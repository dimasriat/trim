# What this does not answer yet

- **The minimum discount a filler accepts, in Trim's own auction.** We measured the closest market: 345 UniswapX Dutch-auction fills of WETH against stablecoins over nine days (\$20.8M, 29 fillers). Fills landed at a median 0.09% *better* than the Chainlink price of the block before, with the middle half between −0.26% and +0.10%. The filler's margin is smaller than the oracle's own resolution (Chainlink updates on about a 0.5% move). We expect Trim fillers to behave the same, but have not observed it.
- **Production parameters.** The demo uses a 5% maximum discount at 30% deviation so that changes are visible on screen, which pays 0.5–2% for small drifts. Given the UniswapX margins, a real deployment should reach about 0.2% at a small deviation and cap the discount far lower.
- **Chunked fills at scale.** The \$10M case assumes pieces spread two blocks apart with the pool recovering as measured. A filler that hedges on a centralised exchange would do better; we have not measured that.
- **The boost direction.** When the price rises, a lagging oracle would sell cheap. Both vaults only rebalance toward safety in this build.
- **Discovery.** Fillers need an index of Trim positions. The demo has one position; aggregator routing to Aqua makers like these is 1inch's decision, not ours.
- **Oracle trust.** The Aave vault prices from the same oracle Aave uses for its own health factor, which adds no new trust assumption, but it is still an oracle.
- **Mainnet deployment.** Everything runs on a fork. The SwapVM router with `TrimSkew` is a modified redeployment and is released under the SwapVM license.
