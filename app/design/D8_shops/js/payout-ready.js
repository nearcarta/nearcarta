// Payouts can be prepared only when every NEAR row is a real account under the cap.

import { nearAccountOk, nearAmountOk, payoutIssues } from './payouts.js';

export function payableRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter(r => String(r?.asset || 'NEAR').toUpperCase() !== 'USDC' && nearAccountOk(r?.to) && nearAmountOk(r?.amt)).slice(0, 3);
}

export function payoutReady(rows, exists) {
  const issues = payoutIssues(rows, exists);
  const list = payableRows(rows);
  const total = Math.round(list.reduce((t, r) => t + Number(r.amt), 0) * 1e6) / 1e6;
  return { count: issues.length ? 0 : list.length, total, enabled: issues.length === 0 && list.length > 0 && total > 0, issues };
}

export function payoutLabel(rows) {
  const { count, enabled } = payoutReady(rows);
  return enabled ? `Prepare ${count} as one batch` : 'Pay';
}
