# How it works, in two minutes

## One fill, left to right

```
Filler bot ──fill()──▶ TrimSwapVMRouter  (official SwapVM + one instruction, 0xb6)
                          │  runs the order's program: TrimSkew(vault, maxDiscount, fullDeviation)
                          │  TrimSkew asks the vault: deviation(), fairAmountOut(), deviationAfter()
                          │  price = fair amount ÷ (1 − average discount)
                          ▼
                     official Aqua (0x4999…6d31)
   Aqua.push   USDC  filler ──▶ vault      vault.postTransferIn   repays the Aave debt
   Aqua.pull   WETH  vault  ──▶ filler     vault.preTransferOut   withdraws it from Aave first
```

All of it is one transaction. The collateral never sits idle in the vault: it stays supplied on Aave, and Aqua only holds a *virtual* 10 WETH balance for the strategy. The hook withdraws exactly what a fill takes, just in time. That is Aqua's shared-liquidity idea applied to a leveraged position.

Who signs what:

| Role | Signs | Can do |
|---|---|---|
| Owner | `vault.open()`, `vault.ship(order)` | open the position, choose the curve (it lives in the order's bytes) |
| Filler | `TrimFiller.fill()` | swap at the curve's price, only toward the target |
| Anyone | nothing | read the rule from the program bytes before filling |

## The math

The vault measures how far it has drifted, relative to its target health factor $H^*$:

$$
\delta = \frac{H^* - H}{H^*}
$$

This is relative, not "LTV minus target LTV in points". With a 1.50 target, HF 1.32 is $\delta = 12\%$. In LTV terms that is 63.1% against a 55.3% target: 7.7 points, but the curve reads 12%.

The discount rises in a straight line and stops at the maximum:

$$
d(\delta) = D \cdot \frac{\min(\delta, \bar\delta)}{\bar\delta}
$$

A fill pays the **average of the discount where it starts and where it ends**, because the fill itself pulls the position back toward the target:

$$
\text{out} = \frac{\text{fair out}}{1 - \tfrac12\,(d_0 + d_1)}
$$

Worked, from the demo: $D = 1\%$, $\bar\delta = 20\%$, ETH at 2,178.71 USDC, HF 1.32.

| | Value |
|---|---|
| $\delta$ now | 12.3% |
| $d_0$ | 1% × 12.3 ÷ 20 = 0.61% |
| a 2,000 USDC fill brings HF to 1.40, so $d_1$ | 0.33% |
| average | 0.47% |
| fair out | 2,000 ÷ 2,178.71 = 0.9180 WETH |
| filler gets | 0.9180 ÷ (1 − 0.0047) = 0.9223 WETH |
| position pays | 0.9223 WETH ≈ 2,009.44 USDC for 2,000 USDC of debt: 9.44 USDC |

Why the average: a bigger fill gets a worse price, so nobody can take the whole rebalance at the steepest discount. On a straight line the average of the two ends is exactly the average over the path. On the real position $d_1$ is read from an estimate, so slicing a fill is not perfectly neutral; in our simulation it moved about one extra fill's gas.

## Why these choices

- **A new instruction, not an Extruction.** The same pricing could run as an Extruction call on the canonical router. As an opcode, the two curve parameters sit in the program bytes, so a taker reads the whole rule without trusting an external contract, and it saves a call. The trade-off: until 1inch adopts the opcode, fills go through our router, which is the official SwapVM plus one instruction.
- **Price from Aave's own oracle.** The position is liquidated by that oracle; pricing the rebalance from it adds no new trust assumption.
- **Only toward safety.** The vault rejects fills that pass the target or go the other way, so a filler can never make the position worse.
