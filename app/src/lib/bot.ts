import { fillLedger, keeperLeak } from "./trim";

type LedgerFill = { amountIn: bigint; amountOut: bigint; fairOut: bigint; gasUsdc: number };

export async function largestPassing(min: bigint, max: bigint, step: bigint, passes: (size: bigint) => Promise<boolean>): Promise<bigint | null> {
  if (!(await passes(min))) return null;
  let low = min / step;
  let high = max / step;
  while (low < high) {
    const middle = (low + high + 1n) / 2n;
    if (await passes(middle * step)) low = middle;
    else high = middle - 1n;
  }
  return low * step;
}

export function ownerTotals(fills: LedgerFill[]) {
  let cost = 0;
  let moved = 0;
  for (const fill of fills) {
    const ledger = fillLedger(fill);
    cost += ledger.positionCostUsdc;
    moved += ledger.debtRepaidUsdc;
  }
  const keeperCost = moved * keeperLeak(moved);
  return { cost, keeperCost, saved: keeperCost - cost };
}

export function botTotals(fills: LedgerFill[], sellCostBps: number) {
  let discount = 0;
  let gas = 0;
  let selling = 0;
  for (const fill of fills) {
    const ledger = fillLedger(fill);
    discount += ledger.positionCostUsdc;
    gas += fill.gasUsdc;
    selling += ledger.debtRepaidUsdc * (sellCostBps / 10_000);
  }
  return { discount, gas, selling, profit: discount - gas - selling };
}
