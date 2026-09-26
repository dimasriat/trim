#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"

: "${MAINNET_RPC_URL:?set MAINNET_RPC_URL}"
RPC=${DEMO_RPC:-http://127.0.0.1:8545}
PORT=${RPC##*:}
FORK_BLOCK=${FORK_BLOCK:-26050000}
LOG=${DEMO_LOG:-$HOME/.cache/trim/anvil.log}
ORACLE=0x54586bE62E3c3580375aE3723C145253060Ca0C2
WETH=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
USDC=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48

MNEMONIC="test test test test test test test test test test test junk"
export DEPLOYER_KEY=${DEPLOYER_KEY:-$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 0)}
export OWNER_KEY=${OWNER_KEY:-$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 1)}
export FILLER_KEY=${FILLER_KEY:-$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 2)}

if ! cast block-number --rpc-url "$RPC" >/dev/null 2>&1; then
  mkdir -p "$(dirname "$LOG")"
  nohup anvil --host 127.0.0.1 --port "$PORT" --fork-url "$MAINNET_RPC_URL" --fork-block-number "$FORK_BLOCK" >"$LOG" 2>&1 &
  until cast block-number --rpc-url "$RPC" >/dev/null 2>&1; do sleep 1; done
fi

weth_price=$(cast call "$ORACLE" "getAssetPrice(address)(uint256)" "$WETH" --rpc-url "$RPC" | cut -d' ' -f1)
usdc_price=$(cast call "$ORACLE" "getAssetPrice(address)(uint256)" "$USDC" --rpc-url "$RPC" | cut -d' ' -f1)
cast rpc anvil_setCode "$ORACLE" "$(forge inspect DemoAaveOracle deployedBytecode)" --rpc-url "$RPC" >/dev/null
cast send "$ORACLE" "setPrice(address,uint256)" "$WETH" "$weth_price" --private-key "$DEPLOYER_KEY" --rpc-url "$RPC" >/dev/null
cast send "$ORACLE" "setPrice(address,uint256)" "$USDC" "$usdc_price" --private-key "$DEPLOYER_KEY" --rpc-url "$RPC" >/dev/null

export DEPLOYMENTS_PATH=${DEPLOYMENTS_PATH:-./deployments/anvil.json}
forge script script/DeployDemo.s.sol --rpc-url "$RPC" --broadcast --slow >/dev/null
cast rpc evm_snapshot --rpc-url "$RPC" | tr -d '"' >"${DEPLOYMENTS_PATH%.json}.snapshot"
echo "demo ready on $RPC, WETH at $weth_price, $DEPLOYMENTS_PATH"
