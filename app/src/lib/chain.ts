import { createPublicClient, createWalletClient, defineChain, http, parseAbi } from "viem";
import { mnemonicToAccount } from "viem/accounts";

export type Deployments = {
  aqua: `0x${string}`;
  vault: `0x${string}`;
  filler: `0x${string}`;
  oracle: `0x${string}`;
  router: `0x${string}`;
  weth: `0x${string}`;
  usdc: `0x${string}`;
  owner: `0x${string}`;
  operator: `0x${string}`;
  orderMaker: `0x${string}`;
  orderTraits: string;
  orderData: `0x${string}`;
  maxDiscountBps: number;
  fullDeviation: number;
  targetHealthFactor: number;
};

export const AAVE_POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2" as const;
const DEMO_MNEMONIC = "test test test test test test test test test test test junk";

export const demoFork = defineChain({
  id: 1,
  name: "Mainnet fork",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["/rpc"] } },
});

const transport = http("/rpc");

export const publicClient = createPublicClient({ chain: demoFork, transport });

export const accounts = {
  market: mnemonicToAccount(DEMO_MNEMONIC, { addressIndex: 0 }),
  owner: mnemonicToAccount(DEMO_MNEMONIC, { addressIndex: 1 }),
  filler: mnemonicToAccount(DEMO_MNEMONIC, { addressIndex: 2 }),
};

export const wallets = {
  market: createWalletClient({ chain: demoFork, transport, account: accounts.market }),
  filler: createWalletClient({ chain: demoFork, transport, account: accounts.filler }),
  owner: createWalletClient({ chain: demoFork, transport, account: accounts.owner }),
};

export const abis = {
  vault: parseAbi([
    "function healthFactor() view returns (uint256)",
    "function targetHealthFactor() view returns (uint256)",
    "function fairAmountOut(address tokenIn, address tokenOut, uint256 amountIn) view returns (uint256)",
    "function deviationAfter(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut) view returns (uint256)",
    "struct Order { address maker; uint256 traits; bytes data; }",
    "function ship(Order order, uint256 collateralLimit) returns (bytes32)",
  ]),
  aqua: parseAbi(["event Shipped(address maker, address app, bytes32 strategyHash, bytes strategy)"]),
  aquaMoves: parseAbi([
    "event Pushed(address maker, address app, bytes32 strategyHash, address token, uint256 amount)",
    "event Pulled(address maker, address app, bytes32 strategyHash, address token, uint256 amount)",
  ]),
  oracleEvents: parseAbi(["event PriceSet(address indexed asset, uint256 price)"]),
  pool: parseAbi([
    "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
  ]),
  oracle: parseAbi([
    "function getAssetPrice(address asset) view returns (uint256)",
    "function setPrice(address asset, uint256 price)",
  ]),
  filler: parseAbi([
    "struct Order { address maker; uint256 traits; bytes data; }",
    "function quote(Order order, address tokenIn, address tokenOut, uint256 amountIn) returns (uint256, uint256)",
    "function fill(Order order, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut) returns (uint256, uint256)",
  ]),
  erc20: parseAbi(["function balanceOf(address owner) view returns (uint256)"]),
};

export async function loadDeployments(): Promise<Deployments> {
  const response = await fetch("/deployments.json");
  return response.json();
}

export type Order = { maker: `0x${string}`; traits: bigint; data: `0x${string}` };

export function orderOf(d: Deployments): Order {
  return { maker: d.orderMaker, traits: BigInt(d.orderTraits), data: d.orderData };
}
