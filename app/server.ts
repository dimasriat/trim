import { join } from "node:path";

const port = Number(process.env.PORT ?? 3950);
const anvil = process.env.ANVIL_RPC ?? "http://127.0.0.1:8545";
const dist = join(import.meta.dir, "dist");
const deployments = join(import.meta.dir, "..", "contracts", "deployments", "anvil.json");
const credentials = process.env.DEMO_USER && process.env.DEMO_PASS
  ? "Basic " + btoa(`${process.env.DEMO_USER}:${process.env.DEMO_PASS}`)
  : null;

function unauthorized(): Response {
  return new Response("auth required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="trim"' } });
}

Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    if (credentials && request.headers.get("authorization") !== credentials) return unauthorized();
    const { pathname } = new URL(request.url);

    if (pathname === "/rpc" && request.method === "POST") {
      return fetch(anvil, { method: "POST", headers: { "content-type": "application/json" }, body: await request.text() });
    }
    if (pathname === "/deployments.json") return new Response(Bun.file(deployments));

    const file = Bun.file(join(dist, pathname === "/" ? "index.html" : pathname));
    return (await file.exists()) ? new Response(file) : new Response(Bun.file(join(dist, "index.html")));
  },
});

console.log(`trim demo on http://127.0.0.1:${port}`);
