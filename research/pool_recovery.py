import csv
import json
import os
import urllib.request

POOL = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640"
SLOT0 = "0x3850c7bd"
DUMPS = {
    "0xc9a90b1cd9da4db2b438206ec1a7c9a9ba38ac7d737625a881fddb23d32cc6bf": 24362946,
    "0x169ec4eaab5580863ab41f121a20763f689d999c50f29d7ae59d29545ef21530": 24356381,
}
OFFSETS = [-1, 0, 1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 40, 50]


def eth_price(block: int) -> float:
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": [{"to": POOL, "data": SLOT0}, hex(block)]})
    request = urllib.request.Request(os.environ["MAINNET_RPC_URL"], body.encode(), {"content-type": "application/json"})
    sqrt_price = int(json.load(urllib.request.urlopen(request))["result"][2:66], 16)
    return 1e12 / (sqrt_price / 2**96) ** 2


with open("data/pool_recovery.csv", "w", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(["tx", "offset", "eth_price"])
    for tx, block in DUMPS.items():
        for offset in OFFSETS:
            writer.writerow([tx, offset, round(eth_price(block + offset), 2)])
