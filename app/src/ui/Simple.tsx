import type { CrashProgress, Fill, TargetQuote, TrimState } from "../lib/useTrim";
import { useState } from "react";
import type { Activity, ActivityKind, AutoBot, BotDecision, BotLogEntry } from "../lib/useTrim";
import { ownerTotals } from "../lib/bot";
import { curveDiscount, formatHealthFactor, formatToken, healthStatus, keeperLeak, loanToValue, ltvAtHealthFactor, type CurveParams } from "../lib/trim";
import { hf, percent, TxLink, usdc, wethInUsdc } from "./format";

function dollars(amount: number): string {
  return "$" + amount.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function onTarget(state: TrimState, curve: CurveParams): boolean {
  return (curve.target - hf(state.healthFactor)) / curve.target < 0.0005;
}

function PositionCard({ state, curve }: { state: TrimState; curve: CurveParams }) {
  const status = onTarget(state, curve) ? "healthy" : healthStatus(state.healthFactor, state.target);
  const ltv = loanToValue(state.collateralBase, state.debtBase);
  const targetLtv = ltvAtHealthFactor(curve.target, state.liquidationThresholdBps);
  const liquidationLtv = state.liquidationThresholdBps / 10_000;
  const collateralWeth = (state.collateralBase * 10n ** 18n) / state.ethPrice;
  const toBar = (value: number) => Math.max(0, Math.min(100, (value / liquidationLtv) * 100));
  const healthy = onTarget(state, curve);
  return (
    <section className="card simple">
      <h2>1 · A leveraged position on Aave</h2>
      <div className={`big ${status}`}>LTV {percent(ltv, 1)}</div>
      <div className="bar">
        <div className={`fill ${status}`} style={{ width: `${toBar(ltv)}%` }} />
        <div className="mark" style={{ left: `${toBar(targetLtv)}%` }} />
        <div className="labels">
          <span>0%</span>
          <span style={{ left: `${toBar(targetLtv)}%` }} className="at">target {percent(targetLtv, 1)}</span>
          <span>liquidation {percent(liquidationLtv, 0)}</span>
        </div>
      </div>
      <div className="rows">
        <div><span>Collateral</span><strong>{formatToken(collateralWeth, 18, 2)} WETH <small>{dollars(Number(state.collateralBase) / 1e8)}</small></strong></div>
        <div><span>Debt</span><strong>{formatToken(state.debtBase * 10n ** 6n / state.usdcPrice, 6, 0)} USDC <small>{dollars(Number(state.debtBase) / 1e8)}</small></strong></div>
        <div><span>Health factor</span><strong>{formatHealthFactor(state.healthFactor)} <small>target {curve.target.toFixed(2)} · liquidation 1.00</small></strong></div>
      </div>
      <span className={`chip ${status}`}>{healthy ? "Healthy · no offer" : "Below target · offering a discount"}</span>
    </section>
  );
}

function OfferCard({ state, curve, targetQuote, busy, movePrice, resetPrice, fillToTarget, crashWithBot, crash, stopCrash, openPrice, autoBot, setAutoBot, lastDecision }: {
  autoBot: AutoBot;
  setAutoBot: (bot: AutoBot) => void;
  lastDecision: BotLogEntry | null;
  crash: CrashProgress | null;
  stopCrash: () => void;
  openPrice: number;
  state: TrimState;
  curve: CurveParams;
  targetQuote: TargetQuote;
  busy: string | null;
  movePrice: (percent: number) => void;
  resetPrice: () => void;
  fillToTarget: () => void;
  crashWithBot: () => void;
}) {
  const discount = curveDiscount(hf(state.healthFactor), curve);
  const average = targetQuote ? Number(targetQuote.amountOut - targetQuote.fairOut) / Number(targetQuote.amountOut) : 0;
  return (
    <section className="card simple">
      <h2>2 · The offer</h2>
      <div className="rows">
        <div>
          <span>ETH price (Aave oracle)</span>
          <strong className="price">
            {dollars(Number(state.ethPrice) / 1e8)} <small>{((Number(state.ethPrice) / 1e8 / openPrice - 1) * 100).toFixed(1)}% since start</small>
          </strong>
        </div>
      </div>
      <div className="buttons">
        <button className="primary" disabled={busy !== null} onClick={() => movePrice(-10)}>ETH −10%</button>
        <button disabled={busy !== null} onClick={() => movePrice(5)}>ETH +5%</button>
        <button disabled={busy !== null} onClick={resetPrice}>Start price</button>
      </div>
      <label className="watch">
        <input type="checkbox" checked={autoBot.on} onChange={(e) => setAutoBot({ ...autoBot, on: e.target.checked })} />
        Bot watching: after every price move it fills only if that pays for its gas and selling ({autoBot.costBps} bps)
      </label>
      {!crash && autoBot.on && lastDecision && <DecisionLine decision={lastDecision} />}
      {onTarget(state, curve) || !targetQuote ? (
        <span className="chip muted-chip">{onTarget(state, curve) ? "No offer · position at target" : "Checking the offer…"}</span>
      ) : (
        <div className="offer-box">
          <div className="rows">
            <div><span>Discount now</span><strong className="good">{percent(discount)} below oracle</strong></div>
            <div><span>Bot pays (debt repaid)</span><strong>{formatToken(targetQuote.amountIn, 6, 0)} USDC</strong></div>
            <div><span>Bot gets</span><strong>{formatToken(targetQuote.amountOut, 18, 4)} WETH <small>{dollars(wethInUsdc(targetQuote.amountOut, state.ethPrice, state.usdcPrice))}</small></strong></div>
            <div><span>Average discount of this fill</span><strong>{percent(average)}</strong></div>
          </div>
          <button className="primary wide" disabled={busy !== null} onClick={fillToTarget}>Fill to target now, ignoring the bot's costs</button>
        </div>
      )}
      {crash ? (
        <div className="progress">
          <div className="progress-bar"><div style={{ width: `${(crash.step / crash.steps) * 100}%` }} /></div>
          <div className="progress-text">
            <span>Step {crash.step} / {crash.steps} · ETH {dollars(crash.price)} · bot filled {crash.fills}×</span>
            <button className="small" onClick={stopCrash}>Stop</button>
          </div>
          {crash.decision && <DecisionLine decision={crash.decision} />}
        </div>
      ) : (
        <button className="wide" disabled={busy !== null} onClick={crashWithBot}>Slow crash −20%, a bot watching every step</button>
      )}
    </section>
  );
}

function CostCard({ fills, explorerUrl }: { fills: Fill[]; explorerUrl: string | null }) {
  const totals = ownerTotals(fills);
  const moved = fills.reduce((sum, fill) => sum + Number(fill.amountIn) / 1e6, 0);
  return (
    <section className="card simple">
      <h2>3 · What the rebalance cost</h2>
      {fills.length === 0 ? (
        <div className="cost-rows">
          <div><span>Debt repaid</span><strong>0 USDC</strong></div>
          <div><span>Typical keeper cost</span><strong className="bad">0.56%</strong></div>
          <p className="muted small">DeFi Saver median for a $1k–$10k rebalance, from 919 real ones on Aave v3.</p>
        </div>
      ) : (
        <>
          <div className="cost-rows">
            <div><span>Debt repaid</span><strong>{usdc(moved, 0)}</strong></div>
            <div><span>Cost with Trim</span><strong className="good">{usdc(totals.cost)} ({percent(totals.cost / moved)})</strong></div>
            <div><span>Cost with a keeper</span><strong className="bad">{usdc(totals.keeperCost)} ({percent(keeperLeak(moved))})</strong></div>
            <div className="saved"><span>Saved</span><strong className="good">{usdc(totals.saved)}</strong></div>
          </div>
          <div className="rows">
            <div><span>Transactions</span><strong>{fills.length} <small>no keeper, no fee</small></strong></div>
            <div><span>Latest</span><strong>{explorerUrl ? <a href={`${explorerUrl}/tx/${fills[0].hash}`} target="_blank" rel="noreferrer">View transaction ↗</a> : <TxLink hash={fills[0].hash} explorerUrl={null} />}</strong></div>
          </div>
        </>
      )}
    </section>
  );
}

function money2(v: number): string {
  return "$" + v.toFixed(2);
}

function DecisionLine({ decision }: { decision: BotDecision }) {
  if (decision.action === "none") return <p className="decision muted">Bot: nothing to fill, the position is at target.</p>;
  const fills = decision.action === "fill";
  return (
    <p className={`decision ${fills ? "good" : "warn"}`}>
      Bot {fills ? "fills" : "waits"}: earns {money2(decision.discountUsdc)} {fills ? "≥" : "<"} its cost {money2(decision.costUsdc)} (gas + selling)
    </p>
  );
}

function BotLogCard({ log }: { log: BotLogEntry[] }) {
  return (
    <section className="card simple botlog">
      <h2>What the bot decided</h2>
      {log.length === 0 ? (
        <p className="muted small">With "Bot watching" on, every price move makes the bot weigh the offer: it fills only when the discount it earns beats its gas and selling cost.</p>
      ) : (
        <table className="tx-table">
          <thead>
            <tr><th>#</th><th>After</th><th>ETH</th><th>Best fill</th><th>Bot earns</th><th>Bot's cost</th><th>Decision</th></tr>
          </thead>
          <tbody>
            {[...log].reverse().map((d) => (
              <tr key={d.step}>
                <td>{d.step}</td>
                <td>{d.trigger}</td>
                <td>{dollars(d.price)}</td>
                <td>{d.size ? `${d.size.toLocaleString("en-US")} USDC` : "none"}</td>
                <td>{d.size ? money2(d.discountUsdc) : "·"}</td>
                <td>{d.size ? money2(d.costUsdc) : "·"}</td>
                <td>
                  <span className={`chip ${d.action === "fill" ? "kind-bot" : d.action === "wait" ? "kind-wait" : "kind-oracle"}`}>
                    {d.action === "fill" ? "Fills" : d.action === "wait" ? "Waits" : "No offer"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const FILTERS: { key: ActivityKind | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "oracle", label: "Oracle" },
  { key: "bot", label: "Bot fills" },
  { key: "owner", label: "Owner" },
];

const KIND_LABEL: Record<ActivityKind, string> = { oracle: "Oracle", bot: "Bot", owner: "Owner" };

function TransactionsCard({ activity, explorerUrl }: { activity: Activity[]; explorerUrl: string | null }) {
  const [filter, setFilter] = useState<ActivityKind | "all">("all");
  const shown = activity.filter((item) => filter === "all" || item.kind === filter);
  return (
    <section className="card simple transactions">
      <div className="tx-head">
        <h2>Transactions</h2>
        <div className="tabs">
          {FILTERS.map((f) => (
            <button key={f.key} className={`small ${filter === f.key ? "active" : ""}`} onClick={() => setFilter(f.key)}>
              {f.label} ({f.key === "all" ? activity.length : activity.filter((item) => item.kind === f.key).length})
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="muted small">No transactions yet. Press "ETH −10%" to start.</p>
      ) : (
        <table className="tx-table">
          <thead>
            <tr><th>Block</th><th>Type</th><th>What happened</th><th>Transaction</th></tr>
          </thead>
          <tbody>
            {shown.map((item) => (
              <tr key={item.hash}>
                <td>{item.block.toString()}</td>
                <td><span className={`chip kind-${item.kind}`}>{KIND_LABEL[item.kind]}</span></td>
                <td>{item.label}</td>
                <td><TxLink hash={item.hash} explorerUrl={explorerUrl} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function Simple({ state, curve, fills, targetQuote, busy, explorerUrl, movePrice, resetPrice, fillToTarget, crashWithBot, showDetails, activity, botLog, autoBot, setAutoBot, crash, stopCrash, openPrice }: {
  activity: Activity[];
  botLog: BotLogEntry[];
  autoBot: AutoBot;
  setAutoBot: (bot: AutoBot) => void;
  crash: CrashProgress | null;
  stopCrash: () => void;
  openPrice: number;
  state: TrimState;
  curve: CurveParams;
  fills: Fill[];
  targetQuote: TargetQuote;
  busy: string | null;
  explorerUrl: string | null;
  movePrice: (percent: number) => void;
  resetPrice: () => void;
  fillToTarget: () => void;
  crashWithBot: () => void;
  showDetails: () => void;
}) {
  return (
    <>
      <div className="board">
        <PositionCard state={state} curve={curve} />
        <OfferCard state={state} curve={curve} targetQuote={targetQuote} busy={busy} movePrice={movePrice} resetPrice={resetPrice} fillToTarget={fillToTarget} crashWithBot={crashWithBot} crash={crash} stopCrash={stopCrash} openPrice={openPrice} autoBot={autoBot} setAutoBot={setAutoBot} lastDecision={botLog.at(-1) ?? null} />
        <CostCard fills={fills} explorerUrl={explorerUrl} />
      </div>
      <div className="board lists">
        <BotLogCard log={botLog} />
        <TransactionsCard activity={activity} explorerUrl={explorerUrl} />
      </div>
      <p className="how">
        How: the discount is priced by <strong>TrimSkew</strong>, one new SwapVM instruction, and the swap settles through the official 1inch Aqua on a mainnet
        fork. <a href="/docs/how-it-works" target="_blank" rel="noreferrer">How it works</a> ·{" "}
        <button className="link" onClick={showDetails}>Show every detail</button>
      </p>
    </>
  );
}
