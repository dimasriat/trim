import { useEffect, useState } from "react";
import { FILL_SIZES, type Quote, type Session, type TrimState } from "../lib/useTrim";
import { accounts } from "../lib/chain";
import { curveDiscount, formatToken, ltvAtHealthFactor, type CurveParams } from "../lib/trim";
import { hf, percent, relativeDeviation, short, shortPercent, usdc, wethInUsdc } from "./format";

export function Market({ state, session, busy, setEthPrice, movePrice, resetPrice, slowCrash }: {
  state: TrimState;
  session: Session | null;
  busy: string | null;
  setEthPrice: (price: bigint) => void;
  movePrice: (percent: number) => void;
  resetPrice: () => void;
  slowCrash: (totalPercent: number, steps: number) => void;
}) {
  const now = Number(state.ethPrice) / 1e8;
  const open = session ? Number(session.openPrice) / 1e8 : now;
  const [target, setTarget] = useState(now);
  useEffect(() => setTarget(now), [now]);
  const collateralWeth = Number(state.collateralBase) / Number(state.ethPrice);
  const priceForLtv = (ltv: number) => Number(state.debtBase) / 1e8 / (collateralWeth * ltv);
  const [ltvInput, setLtvInput] = useState("");
  return (
    <section className="card">
      <h2>Market</h2>
      <div className="headline">
        <span className="big">{formatToken((state.ethPrice * 10n ** 8n) / state.usdcPrice, 8, 2)}</span>
        <span className="muted">USDC per ETH, Aave oracle{session ? ` · started at ${open.toFixed(2)}` : ""}</span>
      </div>
      <label className="slider">
        <span>Set the oracle to <strong>{target.toFixed(2)} USD</strong> ({((target / now - 1) * 100).toFixed(1)}%)</span>
        <input type="range" min={Math.round(open * 0.5)} max={Math.round(open * 1.1)} step={1} value={target} onChange={(e) => setTarget(Number(e.target.value))} />
      </label>
      <div className="buttons">
        <button className="primary" disabled={busy !== null || Math.abs(target - now) < 0.005} onClick={() => setEthPrice(BigInt(Math.round(target * 1e8)))}>Set price</button>
        {[-10, -5, 5].map((change) => (
          <button key={change} disabled={busy !== null} onClick={() => movePrice(change)}>
            {change > 0 ? "+" : ""}{change}%
          </button>
        ))}
        <button disabled={busy !== null} onClick={resetPrice}>Start price</button>
      </div>
      <div className="buttons">
        <input className="number" placeholder="LTV %" value={ltvInput} onChange={(e) => setLtvInput(e.target.value)} />
        <button
          disabled={busy !== null || !(Number(ltvInput) > 0 && Number(ltvInput) < 100)}
          onClick={() => setEthPrice(BigInt(Math.round(priceForLtv(Number(ltvInput) / 100) * 1e8)))}
        >
          Move price to this LTV
        </button>
        <button disabled={busy !== null} onClick={() => slowCrash(20, 20)}>Slow crash −20% in 20 steps</button>
      </div>
      <p className="muted small">Signed by the market wallet {short(accounts.market.address)}, which owns the demo oracle. LTV moves with the price; debt stays put.</p>
    </section>
  );
}

export function Curve({ state, curve, draft, quote }: { state: TrimState; curve: CurveParams; draft: CurveParams; quote: Quote }) {
  const width = 360;
  const height = 150;
  const pad = { left: 40, right: 12, top: 12, bottom: 36 };
  const rightHf = 0.95;
  const topDiscount = Math.max(curve.maxDiscountBps, draft.maxDiscountBps) / 10_000;
  const x = (value: number) => pad.left + ((curve.target - value) / (curve.target - rightHf)) * (width - pad.left - pad.right);
  const y = (discount: number) => height - pad.bottom - (discount / topDiscount) * (height - pad.top - pad.bottom);
  const line = (c: CurveParams) => {
    const full = c.target * (1 - c.fullDeviation);
    return `${x(c.target)},${y(0)} ${x(full)},${y(c.maxDiscountBps / 10_000)} ${x(rightHf)},${y(c.maxDiscountBps / 10_000)}`;
  };
  const now = hf(state.healthFactor);
  const nowInView = now < curve.target && now >= rightHf;
  const ticks = [curve.target, 1.4, 1.3, 1.2, 1.1, 1.0].filter((tick) => tick <= curve.target);
  const yTicks = [0, topDiscount / 2, topDiscount];
  const start = quote ? curveDiscount(now, curve) : 0;
  const end = quote ? curveDiscount(quote.healthFactorAfter, curve) : 0;
  const deviation = relativeDeviation(state, curve);
  const previewing = draft.maxDiscountBps !== curve.maxDiscountBps || Math.abs(draft.fullDeviation - curve.fullDeviation) > 1e-9;
  return (
    <section className="card">
      <h2>Discount curve, TrimSkew</h2>
      <svg viewBox={`0 0 ${width} ${height}`} className="curve" role="img" aria-label="Discount against health factor">
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} y1={y(tick)} x2={width - pad.right} y2={y(tick)} className="grid" />
            <text x={pad.left - 4} y={y(tick) + 4} className="tick end">{shortPercent(tick)}</text>
          </g>
        ))}
        <line x1={x(1)} y1={pad.top} x2={x(1)} y2={y(0)} className="liquidation" />
        <text x={x(1) - 3} y={pad.top + 9} className="tick end bad">liquidation</text>
        {ticks.map((tick) => (
          <g key={tick}>
            <text x={x(tick)} y={y(0) + 13} className="tick">{tick.toFixed(2)}</text>
            <text x={x(tick)} y={y(0) + 25} className="tick faint">{percent(ltvAtHealthFactor(tick, state.liquidationThresholdBps), 0)}</text>
          </g>
        ))}
        <polyline points={line(curve)} className="line" />
        {previewing && <polyline points={line(draft)} className="line preview" />}
        {quote && nowInView && <line x1={x(now)} y1={y(start)} x2={x(quote.healthFactorAfter)} y2={y(end)} className="segment" />}
        {nowInView && <circle cx={x(now)} cy={y(curveDiscount(now, curve))} r={4.5} className="now" />}
      </svg>
      <p className="axis-note muted">Across: HF (LTV below it), falling to the right. Up: discount below the oracle price.</p>
      <p className="explain">
        Discount = {shortPercent(curve.maxDiscountBps / 10_000)} × (HF below target ÷ {percent(curve.fullDeviation, 0)}), capped at {shortPercent(curve.maxDiscountBps / 10_000)}.
        {deviation > 0 && ` Now: ${shortPercent(curve.maxDiscountBps / 10_000)} × (${percent(deviation, 1)} ÷ ${percent(curve.fullDeviation, 0)}) = ${percent(curveDiscount(now, curve))}.`}
        {quote && ` The selected fill starts at ${percent(start)} and ends at ${percent(end)}, so it gets the average, ${percent((start + end) / 2)}.`}
      </p>
    </section>
  );
}

export function Offers({ state, selected, select }: { state: TrimState; selected: number; select: (index: number) => void }) {
  const offTarget = state.healthFactor < state.target;
  return (
    <section className="card">
      <h2>Offers a bot can take now</h2>
      <ul className="offers">
        {FILL_SIZES.map((size, i) => {
          const quote = state.quotes[i];
          const affordable = size <= state.fillerUsdc;
          return (
            <li key={String(size)}>
              <button className={`offer ${i === selected ? "selected" : ""}`} onClick={() => select(i)}>
                <span className="pay">Pay {formatToken(size, 6, 0)} USDC</span>
                {quote ? (
                  <>
                    <span className="get">
                      Get {formatToken(quote.amountOut, 18, 4)} WETH
                      <span className="muted"> ≈ {usdc(wethInUsdc(quote.amountOut, state.ethPrice, state.usdcPrice))}</span>
                    </span>
                    <span className="good">{percent(Number(quote.amountOut - quote.fairOut) / Number(quote.amountOut))} below oracle</span>
                  </>
                ) : (
                  <span className="muted">
                    {!affordable ? "More than the bot holds." : offTarget ? "Not fillable: it would push past target, or leave HF under 1." : "No offer: the position is on target."}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="muted small">Every offer here is a simulated <code>fill</code> from the bot, hooks included, so what is shown will execute.</p>
    </section>
  );
}
