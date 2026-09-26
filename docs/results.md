# Results

## Tests

24 Foundry tests, four suites, three of them on an Ethereum mainnet fork at block 26,050,000 against the real Aave v3 pool:

| Suite | What it shows |
|---|---|
| `TrimSkew.t.sol` | on target there is no offer; exact-in and exact-out prices; the discount caps at the full deviation; a larger fill gets a worse average price; a swap moves exactly the quoted amounts |
| `TrimAaveVault.fork.t.sol` | a fill raises the health factor toward the target and pays a discount against the oracle; overshooting fills and the reverse direction are rejected; hooks refuse other callers and other orders; near liquidation, repay-first fills while withdraw-first reverts; gas of one fill |
| `TrimBalancedVault.fork.t.sol` | a balanced vault has no offer; an ETH rally sells ETH, a slump sells dollars; buying the underweight token and overshooting are rejected |
| `TrimFiller.fork.t.sol` | the filler's quote matches its fill; the minimum-out guard holds; only the operator fills and withdraws |

```bash
cd contracts
MAINNET_RPC_URL=... forge test --threads 1
```

One fill (repay Aave, withdraw collateral, Aqua transfers) costs **556,051 gas** on the fork with cold storage, and 427,563 to 444,663 gas in the demo transactions. That excludes the filler's own sale of what it receives.

## End-to-end demo

`contracts/script/demo-up.sh` starts an anvil fork, swaps the Aave oracle for a settable one seeded with the real prices (`anvil_setCode`), deploys everything and opens a 10 WETH position at health factor 1.60 with a 1.50 target. The app in `app/` gives three roles three wallets: the market moves the ETH price, the owner holds the position, the filler runs `TrimFiller`.

The curve is set at production scale: at most 1% below the oracle, reached 20% below the target health factor. The app shows each number in WETH and USDC, and after every fill who got what.

| Step | ETH (USDC) | LTV, HF | What happens |
|---|---|---|---|
| Healthy | 2,689.77 | 51.9%, 1.60 | no offer at any size |
| ETH −10% | 2,420.79 | 57.6%, 1.44 | 500 USDC offered at 0.16% below the oracle; larger fills would pass the target |
| Fill 500 USDC | | 56.7%, 1.46 | 0.2069 WETH to the filler; the position pays 0.80 USDC (0.16%), the filler is 0.32 USDC short after 1.13 USDC of gas, so a live bot would wait |
| ETH −10% again | 2,178.71 | 63.1%, 1.32 | the discount climbs: 500 USDC at 0.58%, 2,000 USDC at 0.47% |
| Fill 2,000 USDC | | 59.3%, 1.40 | 0.9223 WETH to the filler; the position pays 9.44 USDC (0.47%) against 11.20 USDC at DeFi Saver's median for the size |
| ETH +5% | 2,287.65 | 56.4%, 1.47 | the market turns and the discount shrinks with it: 500 USDC at 0.04% |
| ETH +5% | 2,402.03 | 53.8%, 1.54 | back past the target; the auction closes by itself |

The 0.47% fill is the price of a 10% step with nobody filling in between. In a live market the first bot fills as soon as the discount covers its cost.

The fork is deterministic: running the demo again gives the same numbers.
