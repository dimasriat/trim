import { useState } from "react";
import type { AutoBot, Fill, TrimState } from "../lib/useTrim";
import { accounts } from "../lib/chain";
import { botTotals } from "../lib/bot";
import { curveDiscount, fillLedger, formatHealthFactor, formatToken, ltvAtHealthFactor } from "../lib/trim";
import { ethInUsdc, hf, percent, short, signedUsdc, TxLink, usdc, wethInUsdc } from "./format";

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
        The threshold is what selling the WETH costs the bot. After every price move the auto-bot takes the largest fill whose average discount clears it, and only
        if the discount also pays for about 460k gas; otherwise it waits.
      </p>
    </section>
  );
}

export function BotPnl({ state, fills }: { state: TrimState; fills: Fill[] }) {
  const totals = botTotals(fills, {
    startUsdc: (Number(state.fillerUsdc) + fills.reduce((sum, fill) => sum + Number(fill.amountIn), 0)) / 1e6,
    usdcNow: Number(state.fillerUsdc) / 1e6,
    wethNow: Number(state.fillerWeth) / 1e18,
    ethPriceUsdc: ethInUsdc(state),
  });
  const gas = fills.reduce((sum, fill) => sum + fill.gasUsdc, 0);
  return (
    <section className="card">
      <h2>Bot: profit and loss</h2>
      <div className="pnl">
        <div><span className="muted">Earned at fill</span><strong className={totals.edge >= 0 ? "good" : "bad"}>{signedUsdc(totals.edge)}</strong></div>
        <div><span className="muted">Marked to market</span><strong className={totals.markToMarket >= 0 ? "good" : "bad"}>{signedUsdc(totals.markToMarket)}</strong></div>
        <div><span className="muted">Gas paid</span><strong>{usdc(gas)}</strong></div>
      </div>
      <p className="muted small">The first number is locked in at fill time. The second also counts the WETH the bot still holds at the current price: holding it through a crash loses money, so real fillers sell at once.</p>
    </section>
  );
}

export function Ledger({ fill, liquidationThresholdBps, explorerUrl }: { fill: Fill; liquidationThresholdBps: number; explorerUrl: string | null }) {
  const ledger = fillLedger(fill);
  const start = fill.curve ? curveDiscount(hf(fill.hfBefore), fill.curve) : 0;
  const end = fill.curve ? curveDiscount(hf(fill.hfAfter), fill.curve) : 0;
  const edge = ledger.positionCostUsdc - fill.gasUsdc;
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
          <div>Gas {usdc(fill.gasUsdc)}</div>
          <div className={`net ${edge >= 0 ? "good" : "bad"}`}>Edge {signedUsdc(edge)}</div>
          <div className="muted">{edge < 0 ? "A rational bot would have waited." : "Before selling the WETH."}</div>
        </div>
      </div>
      <p className="muted small">
        LTV {percent(ltvAtHealthFactor(hf(fill.hfBefore), liquidationThresholdBps), 1)} → {percent(ltvAtHealthFactor(hf(fill.hfAfter), liquidationThresholdBps), 1)}, HF{" "}
        {formatHealthFactor(fill.hfBefore)} → {formatHealthFactor(fill.hfAfter)}. Discount {percent(start)} at the start, {percent(end)} at the end. {fill.gasUsed.toLocaleString("en-US")} gas.
      </p>
    </section>
  );
}
