import { describe, expect, test } from "bun:test";
import { curveFromOrderData, trimSkewInstruction, withCurve } from "./order";

const data = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2b61e496bb3ed3f342b6606c3dd048d31551afd281ef5006402c68af0bb140000";

describe("order program", () => {
  test("reads the curve TrimSkew carries in the program bytes", () => {
    expect(curveFromOrderData(data)).toEqual({
      source: "0x496bb3ed3f342b6606c3dd048d31551afd281ef5",
      maxDiscountBps: 100,
      fullDeviation: 200_000_000_000_000_000n,
    });
  });

  test("shows the instruction as opcode, length and arguments", () => {
    expect(trimSkewInstruction(data)).toEqual({
      opcode: "b6",
      length: "1e",
      source: "496bb3ed3f342b6606c3dd048d31551afd281ef5",
      maxDiscountBps: "0064",
      fullDeviation: "02c68af0bb140000",
    });
  });

  test("patches only the curve arguments", () => {
    const patched = withCurve(data, 500, 300_000_000_000_000_000n);
    expect(curveFromOrderData(patched)).toMatchObject({ maxDiscountBps: 500, fullDeviation: 300_000_000_000_000_000n });
    expect(patched.slice(0, -20)).toBe(data.slice(0, -20));
  });

  test("returns null when the program has no TrimSkew", () => {
    expect(curveFromOrderData("0x1234")).toBeNull();
  });
});
