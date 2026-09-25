# How AI was used

Trim was built by one person, dimasriat, working mostly from a phone over SSH,
with Claude Code (Claude Opus 5.5) running on a VPS. This file says who did what,
as the ETHGlobal rules ask.

## Written by Claude Code, directed and reviewed by the author

- All Solidity in `contracts/src`, `contracts/test` and `contracts/script`, test-first.
- The demo app in `app/` and its server.
- The docs text in `docs/` and the chart scripts in `research/`.
- The onchain data pulls behind `research/data` (before the hackathon, as research).

## Decided by the author

Each decision is dated in the author's notes; the planning trail is in
[`docs/spec`](docs/spec).

- The idea itself: a position that prices its own rebalance, and the choice of
  1inch Aqua and SwapVM (22 Sep).
- To measure the keeper leak onchain before building, and to lock the framing
  before seeing the numbers (25 Sep).
- To drop claims the data did not support: front-running, late keepers, unsafe
  TWAPs, treasury sales (25 Sep).
- To focus on 1inch and drop the Uniswap v4 hook; a bun monorepo; small
  conventional commits enforced by hooks; the demo as three wallets on a fork
  driven through the UI (26 Sep).

## Written by the author

- The `TrimSkew` curve: Claude wrote the first version and its tests; the author
  learned it through a question-and-answer session and rewrote it; the tests are
  unchanged. See the commit history of `contracts/src/instructions/TrimSkew.sol`.
