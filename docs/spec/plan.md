# Build plan

Hacking started 25 Sep 2026, 21:00 JST; submission closes 27 Sep, 09:00 JST.

| Target (JST) | Work | Done when |
|---|---|---|
| 26 Sep 11:00 | `TrimSkew` opcode with marginal pricing | a larger fill gets a worse average price; fork tests green |
| 26 Sep 14:00 | Maker hooks bound to the vault's own order; gas of one fill | a foreign order reverts; a fill near liquidation succeeds |
| 26 Sep 16:00 | A second, non-lending position on the same opcode | 50/50 vault fork tests green |
| 26 Sep 21:00 | End-to-end demo through the UI on a fork | the demo script runs with three wallets, screenshots of each step |
| 27 Sep 01:00 | Whitepaper-style docs | charts redrawn from the datasets in one command |
| 27 Sep 03:00 | AI attribution and planning artifacts | this folder and `AI.md` |
| 27 Sep 06:00 | Video, public repo, submission | submitted |

Cut rule: if contracts and tests were not complete by 26 Sep 16:00, the second
position would be dropped. They were complete at 04:30.

Not built: the Uniswap v4 hook, an ERC-20 share for the vault, the boost direction.
