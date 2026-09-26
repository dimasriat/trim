import { describe, expect, test } from "bun:test";
import { pairFills } from "./history";

const vault = "0x00000000000000000000000000000000000000aa";
const usdc = "0x00000000000000000000000000000000000000c1";
const weth = "0x00000000000000000000000000000000000000e1";

describe("pairFills", () => {
  test("joins the USDC pushed and the WETH pulled in the same transaction", () => {
    const fills = pairFills(
      [
        { hash: "0x1", block: 10n, maker: vault, token: usdc, amount: 500n },
        { hash: "0x2", block: 12n, maker: vault, token: usdc, amount: 2_000n },
        { hash: "0x3", block: 13n, maker: "0x00000000000000000000000000000000000000bb", token: usdc, amount: 9n },
      ],
      [
        { hash: "0x2", block: 12n, maker: vault, token: weth, amount: 92n },
        { hash: "0x1", block: 10n, maker: vault, token: weth, amount: 20n },
      ],
      { vault, usdc, weth },
    );
    expect(fills).toEqual([
      { hash: "0x1", block: 10n, amountIn: 500n, amountOut: 20n },
      { hash: "0x2", block: 12n, amountIn: 2_000n, amountOut: 92n },
    ]);
  });

  test("ignores pushes without a matching pull, like the initial ship", () => {
    expect(pairFills([{ hash: "0x9", block: 5n, maker: vault, token: weth, amount: 10n }], [], { vault, usdc, weth })).toEqual([]);
  });
});
