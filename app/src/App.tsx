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
      <div className="top">
        <header>
          <h1>Trim</h1>
          <p>A leveraged Aave position that auctions its own rebalance. No keeper: bots compete on price.</p>
        </header>
        <DemoBar demo={demo} busy={busy} resetDemo={resetDemo} />
      </div>
      {error && <p className="error">{error}</p>}
      {!state || !curve ? (
        <p className="muted">Connecting to the fork…</p>
      ) : (() => {
        const selected = state.quotes[picked] ? picked : Math.max(0, state.quotes.findLastIndex((quote) => quote !== null));
        return (
        <>
          <div className="board">
            <div className="column">
              <Position state={state} curve={curve} vault={deployments!.vault} explorerUrl={explorerUrl} />
              <Market state={state} busy={busy} movePrice={movePrice} resetPrice={resetPrice} />
              <Owner state={state} busy={busy} shipCurve={shipCurve} />
            </div>
            <div className="column">
              <Curve state={state} curve={curve} quote={state.quotes[selected]} />
              <Offers state={state} selected={selected} select={setPicked} />
            </div>
            <div className="column">
              <Filler state={state} busy={busy} fills={fills} fill={fill} curve={curve} explorerUrl={explorerUrl} />
              <ActivityLog activity={activity} explorerUrl={explorerUrl} />
            </div>
          </div>
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
