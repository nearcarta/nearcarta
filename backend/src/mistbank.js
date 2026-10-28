// Mist Bank: a private payout desk. Everything shown comes from a real source, nothing is sample data.
//  Street (public): a real Zcash TESTNET shielded payout read live from a public explorer API.
//    streetCheck() proves the amount is not visible: no transparent inputs or outputs, and the only
//    value leaving the shielded pools is the fee. A payout that crosses pools (for example Ironwood to
//    Sapling) shows the crossing amount on chain, so it fails this check, as faucet payouts do.
//  Oath (public): NEAR testnet approval of the payout. Its memo carries only a commitment
//    sha256("mistbank:v1:<zats>:<salt>") (as "mb1:<base64url>"), never the amount.
//  Ledger (disclosed): amount and memo decrypted by a view-only wallet from the payee's published
//    testnet viewing key (judges/proofs/mistbank-payout.json). Anyone can recompute the commitment.
//  Desk (live): dry NEAR Intents 1Click quotes for the confidential legs (shield into Confidential
//    Intents, private transfer, unshield), each checked for the 1Click signature and the echo guard.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { DEP, has } from './config.js';
import { postQuote, checkQuote } from './ferry.js';
import { txStatus, txResult, eventsFromOutcome, explorerTx } from './near.js';

export const ZEC_TESTNET_API = process.env.ZEC_TESTNET_API || 'https://api.testnet.cipherscan.app';
const UA = { 'User-Agent': 'nearcarta-mistbank/0.1' };

export const commitment = (zats, salt) => createHash('sha256').update(`mistbank:v1:${zats}:${salt}`).digest('hex');
// The oath caps memos at 64 bytes, so the commitment goes on chain as base64url: "mb1:" + 43 chars.
export const oathMemo = c => `mb1:${Buffer.from(c, 'hex').toString('base64url')}`;

export async function fetchStreet(txid) {
  if (!/^[0-9a-f]{64}$/.test(txid)) throw Object.assign(new Error('bad txid'), { status: 400 });
  const r = await fetch(`${ZEC_TESTNET_API}/api/tx/${txid}`, { headers: UA });
  if (!r.ok) throw new Error(`zcash explorer http ${r.status}`);
  return r.json();
}

const POOLS = ['Sapling', 'Orchard', 'Ironwood'];
export function streetCheck(tx) {
  const fee = BigInt(tx.feeZat ?? 0);
  const pools = Object.fromEntries(POOLS.map(p => [p.toLowerCase(), String(tx[`valueBalance${p}Zat`] ?? 0)]));
  const reasons = [];
  const tIn = (tx.inputs || []).length, tOut = (tx.outputs || []).length;
  if (tIn || tOut || BigInt(tx.totalInputZat ?? 0) || BigInt(tx.totalOutputZat ?? 0)) reasons.push('transparent_inputs_or_outputs');
  const vb = Object.values(pools).map(BigInt);
  if (vb.some(v => v !== 0n && v !== fee)) reasons.push('pool_crossing_reveals_amount');
  if (vb.reduce((a, b) => a + b, 0n) !== fee) reasons.push('value_balance_not_fee');
  if (tx.isCoinbase) reasons.push('coinbase');
  const actions = { ironwood: tx.ironwoodActions ?? 0, orchard: tx.orchardActions ?? 0, sapling_spends: tx.saplingSpendCount ?? 0, sapling_outputs: tx.saplingOutputCount ?? 0 };
  return {
    txid: tx.txid, height: tx.blockHeight ? Number(tx.blockHeight) : null, confirmations: tx.confirmations ?? 0,
    fee_zat: fee.toString(), value_balance_zat: pools, actions,
    amount_hidden: reasons.length === 0, reasons,
  };
}

// Parse `zcash-devtool wallet list-tx` text output for one txid (received outputs + memo).
export function parseLedger(text, txid) {
  const blocks = text.split(/\n(?=[0-9a-f]{64}\n)/);
  const b = blocks.find(x => x.trimStart().startsWith(txid));
  if (!b) return null;
  let zats = 0; const memos = [];
  for (const out of b.split(/\n\s*Output /).slice(1)) {
    if (!/Received by account/.test(out)) continue;
    const v = out.match(/Value:\s+([\d.]+) TAZ/);
    if (v) { const [w, f = ''] = v[1].split('.'); zats += Number(w) * 1e8 + Number((f + '00000000').slice(0, 8)); }
    const m = out.match(/Memo:\s*(.*)/);
    if (m) { const s = m[1].match(/"((?:[^"\\]|\\.)*)"/); memos.push(s ? s[1] : m[1].trim()); }
  }
  const height = Number((b.match(/Mined: (\d+)/) || [])[1]) || null;
  return { txid, height, zats, taz: (zats / 1e8).toFixed(8), memo: memos.find(m => m.includes('mistbank')) || memos[0] || null };
}

// Dry confidential quotes. Placeholder implicit accounts: dry quotes only, no deposit address exists.
const ACCT = '561e8ef0fecb621469da30250dc6cdcd1e47a66e561e8ef0fecb621469da3025';
const ACCT2 = 'c0ffee'.padEnd(64, '0');
const ZEC = 'nep141:zec.omft.near';
const USDC = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
export function deskRequests(privacy = 'basic', now = Date.now()) {
  const base = o => ({ dry: true, swapType: 'EXACT_INPUT', slippageTolerance: 100, deadline: new Date(now + 3600e3).toISOString(), confidentiality: privacy, ...o });
  return {
    shield: base({ originAsset: ZEC, destinationAsset: ZEC, amount: '10000000', depositType: 'ORIGIN_CHAIN', refundType: 'INTENTS', refundTo: ACCT, recipientType: 'CONFIDENTIAL_INTENTS', recipient: ACCT }),
    transfer: base({ originAsset: USDC, destinationAsset: USDC, amount: '1000000', depositType: 'CONFIDENTIAL_INTENTS', refundType: 'CONFIDENTIAL_INTENTS', refundTo: ACCT, recipientType: 'CONFIDENTIAL_INTENTS', recipient: ACCT2 }),
    unshield: base({ originAsset: USDC, destinationAsset: USDC, amount: '1000000', depositType: 'CONFIDENTIAL_INTENTS', refundType: 'CONFIDENTIAL_INTENTS', refundTo: ACCT, recipientType: 'INTENTS', recipient: ACCT }),
  };
}

export async function desk(privacy = 'basic') {
  if (!['basic', 'advanced'].includes(privacy)) throw Object.assign(new Error('privacy must be basic|advanced'), { status: 400 });
  if (!has.oneClick()) return { available: false, reason: 'confidential quotes need ONECLICK_PARTNER_KEY on the server' };
  const legs = {};
  for (const [k, body] of Object.entries(deskRequests(privacy))) {
    const r = await postQuote(body, { auth: true });
    if (r.http !== 201) { legs[k] = { ok: false, http: r.http, error: r.body?.message || 'refused' }; continue; }
    const c = checkQuote(body, r.body);
    legs[k] = { ok: c.accepted, ms: r.ms, privacy: r.body.quoteRequest?.confidentiality, depositType: body.depositType, recipientType: body.recipientType,
      amountIn: r.body.quote?.amountInFormatted, amountOut: r.body.quote?.amountOutFormatted, signature: c.signature, echo: c.echo, dry: c.dry };
  }
  return { available: true, privacy, legs };
}

const proofPath = new URL('../../judges/proofs/mistbank-payout.json', import.meta.url);
// The recorder writes judges/proofs/mistbank-payout.json; the same record is in shared/deployments (bundled).
export const proof = () => DEP.mistbank || (existsSync(proofPath) ? JSON.parse(readFileSync(proofPath, 'utf8')) : null);

// Anyone holding the disclosed amount and salt can check them against the recorded commitment.
export function verifyOpening(zats, salt, p = proof()) {
  if (!/^\d{1,16}$/.test(String(zats)) || !/^[0-9a-f]{32}$/.test(String(salt))) throw Object.assign(new Error('zats must be an integer and salt 32 hex chars'), { status: 400 });
  const c = commitment(String(Number(zats)), salt);
  return { commitment: c, recorded: p?.commitment?.value ?? null, matches: !!p && c === p.commitment.value, oath_memo: oathMemo(c) };
}

export async function oathCheck(p) {
  const tx = await txStatus(p.oath.tx, p.oath.sender);
  const ok = !!tx?.status?.SuccessValue || tx?.status?.SuccessValue === '';
  const blob = JSON.stringify(eventsFromOutcome(tx).events);
  const memo = oathMemo(p.commitment.value);
  const args = (tx.transaction?.actions || []).map(a => a.FunctionCall?.args).filter(Boolean).map(a => Buffer.from(a, 'base64').toString('utf8')).join(' ');
  const ev = eventsFromOutcome(tx).events.find(e => e.event === 'action')?.data?.[0] || {};
  const decision = txResult(tx)?.value?.decision ?? ev.decision ?? null; // read from chain, not from the proof file
  return { tx: p.oath.tx, url: explorerTx(p.oath.tx), success: ok, decision, shop: ev.shop ?? null, clause_id: ev.clause_id ?? null,
    memo_on_chain: args.includes(memo) || blob.includes(memo) };
}

let cache = { at: 0, v: null };
export async function mistbank({ fresh = false } = {}) {
  if (!fresh && cache.v && Date.now() - cache.at < 60e3) return cache.v;
  const p = proof();
  if (!p) return { built: false, reason: 'no payout recorded yet (run backend/scripts/mistbank-record.js)' };
  const [street, oath, deskBasic] = await Promise.all([
    fetchStreet(p.payout.txid).then(streetCheck).catch(e => ({ error: e.message })),
    oathCheck(p).catch(e => ({ error: e.message })),
    desk('basic').catch(e => ({ available: false, reason: e.message })),
  ]);
  const ledger = p.ledger;
  const binds = !!ledger && commitment(ledger.zats, (ledger.memo?.match(/salt=([0-9a-f]{32})/) || [])[1]) === p.commitment.value && ledger.memo.includes(p.oath.tx);
  const v = { built: true, network: p.network, payout: p.payout, street, oath, ledger, disclosure: p.disclosure, commitment: p.commitment, binds, desk: deskBasic, src: 'live' };
  cache = { at: Date.now(), v };
  return v;
}
