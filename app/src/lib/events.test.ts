import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { eventAbi, fillSteps } from "./events";

const aqua = "0x20A36f644b79b27247642a81e319DF276C20F282";
const pool = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";
const vault = "0x1111111111111111111111111111111111111111";
const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const zero32 = `0x${"00".repeat(32)}` as Hex;

function aquaLog(eventName: "Pushed" | "Pulled", token: string, amount: bigint, logIndex: number) {
  return {
    address: aqua,
    logIndex,
    topics: encodeEventTopics({ abi: eventAbi, eventName }),
    data: encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "uint256" }],
      [vault, vault, zero32, token as Hex, amount],
    ),
  };
}

describe("fillSteps", () => {
  test("lists aqua and aave events of one fill in order", () => {
    const repay = {
      address: pool,
      logIndex: 1,
      topics: encodeEventTopics({ abi: eventAbi, eventName: "Repay", args: { reserve: usdc, user: vault, repayer: vault } }),
      data: encodeAbiParameters([{ type: "uint256" }, { type: "bool" }], [2_000_000_000n, false]),
    };
    const unrelated = { address: usdc, logIndex: 2, topics: [zero32], data: "0x" as Hex };
    const steps = fillSteps([aquaLog("Pulled", weth, 922_300_000_000_000_000n, 3), repay, unrelated, aquaLog("Pushed", usdc, 2_000_000_000n, 0)], { aqua, pool, usdc, weth });
    expect(steps).toEqual(["Aqua Pushed 2,000.00 USDC", "Aave Repay 2,000.00 USDC", "Aqua Pulled 0.9223 WETH"]);
  });
});
