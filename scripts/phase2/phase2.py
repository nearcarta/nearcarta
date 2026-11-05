#!/usr/bin/env python3
"""Phase 2 (Base USDC -> shielded ZEC -> Base USDC through 1Click), dry run.

This file never signs and never broadcasts. It has no --live switch.

  --network mainnet            Base + Zcash mainnet reads + 1Click dry quotes (read-only)

Steps (each prints one JSON line to the log):
  1. quote_legA   1Click dry quote, Base USDC -> ZEC (dry=true: no deposit address is issued)
  2. quote_legB   1Click dry quote, ZEC -> Base USDC
  3. base_read    USDC balance, ETH balance, gas price and eth_estimateGas for the ERC-20 transfer
  4. zcash_read   zcash-devtool (ZCASH_DEVTOOL, e.g. the NU7 build) syncs a COPY of a wallet and
                  runs `propose` (builds a proposal; no signing, no broadcast)

Env: ONECLICK_PARTNER_KEY (optional; without it the quotes use the public endpoint),
     ZCASH_DEVTOOL, ZCASH_WALLET (a wallet directory; it is copied, never written),
     EVM_FROM (an address holding USDC on the chosen network), ZEC_TO (a shielded address),
     ZEC_ACCOUNT (account UUID, when the wallet holds more than one).
Secrets come from env only and are never printed or logged.
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, time, urllib.error, urllib.request

NET = {
    'mainnet': dict(rpcs=['https://mainnet.base.org', 'https://base-rpc.publicnode.com'], chain_id=8453,
                    usdc='0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', zserver='zecrocks', explorer='https://basescan.org'),
}
OC = 'https://1click.chaindefuser.com'
BUSDC = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near'
ZEC = 'nep141:zec.omft.near'
LEG_A_MIN_USDC = 1.750123   # measured 1Click minimum for leg A (see docs/MAINNET_COST_PLAN.md)
LEG_B_MIN_ZATS = 132000     # measured 1Click minimum for leg B
FEE_ZATS = 10000            # ZIP-317 fee for a 1-output shielded send

ap = argparse.ArgumentParser()
ap.add_argument('--network', choices=NET, default='mainnet')
ap.add_argument('--usdc', default='2.5')
ap.add_argument('--zats', type=int, default=50000)
ap.add_argument('--log', default='phase2-dryrun.jsonl')
a = ap.parse_args()
N = NET[a.network]
KEY = os.environ.get('ONECLICK_PARTNER_KEY', '').strip()
LOG = open(a.log, 'a')

def scrub(s):
    return s.replace(KEY, '<key>') if KEY else s

def log(step, **kw):
    line = scrub(json.dumps(dict(step=step, network=a.network, t=time.strftime('%Y-%m-%dT%H:%M:%S%z'), **kw)))
    print(line); LOG.write(line + '\n'); LOG.flush()

def http(method, url, body=None):
    h = {'User-Agent': 'curl/8', 'Accept': 'application/json', 'Content-Type': 'application/json'}
    if KEY: h['X-API-Key'] = KEY
    r = urllib.request.Request(url, None if body is None else json.dumps(body).encode(), h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as f: return f.status, json.loads(f.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400]

def rpc(method, params):
    for u in N['rpcs']:
        try:
            r = urllib.request.Request(u, json.dumps(dict(jsonrpc='2.0', id=1, method=method, params=params)).encode(),
                                       {'Content-Type': 'application/json', 'User-Agent': 'curl/8'})
            j = json.load(urllib.request.urlopen(r, timeout=20))
            if 'result' in j: return j['result']
            last = j.get('error')
        except Exception as e:
            last = repr(e)
    raise RuntimeError(f'{method}: {last}')

def quote(tag, **kw):
    dl = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + 3600))
    b = dict(dry=True, swapType='EXACT_INPUT', slippageTolerance=100, depositType='ORIGIN_CHAIN', refundType='ORIGIN_CHAIN',
             recipientType='DESTINATION_CHAIN', deadline=dl, quoteWaitingTimeMs=0, **kw)
    st, r = http('POST', OC + '/v0/quote', b)
    if st != 201 or not isinstance(r, dict):
        log(tag, ok=False, http=st, error=str(r)[:300]); return None
    q = r['quote']
    log(tag, ok=True, http=st, amount_in=q.get('amountInFormatted'), amount_out=q.get('amountOutFormatted'),
        min_out=q.get('minAmountOut'), eta_s=q.get('timeEstimate'), deposit_address=q.get('depositAddress'),
        note='dry quote: no deposit address, nothing to send')
    return q

# Quotes are mainnet prices with dry=true. A dry quote still checks
# that the addresses are valid mainnet ones: QUOTE_EVM_ADDR (default: the example address from the
# 1Click docs) and QUOTE_ZEC_ADDR (a mainnet Zcash address). Neither is logged.
EVM_PLACEHOLDER = os.environ.get('QUOTE_EVM_ADDR', '0x2527D02599Ba641c19FEa793cD0F167589a0f10D')
ZEC_PLACEHOLDER = os.environ.get('QUOTE_ZEC_ADDR', '')
qa = quote('quote_legA', originAsset=BUSDC, destinationAsset=ZEC, amount=str(int(round(float(a.usdc) * 1e6))),
           recipient=ZEC_PLACEHOLDER, refundTo=EVM_PLACEHOLDER)
qb = quote('quote_legB', originAsset=ZEC, destinationAsset=BUSDC, amount=str(max(a.zats, LEG_B_MIN_ZATS)),
           recipient=EVM_PLACEHOLDER, refundTo=ZEC_PLACEHOLDER)

# Base reads
frm = os.environ.get('EVM_FROM')
try:
    gp = int(rpc('eth_gasPrice', []), 16); cid = int(rpc('eth_chainId', []), 16)
    out = dict(chain_id=cid, chain_ok=cid == N['chain_id'], gas_price_gwei=gp / 1e9)
    if frm:
        units = int(round(float(a.usdc) * 1e6))
        bal = int(rpc('eth_call', [{'to': N['usdc'], 'data': '0x70a08231' + frm[2:].lower().rjust(64, '0')}, 'latest']), 16)
        eth = int(rpc('eth_getBalance', [frm, 'latest']), 16)
        amt = min(units, bal) or 1
        data = '0xa9059cbb' + EVM_PLACEHOLDER[2:].lower().rjust(64, '0') + hex(amt)[2:].rjust(64, '0')
        try: gas = int(rpc('eth_estimateGas', [{'from': frm, 'to': N['usdc'], 'data': data}]), 16); gerr = None
        except RuntimeError as e: gas, gerr = 65000, str(e)[:200]
        out.update(from_=frm, usdc=bal / 1e6, eth=eth / 1e18, estimate_amount_usdc=amt / 1e6, est_gas=gas, est_gas_error=gerr,
                   est_cost_eth=gas * gp / 1e18, usdc_covers_leg_a=bal / 1e6 >= LEG_A_MIN_USDC)
    log('base_read', ok=out['chain_ok'], **out, signed=False, sent=False)
except RuntimeError as e:
    log('base_read', ok=False, error=str(e)[:300])

# Zcash reads on a copy of the wallet
dev, wal, to = os.environ.get('ZCASH_DEVTOOL'), os.environ.get('ZCASH_WALLET'), os.environ.get('ZEC_TO')
if dev and wal:
    tmp = tempfile.mkdtemp(prefix='p2-wallet-'); w = os.path.join(tmp, 'w')
    shutil.copytree(wal, w)
    def z(*args, timeout=1800):
        r = subprocess.run([dev, 'wallet', '-w', w, *args], capture_output=True, text=True, timeout=timeout)
        return r.returncode, '\n'.join(l for l in (r.stdout + r.stderr).splitlines() if ' INFO ' not in l)
    ver = os.environ.get('ZCASH_DEVTOOL_LABEL') or os.path.basename(dev)
    rc_sync, o_sync = z('sync', '-s', N['zserver'])
    acct = os.environ.get('ZEC_ACCOUNT')
    rc_bal, o_bal = z('balance', *([acct] if acct else []))
    height = (re.findall(r'Height:\s*(\d+)', o_bal) or [None])[0]
    spend = sum(int(round(float(x) * 1e8)) for x in re.findall(r'(?:Orchard|Ironwood|Sapling) Spendable:\s+([\d.]+)', o_bal))
    # Balances, addresses and the proposal text are not logged: the wallet may hold a private payout.
    res = dict(devtool=ver, sync_rc=rc_sync, sync_error=o_sync[-300:] if rc_sync else None, height=height,
               spendable_covers_value=spend >= a.zats + FEE_ZATS)
    if to:
        rc_p, o_p = z('propose', '--address', to, '--value', str(a.zats), *([acct] if acct else []))
        fee = re.findall(r'Fee:\s+([\d.]+)', o_p)
        res.update(propose_rc=rc_p, propose_ok=rc_p == 0, propose_value=a.zats,
                   fee_zats=int(round(float(fee[-1]) * 1e8)) if fee else None,
                   pools=sorted(set(re.findall(r'Pool:\s+(\w+)', o_p))), steps=len(re.findall(r'Step \d+:', o_p)),
                   propose_error=None if rc_p == 0 else o_p[-300:])
    shutil.rmtree(tmp, ignore_errors=True)
    log('zcash_read', ok=rc_sync == 0 and res.get('propose_ok', True), **res, signed=False, sent=False)
else:
    log('zcash_read', ok=False, skipped='set ZCASH_DEVTOOL and ZCASH_WALLET')

log('done', note='dry run: nothing was signed or broadcast on any network')
