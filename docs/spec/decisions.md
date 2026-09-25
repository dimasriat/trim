# Decisions

| Date | Decision | Why |
|---|---|---|
| 22 Sep | A position auctions its own rebalance; price driven by its health, not a clock | direction and size of a forced trade are public, only its timing can be traded away |
| 25 Sep | Measure the keeper leak onchain before building | the pitch depended on a number we did not have |
| 25 Sep | Lock the framing before the numbers: ≥1% "keepers are expensive", 0.1–1% "small each time, large per year", <0.1% "dependency" | so the numbers could not be cherry-picked |
| 25 Sep | Drop front-running, late keepers and treasury sales from the case | sandwiches ≤1.2%; median keeper delay 4 blocks; CoW TWAP sold the Ethereum Foundation's ETH at 0.18% |
| 25 Sep | Position Trim as "automated, at a manual-grade price, with no operator" | TWAPs are as safe and as cheap, but need someone to set them up; automation today costs 0.5–4.4% |
| 26 Sep | Focus on 1inch; drop the Uniswap v4 hook | 36 hours; the hook was the riskiest piece |
| 26 Sep | Repay before withdrawing via the taker's transfer order | Aave refuses unsafe withdrawals; this removes the need for a flash loan near liquidation |
| 26 Sep | Second position is a 50/50 vault, not a leveraged token | a leveraged token on Aave would prove little about generality; onchain leveraged tokens are a small market |
