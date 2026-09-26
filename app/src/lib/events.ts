import { decodeEventLog, parseAbi, type Hex } from "viem";
import { formatToken } from "./trim";

export const eventAbi = parseAbi([
  "event Pushed(address maker, address app, bytes32 strategyHash, address token, uint256 amount)",
  "event Pulled(address maker, address app, bytes32 strategyHash, address token, uint256 amount)",
  "event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)",
  "event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)",
]);

type Log = { address: string; logIndex: number | null; topics: readonly Hex[] | Hex[]; data: Hex };
type Addresses = { aqua: string; pool: string; usdc: string; weth: string };

function tokenAmount(token: string, amount: bigint, { usdc }: Addresses): string {
  return token.toLowerCase() === usdc.toLowerCase() ? `${formatToken(amount, 6, 2)} USDC` : `${formatToken(amount, 18, 4)} WETH`;
}

export function fillSteps(logs: Log[], addresses: Addresses): string[] {
  const sources: Record<string, string> = { [addresses.aqua.toLowerCase()]: "Aqua", [addresses.pool.toLowerCase()]: "Aave" };
  return [...logs]
    .sort((a, b) => (a.logIndex ?? 0) - (b.logIndex ?? 0))
    .flatMap((log) => {
      const source = sources[log.address.toLowerCase()];
      if (!source) return [];
      try {
        const { eventName, args } = decodeEventLog({ abi: eventAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        const token = "token" in args ? args.token : args.reserve;
        return [`${source} ${eventName} ${tokenAmount(token, args.amount, addresses)}`];
      } catch {
        return [];
      }
    });
}
