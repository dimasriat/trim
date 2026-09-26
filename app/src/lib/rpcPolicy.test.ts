import { describe, expect, test } from "bun:test";
import { RateLimiter, requestAllowed } from "./rpcPolicy";

const FORK = 26_050_000n;
const call = (method: string, params: unknown[] = []) => JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });

describe("requestAllowed", () => {
  test("lets the app read and send signed transactions", () => {
    expect(requestAllowed(call("eth_call"), "write", FORK)).toBe(true);
    expect(requestAllowed(call("eth_sendRawTransaction"), "write", FORK)).toBe(true);
  });

  test("never touches anvil's unlocked accounts or admin methods", () => {
    expect(requestAllowed(call("eth_sendTransaction"), "write", FORK)).toBe(false);
    expect(requestAllowed(call("eth_sign"), "write", FORK)).toBe(false);
    expect(requestAllowed(call("anvil_setCode"), "write", FORK)).toBe(false);
    expect(requestAllowed(call("evm_revert"), "write", FORK)).toBe(false);
  });

  test("gives the explorer otterscan methods but no way to write", () => {
    expect(requestAllowed(call("ots_getApiLevel"), "read", FORK)).toBe(true);
    expect(requestAllowed(call("erigon_getHeaderByNumber", ["latest"]), "read", FORK)).toBe(true);
    expect(requestAllowed(call("erigon_getHeaderByNumber", ["latest"]), "write", FORK)).toBe(false);
    expect(requestAllowed(call("ots_getApiLevel"), "write", FORK)).toBe(false);
    expect(requestAllowed(call("eth_sendRawTransaction"), "read", FORK)).toBe(false);
  });

  test("keeps log queries inside the fork", () => {
    expect(requestAllowed(call("eth_getLogs", [{ fromBlock: "0x18d7dd0", toBlock: "latest" }]), "read", FORK)).toBe(true);
    expect(requestAllowed(call("eth_getLogs", [{ fromBlock: "0x0", toBlock: "latest" }]), "read", FORK)).toBe(false);
    expect(requestAllowed(call("eth_getLogs", [{ toBlock: "latest" }]), "read", FORK)).toBe(false);
    expect(requestAllowed(call("eth_getLogs", [{ blockHash: "0xabc" }]), "read", FORK)).toBe(true);
  });

  test("checks every call in a batch and caps its size", () => {
    const ok = JSON.stringify([JSON.parse(call("eth_chainId")), JSON.parse(call("eth_blockNumber"))]);
    const mixed = JSON.stringify([JSON.parse(call("eth_chainId")), JSON.parse(call("anvil_mine"))]);
    const huge = JSON.stringify(Array.from({ length: 101 }, () => JSON.parse(call("eth_chainId"))));
    expect(requestAllowed(ok, "write", FORK)).toBe(true);
    expect(requestAllowed(mixed, "write", FORK)).toBe(false);
    expect(requestAllowed(huge, "write", FORK)).toBe(false);
  });

  test("rejects anything that is not JSON-RPC", () => {
    expect(requestAllowed("not json", "write", FORK)).toBe(false);
    expect(requestAllowed(JSON.stringify({ id: 1 }), "write", FORK)).toBe(false);
  });
});

describe("RateLimiter", () => {
  test("allows a burst, then refills over time", () => {
    const limiter = new RateLimiter(3, 1);
    expect([0, 0, 0, 0].map(() => limiter.take("a", 0))).toEqual([true, true, true, false]);
    expect(limiter.take("b", 0)).toBe(true);
    expect(limiter.take("a", 1_000)).toBe(true);
    expect(limiter.take("a", 1_000)).toBe(false);
  });
});
