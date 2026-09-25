# Research data

Onchain measurements behind the numbers in `docs/`. The raw pulls were made on
25 Sep 2026, before hacking started, and are disclosed as prior research; the
chart scripts in this folder were written during the hackathon.

| File | What | Source |
|---|---|---|
| `defisaver_aavev3.csv` | 919 DeFi Saver automated repay and boost executions on Aave v3 mainnet, blocks 23,420,000 to 26,053,000, with value in and out at the Aave oracle price of the previous block | DefisaverLogger `RecipeEvent`, receipts, Aave oracle |
| `defisaver_aavev3_delay.csv` | Blocks from a position crossing its trigger (or being subscribed) to execution | Trigger data from `executeStrategy` input, `getUserAccountData` at historical blocks |
| `defisaver_aavev3_mev.csv` | Same-pool swaps right before and after each rebalance | Neighbouring transactions in the same block |
| `morpho_preliq_eth.csv`, `morpho_preliq_base.csv` | Every Morpho pre-liquidation, realized incentive factor | `PreLiquidate` events, pre-liquidation oracle at the previous block |
| `ripcord.csv` | Every Index Coop `RipcordCalled` on Ethereum and Arbitrum | Extension events, caller, reward |
