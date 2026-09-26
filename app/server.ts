import { join } from "node:path";
import { RateLimiter, requestAllowed, type RpcMode } from "./src/lib/rpcPolicy";

const port = Number(process.env.PORT ?? 3950);
const anvil = process.env.ANVIL_RPC ?? "http://127.0.0.1:8545";
const forkBlock = BigInt(process.env.FORK_BLOCK ?? 26_050_000);
const dist = join(import.meta.dir, "dist");
const docs = join(import.meta.dir, "..", "docs", ".vitepress", "dist");
const deployments = process.env.DEPLOYMENTS ?? join(import.meta.dir, "..", "contracts", "deployments", "anvil.json");
const snapshotFile = process.env.SNAPSHOT_FILE ?? deployments.replace(/\.json$/, ".snapshot");
const explorerUrl = process.env.EXPLORER_URL ?? null;
const sourcifyDir = process.env.SOURCIFY_DIR ?? deployments.replace(/\.json$/, "-sourcify");
const resetEveryMinutes = Number(process.env.RESET_EVERY_MIN ?? 0);
const credentials = process.env.DEMO_USER && process.env.DEMO_PASS
  ? "Basic " + btoa(`${process.env.DEMO_USER}:${process.env.DEMO_PASS}`)
  : null;

const rpcLimiter = new RateLimiter(Number(process.env.RPC_BURST ?? 120), Number(process.env.RPC_PER_SECOND ?? 30));
const resetLimiter = new RateLimiter(1, 1 / Number(process.env.RESET_MIN_SECONDS ?? 15));
const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

type SourcifyEntry = { metadata: unknown; sources: Record<string, { content: string }> } | null;
const sourcifyCache = new Map<string, Promise<SourcifyEntry>>();
const SOURCIFY_PATH = /^contracts\/full_match\/1\/(0x[0-9a-fA-F]{40})\/(metadata\.json|sources\/(.+))$/;

function upstreamSourcify(address: string): Promise<SourcifyEntry> {
  const key = address.toLowerCase();
  if (!sourcifyCache.has(key)) {
    sourcifyCache.set(key, fetch(`https://sourcify.dev/server/v2/contract/1/${address}?fields=metadata,sources`)
      .then(async (response) => (response.ok ? ((await response.json()) as SourcifyEntry) : null))
      .catch(() => null));
  }
  return sourcifyCache.get(key)!;
}

let epoch = 0;
let nextResetAt = resetEveryMinutes > 0 ? Date.now() + resetEveryMinutes * 60_000 : null;

function clientOf(request: Request, server: { requestIP(r: Request): { address: string } | null }): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? server.requestIP(request)?.address ?? "unknown";
}

function unauthorized(): Response {
  return new Response("auth required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="trim"' } });
}

async function anvilCall(method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch(anvil, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const { result, error } = await response.json() as { result?: unknown; error?: { message: string } };
  if (error) throw new Error(error.message);
  return result;
}

async function resetFork(): Promise<void> {
  const snapshot = (await Bun.file(snapshotFile).text()).trim();
  const reverted = await anvilCall("evm_revert", [snapshot]);
  if (reverted !== true) throw new Error(`snapshot ${snapshot} is gone`);
  await Bun.write(snapshotFile, String(await anvilCall("evm_snapshot")));
  epoch += 1;
  if (resetEveryMinutes > 0) nextResetAt = Date.now() + resetEveryMinutes * 60_000;
}

async function proxy(request: Request, mode: RpcMode, client: string, headers: Record<string, string> = {}): Promise<Response> {
  if (!rpcLimiter.take(client)) return new Response("slow down", { status: 429, headers });
  const body = await request.text();
  if (!requestAllowed(body, mode, forkBlock)) return new Response("method not allowed", { status: 403, headers });
  const upstream = await fetch(anvil, { method: "POST", headers: { "content-type": "application/json" }, body });
  return new Response(upstream.body, { status: upstream.status, headers: { "content-type": "application/json", ...headers } });
}

if (resetEveryMinutes > 0) {
  setInterval(() => {
    if (nextResetAt !== null && Date.now() >= nextResetAt) resetFork().catch((e) => console.error("scheduled reset", e));
  }, 30_000);
}

Bun.serve({
  hostname: process.env.HOST ?? "127.0.0.1",
  port,
  async fetch(request, server) {
    const { pathname } = new URL(request.url);
    const client = clientOf(request, server);

    if (pathname === "/explorer-rpc") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
      if (request.method === "POST") return proxy(request, "read", client, corsHeaders);
    }

    if (pathname.startsWith("/sourcify/") && request.method === "GET") {
      const relative = decodeURIComponent(pathname.slice("/sourcify/".length));
      if (relative.split("/").includes("..")) return new Response("bad path", { status: 400, headers: corsHeaders });
      const file = Bun.file(join(sourcifyDir, relative));
      if (await file.exists()) return new Response(file, { headers: corsHeaders });
      const match = relative.match(SOURCIFY_PATH);
      const entry = match ? await upstreamSourcify(match[1]) : null;
      if (entry && match![2] === "metadata.json") return Response.json(entry.metadata, { headers: corsHeaders });
      if (entry && match![3] && entry.sources[match![3]]) return new Response(entry.sources[match![3]].content, { headers: corsHeaders });
      return new Response("not found", { status: 404, headers: corsHeaders });
    }

    if (credentials && request.headers.get("authorization") !== credentials) return unauthorized();

    if (pathname === "/rpc" && request.method === "POST") return proxy(request, "write", client);
    if (pathname === "/reset" && request.method === "POST") {
      if (!resetLimiter.take("reset")) return new Response("reset again in a few seconds", { status: 429 });
      try {
        await resetFork();
        return Response.json({ epoch });
      } catch (e) {
        return new Response(String(e), { status: 500 });
      }
    }
    if (pathname === "/demo.json") return Response.json({ explorerUrl, epoch, resetEveryMinutes, nextResetAt });
    if (pathname === "/deployments.json") return new Response(Bun.file(deployments));
    if (pathname === "/docs" || pathname.startsWith("/docs/")) {
      const path = pathname.replace(/^\/docs\/?/, "") || "index.html";
      for (const candidate of [path, `${path}.html`, join(path, "index.html")]) {
        const page = Bun.file(join(docs, candidate));
        if (await page.exists()) return new Response(page);
      }
      return new Response("not found", { status: 404 });
    }

    const file = Bun.file(join(dist, pathname === "/" ? "index.html" : pathname));
    return (await file.exists()) ? new Response(file) : new Response(Bun.file(join(dist, "index.html")));
  },
});

console.log(`trim demo on http://${process.env.HOST ?? "127.0.0.1"}:${port}`);
