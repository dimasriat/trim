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

One fill (repay Aave, withdraw collateral, Aqua transfers) costs **556,051 gas** on the fork with cold storage, and 427,575 to 444,675 gas in the demo transactions. That excludes the filler's own sale of what it receives.

## End-to-end demo

`contracts/script/demo-up.sh` starts an anvil fork, swaps the Aave oracle for a settable one seeded with the real prices (`anvil_setCode`), deploys everything and opens a 10 WETH position at health factor 1.60 with a 1.50 target. The app in `app/` gives three roles three wallets: the market moves the ETH price, the owner holds the position, the filler runs `TrimFiller`.

| Step | Health factor | What happens |
|---|---|---|
| Healthy | 1.60 | no offer at any size |
| ETH −10% | 1.44 | 500 USDC offered at 0.53% below the oracle |
| ETH −10% again | 1.30 | the discount rises to 2.17%; 2,000 USDC now fillable at 1.84% |
| Fill 2,000 USDC | 1.30 → 1.37 | 0.9352 WETH to the filler |
| Fill 2,000 USDC | 1.37 → 1.48 | every size now past the target; the auction stops by itself |
| ETH −10% | 1.33 | the offer reopens at 1.73% |
| Fill 2,000 USDC | 1.33 → 1.45 | 1.0323 WETH to the filler |

The fork is deterministic: running the demo again gives the same numbers.
