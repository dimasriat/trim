import type { Activity, DemoConfig } from "../lib/useTrim";
import { short, TxLink } from "./format";

const QUESTIONS: [string, string][] = [
  ["Why not a keeper, like DeFi Saver?", "We measured all 919 DeFi Saver automated rebalances on Aave v3 over twelve months: the median leaks 0.48% of the amount moved, 0.56% between $1k and $10k, mostly service fee and marked-up gas. Trim has no operator to pay."],
  ["Why a new opcode and a redeployed router, not an Extruction on the canonical router?", "The same pricing could run as an Extruction. As an opcode, the curve's two parameters sit in the program bytes, so a taker can read the whole rule without trusting an external contract, and it saves a call. The cost is honest: until 1inch adopts the opcode, fills go through our router, which is an unmodified SwapVM plus one instruction."],
  ["Isn't this just a Dutch auction, like UniswapX or Fusion?", "Those are driven by a clock and need someone to sign each order. A Trim strategy is shipped once. Its price moves with the position's own health, it fills any size up to the target, and it stops by itself when the position is back."],
  ["What if no bot comes?", "Over twelve months of Chainlink ETH/USD, the worst 40-minute drop was 13.1%, so a trigger at HF 1.15 survives it with no filler at all. And in a crash the discount grows fast, so fills come sooner."],
  ["Can one bot take the whole rebalance at the best price?", "No. A fill pays the average of the discount where it starts and where it ends, so a big fill gets a worse average. Slicing is not exactly neutral on the real curve: in our simulation one 4,000 USDC fill at HF 1.30 cost the position 14.32 USDC and two fills 15.35, about the gas of the extra fill, so slicing does not pay."],
  ["How cheap do fillers actually go?", "In UniswapX, fillers settle around the oracle price: the median margin over 345 WETH/stablecoin fills was −0.09%. Turn on the auto-bot with a small threshold and run the slow crash: it fills as soon as the discount clears its cost."],
  ["Does the filler get any power over the owner's funds?", "No. It swaps at the curve's price through the SwapVM router; the vault's hooks only accept its own latest order, and every fill must move the position toward the target."],
  ["Is it only for Aave?", "No. TrimSkew asks its source four view questions: deviation now, deviation after, and the fair amount either way. The balanced vault in the repo uses the same instruction unchanged. The one limit: the asset must leave in the same transaction."],
  ["What is live here and what is not?", "An Ethereum mainnet fork at block 26,050,000: Aave v3 and the official Aqua at 0x4999…6d31 are the real contracts. Only the Aave price oracle is swapped for one the market controls can move. Every transaction is on the explorer."],
];

export function Questions() {
  return (
    <section className="card">
      <h2>Questions</h2>
      <div className="questions-grid">
        {QUESTIONS.map(([question, answer]) => (
          <details key={question} className="question">
            <summary>{question}</summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function ActivityLog({ activity, explorerUrl }: { activity: Activity[]; explorerUrl: string | null }) {
  return (
    <section className="card">
      <h2>Transactions</h2>
      {activity.length === 0 ? (
        <p className="muted small">Nothing yet this session.</p>
      ) : (
        <ul className="activity">
          {activity.slice(0, 12).map((item) => (
            <li key={item.hash}>
              <span>{item.label}</span>
              <span className="muted">{short(item.signer)} · <TxLink hash={item.hash} explorerUrl={explorerUrl} /></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TopBar({ demo, busy, resetDemo }: { demo: DemoConfig | null; busy: string | null; resetDemo: () => void }) {
  const minutesLeft = demo?.nextResetAt ? Math.max(0, Math.ceil((demo.nextResetAt - Date.now()) / 60_000)) : null;
  return (
    <div className="top">
      <header>
        <h1>Trim</h1>
        <p>A leveraged Aave position that auctions its own rebalance. No keeper: bots compete on price.</p>
      </header>
      <div className="demobar">
        <span className="muted">
          Mainnet fork, public test keys.{minutesLeft !== null && ` Resets itself in ${minutesLeft} min.`}
        </span>
        <a href="/docs/">Docs</a>
        {demo?.explorerUrl && <a href={demo.explorerUrl} target="_blank" rel="noreferrer">Explorer</a>}
        <button disabled={busy !== null} onClick={resetDemo}>Reset demo</button>
      </div>
    </div>
  );
}
