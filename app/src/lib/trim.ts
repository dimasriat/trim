import { formatUnits } from "viem";

export type HealthStatus = "healthy" | "auction" | "danger";

const DANGER = 11n * 10n ** 17n;

export function discountVsOracle(fairOut: bigint, amountOut: bigint): number {
  if (amountOut === 0n) return 0;
  return Number(amountOut - fairOut) / Number(amountOut);
}

export function healthStatus(healthFactor: bigint, target: bigint): HealthStatus {
  if (healthFactor >= target) return "healthy";
  if (healthFactor < DANGER) return "danger";
  return "auction";
}

export function formatHealthFactor(healthFactor: bigint): string {
  return Number(formatUnits(healthFactor, 18)).toFixed(2);
}

export function formatToken(amount: bigint, decimals: number, digits: number): string {
  return Number(formatUnits(amount, decimals)).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export type CurveParams = { maxDiscountBps: number; fullDeviation: number; target: number };

export function loanToValue(collateralBase: bigint, debtBase: bigint): number {
  if (collateralBase === 0n) return 0;
  return Number(debtBase) / Number(collateralBase);
}

export function ltvAtHealthFactor(healthFactor: number, liquidationThresholdBps: number): number {
  return liquidationThresholdBps / 10_000 / healthFactor;
}

export function curveDiscount(healthFactor: number, { maxDiscountBps, fullDeviation, target }: CurveParams): number {
  const deviation = Math.max(0, (target - healthFactor) / target);
  return (maxDiscountBps / 10_000) * Math.min(deviation, fullDeviation) / fullDeviation;
}

export function fillLedger({ amountIn, amountOut, fairOut }: { amountIn: bigint; amountOut: bigint; fairOut: bigint }) {
  const debtRepaidUsdc = Number(formatUnits(amountIn, 6));
  const collateralOutUsdc = fairOut === 0n ? 0 : debtRepaidUsdc * Number(amountOut) / Number(fairOut);
  const positionCostUsdc = collateralOutUsdc - debtRepaidUsdc;
  return {
    debtRepaidUsdc,
    collateralOutUsdc,
    positionCostUsdc,
    positionCostShare: debtRepaidUsdc === 0 ? 0 : positionCostUsdc / debtRepaidUsdc,
  };
}

const KEEPER_LEAK_BY_SIZE: [number, number][] = [
  [1_000, 0.0346],
  [10_000, 0.0056],
  [100_000, 0.0042],
  [1_000_000, 0.0046],
];

export function keeperLeak(sizeUsdc: number): number {
  return KEEPER_LEAK_BY_SIZE.find(([below]) => sizeUsdc < below)?.[1] ?? 0.0105;
}
