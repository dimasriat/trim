import { useCallback, useEffect, useRef, useState } from "react";
import { AAVE_POOL, abis, accounts, loadDeployments, orderOf, publicClient, wallets, type Deployments } from "./chain";

export const FILL_SIZES = [500_000_000n, 2_000_000_000n, 5_000_000_000n];

export type Quote = { amountIn: bigint; amountOut: bigint; fairOut: bigint } | null;

export type TrimState = {
  healthFactor: bigint;
  target: bigint;
  collateralBase: bigint;
  debtBase: bigint;
  ethPrice: bigint;
  quotes: Quote[];
  fillerWeth: bigint;
  fillerUsdc: bigint;
};

export type Fill = {
  hash: `0x${string}`;
  amountIn: bigint;
  amountOut: bigint;
  hfBefore: bigint;
  hfAfter: bigint;
  gasUsed: bigint;
};

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
    return { amountIn: result[0], amountOut: result[1], fairOut };
  } catch {
    return null;
  }
}

async function readState(d: Deployments): Promise<TrimState> {
  const [healthFactor, target, account, ethPrice, fillerWeth, fillerUsdc, ...quotes] = await Promise.all([
    publicClient.readContract({ address: d.vault, abi: abis.vault, functionName: "healthFactor" }),
    publicClient.readContract({ address: d.vault, abi: abis.vault, functionName: "targetHealthFactor" }),
    publicClient.readContract({ address: AAVE_POOL, abi: abis.pool, functionName: "getUserAccountData", args: [d.vault] }),
    publicClient.readContract({ address: d.oracle, abi: abis.oracle, functionName: "getAssetPrice", args: [d.weth] }),
    publicClient.readContract({ address: d.weth, abi: abis.erc20, functionName: "balanceOf", args: [d.filler] }),
    publicClient.readContract({ address: d.usdc, abi: abis.erc20, functionName: "balanceOf", args: [d.filler] }),
    ...FILL_SIZES.map((size) => readQuote(d, size)),
  ]);
  return {
    healthFactor,
    target,
    collateralBase: account[0],
    debtBase: account[1],
    ethPrice,
    quotes: quotes as Quote[],
    fillerWeth,
    fillerUsdc,
  };
}

export function useTrim() {
  const [deployments, setDeployments] = useState<Deployments | null>(null);
  const [state, setState] = useState<TrimState | null>(null);
  const [fills, setFills] = useState<Fill[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openPrice = useRef<bigint | null>(null);

  const refresh = useCallback(async () => {
    if (!deployments) return;
    const next = await readState(deployments);
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
    const hfAfter = await publicClient.readContract({ address: deployments.vault, abi: abis.vault, functionName: "healthFactor" });
    setFills((previous) => [
      { hash, amountIn, amountOut: quote.amountOut, hfBefore, hfAfter, gasUsed: receipt.gasUsed },
      ...previous,
    ]);
  }), [deployments, run]);

  return { deployments, state, fills, busy, error, movePrice, resetPrice, fill, openPrice: openPrice.current };
}
