import type { TimelinePoint } from "../lib/timeline";

const W = 460;
const H = 170;
const PAD = { left: 62, right: 12, top: 12, bottom: 24 };

function scale(values: number[], pad = 0.08) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(1, Math.abs(max) * 0.05);
  return { min: min - span * pad, max: max + span * pad };
}

function xAt(i: number, n: number) {
  return PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD.left - PAD.right));
}

function path(values: number[], y: (v: number) => number) {
  return values.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i, values.length).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
}

function money(v: number, digits = 0) {
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function PriceChart({ points }: { points: TimelinePoint[] }) {
  const prices = points.map((p) => p.price);
  const { min, max } = scale(prices);
  const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * (H - PAD.top - PAD.bottom);
  const last = prices[prices.length - 1];
  const change = (last / prices[0] - 1) * 100;
  return (
    <section className="card simple">
      <h2>ETH price, every step</h2>
      <div className="chart-head">
        <strong>{money(last, 2)}</strong>
        <span className={change < 0 ? "bad" : "good"}>{change >= 0 ? "+" : ""}{change.toFixed(1)}% since start</span>
        <span className="legend"><i className="dot bot" /> a bot filled here</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="timeline" role="img" aria-label="ETH price over the demo">
        {[max, (max + min) / 2, min].map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="grid" />
            <text x={PAD.left - 6} y={y(v) + 4} className="tick end">{money(v)}</text>
          </g>
        ))}
        <path d={path(prices, y)} className="price-line" />
        {points.map((p, i) => p.fill && <circle key={i} cx={xAt(i, points.length)} cy={y(p.price)} r={5} className="fill-dot" />)}
        <text x={PAD.left} y={H - 6} className="tick start">start</text>
        <text x={W - PAD.right} y={H - 6} className="tick end">now</text>
      </svg>
    </section>
  );
}

export function CostChart({ points }: { points: TimelinePoint[] }) {
  const keeper = points.map((p) => p.keeper);
  const trim = points.map((p) => p.trim);
  const top = Math.max(1, ...keeper, ...trim) * 1.1;
  const y = (v: number) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);
  const lastKeeper = keeper[keeper.length - 1];
  const lastTrim = trim[trim.length - 1];
  const area = `${path(keeper, y)} ${trim.map((v, i) => `L${xAt(trim.length - 1 - i, trim.length).toFixed(1)},${y(trim[trim.length - 1 - i]).toFixed(1)}`).join(" ")} Z`;
  return (
    <section className="card simple">
      <h2>Rebalancing cost so far</h2>
      <div className="chart-head">
        <span className="legend"><i className="dot keeper" /> keeper <strong className="bad">{money(lastKeeper, 2)}</strong></span>
        <span className="legend"><i className="dot trim" /> Trim <strong className="good">{money(lastTrim, 2)}</strong></span>
        <span className="legend">saved <strong className="good">{money(lastKeeper - lastTrim, 2)}</strong></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="timeline" role="img" aria-label="Cumulative cost, keeper against Trim">
        {[top / 1.1, top / 2.2, 0].map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="grid" />
            <text x={PAD.left - 6} y={y(v) + 4} className="tick end">{money(v, 2)}</text>
          </g>
        ))}
        {lastKeeper > 0 && <path d={area} className="saved-area" />}
        <path d={path(keeper, y)} className="keeper-line" />
        <path d={path(trim, y)} className="trim-line" />
        {lastKeeper === 0 && <text x={W / 2} y={H / 2} className="tick">Costs appear here after the first fill</text>}
        <text x={PAD.left} y={H - 6} className="tick start">start</text>
        <text x={W - PAD.right} y={H - 6} className="tick end">now</text>
      </svg>
    </section>
  );
}
