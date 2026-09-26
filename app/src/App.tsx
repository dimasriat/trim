import { useState } from "react";
import { FILL_SIZES, useTrim, type Activity, type DemoConfig, type Fill, type Quote, type TrimState } from "./lib/useTrim";
import { accounts } from "./lib/chain";
import { curveFromOrderData, trimSkewInstruction } from "./lib/order";
import {
  curveDiscount,
  fillLedger,
  formatHealthFactor,
  formatToken,
  healthStatus,
  keeperLeak,
  loanToValue,
  ltvAtHealthFactor,
  type CurveParams,
} from "./lib/trim";

function percent(fraction: number, digits = 2): string {
  return (fraction * 100).toFixed(digits) + "%";
}

function usdc(amount: number, digits = 2): string {
  return amount.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + " USDC";
}

function hf(value: bigint): number {
  return Number(value) / 1e18;
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function TxLink({ hash, explorerUrl }: { hash: string; explorerUrl: string | null }) {
  const text = `${hash.slice(0, 10)}…${hash.slice(-6)}`;
  return explorerUrl ? <a className="hash" href={`${explorerUrl}/tx/${hash}`} target="_blank" rel="noreferrer">{text}</a> : <code className="hash">{text}</code>;
}

function AddressLink({ address, explorerUrl }: { address: string; explorerUrl: string | null }) {
  return explorerUrl ? <a className="hash" href={`${explorerUrl}/address/${address}`} target="_blank" rel="noreferrer">{short(address)}</a> : <code className="hash">{short(address)}</code>;
}

function wethInUsdc(weth: bigint, ethPrice: bigint, usdcPrice: bigint): number {
  return (Number(weth) / 1e18) * (Number(ethPrice) / Number(usdcPrice));
}

function Position({ state, curve, vault, explorerUrl }: { state: TrimState; curve: CurveParams; vault: string; explorerUrl: string | null }) {
  const status = healthStatus(state.healthFactor, state.target);
  const ltv = loanToValue(state.collateralBase, state.debtBase);
  const targetLtv = ltvAtHealthFactor(curve.target, state.liquidationThresholdBps);
  const liquidationLtv = state.liquidationThresholdBps / 10_000;
  const collateralWeth = (state.collateralBase * 10n ** 18n) / state.ethPrice;
  const toBar = (value: number) => Math.max(0, Math.min(100, (value / liquidationLtv) * 100));
  const points = (ltv - targetLtv) * 100;
  return (
    <section className="card">
      <h2>Position on Aave v3</h2>
      <div className="headline">
        <span className={`big ${status}`}>LTV {percent(ltv, 1)}</span>
        <span className="muted">HF {formatHealthFactor(state.healthFactor)}</span>
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
        {points <= 0
          ? "At or below target LTV. No offer is open, so no bot has a reason to come."
          : `LTV is ${points.toFixed(1)} points above target. The position is auctioning its rebalance.`}
      </p>
      <dl>
        <dt>Collateral</dt>
        <dd>{formatToken(collateralWeth, 18, 4)} WETH <span className="muted">≈ {usdc(Number(state.collateralBase) / Number(state.usdcPrice), 0)}</span></dd>
        <dt>Debt</dt>
        <dd>{usdc(Number(state.debtBase) / Number(state.usdcPrice), 0)}</dd>
        <dt>LTV</dt>
        <dd className="muted">debt / collateral</dd>
        <dt>Vault</dt>
        <dd><AddressLink address={vault} explorerUrl={explorerUrl} /> <span className="muted">owner {short(accounts.owner.address)}</span></dd>
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
      <div className="headline">
        <span className="big">{formatToken((state.ethPrice * 10n ** 8n) / state.usdcPrice, 8, 2)}</span>
        <span className="muted">USDC per ETH, Aave oracle</span>
      </div>
      <div className="buttons">
        {[-10, -5, 5].map((change) => (
          <button key={change} disabled={busy !== null} onClick={() => movePrice(change)}>
            ETH {change > 0 ? "+" : ""}{change}%
          </button>
        ))}
        <button disabled={busy !== null} onClick={resetPrice}>Reset price</button>
      </div>
      <p className="muted role">Signed by the market wallet {short(accounts.market.address)}, which owns the demo oracle.</p>
    </section>
  );
}

const CURVE_RIGHT_HF = 1.1;

function Curve({ state, curve, quote }: { state: TrimState; curve: CurveParams; quote: Quote }) {
  const width = 320;
  const height = 150;
  const pad = { left: 36, right: 10, top: 12, bottom: 34 };
  const maxDiscount = curve.maxDiscountBps / 10_000;
  const x = (value: number) => pad.left + ((curve.target - value) / (curve.target - CURVE_RIGHT_HF)) * (width - pad.left - pad.right);
  const y = (discount: number) => height - pad.bottom - (discount / maxDiscount) * (height - pad.top - pad.bottom);
  const fullHf = curve.target * (1 - curve.fullDeviation);
  const now = hf(state.healthFactor);
  const nowInView = now < curve.target && now >= CURVE_RIGHT_HF;
  const ticks = [curve.target, 1.4, 1.3, fullHf, CURVE_RIGHT_HF];
  const start = quote ? curveDiscount(now, curve) : 0;
  const end = quote ? curveDiscount(quote.healthFactorAfter, curve) : 0;
  return (
    <section className="card">
      <h2>Discount curve, TrimSkew</h2>
      <svg viewBox={`0 0 ${width} ${height}`} className="curve" role="img" aria-label="Discount against health factor">
        <line x1={pad.left} y1={y(0)} x2={width - pad.right} y2={y(0)} className="axis" />
        <line x1={pad.left} y1={y(0)} x2={pad.left} y2={pad.top} className="axis" />
        <text x={pad.left - 4} y={y(maxDiscount) + 4} className="tick end">{percent(maxDiscount, 0)}</text>
        <text x={pad.left - 4} y={y(0) + 4} className="tick end">0%</text>
        {ticks.map((tick) => (
          <g key={tick}>
            <text x={x(tick)} y={y(0) + 13} className="tick">{tick.toFixed(2)}</text>
            <text x={x(tick)} y={y(0) + 25} className="tick faint">{percent(ltvAtHealthFactor(tick, state.liquidationThresholdBps), 0)}</text>
          </g>
        ))}
        <polyline
          points={`${x(curve.target)},${y(0)} ${x(fullHf)},${y(maxDiscount)} ${x(CURVE_RIGHT_HF)},${y(maxDiscount)}`}
          className="line"
        />
        {quote && nowInView && (
          <line x1={x(now)} y1={y(start)} x2={x(quote.healthFactorAfter)} y2={y(end)} className="segment" />
        )}
        {nowInView && <circle cx={x(now)} cy={y(curveDiscount(now, curve))} r={4.5} className="now" />}
      </svg>
      <p className="axis-note muted">Across: HF, with LTV below it. Up: discount below the oracle price.</p>
      <p className="explain">
        Discount = {percent(maxDiscount, 0)} × distance below target ÷ {percent(curve.fullDeviation, 0)}.
        {quote
          ? ` This fill starts at ${percent(start)} and ends at ${percent(end)}, so it gets the average, ${percent((start + end) / 2)}.`
          : " The dot is the position now. Pick an offer to see its fill drawn on the line."}
      </p>
    </section>
  );
}

function Offers({ state, selected, select }: { state: TrimState; selected: number; select: (index: number) => void }) {
  const offTarget = state.healthFactor < state.target;
  return (
    <section className="card">
      <h2>Offers a bot can take now</h2>
      <ul className="offers">
        {FILL_SIZES.map((size, i) => {
          const quote = state.quotes[i];
          const pay = formatToken(size, 6, 0) + " USDC";
          return (
            <li key={String(size)}>
              <button className={`offer ${i === selected ? "selected" : ""}`} onClick={() => select(i)}>
                <span className="pay">Pay {pay}</span>
                {quote ? (
                  <>
                    <span className="get">
                      Get {formatToken(quote.amountOut, 18, 4)} WETH
                      <span className="muted"> ≈ {usdc(wethInUsdc(quote.amountOut, state.ethPrice, state.usdcPrice))}</span>
                    </span>
                    <span className="good">{percent(Number(quote.amountOut - quote.fairOut) / Number(quote.amountOut))} below oracle</span>
                  </>
                ) : (
                  <span className="muted">{offTarget ? "Too big: this fill would push the position past target." : "No offer: the position is on target."}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Ledger({ fill, curve, liquidationThresholdBps, explorerUrl }: { fill: Fill; curve: CurveParams; liquidationThresholdBps: number; explorerUrl: string | null }) {
  const ledger = fillLedger(fill);
  const gasUsdc = wethInUsdc(fill.gasUsed * fill.gasPrice, fill.ethPrice, fill.usdcPrice);
  const collateralOut = formatToken(fill.amountOut, 18, 4) + " WETH";
  const keeper = keeperLeak(ledger.debtRepaidUsdc);
  const ltvBefore = ltvAtHealthFactor(hf(fill.hfBefore), liquidationThresholdBps);
  const ltvAfter = ltvAtHealthFactor(hf(fill.hfAfter), liquidationThresholdBps);
  const start = curveDiscount(hf(fill.hfBefore), curve);
  const end = curveDiscount(hf(fill.hfAfter), curve);
  return (
    <div className="ledger">
      <h3>Who got what in the last fill</h3>
      <div className="party">
        <div className="who">One transaction <TxLink hash={fill.hash} explorerUrl={explorerUrl} /></div>
        <ol className="steps">
          {fill.steps.map((step, i) => <li key={i}>{step}</li>)}
        </ol>
      </div>
      <div className="party">
        <div className="who">Position</div>
        <div>Gave {collateralOut} <span className="muted">≈ {usdc(ledger.collateralOutUsdc)}</span></div>
        <div>Got its debt cut by {usdc(ledger.debtRepaidUsdc)}</div>
        <div className="net">Cost {usdc(ledger.positionCostUsdc)} ({percent(ledger.positionCostShare)})</div>
      </div>
      <div className="party">
        <div className="who">Filler bot</div>
        <div>Paid {usdc(ledger.debtRepaidUsdc)} and {usdc(gasUsdc)} of gas</div>
        <div>Got {collateralOut} <span className="muted">≈ {usdc(ledger.collateralOutUsdc)}</span></div>
        <div className="net">Edge {usdc(ledger.positionCostUsdc - gasUsdc)} before selling the WETH</div>
      </div>
      <div className="party">
        <div className="who">Keeper today, same size</div>
        <div>DeFi Saver's measured median leak at this size is {percent(keeper)}.</div>
        <div className="net">Cost {usdc(ledger.debtRepaidUsdc * keeper)}</div>
      </div>
      <p className="muted">
        The cost depends on how far the position drifted before a bot filled. This demo moves the price 10% at a time
        with no bot watching in between; live, bots fill as soon as the discount covers their cost.
      </p>
      <p className="muted">
        LTV {percent(ltvBefore, 1)} → {percent(ltvAfter, 1)}, HF {formatHealthFactor(fill.hfBefore)} → {formatHealthFactor(fill.hfAfter)}.
        Discount {percent(start)} at the start, {percent(end)} at the end. {fill.gasUsed.toLocaleString("en-US")} gas.
      </p>
    </div>
  );
}

function Filler({ state, busy, fills, fill, curve, explorerUrl }: {
  explorerUrl: string | null;
  state: TrimState;
  busy: string | null;
  fills: Fill[];
  fill: (amountIn: bigint) => void;
  curve: CurveParams;
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
      <p className="muted">
        Operator {short(accounts.filler.address)} runs <code>TrimFiller</code>. Holds {formatToken(state.fillerUsdc, 6, 0)} USDC and {formatToken(state.fillerWeth, 18, 4)} WETH. It can only
        swap at the curve's price; it has no permission over the owner's wallet.
      </p>
      {fills[0] && <Ledger fill={fills[0]} curve={curve} liquidationThresholdBps={state.liquidationThresholdBps} explorerUrl={explorerUrl} />}
      {fills.length > 1 && (
        <ul className="log">
          {fills.slice(1).map((f) => {
            const ledger = fillLedger(f);
            return (
              <li key={f.hash}>
                Paid {formatToken(f.amountIn, 6, 0)} USDC, got {formatToken(f.amountOut, 18, 4)} WETH. Position cost {usdc(ledger.positionCostUsdc)} ({percent(ledger.positionCostShare)}), HF {formatHealthFactor(f.hfBefore)} → {formatHealthFactor(f.hfAfter)}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const PRESETS = [
  { name: "Production", maxDiscountBps: 100, fullDeviation: 200_000_000_000_000_000n },
  { name: "Aggressive", maxDiscountBps: 500, fullDeviation: 300_000_000_000_000_000n },
  { name: "Patient", maxDiscountBps: 50, fullDeviation: 400_000_000_000_000_000n },
];

function Owner({ state, busy, shipCurve }: { state: TrimState; busy: string | null; shipCurve: (maxDiscountBps: number, fullDeviation: bigint) => void }) {
  const instruction = trimSkewInstruction(state.order.data);
  const current = curveFromOrderData(state.order.data);
  const shippedCurves = new Set(state.shipped.map((order) => {
    const curve = curveFromOrderData(order.data);
    return curve ? `${curve.maxDiscountBps}/${curve.fullDeviation}` : "";
  }));
  return (
    <section className="card">
      <h2>Owner: the curve lives in the program bytes</h2>
      {instruction && (
        <div className="program">
          <span title="opcode">{instruction.opcode}</span>
          <span title="length">{instruction.length}</span>
          <span title="source">{instruction.source.slice(0, 8)}…</span>
          <span className="arg" title="maxDiscountBps">{instruction.maxDiscountBps}</span>
          <span className="arg" title="fullDeviation">{instruction.fullDeviation}</span>
        </div>
      )}
      <p className="muted">
        Opcode <code>0xb6</code>, then the source, then {current ? `${current.maxDiscountBps} bps` : "?"} and{" "}
        {current ? `${Number(current.fullDeviation) / 1e16}%` : "?"}. A filler can read the whole pricing rule before it fills.
      </p>
      <div className="buttons">
        {PRESETS.map((preset) => {
          const key = `${preset.maxDiscountBps}/${preset.fullDeviation}`;
          const active = current && `${current.maxDiscountBps}/${current.fullDeviation}` === key;
          return (
            <button key={preset.name} className={active ? "active" : ""} disabled={busy !== null || shippedCurves.has(key)} onClick={() => shipCurve(preset.maxDiscountBps, preset.fullDeviation)}>
              {preset.name} {preset.maxDiscountBps / 100}% / {Number(preset.fullDeviation) / 1e16}%
            </button>
          );
        })}
      </div>
      <p className="muted role">
        Signed by the owner {short(accounts.owner.address)}. Aqua strategies are immutable, so each curve ships once per session and
        the vault only honours the latest; Reset demo brings back Production.
      </p>
    </section>
  );
}

const QUESTIONS: [string, string][] = [
  ["Why not a keeper, like DeFi Saver?", "We measured all 919 DeFi Saver automated rebalances on Aave v3 over twelve months: the median leaks 0.48% of the amount moved, 0.56% between $1k and $10k, mostly service fee and marked-up gas. Trim has no operator to pay."],
  ["Isn't this just a Dutch auction, like UniswapX or Fusion?", "Those are driven by a clock and need someone to sign each order. A Trim strategy is shipped once. Its price moves with the position's own health, it fills any size up to the target, and it stops by itself when the position is back."],
  ["What if no bot comes?", "Over twelve months of Chainlink ETH/USD, the worst 40-minute drop was 13.1%, so a trigger at HF 1.15 survives it with no filler at all. And in a crash the discount grows fast, so fills come sooner."],
  ["Can one bot take the whole rebalance at the best price?", "No. A fill pays the average of the discount where it starts and where it ends, so a big fill gets a worse average. Splitting it into pieces pays exactly the same total."],
  ["Does the filler get any power over the owner's funds?", "No. It swaps at the curve's price through the SwapVM router; the vault's hooks only accept its own latest order, and every fill must move the position toward the target."],
  ["Is it only for Aave?", "No. TrimSkew asks its source four view questions: deviation now, deviation after, and the fair amount either way. The balanced vault in the repo uses the same instruction unchanged. The one limit: the asset must leave in the same transaction."],
  ["What is live here and what is not?", "This is an Ethereum mainnet fork at block 26,050,000: Aave v3 and the official Aqua at 0x4999…6d31 are the real contracts. Only the Aave price oracle is swapped for one the market buttons can move. Every transaction is on the explorer."],
  ["Why did a crash fill cost 0.47%?", "The demo moves the price 10% at a time with no bot watching in between, so the position drifts far before anyone fills. Live, the first bot fills as soon as the discount covers its cost, around 0.1-0.2% for UniswapX fillers today."],
];

function Questions() {
  return (
    <section className="card">
      <h2>Questions</h2>
      {QUESTIONS.map(([question, answer]) => (
        <details key={question} className="question">
          <summary>{question}</summary>
          <p>{answer}</p>
        </details>
      ))}
    </section>
  );
}

function ActivityLog({ activity, explorerUrl }: { activity: Activity[]; explorerUrl: string | null }) {
  if (activity.length === 0) return null;
  return (
    <section className="card">
      <h2>Transactions</h2>
      <ul className="activity">
        {activity.map((item) => (
          <li key={item.hash}>
            <span>{item.label}</span>
            <span className="muted">{short(item.signer)} · <TxLink hash={item.hash} explorerUrl={explorerUrl} /></span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DemoBar({ demo, busy, resetDemo }: { demo: DemoConfig | null; busy: string | null; resetDemo: () => void }) {
  const minutesLeft = demo?.nextResetAt ? Math.max(0, Math.ceil((demo.nextResetAt - Date.now()) / 60_000)) : null;
  return (
    <div className="demobar">
      <span className="muted">
        Mainnet fork, public test keys.{minutesLeft !== null && ` Resets itself in ${minutesLeft} min.`}
        {demo?.explorerUrl && <> <a href={demo.explorerUrl} target="_blank" rel="noreferrer">Explorer</a></>}
      </span>
      <button disabled={busy !== null} onClick={resetDemo}>Reset demo</button>
    </div>
  );
}

export function App() {
  const { deployments, state, fills, activity, demo, busy, error, movePrice, resetPrice, resetDemo, shipCurve, fill } = useTrim();
  const explorerUrl = demo?.explorerUrl ?? null;
  const [picked, setPicked] = useState(1);
  const shippedCurve = state ? curveFromOrderData(state.order.data) : null;
  const curve: CurveParams | null = deployments && shippedCurve
    ? {
        maxDiscountBps: shippedCurve.maxDiscountBps,
        fullDeviation: Number(shippedCurve.fullDeviation) / 1e18,
        target: Number(deployments.targetHealthFactor) / 1e18,
      }
    : null;
  return (
    <main>
      <header>
        <h1>Trim</h1>
        <p>A leveraged Aave position that auctions its own rebalance. No keeper: bots compete on price.</p>
      </header>
      <DemoBar demo={demo} busy={busy} resetDemo={resetDemo} />
      {error && <p className="error">{error}</p>}
      {!state || !curve ? (
        <p className="muted">Connecting to the fork…</p>
      ) : (() => {
        const selected = state.quotes[picked] ? picked : Math.max(0, state.quotes.findLastIndex((quote) => quote !== null));
        return (
        <>
          <Position state={state} curve={curve} vault={deployments!.vault} explorerUrl={explorerUrl} />
          <Market state={state} busy={busy} movePrice={movePrice} resetPrice={resetPrice} />
          <Curve state={state} curve={curve} quote={state.quotes[selected]} />
          <Offers state={state} selected={selected} select={setPicked} />
          <Filler state={state} busy={busy} fills={fills} fill={fill} curve={curve} explorerUrl={explorerUrl} />
          <Owner state={state} busy={busy} shipCurve={shipCurve} />
          <ActivityLog activity={activity} explorerUrl={explorerUrl} />
          <Questions />
        </>
        );
      })()}
      <footer className="muted">
        Keepers today: DeFi Saver leaks 0.48% median per rebalance on Aave v3 over twelve months, 0.56% between $1k and $10k.
      </footer>
    </main>
  );
}
