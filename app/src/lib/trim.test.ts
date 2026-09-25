import { describe, expect, test } from "bun:test";
import { discountVsOracle, formatHealthFactor, formatToken, healthStatus } from "./trim";

const ONE = 10n ** 18n;

describe("discountVsOracle", () => {
  test("is zero when the fill gets exactly the oracle amount", () => {
    expect(discountVsOracle(ONE, ONE)).toBe(0);
  });

  test("is the share of the output above the oracle amount", () => {
    expect(discountVsOracle(ONE, (ONE * 100n) / 98n)).toBeCloseTo(0.02, 6);
  });
});

describe("healthStatus", () => {
  const target = (15n * ONE) / 10n;

  test("is healthy at or above target", () => {
    expect(healthStatus(target, target)).toBe("healthy");
  });

  test("opens an auction below target", () => {
    expect(healthStatus((13n * ONE) / 10n, target)).toBe("auction");
  });

  test("warns close to liquidation", () => {
    expect(healthStatus((105n * ONE) / 100n, target)).toBe("danger");
  });
});

describe("formatting", () => {
  test("health factor keeps two decimals", () => {
    expect(formatHealthFactor(1352401710754797092n)).toBe("1.35");
  });

  test("tokens use grouping and fixed digits", () => {
    expect(formatToken(2_000_000_000n, 6, 2)).toBe("2,000.00");
    expect(formatToken(948803227358434492n, 18, 4)).toBe("0.9488");
  });
});
