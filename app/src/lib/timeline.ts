import { fillLedger, keeperLeak } from "./trim";

export type PricePoint = { block: bigint; price: number };
export type FillPoint = { block: bigint; amountIn: bigint; amountOut: bigint; fairOut: bigint };
export type TimelinePoint = { price: number; trim: number; keeper: number; fill: boolean };

export function buildTimeline(openPrice: number, prices: PricePoint[], fills: FillPoint[]): TimelinePoint[] {
  const events = [
    ...prices.map((p) => ({ block: p.block, price: p.price as number | null, fill: null as FillPoint | null })),
    ...fills.map((f) => ({ block: f.block, price: null as number | null, fill: f as FillPoint | null })),
  ].sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0));
  const points: TimelinePoint[] = [{ price: openPrice, trim: 0, keeper: 0, fill: false }];
  let price = openPrice;
  let trim = 0;
  let moved = 0;
  for (const event of events) {
    if (event.price !== null) price = event.price;
    if (event.fill) {
      const ledger = fillLedger(event.fill);
      trim += ledger.positionCostUsdc;
      moved += ledger.debtRepaidUsdc;
    }
    points.push({ price, trim, keeper: moved * keeperLeak(moved), fill: event.fill !== null });
  }
  return points;
}
