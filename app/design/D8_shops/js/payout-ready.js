// Payouts can be prepared only when every row is payable: a NEAR row is a real account at or under
// the visitor's own /setup cap, and a foreign row has a payee address of the right shape.
// No cap here: the caller passes the cap read from the visitor's row.

import { nearAccountOk, nearAmountOk, payoutIssues, foreignAddressOk } from './payouts.js';

function rowOk(r, cap) {
  const asset = String(r?.asset || 'NEAR').toUpperCase();
  const chain = String(r?.chain || (asset === 'NEAR' ? 'near' : '')).toLowerCase();
  if (asset !== 'NEAR' || chain !== 'near') return !!String(r?.to || '').trim() && foreignAddressOk(chain, r?.to) && Number(r?.amt) > 0;
  return nearAccountOk(r?.to) && nearAmountOk(r?.amt, cap);
}

export function payableRows(rows, cap = null) {
  return (Array.isArray(rows) ? rows : []).filter(r => rowOk(r, cap));
}

export function payoutReady(rows, exists, cap = null) {
  const issues = payoutIssues(rows, exists, cap);
  const list = payableRows(rows, cap);
  const total = Math.round(list.reduce((t, r) => t + Number(r.amt), 0) * 1e6) / 1e6;
  return { count: issues.length ? 0 : list.length, total, enabled: issues.length === 0 && list.length > 0 && total > 0, issues };
}

export function payoutLabel(rows, cap = null) {
  const { count, enabled } = payoutReady(rows, null, cap);
  return enabled ? `Prepare ${count} as one batch` : 'Pay';
}
