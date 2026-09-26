import { describe, expect, test } from "bun:test";
import { buildTimeline } from "./timeline";

const fairOut = 1_000_000_000_000_000_000n;

describe("buildTimeline", () => {
  test("starts at the opening price with nothing spent", () => {
    expect(buildTimeline(2_000, [], [])).toEqual([{ price: 2_000, trim: 0, keeper: 0, fill: false }]);
  });

  test("walks price moves and fills in block order, adding up both costs", () => {
    const points = buildTimeline(
      2_000,
      [{ block: 12n, price: 1_800 }, { block: 10n, price: 1_900 }],
      [{ block: 11n, amountIn: 2_000_000_000n, amountOut: (fairOut * 10_000n) / 9_990n, fairOut }],
    );
    expect(points.map((p) => [p.price, p.fill])).toEqual([[2_000, false], [1_900, false], [1_900, true], [1_800, false]]);
    expect(points[2].trim).toBeCloseTo(2.002, 3);
    expect(points[2].keeper).toBeCloseTo(2_000 * 0.0056, 6);
    expect(points[3].trim).toBeCloseTo(points[2].trim, 9);
  });
});
