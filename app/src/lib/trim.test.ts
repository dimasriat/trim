import { describe, expect, test } from "bun:test";
import { curveDiscount, discountVsOracle, fillLedger, formatHealthFactor, formatToken, healthStatus, keeperLeak, loanToValue, ltvAtHealthFactor } from "./trim";

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

describe("loan to value", () => {
  test("is debt over collateral", () => {
    expect(loanToValue(20_000n * 10n ** 8n, 12_000n * 10n ** 8n)).toBeCloseTo(0.6, 9);
  });

  test("follows the liquidation threshold over the health factor", () => {
    expect(ltvAtHealthFactor(1.5, 8_300)).toBeCloseTo(0.5533, 4);
  });
});

describe("curve", () => {
  const params = { maxDiscountBps: 100, fullDeviation: 0.2, target: 1.5 };

  test("has no discount on target or above", () => {
    expect(curveDiscount(1.5, params)).toBe(0);
    expect(curveDiscount(1.6, params)).toBe(0);
  });

  test("grows linearly with the relative distance below target", () => {
    expect(curveDiscount(1.44, params)).toBeCloseTo(0.002, 9);
  });

  test("stops at the maximum discount", () => {
    expect(curveDiscount(1.2, params)).toBeCloseTo(0.01, 9);
    expect(curveDiscount(1.05, params)).toBeCloseTo(0.01, 9);
  });
});

describe("fill ledger", () => {
  const fairOut = 918_273_645_546_372_819n;
  const amountOut = (fairOut * 10_000n) / 9_980n;
  const ledger = fillLedger({ amountIn: 2_000_000_000n, amountOut, fairOut });

  test("values the collateral out at the oracle, in USDC", () => {
    expect(ledger.collateralOutUsdc).toBeCloseTo(2_004.008, 2);
  });

  test("charges the position the gap between collateral out and debt repaid", () => {
    expect(ledger.positionCostUsdc).toBeCloseTo(4.008, 2);
    expect(ledger.positionCostShare).toBeCloseTo(0.002004, 5);
  });
});

describe("keeper benchmark", () => {
  test("uses the measured DeFi Saver median for the size bucket", () => {
    expect(keeperLeak(500)).toBe(0.0346);
    expect(keeperLeak(2_000)).toBe(0.0056);
    expect(keeperLeak(50_000)).toBe(0.0042);
  });
});
