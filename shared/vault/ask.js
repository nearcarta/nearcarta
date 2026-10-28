// "Ask the agent to pay": turns a plain-language request into one `propose` on the owner's charter.
// This is the plain-words FALLBACK used when the NEAR AI model (backend/src/agent.js) is unavailable or over budget,
// and it is labelled as such in every reply. It is deliberately simple: it finds an amount in
// NEAR, a payee (an account id, or a shop named by the first part of an allowlisted account) and
// an optional "for ..." note. Whether the payment happens is decided by the charter, not by this code:
// a payee off the allowlist or an amount over the cap is parsed as asked and then refused on chain.
const YOCTO = 10n ** 24n;
const ACCOUNT_RE = /\b(?:[a-z\d]+[-_])*[a-z\d]+(?:\.(?:[a-z\d]+[-_])*[a-z\d]+)+\b/g;
const AMOUNT_RE = /(\d+(?:\.\d{1,6})?|\.\d{1,6})\s*(near|Ⓝ|n\b)?/i;
/** A scored request memo: ask:<nickname>:<note>. Older `ask:<note>` memos are not scored. */
export const ASK_MEMO_RE = /^ask:([a-z0-9-]{1,20}):([a-z0-9-]{1,40})$/;
const TAG_RE = /^[a-z0-9-]{1,20}$/;

/** "0.0125" NEAR -> yocto string (up to 6 decimals). */
export function nearToYocto(s) {
  const [i, f = ''] = String(s).split('.');
  return (BigInt(i || '0') * YOCTO + BigInt((f + '000000').slice(0, 6)) * 10n ** 18n).toString();
}

const label = r => r.split('.')[0].toLowerCase();
const stems = r => { const l = label(r); return [...new Set([l, l.replace(/s$/, ''), l.replace(/-.*$/, '')])].filter(x => x.length >= 3); };

/** Parse a request. Returns { receiver, amount, note, memo } or throws with a plain message. The tag (nickname) labels the memo. */
export function parseAsk(text, receivers = [], tag = 'mine') {
  if (!TAG_RE.test(tag)) throw new Error('nickname: 1-20 of a-z 0-9 -');
  const t = String(text || '').trim().toLowerCase();
  if (!t) throw new Error('Type what the agent should pay, e.g. "pay the cafe 0.01 NEAR for coffee".');
  if (t.length > 200) throw new Error('Keep it under 200 characters.');
  const noteM = t.match(/\bfor\s+(.+)$/);
  const note = noteM ? noteM[1].replace(/[^a-z0-9 -]/g, '').trim().slice(0, 40) : '';
  const head = noteM ? t.slice(0, noteM.index) : t;
  // An account id has a letter in its last part (so 0.01 is an amount, not an account).
  const acct = [...head.matchAll(ACCOUNT_RE)].map(m => m[0]).find(a => /[a-z]/.test(a.split('.').pop()));
  const rest = acct ? head.replace(acct, ' ') : head;
  const am = rest.match(AMOUNT_RE);
  if (!am) throw new Error('Say how much, in NEAR, e.g. 0.01 NEAR.');
  const amount = nearToYocto(am[1].startsWith('.') ? '0' + am[1] : am[1]);
  if (BigInt(amount) === 0n) throw new Error('The amount must be above 0.');
  let receiver = acct || null;
  if (!receiver) {
    const words = rest.split(/[^a-z0-9-]+/).filter(Boolean);
    receiver = receivers.find(r => stems(r).some(s => words.some(w => w === s || w.replace(/s$/, '') === s || (s.length >= 4 && w.startsWith(s))))) || null;
  }
  if (!receiver) throw new Error(`Name the payee: one of ${receivers.map(label).join(', ') || 'your allowlisted shops'}, or a full account id.`);
  const slug = (note || 'payment').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 40) || 'payment';
  return { receiver, amount, note, memo: `ask:${tag}:${slug}` };
}
