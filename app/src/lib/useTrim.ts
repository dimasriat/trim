import { useCallback, useEffect, useRef, useState } from "react";
import { BaseError, decodeAbiParameters, type Hex } from "viem";
import { AAVE_POOL, abis, accounts, loadDeployments, orderOf, publicClient, wallets, type Deployments, type Order } from "./chain";
import { curveFromOrderData, withCurve } from "./order";
import type { CurveParams } from "./trim";
import { fillSteps } from "./events";
import { pairFills } from "./history";
import { largestPassing } from "./bot";

export const FILL_SIZES = [500_000_000n, 2_000_000_000n, 5_000_000_000n];

const FORK_BLOCK = 26_050_000n;
const COLLATERAL_LIMIT = 10n * 10n ** 18n;
const FILL_STEP = 10_000_000n;
const REFRESH_MS = 3000;
const FILL_GAS = 460_000n;

export type Quote = { amountIn: bigint; amountOut: bigint; fairOut: bigint; healthFactorAfter: number } | null;

export type Shipment = { order: Order; block: bigint; hash: Hex };

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
  order: Order;
  shipped: Order[];
};

export type Fill = {
  hash: Hex;
  block: bigint;
  amountIn: bigint;
  amountOut: bigint;
  fairOut: bigint;
  hfBefore: bigint;
  hfAfter: bigint;
  gasUsed: bigint;
  gasPrice: bigint;
  gasUsdc: number;
  ethPrice: bigint;
  usdcPrice: bigint;
  steps: string[];
  curve: CurveParams | null;
};

export type ActivityKind = "oracle" | "bot" | "owner";

export type Activity = { hash: Hex; block: bigint; kind: ActivityKind; label: string; signer: `0x${string}` };

export type Session = { startBlock: bigint; openPrice: bigint; fillerStartUsdc: bigint };

export type DemoConfig = { explorerUrl: string | null; epoch: number; resetEveryMinutes: number; nextResetAt: number | null };

export type AutoBot = { on: boolean; costBps: number };

export type CrashProgress = { step: number; steps: number; price: number; fills: number };

export type TargetQuote = { amountIn: bigint; amountOut: bigint; fairOut: bigint } | null;

async function loadDemoConfig(): Promise<DemoConfig> {
  const response = await fetch("/demo.json");
  return response.json();
}

function curveOf(order: Order, d: Deployments): CurveParams | null {
  const shipped = curveFromOrderData(order.data);
  return shipped
    ? { maxDiscountBps: shipped.maxDiscountBps, fullDeviation: Number(shipped.fullDeviation) / 1e18, target: d.targetHealthFactor / 1e18 }
    : null;
}

export function errorText(e: unknown): string {
  if (e instanceof BaseError) return e.shortMessage.replace(/\s+/g, " ");
  return e instanceof Error ? e.message.split("\n")[0] : String(e);
}

async function readShipments(d: Deployments): Promise<Shipment[]> {
  const logs = await publicClient.getLogs({ address: d.aqua, event: abis.aqua[0], fromBlock: FORK_BLOCK, toBlock: "latest" });
  return logs
    .filter((log) => log.args.maker?.toLowerCase() === d.vault.toLowerCase())
    .map((log) => {
      const [order] = decodeAbiParameters(
        [{ type: "tuple", components: [{ name: "maker", type: "address" }, { name: "traits", type: "uint256" }, { name: "data", type: "bytes" }] }],
        log.args.strategy!,
      );
      return { order: order as Order, block: log.blockNumber, hash: log.transactionHash };
    });
}

async function simulateFill(d: Deployments, order: Order, amountIn: bigint): Promise<{ amountOut: bigint; fairOut: bigint } | null> {
  try {
    const { result } = await publicClient.simulateContract({
      address: d.filler,
      abi: abis.filler,
      functionName: "fill",
      args: [order, d.usdc, d.weth, amountIn, 0n],
      account: accounts.filler,
    });
    const fairOut = await publicClient.readContract({ address: d.vault, abi: abis.vault, functionName: "fairAmountOut", args: [d.usdc, d.weth, amountIn] });
    return { amountOut: result[1], fairOut };
  } catch {
    return null;
  }
}

async function readQuote(d: Deployments, order: Order, amountIn: bigint): Promise<Quote> {
  const filled = await simulateFill(d, order, amountIn);
  if (!filled) return null;
  try {
    const deviationAfter = await publicClient.readContract({
      address: d.vault,
      abi: abis.vault,
      functionName: "deviationAfter",
      args: [d.usdc, d.weth, amountIn, filled.amountOut],
    });
    const target = d.targetHealthFactor / 1e18;
    return { amountIn, ...filled, healthFactorAfter: target * (1 - Number(deviationAfter) / 1e18) };
  } catch {
    return null;
  }
}

async function readState(d: Deployments, order: Order, shipped: Order[]): Promise<TrimState> {
  const [healthFactor, target, account, ethPrice, usdcPrice, fillerWeth, fillerUsdc, ...quotes] = await Promise.all([
    publicClient.readContract({ address: d.vault, abi: abis.vault, functionName: "healthFactor" }),
    publicClient.readContract({ address: d.vault, abi: abis.vault, functionName: "targetHealthFactor" }),
    publicClient.readContract({ address: AAVE_POOL, abi: abis.pool, functionName: "getUserAccountData", args: [d.vault] }),
    publicClient.readContract({ address: d.oracle, abi: abis.oracle, functionName: "getAssetPrice", args: [d.weth] }),
    publicClient.readContract({ address: d.oracle, abi: abis.oracle, functionName: "getAssetPrice", args: [d.usdc] }),
    publicClient.readContract({ address: d.weth, abi: abis.erc20, functionName: "balanceOf", args: [d.filler] }),
    publicClient.readContract({ address: d.usdc, abi: abis.erc20, functionName: "balanceOf", args: [d.filler] }),
    ...FILL_SIZES.map((size) => readQuote(d, order, size)),
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
    order,
    shipped,
  };
}

async function readSession(d: Deployments, startBlock: bigint): Promise<Session> {
  const [openPrice, fillerStartUsdc] = await Promise.all([
    publicClient.readContract({ address: d.oracle, abi: abis.oracle, functionName: "getAssetPrice", args: [d.weth], blockNumber: startBlock }),
    publicClient.readContract({ address: d.usdc, abi: abis.erc20, functionName: "balanceOf", args: [d.filler], blockNumber: startBlock }),
  ]);
  return { startBlock, openPrice, fillerStartUsdc };
}

async function readFill(d: Deployments, event: { hash: string; block: bigint; amountIn: bigint; amountOut: bigint }, shipments: Shipment[]): Promise<Fill> {
  const before = event.block - 1n;
  const hash = event.hash as Hex;
  const [receipt, hfBefore, hfAfter, fairOut, ethPrice, usdcPrice] = await Promise.all([
    publicClient.getTransactionReceipt({ hash }),
    publicClient.readContract({ address: d.vault, abi: abis.vault, functionName: "healthFactor", blockNumber: before }),
    publicClient.readContract({ address: d.vault, abi: abis.vault, functionName: "healthFactor", blockNumber: event.block }),
    publicClient.readContract({ address: d.vault, abi: abis.vault, functionName: "fairAmountOut", args: [d.usdc, d.weth, event.amountIn], blockNumber: before }),
    publicClient.readContract({ address: d.oracle, abi: abis.oracle, functionName: "getAssetPrice", args: [d.weth], blockNumber: event.block }),
    publicClient.readContract({ address: d.oracle, abi: abis.oracle, functionName: "getAssetPrice", args: [d.usdc], blockNumber: event.block }),
  ]);
  const order = shipments.filter((shipment) => shipment.block < event.block).at(-1)?.order ?? orderOf(d);
  const gasWei = receipt.gasUsed * receipt.effectiveGasPrice;
  return {
    hash,
    block: event.block,
    amountIn: event.amountIn,
    amountOut: event.amountOut,
    fairOut,
    hfBefore,
    hfAfter,
    gasUsed: receipt.gasUsed,
    gasPrice: receipt.effectiveGasPrice,
    gasUsdc: (Number(gasWei) / 1e18) * (Number(ethPrice) / Number(usdcPrice)),
    ethPrice,
    usdcPrice,
    steps: fillSteps(receipt.logs, { aqua: d.aqua, pool: AAVE_POOL, usdc: d.usdc, weth: d.weth }),
    curve: curveOf(order, d),
  };
}

async function readFillEvents(d: Deployments, fromBlock: bigint) {
  const [pushed, pulled] = await Promise.all(
    [abis.aquaMoves[0], abis.aquaMoves[1]].map((event) => publicClient.getLogs({ address: d.aqua, event, fromBlock, toBlock: "latest" })),
  );
  const moves = (logs: typeof pushed) =>
    logs.map((log) => ({ hash: log.transactionHash, block: log.blockNumber, maker: log.args.maker!, token: log.args.token!, amount: log.args.amount! }));
  return pairFills(moves(pushed), moves(pulled), { vault: d.vault, usdc: d.usdc, weth: d.weth });
}

async function readPriceMoves(d: Deployments, fromBlock: bigint): Promise<(Activity & { price: number })[]> {
  const logs = await publicClient.getLogs({ address: d.oracle, event: abis.oracleEvents[0], args: { asset: d.weth }, fromBlock, toBlock: "latest" });
  return logs.map((log) => ({
    hash: log.transactionHash,
    block: log.blockNumber,
    price: Number(log.args.price) / 1e8,
    kind: "oracle" as const,
    label: `Oracle set ETH to ${(Number(log.args.price) / 1e8).toFixed(2)} USD`,
    signer: accounts.market.address,
  }));
}

export function useTrim() {
  const [deployments, setDeployments] = useState<Deployments | null>(null);
  const [state, setState] = useState<TrimState | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [fills, setFills] = useState<Fill[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [demo, setDemo] = useState<DemoConfig | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoBot, setAutoBot] = useState<AutoBot>({ on: false, costBps: 15 });
  const [targetQuote, setTargetQuote] = useState<TargetQuote>(null);
  const [crash, setCrash] = useState<CrashProgress | null>(null);
  const stopCrash = useRef(false);
  const targetQuoteBlock = useRef<bigint | null>(null);
  const fillCache = useRef(new Map<string, Fill>());
  const autoBotRef = useRef(autoBot);
  autoBotRef.current = autoBot;

  const refresh = useCallback(async () => {
    if (!deployments) return;
    const shipments = await readShipments(deployments);
    const startBlock = shipments[0]?.block ?? FORK_BLOCK;
    const order = shipments.at(-1)?.order ?? orderOf(deployments);
    const [next, config, currentSession, events, priceMoves] = await Promise.all([
      readState(deployments, order, shipments.map((shipment) => shipment.order)),
      loadDemoConfig(),
      session?.startBlock === startBlock ? Promise.resolve(session) : readSession(deployments, startBlock),
      readFillEvents(deployments, startBlock),
      readPriceMoves(deployments, startBlock + 1n),
    ]);
    const known = new Set(events.map((event) => event.hash));
    for (const hash of fillCache.current.keys()) if (!known.has(hash)) fillCache.current.delete(hash);
    for (const event of events) {
      if (!fillCache.current.has(event.hash)) fillCache.current.set(event.hash, await readFill(deployments, event, shipments));
    }
    const allFills = events.map((event) => fillCache.current.get(event.hash)!).reverse();
    const ownerShips: Activity[] = shipments.slice(1).map((shipment) => {
      const curve = curveFromOrderData(shipment.order.data);
      return {
        hash: shipment.hash,
        block: shipment.block,
        kind: "owner",
        label: curve ? `Owner shipped a curve: ${curve.maxDiscountBps / 100}% max at ${(Number(curve.fullDeviation) / 1e16).toFixed(0)}% below target` : "Owner shipped a curve",
        signer: accounts.owner.address,
      };
    });
    const fillActivity: Activity[] = allFills.map((fill) => ({
      hash: fill.hash,
      block: fill.block,
      kind: "bot",
      label: `Bot repaid ${(Number(fill.amountIn) / 1e6).toLocaleString("en-US")} USDC of debt, got ${(Number(fill.amountOut) / 1e18).toFixed(4)} WETH`,
      signer: accounts.filler.address,
    }));
    setActivity([...priceMoves, ...ownerShips, ...fillActivity].sort((a, b) => (a.block > b.block ? -1 : a.block < b.block ? 1 : 0)));
    const block = await publicClient.getBlockNumber();
    if (targetQuoteBlock.current !== block) {
      targetQuoteBlock.current = block;
      let quote: TargetQuote = null;
      if (next.healthFactor < next.target && next.fillerUsdc >= FILL_STEP) {
        const size = await largestPassing(FILL_STEP, next.fillerUsdc, FILL_STEP, async (s) => (await simulateFill(deployments, order, s)) !== null);
        const filled = size === null ? null : await simulateFill(deployments, order, size);
        if (size !== null && filled) quote = { amountIn: size, ...filled };
      }
      setTargetQuote(quote);
    }
    setFills(allFills);
    setSession(currentSession);
    setDemo(config);
    setState(next);
  }, [deployments, session]);

  useEffect(() => {
    loadDeployments().then(setDeployments).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(errorText(e)));
    const timer = setInterval(() => refresh().catch(() => {}), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const run = useCallback(async (label: string, action: () => Promise<void>) => {
    targetQuoteBlock.current = null;
    setBusy(label);
    setError(null);
    try {
      await action();
      targetQuoteBlock.current = null;
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  const currentOrder = useCallback(async () => {
    if (!deployments) throw new Error("not connected");
    return (await readShipments(deployments)).at(-1)?.order ?? orderOf(deployments);
  }, [deployments]);

  const writePrice = useCallback(async (price: bigint) => {
    if (!deployments) return;
    const hash = await wallets.market.writeContract({ address: deployments.oracle, abi: abis.oracle, functionName: "setPrice", args: [deployments.weth, price] });
    await publicClient.waitForTransactionReceipt({ hash });
  }, [deployments]);

  const writeFill = useCallback(async (order: Order, amountIn: bigint, minOut: bigint) => {
    if (!deployments) return;
    const hash = await wallets.filler.writeContract({
      address: deployments.filler,
      abi: abis.filler,
      functionName: "fill",
      args: [order, deployments.usdc, deployments.weth, amountIn, minOut],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }, [deployments]);

  const botStep = useCallback(async () => {
    if (!deployments) return;
    const { costBps } = autoBotRef.current;
    const order = await currentOrder();
    const balance = await publicClient.readContract({ address: deployments.usdc, abi: abis.erc20, functionName: "balanceOf", args: [deployments.filler] });
    if (balance < FILL_STEP) return;
    const worthIt = async (size: bigint) => {
      const filled = await simulateFill(deployments, order, size);
      return filled !== null && Number(filled.amountOut - filled.fairOut) / Number(filled.amountOut) >= costBps / 10_000;
    };
    const size = await largestPassing(FILL_STEP, balance, FILL_STEP, worthIt);
    if (size === null) return;
    const filled = await simulateFill(deployments, order, size);
    if (!filled) return;
    const [gasPrice, ethPrice, usdcPrice] = await Promise.all([
      publicClient.getGasPrice(),
      publicClient.readContract({ address: deployments.oracle, abi: abis.oracle, functionName: "getAssetPrice", args: [deployments.weth] }),
      publicClient.readContract({ address: deployments.oracle, abi: abis.oracle, functionName: "getAssetPrice", args: [deployments.usdc] }),
    ]);
    const gasUsdc = (Number(FILL_GAS * gasPrice) / 1e18) * (Number(ethPrice) / Number(usdcPrice));
    const discountUsdc = (Number(size) / 1e6) * (Number(filled.amountOut) / Number(filled.fairOut) - 1);
    if (discountUsdc < gasUsdc + (Number(size) / 1e6) * (costBps / 10_000)) return;
    await writeFill(order, size, filled.amountOut);
  }, [deployments, currentOrder, writeFill]);

  const setEthPrice = useCallback((price: bigint) => run("price", async () => {
    await writePrice(price);
    if (autoBotRef.current.on) await botStep();
  }), [run, writePrice, botStep]);

  const movePrice = useCallback((percent: number) => {
    if (!state) return;
    setEthPrice((state.ethPrice * BigInt(100 + percent)) / 100n);
  }, [state, setEthPrice]);

  const resetPrice = useCallback(() => {
    if (session) setEthPrice(session.openPrice);
  }, [session, setEthPrice]);

  const slowCrash = useCallback((totalPercent: number, steps: number, withBot = false) => run("crash", async () => {
    if (!state || !deployments) return;
    const start = Number(state.ethPrice);
    const fillsBefore = fillCache.current.size;
    stopCrash.current = false;
    setCrash({ step: 0, steps, price: start / 1e8, fills: 0 });
    try {
      for (let i = 1; i <= steps && !stopCrash.current; i++) {
        const price = Math.round(start * (1 - (totalPercent / 100) * (i / steps)));
        await writePrice(BigInt(price));
        if (withBot || autoBotRef.current.on) await botStep();
        await refresh();
        setCrash({ step: i, steps, price: price / 1e8, fills: fillCache.current.size - fillsBefore });
      }
    } finally {
      setCrash(null);
    }
  }), [state, deployments, run, writePrice, botStep, refresh]);

  const stopSlowCrash = useCallback(() => {
    stopCrash.current = true;
  }, []);

  const fill = useCallback((amountIn: bigint) => run("fill", async () => {
    if (!deployments) return;
    const order = await currentOrder();
    const filled = await simulateFill(deployments, order, amountIn);
    if (!filled) throw new Error(`No fill possible for ${Number(amountIn) / 1e6} USDC right now`);
    await writeFill(order, amountIn, filled.amountOut);
  }), [deployments, run, currentOrder, writeFill]);

  const fillToTarget = useCallback(() => run("fill", async () => {
    if (!deployments || !state) return;
    const order = await currentOrder();
    const size = await largestPassing(FILL_STEP, state.fillerUsdc, FILL_STEP, async (s) => (await simulateFill(deployments, order, s)) !== null);
    if (size === null) throw new Error("No fill possible right now");
    const filled = await simulateFill(deployments, order, size);
    if (filled) await writeFill(order, size, filled.amountOut);
  }), [deployments, state, run, currentOrder, writeFill]);

  const runBotNow = useCallback(() => run("bot", botStep), [run, botStep]);

  const shipCurve = useCallback((maxDiscountBps: number, fullDeviation: bigint) => run("ship", async () => {
    if (!deployments || !state) return;
    let deviation = fullDeviation;
    const used = new Set(state.shipped.map((order) => order.data.toLowerCase()));
    let order = { ...state.order, data: withCurve(state.order.data, maxDiscountBps, deviation) };
    while (used.has(order.data.toLowerCase())) {
      deviation += 1n;
      order = { ...state.order, data: withCurve(state.order.data, maxDiscountBps, deviation) };
    }
    const hash = await wallets.owner.writeContract({ address: deployments.vault, abi: abis.vault, functionName: "ship", args: [order, COLLATERAL_LIMIT] });
    await publicClient.waitForTransactionReceipt({ hash });
  }), [deployments, state, run]);

  const resetDemo = useCallback(() => run("reset", async () => {
    const response = await fetch("/reset", { method: "POST" });
    if (!response.ok) throw new Error(await response.text());
    fillCache.current.clear();
  }), [run]);

  return {
    deployments,
    state,
    targetQuote,
    crash,
    stopSlowCrash,
    session,
    fills,
    activity,
    demo,
    busy,
    error,
    autoBot,
    setAutoBot,
    setEthPrice,
    movePrice,
    resetPrice,
    slowCrash,
    resetDemo,
    shipCurve,
    fill,
    fillToTarget,
    runBotNow,
  };
}
