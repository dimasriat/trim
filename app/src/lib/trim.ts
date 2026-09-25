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
