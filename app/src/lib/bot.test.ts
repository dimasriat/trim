import { describe, expect, test } from "bun:test";
import { largestPassing, ownerTotals, botTotals } from "./bot";

describe("largestPassing", () => {
  test("finds the largest size that still passes, to the step", async () => {
    const size = await largestPassing(10n, 10_000n, 10n, async (x) => x <= 3_456n);
    expect(size).toBe(3_450n);
  });

  test("returns null when even the smallest size fails", async () => {
    expect(await largestPassing(10n, 10_000n, 10n, async () => false)).toBeNull();
  });
});

describe("totals", () => {
  const fairOut = 1_000_000_000_000_000_000n;
  const fills = [
    { amountIn: 2_000_000_000n, amountOut: (fairOut * 10_000n) / 9_950n, fairOut, gasUsdc: 1 },
    { amountIn: 500_000_000n, amountOut: fairOut, fairOut, gasUsdc: 1.2 },
  ];

  test("owner pays the discount and saves against one keeper rebalance of the same total", () => {
    const totals = ownerTotals(fills);
    expect(totals.cost).toBeCloseTo(10.05, 2);
    expect(totals.keeperCost).toBeCloseTo(2_500 * 0.0056, 6);
    expect(totals.saved).toBeCloseTo(totals.keeperCost - totals.cost, 9);
  });

  test("bot keeps the discount minus gas and the cost of selling the WETH at once", () => {
    const totals = botTotals(fills, 15);
    expect(totals.discount).toBeCloseTo(10.05, 2);
    expect(totals.gas).toBeCloseTo(2.2, 9);
    expect(totals.selling).toBeCloseTo(2_500 * 0.0015, 9);
    expect(totals.profit).toBeCloseTo(10.05 - 2.2 - 3.75, 2);
  });
});
