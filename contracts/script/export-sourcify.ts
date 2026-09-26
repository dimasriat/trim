import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "..");
const [deploymentsPath, outDir] = process.argv.slice(2);
if (!deploymentsPath || !outDir) throw new Error("usage: bun script/export-sourcify.ts <deployments.json> <out dir>");

const artifacts: Record<string, string> = {
  router: "TrimSwapVMRouter.sol/TrimSwapVMRouter.json",
  vault: "TrimAaveVault.sol/TrimAaveVault.json",
  filler: "TrimFiller.sol/TrimFiller.json",
  oracle: "DemoAaveOracle.sol/DemoAaveOracle.json",
};

const deployments = JSON.parse(readFileSync(join(root, deploymentsPath), "utf8"));
rmSync(outDir, { recursive: true, force: true });

function writeContract(address: string, metadata: string, sources: Record<string, string>) {
  const dir = join(outDir, "contracts", "full_match", "1", address);
  mkdirSync(join(dir, "sources"), { recursive: true });
  writeFileSync(join(dir, "metadata.json"), metadata);
  for (const [path, content] of Object.entries(sources)) {
    const target = join(dir, "sources", path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  if (address !== address.toLowerCase()) symlinkSync(address, join(outDir, "contracts", "full_match", "1", address.toLowerCase()));
}

async function fromEtherscan(address: string, apiKey: string) {
  const url = `https://api.etherscan.io/v2/api?chainid=1&module=contract&action=getsourcecode&address=${address}&apikey=${apiKey}`;
  const [result] = (await (await fetch(url)).json()).result;
  const code: string = result?.SourceCode ?? "";
  if (!code) {
    console.log(`etherscan has no source for ${address}`);
    return;
  }
  const input = code.startsWith("{{") ? JSON.parse(code.slice(1, -1)) : code.startsWith("{") ? { sources: JSON.parse(code), settings: {} } : { sources: { [`${result.ContractName}.sol`]: { content: code } }, settings: {} };
  const sources: Record<string, string> = Object.fromEntries(Object.entries(input.sources).map(([path, s]) => [path, (s as { content: string }).content]));
  const target = Object.keys(sources).find((path) => new RegExp(`contract\\s+${result.ContractName}\\b`).test(sources[path]));
  const metadata = {
    compiler: { version: result.CompilerVersion.replace(/^v/, "") },
    language: "Solidity",
    output: { abi: JSON.parse(result.ABI), devdoc: { kind: "dev", methods: {}, version: 1 }, userdoc: { kind: "user", methods: {}, version: 1 } },
    settings: { ...input.settings, compilationTarget: { [target ?? Object.keys(sources)[0]]: result.ContractName } },
    sources: Object.fromEntries(Object.keys(sources).map((path) => [path, { keccak256: "", urls: [] }])),
    version: 1,
  };
  writeContract(address, JSON.stringify(metadata), sources);
  console.log(`etherscan ${result.ContractName} ${address}`);
}

for (const [key, artifact] of Object.entries(artifacts)) {
  const address: string = deployments[key];
  const { rawMetadata } = JSON.parse(readFileSync(join(root, "out", artifact), "utf8"));
  const sources = Object.fromEntries(Object.keys(JSON.parse(rawMetadata).sources).map((source) => [source, readFileSync(join(root, source), "utf8")]));
  writeContract(address, rawMetadata, sources);
  console.log(`${key} ${address}`);
}

if (process.env.ETHERSCAN_API_KEY && deployments.aqua) await fromEtherscan(deployments.aqua, process.env.ETHERSCAN_API_KEY);
