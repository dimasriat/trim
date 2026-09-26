import type { Fill, TargetQuote, TrimState } from "../lib/useTrim";
import { ownerTotals } from "../lib/bot";
import { curveDiscount, formatHealthFactor, formatToken, healthStatus, keeperLeak, loanToValue, ltvAtHealthFactor, type CurveParams } from "../lib/trim";
import { hf, percent, TxLink, usdc, wethInUsdc } from "./format";

function onTarget(state: TrimState, curve: CurveParams): boolean {
  return (curve.target - hf(state.healthFactor)) / curve.target < 0.0005;
}

function PositionCard({ state, curve }: { state: TrimState; curve: CurveParams }) {
  const status = healthStatus(state.healthFactor, state.target);
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
      <p className="lead">
        {formatToken(collateralWeth, 18, 2)} WETH deposited, {usdc(Number(state.debtBase) / Number(state.usdcPrice), 0)} borrowed.
        Health factor {formatHealthFactor(state.healthFactor)}.
      </p>
      <p className={`status ${status}`}>
        {healthy
          ? "Healthy. Nothing needs to be sold, so there is no offer."
          : "Too much debt for this price. The position now offers some of its WETH, at a small discount, to anyone who repays part of the debt."}
      </p>
    </section>
  );
}

function OfferCard({ state, curve, targetQuote, busy, movePrice, resetPrice, fillToTarget, crashWithBot }: {
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
      <h2>2 · The price falls, the position makes an offer</h2>
      <div className="headline">
        <span className="big">{formatToken((state.ethPrice * 10n ** 8n) / state.usdcPrice, 8, 2)}</span>
        <span className="muted">USDC per ETH</span>
      </div>
      <div className="buttons">
        <button className="primary" disabled={busy !== null} onClick={() => movePrice(-10)}>ETH −10%</button>
        <button disabled={busy !== null} onClick={() => movePrice(5)}>ETH +5%</button>
        <button disabled={busy !== null} onClick={resetPrice}>Start price</button>
      </div>
      {onTarget(state, curve) || !targetQuote ? (
        <p className="lead">No offer. {onTarget(state, curve) ? "The position is at or above its target." : "Checking the offer…"}</p>
      ) : (
        <div className="offer-box">
          <p className="lead">
            Discount right now: <strong>{percent(discount)}</strong> below the oracle price. The further the price falls, the bigger it gets.
          </p>
          <p className="lead">
            To bring the position back to target, a bot pays <strong>{formatToken(targetQuote.amountIn, 6, 0)} USDC</strong> of its debt and gets{" "}
            <strong>{formatToken(targetQuote.amountOut, 18, 4)} WETH</strong> (≈ {usdc(wethInUsdc(targetQuote.amountOut, state.ethPrice, state.usdcPrice))}),{" "}
            {percent(average)} below the oracle on average.
          </p>
          <button className="primary wide" disabled={busy !== null} onClick={fillToTarget}>Fill to target, as a bot</button>
        </div>
      )}
      <button className="wide" disabled={busy !== null} onClick={crashWithBot}>Slow crash −20%, a bot watching every step</button>
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
        <p className="lead">
          Nothing rebalanced yet. Today a keeper such as DeFi Saver does this and takes about <strong>0.56%</strong> each time (median of 919 real
          rebalances on Aave).
        </p>
      ) : (
        <>
          <div className="cost-rows">
            <div><span>Debt repaid</span><strong>{usdc(moved, 0)}</strong></div>
            <div><span>Cost with Trim</span><strong className="good">{usdc(totals.cost)} ({percent(totals.cost / moved)})</strong></div>
            <div><span>Cost with a keeper</span><strong className="bad">{usdc(totals.keeperCost)} ({percent(keeperLeak(moved))})</strong></div>
            <div><span>Saved</span><strong className="good">{usdc(totals.saved)}</strong></div>
          </div>
          <p className="lead">
            {fills.length === 1 ? "One transaction" : `${fills.length} transactions`}: the bot's USDC repaid the Aave debt and the discounted WETH went to the bot.
            No keeper, no fee. <TxLink hash={fills[0].hash} explorerUrl={explorerUrl} />
          </p>
        </>
      )}
    </section>
  );
}

export function Simple({ state, curve, fills, targetQuote, busy, explorerUrl, movePrice, resetPrice, fillToTarget, crashWithBot, showDetails }: {
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
        <OfferCard state={state} curve={curve} targetQuote={targetQuote} busy={busy} movePrice={movePrice} resetPrice={resetPrice} fillToTarget={fillToTarget} crashWithBot={crashWithBot} />
        <CostCard fills={fills} explorerUrl={explorerUrl} />
      </div>
      <p className="how">
        How: the discount is priced by <strong>TrimSkew</strong>, one new SwapVM instruction, and the swap settles through the official 1inch Aqua on a mainnet
        fork. <a href="/docs/how-it-works" target="_blank" rel="noreferrer">How it works</a> ·{" "}
        <button className="link" onClick={showDetails}>Show every detail</button>
      </p>
    </>
  );
}
