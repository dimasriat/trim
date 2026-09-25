# Trim

Rebalance without a keeper or a dump: the position auctions its own trade, so
bots compete on price instead of speed, and the savings stay with its owner.

Built at ETHGlobal Tokyo 2026 on 1inch Aqua and SwapVM.

## Layout

| Path | What |
|---|---|
| `contracts/` | Foundry: the `TrimSkew` SwapVM instruction, maker hooks, positions |
| `app/` | Demo UI |
| `docs/` | Whitepaper-style docs and specs |
| `research/` | Onchain measurements behind the docs' numbers |

## Setup

```bash
git config core.hooksPath .githooks
```

The hooks keep commits small (400 changed lines, 20 files; lockfiles, CSV and
images excluded) and subjects under 72 characters, so the history shows the
work as it happened.
