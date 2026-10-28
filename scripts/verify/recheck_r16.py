"""Re-derive the R16 factory claims in judges/proofs/r16-factory.json from testnet RPC and the committed artifacts.
Read-only: loads no keys, signs nothing, prints no secrets. Exit 1 on any mismatch.
- oath.r16.wasm sha256 3a65b00c.. (reproducible build of 5099a7c); oath.r16.oz.wasm == binaryen 133 `wasm-opt -Oz` of it
  (re-run when WASM_OPT points at a binaryen version_133 wasm-opt, otherwise SKIP)
- the global code on chain under AWw8zu6m.. is byte-equal to oath.r16.oz.wasm
- the factory runs charter_factory.r15.wasm, pins AWw8zu6m.., has 0 access keys
- arena + redteam charters were made by the factory, run the global code, hold exactly one propose-only key == agent_key
- every proof tx re-read FINAL; H14 = ERR_LOW_GAS with no log in any receipt; H15 + arena attacks refused with the logged reason
Usage: python3 scripts/verify/recheck_r16.py   (NEAR_RPC / NEAR_RPC_FALLBACKS / WASM_OPT optional)"""
import os, sys, json, hashlib, base64, subprocess, tempfile, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE); import nearrpc as nl
ART = os.path.join(ROOT, "contracts", "artifacts")
P = json.load(open(os.path.join(ROOT, "judges", "proofs", "r16-factory.json")))
bad = 0
def ok(c, m):
    global bad
    print(("OK   " if c else "BAD  ") + m); bad += (not c)
sha = lambda b: hashlib.sha256(b).hexdigest()
b58 = lambda b: nl.b58e(hashlib.sha256(b).digest())
rd = lambda n: open(os.path.join(ART, n), "rb").read()
src, oz, fac = rd("oath.r16.wasm"), rd("oath.r16.oz.wasm"), rd("charter_factory.r15.wasm")
ok(sha(src) == P["source"]["oath.r16.wasm"]["sha256"] == "3a65b00c5112d375cc5b492f05570b7e574a7a2d0dfb0506f04116ccb4a84d46", "oath.r16.wasm sha256 3a65b00c.. (reproducible build of 5099a7c)")
ok(sha(oz) == P["lean_artifact"]["sha256"], f"oath.r16.oz.wasm sha256 {sha(oz)[:8]}.. as in the proof")
wo = os.environ.get("WASM_OPT") or shutil.which("wasm-opt")
ver = subprocess.run([wo, "--version"], capture_output=True, text=True).stdout if wo else ""
if wo and "133" in ver:
    with tempfile.TemporaryDirectory() as d:
        subprocess.run([wo, "-Oz", "--enable-nontrapping-float-to-int", "--enable-bulk-memory", os.path.join(ART, "oath.r16.wasm"), "-o", f"{d}/o.wasm"], check=True)
        ok(open(f"{d}/o.wasm", "rb").read() == oz, f"wasm-opt -Oz re-run == oath.r16.oz.wasm ({len(src)} -> {len(oz)} bytes)")
else:
    print("SKIP wasm-opt -Oz re-run: set WASM_OPT to binaryen version_133 bin/wasm-opt (release tarball sha256 " + P["lean_artifact"]["binaryen_tarball_sha256"][:8] + "..)")
H = b58(oz); ok(H == P["lean_artifact"]["code_hash"] == "AWw8zu6mcbkdmTf49wPB2BdXEUjbbWKVHAfjfiQho89r", f"code_hash {H}")
g = nl.rpc("query", {"request_type": "view_global_contract_code", "finality": "final", "code_hash": H})
ok(base64.b64decode(g.get("result", {}).get("code_base64", "")) == oz, "global code on chain is byte-equal to oath.r16.oz.wasm")
f = P["factory"]["account"]; fa = nl.query({"request_type": "view_account", "account_id": f})
ok(fa["code_hash"] == b58(fac) and sha(fac) == P["factory"]["sha256"], f"factory {f} code_hash == sha256(charter_factory.r15.wasm) {sha(fac)[:8]}..")
ok(nl.view(f, "get_config")["code_hash"] == H, "factory get_config.code_hash == R16 -Oz")
ok(len(nl.keys(f)) == 0, "factory has 0 access keys (locked)")
for ch in (P["charters"]["arena"], P["charters"]["redteam"]):
    a = nl.query({"request_type": "view_account", "account_id": ch})
    ok(a.get("global_contract_hash") == H, f"{ch} runs global code {H[:8]}..")
    ok(nl.view(f, "is_charter", {"account_id": ch}) is True, f"{ch} registered by the factory")
    ks = nl.keys(ch); s = nl.view(ch, "get_state")
    ok(len(ks) == 1 and ks[0]["access_key"]["permission"] != "FullAccess"
       and ks[0]["access_key"]["permission"]["FunctionCall"]["method_names"] == ["propose"] and ks[0]["public_key"] == s["agent_key"],
       f"{ch}: 1 key, propose-only, == get_state.agent_key")
expect = {"H14 propose": ("FAILURE", "ERR_LOW_GAS"), "H14 control": ("OK", '"allowed"'), "H15 min_amount": ("OK", "below_min_amount"),
          "H15 count: tip action 2": ("OK", '"allowed"'), "H15 count: tip action 3": ("OK", '"allowed"'),
          "H15 count: 4th": ("OK", "over_daily_action_count"), "H15 storage_reserve_low": ("OK", "storage_reserve_low"),
          "arena attack fake-invoice": ("OK", "receiver_not_allowlisted"), "arena attack injected-recipient": ("OK", "receiver_not_allowlisted"),
          "arena attack lookalike": ("OK", "receiver_not_allowlisted"), "arena attack impersonation": ("OK", "over_per_action_cap")}
who = nl.signers([s["tx"] for s in P["steps"]])
seen = set(); n = 0
for e in P["steps"]:
    r = nl.tx_status(e["tx"], who.get(e["tx"]) or f)
    if "result" not in r: ok(False, f"{e['step'][:70]}: not found on RPC"); continue
    got, logs = nl.outcome(r); n += 1
    ok(got.split(" ")[0] == e["status"].split(" ")[0] and (not got.startswith("OK") or got == e["status"]), f"{e['step'][:70]}: {got[:90]}")
    for k, (stt, frag) in expect.items():
        if e["step"].startswith(k):
            seen.add(k); ok(got.startswith(stt) and frag in got, f"  expect {stt} containing {frag}")
            if stt == "FAILURE": ok(not logs, "  no log in any receipt of the reverted tx (no phantom event)")
ok(seen == set(expect), f"all {len(expect)} expected claims present ({len(seen)}); {n} txs re-read")
print("RESULT", "PASS" if not bad else f"FAIL ({bad})"); sys.exit(1 if bad else 0)
