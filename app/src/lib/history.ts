export type AquaMove = { hash: string; block: bigint; maker: string; token: string; amount: bigint };
export type FillEvent = { hash: string; block: bigint; amountIn: bigint; amountOut: bigint };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function pairFills(pushed: AquaMove[], pulled: AquaMove[], { vault, usdc, weth }: { vault: string; usdc: string; weth: string }): FillEvent[] {
  const out = new Map(pulled.filter((move) => same(move.maker, vault) && same(move.token, weth)).map((move) => [move.hash, move.amount]));
  return pushed
    .filter((move) => same(move.maker, vault) && same(move.token, usdc) && out.has(move.hash))
    .map((move) => ({ hash: move.hash, block: move.block, amountIn: move.amount, amountOut: out.get(move.hash)! }))
    .sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0));
}
