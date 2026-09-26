import csv
import os
import statistics
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

DATA = Path(__file__).parent / "data"
OUT = Path(__file__).parent.parent / "docs" / "public" / "charts"
INK = "#1c1b19"
MUTED = "#8a857b"
KEEPER = "#c0392b"
TRIM = "#1f7a4d"
ACCENT = "#1d4ed8"

plt.rcParams.update({
    "font.size": 11,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.edgecolor": MUTED,
    "axes.labelcolor": INK,
    "xtick.color": INK,
    "ytick.color": INK,
    "svg.fonttype": "none",
})


def rows(name):
    with open(DATA / name) as f:
        return list(csv.DictReader(f))


def save(fig, name):
    fig.tight_layout()
    fig.savefig(OUT / f"{name}.svg")
    if os.environ.get("CHART_PREVIEW"):
        fig.savefig(Path(os.environ["CHART_PREVIEW"]) / f"{name}.png", dpi=110)
    plt.close(fig)


def leak_by_size():
    measured = [r for r in rows("defisaver_aavev3.csv") if not r["error"] and float(r["v_out_usd"]) >= 1]
    buckets = [(0, 1e3, "<$1k"), (1e3, 1e4, "$1k–10k"), (1e4, 1e5, "$10k–100k"), (1e5, 1e6, "$100k–1M"), (1e6, 1e15, "≥$1M")]
    labels, keeper, trim = [], [], []
    for low, high, label in buckets:
        bucket = [r for r in measured if low <= float(r["v_out_usd"]) < high]
        room = [(float(r["fee_service_usd"]) + float(r["fee_gas_usd"]) - float(r["bot_gas_usd"])) / float(r["v_out_usd"]) for r in bucket]
        leak = [float(r["leak"]) for r in bucket]
        labels.append(f"{label}\nn={len(bucket)}")
        keeper.append(statistics.median(leak) * 100)
        trim.append(statistics.median([l - m for l, m in zip(leak, room)]) * 100)
    fig, ax = plt.subplots(figsize=(6.4, 4.2))
    x = range(len(labels))
    ax.bar([i - 0.2 for i in x], [min(k, 1.2) for k in keeper], 0.4, color=KEEPER, label="Keeper today (DeFi Saver)")
    ax.bar([i + 0.2 for i in x], [min(t, 1.2) for t in trim], 0.4, color=MUTED, label="Same trade minus service fee and gas markup")
    for i, (k, t) in enumerate(zip(keeper, trim)):
        ax.text(i - 0.2, min(k, 1.2) + 0.03, f"{k:.2f}" + ("↑" if k > 1.2 else ""), fontsize=8, ha="center", color=INK)
        ax.text(i + 0.2, min(t, 1.2) + 0.03, f"{t:.2f}" + ("↑" if t > 1.2 else ""), fontsize=8, ha="center", color=MUTED)
    ax.set_xticks(list(x), labels, fontsize=9)
    ax.set_ylabel("Median cost per rebalance (%)")
    ax.set_ylim(0, 1.6)
    ax.set_title("DeFi Saver on Aave v3, 919 rebalances. Bars above 1.2% are cut.", fontsize=9, color=MUTED, loc="left")
    ax.legend(frameon=False, fontsize=9, loc="upper right")
    save(fig, "leak-by-size")


def dump_recovery():
    data = rows("pool_recovery.csv")
    fig, ax = plt.subplots(figsize=(6.4, 3.8))
    for tx, color, label in [(data[0]["tx"], KEEPER, "$10.4M repay"), (data[-1]["tx"], ACCENT, "$9.1M repay")]:
        series = [r for r in data if r["tx"] == tx]
        before = float(series[0]["eth_price"])
        ax.plot([int(r["offset"]) for r in series], [(float(r["eth_price"]) / before - 1) * 100 for r in series], marker="o", color=color, label=label)
    ax.axhline(0, color=MUTED, linewidth=0.8)
    ax.set_xlabel("Blocks after the keeper's swap")
    ax.set_ylabel("Uniswap ETH price vs block before (%)")
    ax.legend(frameon=False, fontsize=9)
    save(fig, "dump-recovery")


def morpho_bonus():
    fig, ax = plt.subplots(figsize=(6.4, 3.6))
    for name, color, label in [("morpho_preliq_eth.csv", ACCENT, "Ethereum"), ("morpho_preliq_base.csv", MUTED, "Base")]:
        bonus = [(float(r["lif_realized"]) - 1) * 100 for r in rows(name) if float(r["lif_realized"]) > 0]
        ax.hist(bonus, bins=[i / 4 for i in range(0, 53)], histtype="step", linewidth=1.8, color=color, label=f"{label}, n={len(bonus)}")
    ax.set_xlabel("Bonus paid to the pre-liquidator (%)")
    ax.set_ylabel("Pre-liquidations")
    ax.legend(frameon=False, fontsize=9)
    save(fig, "morpho-bonus")


def discount(deviation, max_bps=100, full=0.2):
    return max_bps * min(deviation, full) / full


def trimskew_curve():
    target, threshold = 1.5, 0.83
    hf = [0.95 + i / 200 for i in range(0, 111)]
    fig, ax = plt.subplots(figsize=(6.4, 3.6))
    ax.plot(hf, [discount(max(0.0, (target - h) / target)) / 100 for h in hf], color=TRIM, linewidth=2)
    ax.axvline(target, color=MUTED, linestyle="--", linewidth=1)
    ax.axvline(1.0, color=KEEPER, linestyle=":", linewidth=1)
    ax.annotate("target", (target - 0.01, 1.03), fontsize=9, color=MUTED, ha="right")
    ax.annotate("liquidation", (1.0 + 0.01, 1.03), fontsize=9, color=KEEPER, ha="left")
    ax.set_xlim(target + 0.02, 0.95)
    ax.set_ylim(0, 1.1)
    ax.set_xlabel("Health factor (falls to the right)")
    ax.set_ylabel("Discount below oracle (%)")
    ltv = ax.secondary_xaxis("top", functions=(lambda h: threshold / h * 100, lambda l: threshold * 100 / l))
    ltv.set_xlabel("LTV (%), liquidation threshold 83%", fontsize=9, color=MUTED)
    save(fig, "trimskew-curve")


def marginal():
    price, collateral, debt, lt, target = 2178.5, 10.0, 13951.0, 0.8326, 1.5
    hf0 = collateral * price * lt / debt
    sizes, averages, starts = [], [], []
    for step in range(1, 200):
        size = step * 25.0
        fair_out = size / price
        start = discount((target - hf0) / target)
        first_out = fair_out * 10_000 / (10_000 - start)
        hf1 = (collateral - first_out) * price * lt / (debt - size)
        if hf1 > target:
            break
        end = discount((target - hf1) / target)
        sizes.append(size)
        averages.append((start + end) / 2 / 100)
        starts.append(start / 100)
    fig, ax = plt.subplots(figsize=(6.4, 3.6))
    ax.plot(sizes, starts, color=MUTED, linestyle="--", label="Discount at the current health factor")
    ax.plot(sizes, averages, color=TRIM, linewidth=2, label="Average discount the fill gets")
    ax.set_xlabel("Fill size (USDC), position at HF 1.30")
    ax.set_ylabel("Discount below oracle (%)")
    ax.set_ylim(0, None)
    ax.legend(frameon=False, fontsize=9)
    save(fig, "marginal")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    leak_by_size()
    dump_recovery()
    morpho_bonus()
    trimskew_curve()
    marginal()
    print(sorted(p.name for p in OUT.iterdir()))
