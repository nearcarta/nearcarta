// Ferry guard, dependency-free: no imports, so the frontend and tools can import this file as is.
// It answers two questions about a 1Click quote before anything is shown:
//  1. orchardOnly(receivers): the Zcash recipient UA must carry exactly one receiver, Orchard.
//     Orchard+Sapling or Orchard+transparent is refused: a sender may pick the weaker receiver.
//  2. echoGuard(sent, quoteRequest): every field we asked for must come back unchanged.
//     confidentiality, appFees and rebates are NOT covered by the 1Click signature, so a silent
//     downgrade (basic -> public) or a swapped recipient is caught here, not by the signature.
// Decoding a UA into receivers needs bech32m + blake2b; that part is in backend/src/zcash.js.

export const ECHO = ['dry', 'swapType', 'slippageTolerance', 'originAsset', 'depositType', 'destinationAsset', 'amount',
  'refundTo', 'refundType', 'recipient', 'recipientType', 'confidentiality', 'rebates'];
const norm = (k, v) => (k === 'confidentiality' ? v || 'public' : k === 'rebates' ? JSON.stringify(v || []) : v);
// 1Click appends its own protocol fee to appFees (seen live: 20 bps, 1 bp on stable routes).
// Our own fee entries must come back unchanged; extra entries are disclosed and capped.
export const PROTOCOL_FEE_MAX_BPS = 20;

export function echoGuard(sent, quoteRequest) {
  const diffs = [];
  for (const k of ECHO) {
    const a = norm(k, sent[k]), b = norm(k, quoteRequest?.[k]);
    if (a !== b) diffs.push({ field: k, sent: a, got: b });
  }
  const ours = sent.appFees || [], got = [...(quoteRequest?.appFees || [])];
  for (const f of ours) {
    const i = got.findIndex(g => g.recipient === f.recipient && g.fee === f.fee);
    if (i < 0) diffs.push({ field: 'appFees', sent: f, got: null }); else got.splice(i, 1);
  }
  const protocolBps = got.reduce((s, g) => s + Number(g.fee || 0), 0);
  if (protocolBps > PROTOCOL_FEE_MAX_BPS) diffs.push({ field: 'appFees', sent: `protocol <= ${PROTOCOL_FEE_MAX_BPS} bps`, got: `${protocolBps} bps` });
  return { ok: diffs.length === 0, diffs, protocolFeeBps: protocolBps };
}

export function orchardOnly(receivers) {
  const r = (receivers || []).filter(x => !String(x).startsWith('unknown_'));
  const ok = r.length === 1 && r[0] === 'Orchard';
  const extra = r.filter(x => x !== 'Orchard');
  return { ok, receivers: r, why: ok ? 'Orchard-only UA' : r.includes('Orchard') ? `UA also carries ${extra.join(' + ')}; a sender may pick it` : 'no Orchard receiver' };
}

// Both checks together; refused[] lists every reason, in the order a reader should see them.
export function ferryGuard({ receivers, sent, quoteRequest }) {
  const refused = [];
  const ua = orchardOnly(receivers);
  if (!ua.ok) refused.push({ case: 'recipient_not_orchard_only', why: ua.why, receivers: ua.receivers });
  if (quoteRequest) {
    const e = echoGuard(sent, quoteRequest);
    for (const d of e.diffs) refused.push({ case: d.field === 'confidentiality' ? 'privacy_downgrade' : d.field === 'recipient' ? 'recipient_swap' : `echo_${d.field}`, why: `${d.field}: sent ${JSON.stringify(d.sent)}, got ${JSON.stringify(d.got)}`, diffs: [d] });
  }
  return { ok: refused.length === 0, refused };
}
