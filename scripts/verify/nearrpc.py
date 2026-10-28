"""Tiny read-only NEAR testnet JSON-RPC helper for the verify scripts. No keys, no signing.
NEAR_RPC sets the primary URL; NEAR_RPC_FALLBACKS (comma list) is tried when one answers 429/5xx or is unreachable."""
import os, json, time, base64, urllib.request, urllib.error

PRIMARY = os.environ.get("NEAR_RPC", "https://test.rpc.fastnear.com")
FALLBACKS = [u.strip() for u in os.environ.get("NEAR_RPC_FALLBACKS", "https://rpc.testnet.fastnear.com,https://rpc.testnet.near.org,https://near-testnet.drpc.org").split(",") if u.strip()]
URLS = [PRIMARY] + [u for u in FALLBACKS if u != PRIMARY]
TX_INDEX = os.environ.get("FASTNEAR_TX_API", "https://tx.test.fastnear.com")
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def _post(url, body, timeout=30):
    req = urllib.request.Request(url, json.dumps(body).encode(), {"content-type": "application/json", "user-agent": "nearcarta-verify"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def rpc(method, params, rounds=3):
    """Returns the raw JSON-RPC answer ({'result': ...} or {'error': ...})."""
    last = None
    for i in range(rounds):
        for url in URLS:
            try:
                return _post(url, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
            except urllib.error.HTTPError as e:
                last = e
                if e.code not in (408, 429, 500, 502, 503, 504):
                    raise
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                last = e
        time.sleep(0.5 * 2 ** i)
    raise RuntimeError(f"rpc {method}: {last}")


def query(params):
    r = rpc("query", {"finality": "final", **params})
    if "error" in r:
        raise RuntimeError(json.dumps(r["error"])[:300])
    return r["result"]


def view(account_id, method, args=None):
    res = query({"request_type": "call_function", "account_id": account_id, "method_name": method,
                 "args_base64": base64.b64encode(json.dumps(args or {}).encode()).decode()})
    txt = bytes(res["result"]).decode()
    return json.loads(txt) if txt else None


def keys(account_id):
    return query({"request_type": "view_access_key_list", "account_id": account_id})["keys"]


def b58e(b):
    n = int.from_bytes(b, "big"); s = ""
    while n:
        n, r = divmod(n, 58); s = B58[r] + s
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + s


def signers(hashes):
    """tx hash -> signer account, from the public FastNEAR tx index (RPC needs the signer to route)."""
    out = {}
    for i in range(0, len(hashes), 20):
        j = _post(f"{TX_INDEX}/v0/transactions", {"tx_hashes": hashes[i:i + 20]})
        for t in j.get("transactions", []):
            tx = t.get("transaction", {})
            out[tx.get("hash")] = tx.get("signer_id")
    return out


def tx_status(tx_hash, signer):
    return rpc("EXPERIMENTAL_tx_status", {"tx_hash": tx_hash, "sender_account_id": signer, "wait_until": "FINAL"})


def outcome(r):
    """'OK <return value>' or 'FAILURE <json>' for a tx_status answer, plus every log line."""
    res = r["result"]
    logs = [l for ro in res["receipts_outcome"] for l in ro["outcome"]["logs"]]
    fails = [ro["outcome"]["status"]["Failure"] for ro in res["receipts_outcome"] if "Failure" in ro["outcome"]["status"]]
    st = res["status"]
    if "Failure" in st or fails:
        return "FAILURE " + json.dumps(st.get("Failure") or fails[0]), logs
    v = st.get("SuccessValue")
    return ("OK " + (base64.b64decode(v).decode() if v else "")).strip(), logs
