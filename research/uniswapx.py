import csv
import json
import os
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REACTORS = ["0x00000011F84B9aa48e5f8aA8B9897600006289Be", "0x6000da47483062A0D734Ba3dc7576Ce6A0B645C4"]
FILL = "0x78ad7ec0e9f89e74012afa58738b6b661c024cb0fd185ee2f616c0a28924bd66"
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
ORACLE = "0x54586bE62E3c3580375aE3723C145253060Ca0C2"
TOKENS = {
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": ("WETH", 18),
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": ("USDC", 6),
    "0xdac17f958d2ee523a2206206994597c13d831ec7": ("USDT", 6),
    "0x6b175474e89094c44da98b954eedeac495271d0f": ("DAI", 18),
}
FROM_BLOCK = int(os.environ.get("FROM_BLOCK", "25990000"))
OUT = Path(__file__).parent / "data" / "uniswapx.csv"
CACHE = Path.home() / ".cache" / "trim" / "uniswapx"


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    for attempt in range(10):
        try:
            request = urllib.request.Request(os.environ["MAINNET_RPC_URL"], body, {"content-type": "application/json"})
            response = json.load(urllib.request.urlopen(request, timeout=60))
            if "result" in response:
                return response["result"]
        except Exception:
            pass
        time.sleep(min(30, 2 ** attempt))
    raise RuntimeError(method)


def fills():
    logs = []
    for reactor in REACTORS:
        low = FROM_BLOCK
        while True:
            query = (
                "https://api.etherscan.io/v2/api?chainid=1&module=logs&action=getLogs"
                f"&address={reactor}&topic0={FILL}&fromBlock={low}&toBlock=latest&offset=1000&page=1"
                f"&apikey={os.environ['ETHERSCAN_API_KEY']}"
            )
            page = json.load(urllib.request.urlopen(urllib.request.Request(query, headers={"User-Agent": "trim"})))["result"]
            logs += page
            if len(page) < 1000:
                break
            low = int(page[-1]["blockNumber"], 16) + 1
            time.sleep(0.3)
    return logs


def cached(name, fetch):
    path = CACHE / f"{name}.json"
    if path.exists():
        return json.loads(path.read_text())
    value = fetch()
    temporary = path.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
    temporary.write_text(json.dumps(value))
    temporary.replace(path)
    return value


def price(token, block):
    data = "0xb3596f07" + token[2:].rjust(64, "0")
    return cached(f"px-{token}-{block}", lambda: int(rpc("eth_call", [{"to": ORACLE, "data": data}, hex(block)]), 16) / 1e8)


def measure(log):
    tx = log["transactionHash"]
    block = int(log["blockNumber"], 16)
    swapper = "0x" + log["topics"][3][-40:]
    receipt = cached(f"rcpt-{tx}", lambda: rpc("eth_getTransactionReceipt", [tx]))
    given, received, fees = {}, {}, {}
    out_senders = set()
    for entry in receipt["logs"]:
        topics = entry["topics"]
        token = entry["address"].lower()
        if not topics or topics[0] != TRANSFER or len(topics) != 3 or token not in TOKENS:
            continue
        sender, recipient = "0x" + topics[1][-40:], "0x" + topics[2][-40:]
        amount = int(entry["data"], 16)
        if sender == swapper:
            given[token] = given.get(token, 0) + amount
        elif recipient == swapper:
            received[token] = received.get(token, 0) + amount
            out_senders.add(sender)
    if len(given) != 1 or len(received) != 1:
        return None
    token_in, amount_in = next(iter(given.items()))
    token_out, amount_out = next(iter(received.items()))
    if (TOKENS[token_in][0] == "WETH") == (TOKENS[token_out][0] == "WETH"):
        return None
    for entry in receipt["logs"]:
        topics = entry["topics"]
        if topics and topics[0] == TRANSFER and len(topics) == 3 and entry["address"].lower() == token_out:
            sender, recipient = "0x" + topics[1][-40:], "0x" + topics[2][-40:]
            if sender in out_senders and recipient != swapper:
                fees[token_out] = fees.get(token_out, 0) + int(entry["data"], 16)
    value_in = amount_in / 10 ** TOKENS[token_in][1] * price(token_in, block - 1)
    value_out = amount_out / 10 ** TOKENS[token_out][1] * price(token_out, block - 1)
    value_fee = fees.get(token_out, 0) / 10 ** TOKENS[token_out][1] * price(token_out, block - 1)
    return {
        "tx": tx,
        "block": block,
        "reactor": log["address"],
        "filler": "0x" + log["topics"][2][-40:],
        "sell": TOKENS[token_in][0],
        "buy": TOKENS[token_out][0],
        "value_in_usd": round(value_in, 2),
        "swapper_cost": round(1 - value_out / value_in, 6),
        "filler_margin": round(1 - (value_out + value_fee) / value_in, 6),
    }


if __name__ == "__main__":
    CACHE.mkdir(parents=True, exist_ok=True)
    logs = cached(f"fills-{FROM_BLOCK}", fills)
    with ThreadPoolExecutor(2) as pool:
        rows = [r for r in pool.map(measure, logs) if r and r["value_in_usd"] >= 1]
    with open(OUT, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"{len(logs)} fills, {len(rows)} WETH/stable measured -> {OUT}")
