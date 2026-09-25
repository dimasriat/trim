# The problem, measured

Every number on this page comes from onchain data in [`research/data`](https://github.com/dimasriat/trim/tree/main/research/data), and every chart is redrawn by `research/charts.py`.

## Keepers leak on every rebalance

We pulled all 919 automated rebalances that DeFi Saver executed on Aave v3 mainnet over twelve months (blocks 23,420,000 to 26,053,000): repays, boosts and their flash-loan variants.

For each one we measure the leak from the position's point of view, at the Aave oracle price of the block before execution:

$$
L = 1 - \frac{V(\text{value put into the position})}{V(\text{value taken out of the position})}
$$

This single number includes the service fee, the gas billed to the user, flash-loan fees and the swap itself.

| Measure | Value |
|---|---|
| Notional rebalanced | \$340M |
| Lost | \$5.6M |
| Median leak per rebalance | 0.48% |
| Notional-weighted leak | 1.65% |
| Rebalances of \$1M or more (64) | 1.85% |

The median decomposes into a 0.25% service fee, 0.10% gas billed to the user and 0.06% swap cost against the oracle. Across the year the keeper billed **\$203k of gas while spending \$36k**, a 5.6× markup.

![Median cost per rebalance by size](/charts/leak-by-size.svg)

The green bars remove only the operator: the same swap at the same pool, with the gas the keeper actually paid. For rebalances between \$1k and \$1M that alone saves about 0.3 points. Below \$1k gas is 3% of the trade and nobody wins on mainnet.

## Large rebalances dump on themselves

The two largest leaks were flash-loan repays of \$10.4M and \$9.1M, each selling wstETH through a single Uniswap v3 USDC/WETH pool. They lost 6.7% and 9.8%.

The market did not crash. The keeper's own swap moved the pool, and arbitrageurs moved it back within two blocks:

![Uniswap price around the two largest repays](/charts/dump-recovery.svg)

A fork quote of the full 4,526 WETH reproduces the real execution to the unit (9,754,211 USDC), so the impact curve below is the pool's real depth at that block:

| Sold per piece | Impact |
|---|---|
| All at once (\$10M) | 6.04% |
| 1/10 | 3.18% |
| 1/50 | 0.90% |
| 1/100 | 0.48% |

With the pool recovering 97% within two blocks, selling in 100 pieces costs about 0.5% instead of 6%.

The difference goes to whoever trades right after. Across all 919 rebalances, a same-pool swap follows the rebalance 24% of the time below \$100k and 70% of the time above \$1M, against 13% and 28% right before it. 105 different contracts did those backruns (HHI 0.034), so the fillers already exist and already compete.

## A fixed bonus does not get cheaper with competition

Morpho shipped a pre-liquidation contract whose bonus can rise linearly with the loan-to-value, a quasi-Dutch auction. We measured every pre-liquidation on Ethereum and Base:

| | Ethereum | Base |
|---|---|---|
| Pre-liquidations | 3,030 | 3,365 |
| Distinct fillers | 155 | 43 |
| Fills through a rising curve | 0 | 6 |
| Median bonus paid | 4.38% | 4.38% |

![Bonus paid per Morpho pre-liquidation](/charts/morpho-bonus.svg)

99.9% of fills used a flat bonus. With 155 bots racing, the price never moved: the race was on speed. Morpho marked pre-liquidation as deprecated on 22 Sep 2026 with no successor.

Index Coop's emergency `ripcord()` shows the same flaw from the other side. It pays a fixed ETH reward regardless of size: \$445 to rebalance \$501 in one case, nothing to rebalance \$210,517 in another, which was then called by the same two addresses that call all the unrewarded ripcords.

## What we measured and dropped

Some of our own claims did not survive the data, and they are not part of this project's case:

- **Front-running.** At most 11 of 919 rebalances (1.2%) look sandwiched, with a loose heuristic.
- **Late keepers.** From a position crossing its trigger to execution: median 4 blocks, 90th percentile 9 minutes.
- **Clock-based selling is unsafe.** It is not. The Ethereum Foundation sold \$15.6M of ETH through CoW Swap TWAPs at 0.18% against the oracle, and a 4 × 15-minute TWAP never let a simulated position reach liquidation over twelve months of Chainlink prices.

What remains is narrower and holds: **automation today is expensive (0.5% at DeFi Saver, 4.4% at Morpho), and the cheap way to trade is manual.** Trim gives an automated position a manual-grade price with no operator.
