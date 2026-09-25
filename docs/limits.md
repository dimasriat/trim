# What this does not answer yet

- **The minimum discount a filler accepts.** Our 0.1 to 0.2% comes from the cost of the same trade (impact plus gas), not from observed filler behaviour. Morpho's flat bonuses cannot tell us: they only show fillers arriving at 1.7%. The one rising curve we found on Morpho Base (6 fills) paid 1.17%. Dutch-auction fills on 1inch Fusion or UniswapX would be the next dataset.
- **Chunked fills at scale.** The \$10M case assumes pieces spread two blocks apart with the pool recovering as measured. A filler that hedges on a centralised exchange would do better; we have not measured that.
- **The boost direction.** When the price rises, a lagging oracle would sell cheap. Both vaults only rebalance toward safety in this build.
- **Discovery.** Fillers need an index of Trim positions. The demo has one position; aggregator routing to Aqua makers like these is 1inch's decision, not ours.
- **Oracle trust.** The Aave vault prices from the same oracle Aave uses for its own health factor, which adds no new trust assumption, but it is still an oracle.
- **Mainnet deployment.** Everything runs on a fork. The SwapVM router with `TrimSkew` is a modified redeployment and is released under the SwapVM license.
