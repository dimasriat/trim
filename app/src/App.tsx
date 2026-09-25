import { FILL_SIZES, useTrim, type Quote, type TrimState } from "./lib/useTrim";
import { discountVsOracle, formatHealthFactor, formatToken, healthStatus } from "./lib/trim";

const STATUS_TEXT = {
  healthy: "On target. No offer is open.",
  auction: "Off target. The position is auctioning its rebalance.",
  danger: "Close to liquidation. The discount is at its steepest.",
};

function usd(base: bigint): string {
  return "$" + formatToken(base, 8, 0);
}

function HealthBar({ state }: { state: TrimState }) {
  const toPercent = (hf: bigint) => Math.max(0, Math.min(100, ((Number(hf) / 1e18 - 1) / 0.8) * 100));
  return (
    <div className="bar">
      <div className={`fill ${healthStatus(state.healthFactor, state.target)}`} style={{ width: `${toPercent(state.healthFactor)}%` }} />
      <div className="mark" style={{ left: `${toPercent(state.target)}%` }} title="target" />
      <div className="labels">
        <span>1.0 liquidation</span>
        <span>{formatHealthFactor(state.target)} target</span>
      </div>
    </div>
  );
}

function Position({ state }: { state: TrimState }) {
  const status = healthStatus(state.healthFactor, state.target);
  return (
    <section className="card">
      <h2>Position on Aave v3</h2>
      <div className={`big ${status}`}>HF {formatHealthFactor(state.healthFactor)}</div>
      <HealthBar state={state} />
      <p className="muted">{STATUS_TEXT[status]}</p>
      <dl>
        <dt>Collateral</dt>
        <dd>{usd(state.collateralBase)} WETH</dd>
        <dt>Debt</dt>
        <dd>{usd(state.debtBase)} USDC</dd>
      </dl>
    </section>
  );
}

function Market({ state, busy, movePrice, resetPrice }: {
  state: TrimState;
  busy: string | null;
  movePrice: (percent: number) => void;
  resetPrice: () => void;
}) {
  return (
    <section className="card">
      <h2>Market</h2>
      <div className="big">ETH {usd(state.ethPrice)}</div>
      <div className="buttons">
        {[-10, -5, 5].map((percent) => (
          <button key={percent} disabled={busy !== null} onClick={() => movePrice(percent)}>
            ETH {percent > 0 ? "+" : ""}{percent}%
          </button>
        ))}
        <button disabled={busy !== null} onClick={resetPrice}>Reset</button>
      </div>
    </section>
  );
}

function OfferRow({ size, quote, pastTarget }: { size: bigint; quote: Quote; pastTarget: boolean }) {
  if (!quote) {
    return (
      <tr>
        <td>{formatToken(size, 6, 0)} USDC</td>
        <td colSpan={2} className="muted">{pastTarget ? "past target" : "no offer"}</td>
      </tr>
    );
  }
  return (
    <tr>
      <td>{formatToken(size, 6, 0)} USDC</td>
      <td>{formatToken(quote.amountOut, 18, 4)} WETH</td>
      <td className="good">{(discountVsOracle(quote.fairOut, quote.amountOut) * 100).toFixed(2)}%</td>
    </tr>
  );
}

function Offers({ state }: { state: TrimState }) {
  return (
    <section className="card">
      <h2>Offer, priced by TrimSkew</h2>
      <table>
        <thead>
          <tr><th>Pay</th><th>Get</th><th>Below oracle</th></tr>
        </thead>
        <tbody>
          {FILL_SIZES.map((size, i) => (
            <OfferRow key={String(size)} size={size} quote={state.quotes[i]} pastTarget={state.quotes.some((q) => q !== null)} />
          ))}
        </tbody>
      </table>
      <p className="muted">Bigger fills move the position further back to target, so their average discount is smaller.</p>
    </section>
  );
}

function Filler({ state, busy, fills, fill }: {
  state: TrimState;
  busy: string | null;
  fills: ReturnType<typeof useTrim>["fills"];
  fill: (amountIn: bigint) => void;
}) {
  return (
    <section className="card">
      <h2>Filler bot</h2>
      <div className="buttons">
        {FILL_SIZES.map((size) => (
          <button key={String(size)} disabled={busy !== null} onClick={() => fill(size)}>
            Fill {formatToken(size, 6, 0)}
          </button>
        ))}
      </div>
      <p className="muted">Holds {formatToken(state.fillerUsdc, 6, 0)} USDC, {formatToken(state.fillerWeth, 18, 4)} WETH</p>
      <ul className="log">
        {fills.map((f) => (
          <li key={f.hash}>
            Paid {formatToken(f.amountIn, 6, 0)} USDC, got {formatToken(f.amountOut, 18, 4)} WETH. HF {formatHealthFactor(f.hfBefore)} → {formatHealthFactor(f.hfAfter)}, {f.gasUsed.toLocaleString("en-US")} gas
          </li>
        ))}
      </ul>
    </section>
  );
}

export function App() {
  const { state, fills, busy, error, movePrice, resetPrice, fill } = useTrim();
  return (
    <main>
      <header>
        <h1>Trim</h1>
        <p>Make the bots compete on price, not speed.</p>
      </header>
      {error && <p className="error">{error}</p>}
      {!state ? (
        <p className="muted">Connecting to the fork…</p>
      ) : (
        <>
          <Position state={state} />
          <Market state={state} busy={busy} movePrice={movePrice} resetPrice={resetPrice} />
          <Offers state={state} />
          <Filler state={state} busy={busy} fills={fills} fill={fill} />
        </>
      )}
      <footer className="muted">
        Keepers today: DeFi Saver leaks 0.48% median per rebalance and one dump lost $700k. Morpho pre-liquidations pay a flat 4.4%.
        Demo on a local mainnet fork with public test keys.
      </footer>
    </main>
  );
}
