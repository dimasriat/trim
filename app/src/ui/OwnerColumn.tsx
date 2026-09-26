import type { Fill, TrimState } from "../lib/useTrim";
import { accounts } from "../lib/chain";
import { trimSkewInstruction } from "../lib/order";
import { ownerTotals } from "../lib/bot";
import { formatHealthFactor, formatToken, healthStatus, loanToValue, ltvAtHealthFactor, type CurveParams } from "../lib/trim";
import { AddressLink, percent, relativeDeviation, short, shortPercent, signedUsdc, usdc } from "./format";

export function Position({ state, curve, vault, explorerUrl }: { state: TrimState; curve: CurveParams; vault: string; explorerUrl: string | null }) {
  const status = healthStatus(state.healthFactor, state.target);
  const ltv = loanToValue(state.collateralBase, state.debtBase);
  const targetLtv = ltvAtHealthFactor(curve.target, state.liquidationThresholdBps);
  const liquidationLtv = state.liquidationThresholdBps / 10_000;
  const collateralWeth = (state.collateralBase * 10n ** 18n) / state.ethPrice;
  const toBar = (value: number) => Math.max(0, Math.min(100, (value / liquidationLtv) * 100));
  const deviation = relativeDeviation(state, curve);
  return (
    <section className="card">
      <h2>Position on Aave v3</h2>
      <div className="headline">
        <span className={`big ${status}`}>LTV {percent(ltv, 1)}</span>
        <span className="muted">HF {formatHealthFactor(state.healthFactor)} · target HF {curve.target.toFixed(2)}</span>
      </div>
      <div className="bar">
        <div className={`fill ${status}`} style={{ width: `${toBar(ltv)}%` }} />
        <div className="mark" style={{ left: `${toBar(targetLtv)}%` }} />
        <div className="labels">
          <span>0%</span>
          <span style={{ left: `${toBar(targetLtv)}%` }} className="at">target {percent(targetLtv, 1)}</span>
          <span>liquidation {percent(liquidationLtv, 0)}</span>
        </div>
      </div>
      <p className={`status ${status}`}>
        {deviation < 0.0005
          ? "At or below target LTV. No offer is open."
          : `HF is ${percent(deviation, 1)} below target, so the position is auctioning its rebalance.`}
      </p>
      <dl>
        <dt>Collateral</dt>
        <dd>{formatToken(collateralWeth, 18, 4)} WETH <span className="muted">≈ {usdc(Number(state.collateralBase) / Number(state.usdcPrice), 0)}</span></dd>
        <dt>Debt</dt>
        <dd>{usdc(Number(state.debtBase) / Number(state.usdcPrice), 0)}</dd>
        <dt>Vault</dt>
        <dd><AddressLink address={vault} explorerUrl={explorerUrl} /> <span className="muted">owner {short(accounts.owner.address)}</span></dd>
      </dl>
    </section>
  );
}

export function OwnerPnl({ fills }: { fills: Fill[] }) {
  const totals = ownerTotals(fills);
  return (
    <section className="card">
      <h2>Owner: what rebalancing cost</h2>
      <div className="pnl">
        <div><span className="muted">Paid</span><strong>{usdc(totals.cost)}</strong></div>
        <div><span className="muted">Keeper would take</span><strong>{usdc(totals.keeperCost)}</strong></div>
        <div><span className="muted">Saved</span><strong className={totals.saved >= 0 ? "good" : "bad"}>{signedUsdc(totals.saved)}</strong></div>
      </div>
      <p className="muted small">
        {fills.length} fill{fills.length === 1 ? "" : "s"}. Paid = collateral given at the oracle price minus debt repaid. Keeper = one DeFi Saver rebalance of the
        same total, at its measured median leak for that size.
      </p>
    </section>
  );
}

const PRESETS = [
  { name: "Production", maxDiscountBps: 100, fullDeviation: 0.2 },
  { name: "Aggressive", maxDiscountBps: 500, fullDeviation: 0.3 },
  { name: "Patient", maxDiscountBps: 50, fullDeviation: 0.3 },
];

export function CurveSettings({ state, curve, busy, draft, setDraft, shipCurve }: {
  state: TrimState;
  curve: CurveParams;
  busy: string | null;
  draft: CurveParams;
  setDraft: (curve: CurveParams) => void;
  shipCurve: (maxDiscountBps: number, fullDeviation: bigint) => void;
}) {
  const instruction = trimSkewInstruction(state.order.data);
  const maxFull = Math.floor(((curve.target - 1) / curve.target) * 100) / 100;
  const changed = draft.maxDiscountBps !== curve.maxDiscountBps || Math.abs(draft.fullDeviation - curve.fullDeviation) > 1e-9;
  return (
    <section className="card">
      <h2>Owner: the curve, in the program bytes</h2>
      {instruction && (
        <div className="program">
          <span title="opcode">{instruction.opcode}</span>
          <span title="length">{instruction.length}</span>
          <span title="source">{instruction.source.slice(0, 8)}…</span>
          <span className="arg" title="maxDiscountBps">{instruction.maxDiscountBps}</span>
          <span className="arg" title="fullDeviation">{instruction.fullDeviation}</span>
        </div>
      )}
      <label className="slider">
        <span>Max discount <strong>{shortPercent(draft.maxDiscountBps / 10_000)}</strong></span>
        <input type="range" min={10} max={500} step={10} value={draft.maxDiscountBps} onChange={(e) => setDraft({ ...draft, maxDiscountBps: Number(e.target.value) })} />
      </label>
      <label className="slider">
        <span>Reached at HF <strong>{percent(draft.fullDeviation, 0)}</strong> below target (HF {(curve.target * (1 - draft.fullDeviation)).toFixed(2)})</span>
        <input type="range" min={0.05} max={maxFull} step={0.01} value={draft.fullDeviation} onChange={(e) => setDraft({ ...draft, fullDeviation: Number(e.target.value) })} />
      </label>
      <div className="buttons">
        {PRESETS.map((preset) => (
          <button key={preset.name} className="small" onClick={() => setDraft({ ...curve, maxDiscountBps: preset.maxDiscountBps, fullDeviation: preset.fullDeviation })}>
            {preset.name}
          </button>
        ))}
        <button
          className="primary"
          disabled={busy !== null || !changed}
          onClick={() => shipCurve(draft.maxDiscountBps, BigInt(Math.round(draft.fullDeviation * 100)) * 10n ** 16n)}
        >
          Ship this curve
        </button>
      </div>
      <p className="muted small">
        {changed ? "Dashed line on the chart is the preview. " : ""}Shipping signs <code>vault.ship()</code> as the owner {short(accounts.owner.address)}; the
        vault then honours only the newest order.
      </p>
    </section>
  );
}
