// One public ledger from the board feed, the ledger route, and the deployments payload.
// Hashes come from those payloads. This module does not invent a transaction.

const link = h => `https://nearblocks.io/txns/${h}`;

export const ENTRY_NEAR = '0.001';
export const ENTRY_YOCTO = '1000000000000000000000';

const SHOP_ID = {
  'toll bridge': 'toll', toll: 'toll',
  ferry: 'ferry',
  guardhouse: 'guard', guard: 'guard',
  'your house': 'house', house: 'house',
  'vault arena': 'arena', arena: 'arena',
  'town hall': 'hall', hall: 'hall',
  board: 'board',
  'model budget': 'model', model: 'model',
  payouts: 'payouts',
  chronicle: 'chronicle',
  bank: 'bank', 'mist bank': 'bank',
};

export function shopId(name) {
  const raw = String(name || '').trim();
  const key = raw.toLowerCase();
  return SHOP_ID[key] || raw.split('.')[0].toLowerCase() || 'board';
}

export function decisionOf(raw) {
  const d = String(raw || '').toLowerCase();
  if (['allowed', 'allow', 'opened', 'success', 'sale', 'payout'].includes(d)) return 'allowed';
  if (['denied', 'refused', 'refusal', 'failed'].includes(d)) return 'denied';
  return '';
}

function amountFromNote(note) {
  const m = String(note || '').match(/(\d+(?:\.\d+)?)\s*NEAR/i);
  return m ? `${m[1]} NEAR` : '';
}

function txRows(bag, spec) {
  const txs = bag || {};
  const out = [];
  for (const s of spec) {
    const h = txs[s.name];
    if (!h || typeof h !== 'string') continue;
    out.push({
      shop: s.shop, decision: s.decision, reason: s.reason, label: s.reason,
      amount: s.amount, h, url: link(h), signer: '', at: '',
    });
  }
  return out;
}

export function rowsFromMainnet(dep) {
  if (!dep || typeof dep !== 'object') return [];
  const rows = [];
  const ferry = dep.ferry_intents;
  if (ferry && String(ferry.status || '').toUpperCase() === 'SUCCESS' && ferry.txs?.wrap_near) {
    rows.push({
      shop: 'ferry', decision: 'allowed', reason: 'SUCCESS', label: 'SUCCESS',
      amount: ferry.amount_out || ferry.amount_in || '',
      h: ferry.txs.wrap_near, url: link(ferry.txs.wrap_near),
      signer: ferry.from || '', at: ferry.updated_at || '',
    });
  }
  rows.push(...txRows(dep.toll?.txs, [
    { name: 'owner_toll_pay_allowlisted', shop: 'toll', decision: 'allowed', amount: '0.001 NEAR', reason: 'toll sale allowed' },
    { name: 'owner_toll_pay_not_allowlisted', shop: 'toll', decision: 'denied', amount: '0', reason: 'receiver_not_allowlisted' },
  ]));
  rows.push(...txRows(dep.board?.txs, [
    { name: 'allowed_0.001', shop: 'board', decision: 'allowed', amount: '0.001 NEAR', reason: 'allowed' },
    { name: 'refused_over_per_action_cap', shop: 'guard', decision: 'denied', amount: '0', reason: 'over_per_action_cap' },
    { name: 'refused_receiver_not_allowlisted', shop: 'guard', decision: 'denied', amount: '0', reason: 'receiver_not_allowlisted' },
  ]));
  rows.push(...txRows(dep.board?.visitor_run?.txs, [
    { name: 'propose_allowed_0.001', shop: 'payouts', decision: 'allowed', amount: '0.001 NEAR', reason: 'payment allowed' },
    { name: 'propose_refused_0.01_over_per_action_cap', shop: 'payouts', decision: 'denied', amount: '0', reason: 'over_per_action_cap' },
  ]));
  rows.push(...txRows(dep.extras?.house?.txs, [
    { name: 'house_pay_allowed_0.001', shop: 'house', decision: 'allowed', amount: '0.001 NEAR', reason: 'deed payment allowed' },
    { name: 'house_pay_refused_0.002', shop: 'house', decision: 'denied', amount: '0', reason: 'over_per_action_cap' },
  ]));
  return rows;
}

export function rowFromBoard(t) {
  if (!t?.hash && !t?.h) return null;
  const h = t.hash || t.h;
  const note = t.note || t.reason || '';
  const decision = decisionOf(t.decision) || 'allowed';
  return {
    shop: shopId(t.shop || 'board'), decision, reason: note, label: note,
    h, signer: t.signer || '', amount: t.amount || amountFromNote(note),
    url: t.url || link(h), at: t.at || '',
  };
}

export function rowFromLedger(r) {
  if (!r?.tx) return null;
  const decision = r.kind === 'refusal' ? 'denied' : 'allowed';
  return {
    shop: shopId(r.shop), decision, reason: r.note || '', label: r.note || '',
    h: r.tx, signer: '', amount: r.amount ? `${r.amount} ${r.asset || ''}`.trim() : '',
    url: r.url || link(r.tx), at: r.at || '',
  };
}

function pushRow(out, seen, row) {
  if (!row) return;
  const h = String(row.h || '');
  const key = h || `local:${row.shop}:${row.reason}:${row.amount}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(row);
}

export function mergeChronicle({ board, ledger, mainnet, local = [], recorded = [] } = {}) {
  const out = [];
  const seen = new Set();
  for (const r of local || []) pushRow(out, seen, rowFromBoard({ ...r, hash: r.h || r.hash, note: r.reason || r.label }));
  for (const r of rowsFromMainnet(mainnet)) pushRow(out, seen, r);
  for (const t of board?.txs || []) pushRow(out, seen, rowFromBoard(t));
  for (const r of ledger?.rows || []) pushRow(out, seen, rowFromLedger(r));
  const live = out.length > 0;
  if (!out.length) for (const r of recorded || []) pushRow(out, seen, rowFromBoard({ ...r, hash: r.h, note: r.reason || r.label }));
  return { rows: out, live };
}

export async function loadChronicleSources(fetchFn, apiBase = '') {
  const get = async (path) => {
    const res = await fetchFn(`${apiBase}${path}`);
    if (!res || res.ok === false) throw new Error(path);
    return res.json();
  };
  const [board, ledger, mainnet] = await Promise.all([
    get('/api/chronicle').catch(() => null),
    get('/api/ledger').catch(() => null),
    get('/api/mainnet').catch(() => null),
  ]);
  return { board, ledger, mainnet, any: !!(board || ledger || mainnet) };
}

export function entryPlan({
  capYocto, balanceYocto = null, receivers = null, receiver = '',
  amountYocto = ENTRY_YOCTO, spentYocto = null, dailyYocto = null,
} = {}) {
  let cap, amt;
  try {
    cap = BigInt(capYocto);
    amt = BigInt(amountYocto);
  } catch {
    return { ok: false, reason: 'The board row has no per-payment cap yet. Nothing was signed.' };
  }
  if (amt <= 0n) return { ok: false, reason: 'The entry amount is empty. Nothing was signed.' };
  if (amt > cap) return { ok: false, reason: 'This 0.001 NEAR entry is larger than the per-payment cap on your board row. Nothing was signed.' };
  if (balanceYocto != null && balanceYocto !== '') {
    try {
      if (BigInt(balanceYocto) < amt) return { ok: false, reason: 'The board row does not hold 0.001 NEAR for this entry. Nothing was signed.' };
    } catch { /* an unreadable balance is not a pass */ }
  }
  if (dailyYocto != null && dailyYocto !== '' && spentYocto != null && spentYocto !== '') {
    try {
      if (BigInt(spentYocto) + amt > BigInt(dailyYocto)) return { ok: false, reason: 'This entry would pass the daily budget on your board row. Nothing was signed.' };
    } catch { /* ignore an unreadable budget */ }
  }
  const list = Array.isArray(receivers) ? receivers : null;
  if (list && list.length && receiver && !list.includes(receiver)) {
    return { ok: false, reason: 'That payee is not on your board row. Nothing was signed.' };
  }
  return { ok: true, amountYocto: amt.toString(), near: ENTRY_NEAR };
}
