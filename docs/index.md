# Trim

**Rebalance without a keeper or a dump: the position auctions its own trade, so bots compete on price instead of speed, and the savings stay with its owner.**

A leveraged position has to rebalance whenever the market moves. Today it pays a keeper to do it. The keeper charges a fee, bills gas at a markup, and on large positions sells everything in one swap, so the sale itself moves the pool against the owner.

Trim is a new SwapVM instruction, `TrimSkew`, that lets a position price its own rebalance on 1inch Aqua. The price is set by how far the position has drifted from its target, not by a clock. The further it drifts, the better the deal for whoever fills it. Anyone can fill, in any size up to the target, and every fill is checked onchain.

| | Keeper today | Trim |
|---|---|---|
| Who watches the position | the keeper's bot | nobody; the contract knows it has drifted |
| Who may execute | only the bot you authorised | anyone, at the curve's price |
| Operator fee | 0.25% plus gas billed at 5.6× | none |
| Large positions | sold in one swap, up to 10% lost | filled in pieces as the price allows |

- [The problem, measured](/problem): 919 keeper rebalances, 6,395 Morpho pre-liquidations, 33 Index Coop ripcords, 17 Ethereum Foundation TWAP sales.
- [The mechanism](/mechanism): the `TrimSkew` pricing rule and the two positions built on it.
- [Results](/results): 24 tests on a mainnet fork and the end-to-end demo.
- [What this does not answer yet](/limits)
