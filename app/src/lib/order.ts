import type { Hex } from "viem";

const HEADER = "b61e";
const ARGS = 60;

function locate(data: string): number {
  const hex = data.toLowerCase().replace(/^0x/, "");
  const at = hex.lastIndexOf(HEADER);
  return at >= 0 && hex.length >= at + HEADER.length + ARGS ? at : -1;
}

export function trimSkewInstruction(data: string) {
  const at = locate(data);
  if (at < 0) return null;
  const args = data.toLowerCase().replace(/^0x/, "").slice(at + HEADER.length, at + HEADER.length + ARGS);
  return {
    opcode: HEADER.slice(0, 2),
    length: HEADER.slice(2),
    source: args.slice(0, 40),
    maxDiscountBps: args.slice(40, 44),
    fullDeviation: args.slice(44, 60),
  };
}

export function curveFromOrderData(data: string) {
  const instruction = trimSkewInstruction(data);
  if (!instruction) return null;
  return {
    source: `0x${instruction.source}`,
    maxDiscountBps: parseInt(instruction.maxDiscountBps, 16),
    fullDeviation: BigInt(`0x${instruction.fullDeviation}`),
  };
}

export function withCurve(data: Hex, maxDiscountBps: number, fullDeviation: bigint): Hex {
  const at = locate(data);
  if (at < 0) throw new Error("order has no TrimSkew instruction");
  const hex = data.toLowerCase().replace(/^0x/, "");
  const start = at + HEADER.length + 40;
  const args = maxDiscountBps.toString(16).padStart(4, "0") + fullDeviation.toString(16).padStart(16, "0");
  return `0x${hex.slice(0, start)}${args}${hex.slice(start + 20)}`;
}
