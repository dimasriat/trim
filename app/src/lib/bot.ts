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

export function botTotals(fills: LedgerFill[], { startUsdc, usdcNow, wethNow, ethPriceUsdc }: { startUsdc: number; usdcNow: number; wethNow: number; ethPriceUsdc: number }) {
  const edge = fills.reduce((sum, fill) => sum + fillLedger(fill).positionCostUsdc - fill.gasUsdc, 0);
  const gas = fills.reduce((sum, fill) => sum + fill.gasUsdc, 0);
  return { edge, markToMarket: usdcNow + wethNow * ethPriceUsdc - startUsdc - gas };
}
