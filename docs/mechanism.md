# The mechanism

## Pieces

| Contract | Role |
|---|---|
| `TrimSkew` | SwapVM instruction at opcode `0xb6`: prices a swap from how far the maker has drifted from its target |
| `TrimSwapVMRouter` | the Aqua SwapVM router with `TrimSkew` added to its dispatch |
| `ITrimSource` | four view functions a maker implements so `TrimSkew` can price it |
| `TrimAaveVault` | a leveraged Aave v3 position as an Aqua maker |
| `TrimBalancedVault` | a 50/50 two-token vault as an Aqua maker |
| `TrimFiller` | a reference taker that quotes and fills |

A maker ships one Aqua strategy whose program is a single instruction:

```
TrimSkew(source, maxDiscountBps, fullDeviation)
```

The arguments sit in the program bytes, so a filler can read the whole pricing rule before filling.

## Pricing

The source reports its **deviation** $\delta \ge 0$, scaled to $10^{18}$, where $0$ means on target. `TrimSkew` turns it into a discount in basis points, linear up to a cap:

$$
d(\delta) = D \cdot \frac{\min(\delta, \bar\delta)}{\bar\delta}
$$

with $D$ = `maxDiscountBps` and $\bar\delta$ = `fullDeviation`. If $\delta = 0$ the instruction reverts: a position on target has no offer.

![Discount against health factor for D = 5%, target 1.5, full deviation 0.3](/charts/trimskew-curve.svg)

### A fill pays the average of where it starts and where it ends

A discount read only at the current deviation would let the first filler take the whole rebalance at the steepest price. `TrimSkew` asks the source what the deviation would be **after** the fill and charges the average.

For an exact-in fill of $a$ tokens in, with $F$ the fair amount out at the oracle:

$$
d_0 = d(\delta), \qquad
y_0 = \frac{F}{1 - d_0}, \qquad
d_1 = d\big(\delta_{\text{after}}(a, y_0)\big)
$$

$$
y = \frac{F}{1 - \tfrac{1}{2}(d_0 + d_1)}
$$

For an exact-out fill of $y$ tokens out, with $F$ the fair amount in:

$$
a_0 = \Big\lceil F\,(1 - d_0) \Big\rceil, \qquad
d_1 = d\big(\delta_{\text{after}}(a_0, y)\big), \qquad
a = \Big\lceil F\,\big(1 - \tfrac{1}{2}(d_0 + d_1)\big) \Big\rceil
$$

Rounding always favours the maker. A larger fill moves the position further back, ends at a smaller discount and so gets a worse average price:

![Average discount against fill size at health factor 1.30](/charts/marginal.svg)

## The Aave position

`TrimAaveVault` holds a WETH-collateral, USDC-debt position on Aave v3 and sells collateral to repay debt. With $H$ the health factor and $H^*$ the target:

$$
\delta = \max\!\Big(0,\; \frac{H^* - H}{H^*}\Big)
$$

After a fill that repays $a$ USDC and withdraws $y$ WETH, from Aave's own account data (collateral $C$ and debt $B$ in the oracle base currency, liquidation threshold $\lambda$):

$$
H' = \frac{\big(C - y\,p_{\text{WETH}}\big)\,\lambda}{B - a\,p_{\text{USDC}}}
$$

The vault rejects any fill with $H' > H^*$ or that repays the whole debt, so no filler can push the position past its target. It only prices USDC in and WETH out; the reverse direction reverts.

The fill itself runs through two maker hooks in one transaction: `postTransferIn` repays the debt with the USDC that just arrived, `preTransferOut` withdraws the WETH that is about to leave. Both hooks accept only the router, only for the vault's own order hash.

**Near liquidation.** Aave refuses a withdrawal that would drop the health factor below 1. The taker chooses the transfer order, and with `isFirstTransferFromTaker` the debt is repaid before any collateral is withdrawn, so a fill works right up to liquidation with no flash loan. The fork test fills at a health factor below 1.1 this way, and shows the opposite order reverting.

## The 50/50 vault

`TrimBalancedVault` holds two tokens and targets equal value. With $V_x$, $V_y$ the values at the oracle:

$$
\delta = \frac{|V_x - V_y|}{V_x + V_y}
$$

It only sells the overweight token, rejects a fill that would cross to the other side, and treats $\delta < 1\%$ as balanced. The same `TrimSkew` instruction prices it with no changes: the pricing rule knows nothing about Aave.

## Is waiting safe?

A curve that pays more the further a position drifts only works if the position can afford to wait for a filler. Over twelve months of Chainlink ETH/USD updates, the worst 40-minute drop was 13.1% (10 Oct 2025). For ETH collateral against stablecoin debt the health factor falls in proportion, so a trigger at

$$
H \ge \frac{1}{1 - 0.131} \approx 1.15
$$

survives the worst 40 minutes of the year with no filler at all. In a fast crash the deviation grows fast, so the discount grows fast and fills come sooner; the auction is only slow when the market is calm.
