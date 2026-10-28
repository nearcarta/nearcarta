// Live reads for the shop interiors (design/D8_shops imports ../data/live.js; the build puts this file there).
// Same field mapping as design/D8_shops/tools/snapshot.mjs. Reads the testnet API (window.NEARCARTA_API, then the
// same origin); if both are down or slow, the last snapshot stays, labelled with the time it was read.
// Read-only: dry quotes only (no deposit address exists), no keys, no viewing key is copied into the page.
import * as SNAP from './live.snapshot.js';
import { echoGuard, orchardOnly } from '/live/ferry-guard.js';

const UA = 'u1naczqa5m5nefpyqnhs8h3dw8un8z8us45xwgfh4ees95mayyru9snc33dkfk2dc27r5syu4uveyyd5dt8wwad89kpc3f8cah055lm0ex';
// ZIP 316 test vectors (backend/test/fixtures/zip316_vectors.json): what the Orchard-only check refuses.
const UA_BOTH = 'u1ay3aawlldjrmxqnjf5medr5ma6p3acnet464ht8lmwplq5cd3ugytcmlf96rrmtgwldc75x94qn4n8pgen36y8tywlq6yjk7lkf3fa8wzjrav8z2xpxqnrnmjxh8tmz6jhfh425t7f3vy6p4pd3zmqayq49efl2c4xydc0gszg660q9p';
const UA_OPEN = 'u1snf9yr883aj2hm8pksp9aymnqdwzy42rpzuffevj35hhxeckays5pcpeq7vy2mtgzlcuc4mnh9443qnuyje0yx6h59angywka4v2ap6kchh2j96ezf9w0c0auyz3wwts2lx5gmk2sk9';
const REFUND = '0x561E8eF0FEcB621469dA30250dC6CdCD1E47A66e';

const bases = [...new Set([(globalThis.NEARCARTA_API || '').replace(/\/$/, ''), ''])];
async function get(base, p, body, ms = 9000) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(base + p, { signal: c.signal, ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }); return r.ok ? await r.json() : null; }
  catch { return null; } finally { clearTimeout(t); }
}
async function read() {
  for (const b of bases) {
    const [mb, q, mine, both, open] = await Promise.all([
      get(b, '/api/mistbank'),
      get(b, '/api/ferry/quote', { from: { symbol: 'USDC', chain: 'base' }, to: { symbol: 'ZEC', chain: 'zec' }, amount: '30', recipient: UA, refundTo: REFUND, privacy: 'basic' }),
      get(b, '/api/ferry/zcash/' + UA), get(b, '/api/ferry/zcash/' + UA_BOTH), get(b, '/api/ferry/zcash/' + UA_OPEN)]);
    if (mb?.built || q?.ok) return { b, mb, q, mine, both, open };
  }
  return null;
}
const R = await read();
const at = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const host = R ? (R.b || location.origin).replace(/^https?:\/\//, '') : null;
const mb = R?.mb, q = R?.q;

export const BANK = mb?.built ? { src: 'testnet', at, live: true,
  street: { txid: mb.payout.txid, url: mb.payout.explorer, height: mb.street.height, confirmations: mb.street.confirmations, fee: mb.street.fee_zat,
    hidden: mb.street.amount_hidden === true, reasons: mb.street.reasons || [], pool: Object.entries(mb.street.value_balance_zat || {}).find(([, v]) => v !== '0')?.[0] || 'shielded', actions: mb.street.actions },
  oath: { tx: mb.oath.tx, ok: mb.oath.success && mb.oath.decision === 'allowed' && mb.oath.memo_on_chain, clause: mb.oath.clause_id },
  // Never the amount, the salt or the viewing key: only whether the payee's ledger binds to the on-chain commitment.
  ledger: { commitment: mb.commitment?.value, scheme: mb.commitment?.scheme },
  desk: mb.desk?.available ? Object.entries(mb.desk.legs).map(([k, l]) => ({ leg: k, ok: l.ok, privacy: l.privacy, sig: l.signature, echo: l.echo?.ok, out: l.amountOut })) : [] }
  : { ...SNAP.BANK, live: false };

function quote() {
  if (!(q?.ok && q.checks?.accepted && R.mine && orchardOnly(R.mine.receivers || []).ok)) return null;
  if (echoGuard(q.sent, q.echoed).diffs.length) return null; // the page's guard must agree with the server's
  const down = echoGuard(q.sent, { ...q.echoed, confidentiality: undefined }).diffs;
  const swap = echoGuard(q.sent, { ...q.echoed, recipient: UA_OPEN }).diffs;
  return { src: 'live', at, live: true, api: host, from: { sym: q.from.symbol, chain: 'Base', amt: q.from.amount },
    to: { sym: 'ZEC', chain: 'Zcash', amt: String(Number(Number(q.to.amount).toPrecision(3))), exact: q.to.amount },
    eta: `≈ ${q.eta_s} s`, etaS: q.eta_s, feeBps: q.checks.echo.protocolFeeBps, costBps: q.cost_bps_signed, privacy: q.privacy, sig: q.checks.signature === true, dry: q.checks.dry === true,
    fee: `${q.checks.echo.protocolFeeBps} bps (1Click) · signature ${q.checks.signature ? 'verified' : 'FAILED'}`,
    ua: { addr: UA, receivers: R.mine.receivers, orchardOnly: true },
    refused: [
      { case: 'UA with Orchard + Sapling', receivers: R.both?.receivers || SNAP.QUOTE.refused[0].receivers, why: 'not Orchard-only' },
      { case: 'UA with Orchard + transparent', receivers: R.open?.receivers || SNAP.QUOTE.refused[1].receivers, why: 'a sender may pick the transparent receiver' },
      { case: 'Echo drops confidentiality', diffs: down, why: 'downgrade from basic to public' },
      { case: 'Echo swaps the recipient', diffs: swap.map(d => ({ field: d.field, sent: String(d.sent).slice(0, 10) + '…', got: String(d.got).slice(0, 10) + '…' })), why: 'the quote would pay someone else' }] };
}
export const QUOTE = quote() || { ...SNAP.QUOTE, live: false };
