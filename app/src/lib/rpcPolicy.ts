export type RpcMode = "write" | "read";

const MAX_BATCH = 100;
const BLOCKED = new Set(["eth_sendTransaction", "eth_sign", "eth_signTransaction", "eth_signTypedData", "eth_signTypedData_v4"]);
const WRITES = new Set(["eth_sendRawTransaction"]);
const LOG_QUERIES = new Set(["eth_getLogs", "eth_newFilter"]);

type Call = { method?: unknown; params?: unknown };

function blockAtOrAfter(tag: unknown, forkBlock: bigint): boolean {
  if (tag === "latest" || tag === "pending" || tag === "safe" || tag === "finalized") return true;
  if (typeof tag !== "string" || !/^0x[0-9a-fA-F]+$/.test(tag)) return false;
  return BigInt(tag) >= forkBlock;
}

function logQueryInsideFork(params: unknown, forkBlock: bigint): boolean {
  const filter = Array.isArray(params) ? params[0] : undefined;
  if (!filter || typeof filter !== "object") return false;
  const { blockHash, fromBlock, toBlock = "latest" } = filter as Record<string, unknown>;
  if (typeof blockHash === "string") return true;
  return blockAtOrAfter(fromBlock, forkBlock) && blockAtOrAfter(toBlock, forkBlock);
}

function callAllowed(call: Call, mode: RpcMode, forkBlock: bigint): boolean {
  const { method, params } = call;
  if (typeof method !== "string" || BLOCKED.has(method)) return false;
  if (mode === "read" && WRITES.has(method)) return false;
  const prefixes = mode === "read" ? /^(eth|net|web3|ots)_/ : /^(eth|net|web3)_/;
  if (!prefixes.test(method)) return false;
  if (LOG_QUERIES.has(method)) return logQueryInsideFork(params, forkBlock);
  return true;
}

export function requestAllowed(body: string, mode: RpcMode, forkBlock: bigint): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  const calls = [parsed].flat();
  if (calls.length === 0 || calls.length > MAX_BATCH) return false;
  return calls.every((call) => call !== null && typeof call === "object" && callAllowed(call as Call, mode, forkBlock));
}

export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(private capacity: number, private refillPerSecond: number) {}

  take(key: string, now = Date.now()): boolean {
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    const tokens = Math.min(this.capacity, bucket.tokens + ((now - bucket.at) / 1000) * this.refillPerSecond);
    const allowed = tokens >= 1;
    this.buckets.set(key, { tokens: allowed ? tokens - 1 : tokens, at: now });
    if (this.buckets.size > 10_000) this.buckets.clear();
    return allowed;
  }
}
