import { useState } from "react";
import type { AutoBot, Fill, TrimState } from "../lib/useTrim";
import { accounts } from "../lib/chain";
import { botTotals } from "../lib/bot";
import { curveDiscount, fillLedger, formatHealthFactor, formatToken, ltvAtHealthFactor } from "../lib/trim";
import { hf, percent, short, signedUsdc, TxLink, usdc, wethInUsdc } from "./format";

export function Bot({ state, busy, autoBot, setAutoBot, fill, fillToTarget, runBotNow }: {
  state: TrimState;
  busy: string | null;
  autoBot: AutoBot;
  setAutoBot: (bot: AutoBot) => void;
  fill: (amountIn: bigint) => void;
  fillToTarget: () => void;
  runBotNow: () => void;
}) {
  const [amount, setAmount] = useState("1000");
  const amountIn = BigInt(Math.round(Number(amount) * 1e6 || 0));
  return (
    <section className="card">
      <h2>Filler bot</h2>
      <p className="muted small">
        Operator {short(accounts.filler.address)} runs <code>TrimFiller</code>. Holds {formatToken(state.fillerUsdc, 6, 0)} USDC and{" "}
        {formatToken(state.fillerWeth, 18, 4)} WETH (≈ {usdc(wethInUsdc(state.fillerWeth, state.ethPrice, state.usdcPrice), 0)}). It can only swap at the curve's price.
      </p>
      <div className="buttons">
        <input className="number" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="USDC to pay" />
        <button disabled={busy !== null || amountIn <= 0n || amountIn > state.fillerUsdc} onClick={() => fill(amountIn)}>Fill {Number(amount || 0).toLocaleString("en-US")} USDC</button>
        <button disabled={busy !== null} onClick={fillToTarget}>Fill to target</button>
      </div>
      <div className="autobot">
        <label>
          <input type="checkbox" checked={autoBot.on} onChange={(e) => setAutoBot({ ...autoBot, on: e.target.checked })} /> Auto-bot
        </label>
        <label>
          fills when the discount is at least
          <input className="number tiny" type="number" min={1} max={500} value={autoBot.costBps} onChange={(e) => setAutoBot({ ...autoBot, costBps: Number(e.target.value) })} /> bps
        </label>
        <button className="small" disabled={busy !== null} onClick={runBotNow}>Run once</button>
      </div>
      <p className="muted small">
        The threshold is what selling the WETH costs the bot. After every price move the auto-bot takes the largest fill whose average discount clears it, and
        only if the discount also pays for the gas and the sale; otherwise it waits.
      </p>
    </section>
  );
}

export function BotPnl({ fills, sellCostBps }: { fills: Fill[]; sellCostBps: number }) {
  const totals = botTotals(fills, sellCostBps);
  return (
    <section className="card">
      <h2>Bot: profit and loss</h2>
      <div className="pnl">
        <div><span className="muted">Discount earned</span><strong>{usdc(totals.discount)}</strong></div>
        <div><span className="muted">Gas and selling</span><strong>{usdc(totals.gas + totals.selling)}</strong></div>
        <div><span className="muted">Profit</span><strong className={totals.profit >= 0 ? "good" : "bad"}>{signedUsdc(totals.profit)}</strong></div>
      </div>
      <p className="muted small">Like a real filler, the bot sells the WETH it receives right away, paying {sellCostBps} bps to do it. Profit = discount − gas − selling.</p>
    </section>
  );
}

export function Ledger({ fill, liquidationThresholdBps, explorerUrl, sellCostBps }: { fill: Fill; liquidationThresholdBps: number; explorerUrl: string | null; sellCostBps: number }) {
  const ledger = fillLedger(fill);
  const start = fill.curve ? curveDiscount(hf(fill.hfBefore), fill.curve) : 0;
  const end = fill.curve ? curveDiscount(hf(fill.hfAfter), fill.curve) : 0;
  const selling = ledger.debtRepaidUsdc * (sellCostBps / 10_000);
  const profit = ledger.positionCostUsdc - fill.gasUsdc - selling;
  return (
    <section className="card">
      <h2>Last fill <TxLink hash={fill.hash} explorerUrl={explorerUrl} /></h2>
      <ol className="steps">
        {fill.steps.map((step, i) => <li key={i}>{step}</li>)}
      </ol>
      <div className="split">
        <div className="party">
          <div className="who">Owner</div>
          <div>Gave {formatToken(fill.amountOut, 18, 4)} WETH ≈ {usdc(ledger.collateralOutUsdc)}</div>
          <div>Debt down {usdc(ledger.debtRepaidUsdc)}</div>
          <div className="net">Paid {usdc(ledger.positionCostUsdc)} ({percent(ledger.positionCostShare)})</div>
        </div>
        <div className="party">
          <div className="who">Bot</div>
          <div>Paid {usdc(ledger.debtRepaidUsdc)}</div>
          <div>Discount {usdc(ledger.positionCostUsdc)}</div>
          <div>Gas {usdc(fill.gasUsdc)} · selling {usdc(selling)}</div>
          <div className={`net ${profit >= 0 ? "good" : "bad"}`}>Profit {signedUsdc(profit)}</div>
          {profit < 0 && <div className="muted">A rational bot would have waited.</div>}
        </div>
      </div>
      <p className="muted small">
        LTV {percent(ltvAtHealthFactor(hf(fill.hfBefore), liquidationThresholdBps), 1)} → {percent(ltvAtHealthFactor(hf(fill.hfAfter), liquidationThresholdBps), 1)}, HF{" "}
        {formatHealthFactor(fill.hfBefore)} → {formatHealthFactor(fill.hfAfter)}. Discount {percent(start)} at the start, {percent(end)} at the end. {fill.gasUsed.toLocaleString("en-US")} gas.
      </p>
    </section>
  );
}
