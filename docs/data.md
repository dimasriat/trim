# Research data

Every number on the problem page comes from these files. They were collected before the hackathon from public chain data (an archive node and the protocols' own events) and are included as data, not code. The charts are drawn from them by `research/charts.py` in the repo.

| File | Rows | What it backs |
|---|---|---|
| [defisaver_aavev3.csv](/docs/data/defisaver_aavev3.csv) | 921 (919 used) | DeFi Saver automated rebalances on Aave v3 mainnet over twelve months: the 0.48% median leak, 0.56% for $1k–$10k, the fee and gas split |
| [defisaver_aavev3_delay.csv](/docs/data/defisaver_aavev3_delay.csv) | 919 | Blocks from trigger to execution: keepers are not slow (median 4 blocks) |
| [defisaver_aavev3_mev.csv](/docs/data/defisaver_aavev3_mev.csv) | 919 | Swaps right after each rebalance in the same pool: 105 different backrunning contracts |
| [pool_recovery.csv](/docs/data/pool_recovery.csv) | 30 | Uniswap ETH price around the two largest rebalances, block by block |
| [uniswapx.csv](/docs/data/uniswapx.csv) | 345 | UniswapX WETH/stablecoin fills against the Aave oracle: median filler margin −0.09% |
| [morpho_preliq_eth.csv](/docs/data/morpho_preliq_eth.csv) | 3,030 | Morpho pre-liquidations on Ethereum and the bonus paid |
| [morpho_preliq_base.csv](/docs/data/morpho_preliq_base.csv) | 3,365 | The same on Base |
| [ripcord.csv](/docs/data/ripcord.csv) | 33 | Index Coop leveraged-token ripcord calls and their fixed reward |

Not included as files: the Chainlink ETH/USD drawdown (worst 40 minutes over twelve months, 13.1%) and the fork price-impact table were computed live from an RPC and are quoted on the problem page.
