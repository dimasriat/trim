import type { TrimState } from "../lib/useTrim";
import type { CurveParams } from "../lib/trim";

export function percent(fraction: number, digits = 2): string {
  return (fraction * 100).toFixed(digits) + "%";
}

export function shortPercent(fraction: number): string {
  return (fraction * 100).toFixed(2).replace(/\.?0+$/, "") + "%";
}

export function usdc(amount: number, digits = 2): string {
  return amount.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + " USDC";
}

export function signedUsdc(amount: number): string {
  return (amount >= 0 ? "+" : "−") + usdc(Math.abs(amount));
}

export function hf(value: bigint): number {
  return Number(value) / 1e18;
}

export function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function ethInUsdc(state: TrimState): number {
  return Number(state.ethPrice) / Number(state.usdcPrice);
}

export function wethInUsdc(weth: bigint, ethPrice: bigint, usdcPrice: bigint): number {
  return (Number(weth) / 1e18) * (Number(ethPrice) / Number(usdcPrice));
}

export function relativeDeviation(state: TrimState, curve: CurveParams): number {
  return Math.max(0, (curve.target - hf(state.healthFactor)) / curve.target);
}

export function TxLink({ hash, explorerUrl }: { hash: string; explorerUrl: string | null }) {
  const text = `${hash.slice(0, 10)}…${hash.slice(-6)}`;
  return explorerUrl ? <a className="hash" href={`${explorerUrl}/tx/${hash}`} target="_blank" rel="noreferrer">{text}</a> : <code className="hash">{text}</code>;
}

export function AddressLink({ address, explorerUrl }: { address: string; explorerUrl: string | null }) {
  return explorerUrl ? <a className="hash" href={`${explorerUrl}/address/${address}`} target="_blank" rel="noreferrer">{short(address)}</a> : <code className="hash">{short(address)}</code>;
}
