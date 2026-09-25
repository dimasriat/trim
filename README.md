# Trim

Rebalance without a keeper or a dump: the position auctions its own trade, so
bots compete on price instead of speed, and the savings stay with its owner.

Built at ETHGlobal Tokyo 2026 on 1inch Aqua and SwapVM. Docs: `docs/`, served
with the demo.

## Layout

| Path | What |
|---|---|
| `contracts/` | Foundry: the `TrimSkew` SwapVM instruction, router, Aave and 50/50 vaults, reference filler, demo scripts |
| `app/` | Demo UI and a bun server that proxies RPC to the fork and serves the docs |
| `docs/` | Whitepaper-style docs (VitePress, LaTeX) |
| `research/` | Onchain datasets and the scripts that draw the docs' charts |

## Run

```bash
bun install
cd contracts && MAINNET_RPC_URL=... forge test --threads 1
MAINNET_RPC_URL=... contracts/script/demo-up.sh
cd app && bun run build && bun server.ts
cd docs && bun run charts && bun run build
```

## New and reused

| Reused, unmodified | Source |
|---|---|
| Aqua, SwapVM, solidity-utils | [1inch/aqua](https://github.com/1inch/aqua), [1inch/swap-vm](https://github.com/1inch/swap-vm), [1inch/solidity-utils](https://github.com/1inch/solidity-utils) as git submodules |
| OpenZeppelin Contracts, forge-std | git submodules |
| `MockTaker` in tests | from the SwapVM test suite |

Everything under `contracts/src`, `contracts/test`, `contracts/script`, `app/`,
`docs/` and `research/*.py` was written during the hackathon. The datasets in
`research/data` were pulled on 25 Sep 2026, before hacking started, as prior
research; see `research/README.md`. The design was informed by reading Index
Coop's leverage extensions, Risedle, Morpho pre-liquidations and DeFi Saver's
automation contracts; no code from them is included.

## License

MIT, except `contracts/src/instructions/TrimSkew.sol` and
`contracts/src/TrimSwapVMRouter.sol`, which extend SwapVM and are released under
the SwapVM license (`LicenseRef-Degensoft-SwapVM-1.1`) as that license requires
for modified versions.

## Commit hooks

```bash
git config core.hooksPath .githooks
```

The hooks keep commits small (400 changed lines, 20 files; lockfiles, CSV and
images excluded) and subjects under 72 characters with a conventional prefix
(`feat:`, `fix:`, `test:`, `chore:`, `docs:`, `refactor:`), so the history shows
the work as it happened.
