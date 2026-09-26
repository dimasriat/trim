import { useEffect, useState } from "react";
import { useTrim } from "./lib/useTrim";
import { curveFromOrderData } from "./lib/order";
import type { CurveParams } from "./lib/trim";
import { CurveSettings, OwnerPnl, Position } from "./ui/OwnerColumn";
import { Curve, Market, Offers } from "./ui/MarketColumn";
import { Bot, BotPnl, Ledger } from "./ui/BotColumn";
import { ActivityLog, Questions, TopBar } from "./ui/Info";
import { Simple } from "./ui/Simple";

const MODE_KEY = "trim-detailed";

function readDetailed(): boolean {
  try {
    return localStorage.getItem(MODE_KEY) === "1";
  } catch {
    return false;
  }
}

export function Playground() {
  const trim = useTrim();
  const { deployments, state, session, fills, activity, demo, busy, error } = trim;
  const explorerUrl = demo?.explorerUrl ?? null;
  const [picked, setPicked] = useState(1);
  const [detailed, setDetailed] = useState(readDetailed);
  const toggleDetails = () => {
    const next = !detailed;
    setDetailed(next);
    try {
      localStorage.setItem(MODE_KEY, next ? "1" : "0");
    } catch {}
  };
  const shippedCurve = state ? curveFromOrderData(state.order.data) : null;
  const curve: CurveParams | null = deployments && shippedCurve
    ? { maxDiscountBps: shippedCurve.maxDiscountBps, fullDeviation: Number(shippedCurve.fullDeviation) / 1e18, target: Number(deployments.targetHealthFactor) / 1e18 }
    : null;
  const [draft, setDraft] = useState<CurveParams | null>(null);
  const curveKey = curve ? `${curve.maxDiscountBps}/${curve.fullDeviation.toFixed(4)}` : "";
  useEffect(() => setDraft(curve), [curveKey]);
  return (
    <main>
      <TopBar demo={demo} busy={busy} resetDemo={trim.resetDemo} detailed={detailed} toggleDetails={toggleDetails} />
      {busy && <p className="busy">Working: {busy}…</p>}
      {error && <p className="error">{error}</p>}
      {!state || !curve || !draft ? (
        <p className="muted">Connecting to the fork…</p>
      ) : !detailed ? (
        <Simple
          state={state}
          curve={curve}
          fills={fills}
          targetQuote={trim.targetQuote}
          busy={busy}
          explorerUrl={explorerUrl}
          movePrice={trim.movePrice}
          resetPrice={trim.resetPrice}
          fillToTarget={trim.fillToTarget}
          crashWithBot={() => trim.slowCrash(20, 20, true)}
          showDetails={toggleDetails}
          timeline={trim.timeline}
          crash={trim.crash}
          stopCrash={trim.stopSlowCrash}
          openPrice={session ? Number(session.openPrice) / 1e8 : Number(state.ethPrice) / 1e8}
        />
      ) : (() => {
        const selected = state.quotes[picked] ? picked : Math.max(0, state.quotes.findLastIndex((quote) => quote !== null));
        return (
          <>
            <div className="board">
              <div className="column">
                <h3 className="role-title">Position owner</h3>
                <Position state={state} curve={curve} vault={deployments!.vault} explorerUrl={explorerUrl} />
                <OwnerPnl fills={fills} />
                <CurveSettings state={state} curve={curve} busy={busy} draft={draft} setDraft={setDraft} shipCurve={trim.shipCurve} />
              </div>
              <div className="column">
                <h3 className="role-title">Market and curve</h3>
                <Market state={state} session={session} busy={busy} setEthPrice={trim.setEthPrice} movePrice={trim.movePrice} resetPrice={trim.resetPrice} slowCrash={trim.slowCrash} />
                <Curve state={state} curve={curve} draft={draft} quote={state.quotes[selected]} />
                <Offers state={state} selected={selected} select={setPicked} />
              </div>
              <div className="column">
                <h3 className="role-title">Filler bot</h3>
                <Bot state={state} busy={busy} autoBot={trim.autoBot} setAutoBot={trim.setAutoBot} fill={trim.fill} fillToTarget={trim.fillToTarget} runBotNow={trim.runBotNow} />
                <BotPnl fills={fills} sellCostBps={trim.autoBot.costBps} />
                {fills[0] && <Ledger fill={fills[0]} liquidationThresholdBps={state.liquidationThresholdBps} explorerUrl={explorerUrl} sellCostBps={trim.autoBot.costBps} />}
              </div>
            </div>
            <div className="board lower">
              <ActivityLog activity={activity} explorerUrl={explorerUrl} />
              <Questions />
            </div>
          </>
        );
      })()}
      <footer className="muted">
        Keepers today: DeFi Saver leaks 0.48% median per rebalance on Aave v3 over twelve months, 0.56% between $1k and $10k.
      </footer>
    </main>
  );
}
