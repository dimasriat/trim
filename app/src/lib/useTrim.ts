import { useCallback, useEffect, useRef, useState } from "react";
import { AAVE_POOL, abis, accounts, loadDeployments, orderOf, publicClient, wallets, type Deployments } from "./chain";
import { fillSteps } from "./events";

export const FILL_SIZES = [500_000_000n, 2_000_000_000n, 5_000_000_000n];

export type Quote = { amountIn: bigint; amountOut: bigint; fairOut: bigint; healthFactorAfter: number } | null;

export type TrimState = {
  healthFactor: bigint;
  target: bigint;
  collateralBase: bigint;
  debtBase: bigint;
  liquidationThresholdBps: number;
  ethPrice: bigint;
  usdcPrice: bigint;
  quotes: Quote[];
  fillerWeth: bigint;
  fillerUsdc: bigint;
};

export type Fill = {
  hash: `0x${string}`;
  amountIn: bigint;
  amountOut: bigint;
  fairOut: bigint;
  hfBefore: bigint;
  hfAfter: bigint;
  gasUsed: bigint;
  gasPrice: bigint;
  ethPrice: bigint;
  usdcPrice: bigint;
  steps: string[];
};

export type Activity = { hash: `0x${string}`; label: string; signer: `0x${string}` };

export type DemoConfig = { explorerUrl: string | null; epoch: number; resetEveryMinutes: number; nextResetAt: number | null };

async function loadDemoConfig(): Promise<DemoConfig> {
  const response = await fetch("/demo.json");
  return response.json();
}

async function readQuote(d: Deployments, amountIn: bigint): Promise<Quote> {
  try {
    const { result } = await publicClient.simulateContract({
      address: d.filler,
      abi: abis.filler,
      functionName: "quote",
      args: [orderOf(d), d.usdc, d.weth, amountIn],
      account: accounts.filler,
    });
    const fairOut = await publicClient.readContract({
      address: d.vault,
      abi: abis.vault,
      functionName: "fairAmountOut",
      args: [d.usdc, d.weth, amountIn],
    });
    const deviationAfter = await publicClient.readContract({
      address: d.vault,
      abi: abis.vault,
      functionName: "deviationAfter",
      args: [d.usdc, d.weth, amountIn, result[1]],
    });
    const target = d.targetHealthFactor / 1e18;
    return { amountIn: result[0], amountOut: result[1], fairOut, healthFactorAfter: target * (1 - Number(deviationAfter) / 1e18) };
  } catch {
    return null;
  }
}

async function readState(d: Deployments): Promise<TrimState> {
  const [healthFactor, target, account, ethPrice, usdcPrice, fillerWeth, fillerUsdc, ...quotes] = await Promise.all([
    publicClient.readContract({ address: d.vault, abi: abis.vault, functionName: "healthFactor" }),
    publicClient.readContract({ address: d.vault, abi: abis.vault, functionName: "targetHealthFactor" }),
    publicClient.readContract({ address: AAVE_POOL, abi: abis.pool, functionName: "getUserAccountData", args: [d.vault] }),
    publicClient.readContract({ address: d.oracle, abi: abis.oracle, functionName: "getAssetPrice", args: [d.weth] }),
    publicClient.readContract({ address: d.oracle, abi: abis.oracle, functionName: "getAssetPrice", args: [d.usdc] }),
    publicClient.readContract({ address: d.weth, abi: abis.erc20, functionName: "balanceOf", args: [d.filler] }),
    publicClient.readContract({ address: d.usdc, abi: abis.erc20, functionName: "balanceOf", args: [d.filler] }),
    ...FILL_SIZES.map((size) => readQuote(d, size)),
  ]);
  return {
    healthFactor,
    target,
    collateralBase: account[0],
    debtBase: account[1],
    liquidationThresholdBps: Number(account[3]),
    ethPrice,
    usdcPrice,
    quotes: quotes as Quote[],
    fillerWeth,
    fillerUsdc,
  };
}

export function useTrim() {
  const [deployments, setDeployments] = useState<Deployments | null>(null);
  const [state, setState] = useState<TrimState | null>(null);
  const [fills, setFills] = useState<Fill[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [demo, setDemo] = useState<DemoConfig | null>(null);
  const epoch = useRef<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openPrice = useRef<bigint | null>(null);

  const refresh = useCallback(async () => {
    if (!deployments) return;
    const [next, config] = await Promise.all([readState(deployments), loadDemoConfig()]);
    if (epoch.current !== null && config.epoch !== epoch.current) {
      setFills([]);
      setActivity([]);
    }
    epoch.current = config.epoch;
    setDemo(config);
    if (openPrice.current === null) openPrice.current = next.ethPrice;
    setState(next);
  }, [deployments]);

  useEffect(() => {
    loadDeployments().then(setDeployments).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
    const timer = setInterval(() => refresh().catch(() => {}), 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  const run = useCallback(async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : String(e));
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  const setEthPrice = useCallback((price: bigint) => run("price", async () => {
    if (!deployments) return;
    const hash = await wallets.market.writeContract({
      address: deployments.oracle,
      abi: abis.oracle,
      functionName: "setPrice",
      args: [deployments.weth, price],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    setActivity((previous) => [{ hash, label: `Oracle set ETH to ${(Number(price) / 1e8).toFixed(2)} USD`, signer: accounts.market.address }, ...previous]);
  }), [deployments, run]);

  const movePrice = useCallback((percent: number) => {
    if (!state) return;
    setEthPrice((state.ethPrice * BigInt(100 + percent)) / 100n);
  }, [state, setEthPrice]);

  const resetPrice = useCallback(() => {
    if (openPrice.current !== null) setEthPrice(openPrice.current);
  }, [setEthPrice]);

  const fill = useCallback((amountIn: bigint) => run("fill", async () => {
    if (!deployments) return;
    const quote = await readQuote(deployments, amountIn);
    if (!quote) throw new Error("No offer at this size");
    const hfBefore = await publicClient.readContract({ address: deployments.vault, abi: abis.vault, functionName: "healthFactor" });
    const hash = await wallets.filler.writeContract({
      address: deployments.filler,
      abi: abis.filler,
      functionName: "fill",
      args: [orderOf(deployments), deployments.usdc, deployments.weth, amountIn, quote.amountOut],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const [hfAfter, ethPrice, usdcPrice] = await Promise.all([
      publicClient.readContract({ address: deployments.vault, abi: abis.vault, functionName: "healthFactor" }),
      publicClient.readContract({ address: deployments.oracle, abi: abis.oracle, functionName: "getAssetPrice", args: [deployments.weth] }),
      publicClient.readContract({ address: deployments.oracle, abi: abis.oracle, functionName: "getAssetPrice", args: [deployments.usdc] }),
    ]);
    setActivity((previous) => [{ hash, label: `Filler paid ${Number(amountIn) / 1e6} USDC`, signer: accounts.filler.address }, ...previous]);
    setFills((previous) => [
      {
        hash,
        amountIn,
        amountOut: quote.amountOut,
        fairOut: quote.fairOut,
        hfBefore,
        hfAfter,
        gasUsed: receipt.gasUsed,
        gasPrice: receipt.effectiveGasPrice,
        ethPrice,
        usdcPrice,
        steps: fillSteps(receipt.logs, { aqua: deployments.aqua, pool: AAVE_POOL, usdc: deployments.usdc, weth: deployments.weth }),
      },
      ...previous,
    ]);
  }), [deployments, run]);

  const resetDemo = useCallback(() => run("reset", async () => {
    const response = await fetch("/reset", { method: "POST" });
    if (!response.ok) throw new Error(await response.text());
    setFills([]);
    setActivity([]);
  }), [run]);

  return { deployments, state, fills, activity, demo, busy, error, movePrice, resetPrice, resetDemo, fill, openPrice: openPrice.current };
}
