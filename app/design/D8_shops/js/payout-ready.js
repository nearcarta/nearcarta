// Payouts can be sent only when there is something to pay.

export function payableRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter(r => Number(r?.amt) > 0 && r?.to).slice(0, 3);
}

export function payoutReady(rows) {
  const list = payableRows(rows);
  const total = Math.round(list.reduce((t, r) => t + Number(r.amt), 0) * 1e6) / 1e6;
  return { count: list.length, total, enabled: list.length > 0 && total > 0 };
}

export function payoutLabel(rows) {
  const { count, enabled } = payoutReady(rows);
  return enabled ? `Prepare ${count} as one batch` : 'Pay';
}
