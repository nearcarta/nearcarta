// "Why this price?" tooltip. It prints the reasons the quote carries, word for
// word, and computes nothing itself. The quote comes from the contract's
// `quote` view or, in fast-forward, from shared/market/pricing.js.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function factorText(bps) {
  const x = Number(bps) / 10_000;
  return `×${x.toFixed(2).replace(/\.?0+$/, '')}`;
}

export function yoctoToNear(yocto, digits = 4) {
  const y = BigInt(yocto);
  const unit = 10n ** 24n;
  const whole = y / unit;
  const frac = (y % unit).toString().padStart(24, '0').slice(0, digits).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function whyLines(q) {
  return q.reasons.map((r) => `${r.rule} ${factorText(r.factor_bps)}: ${r.why}`);
}

export function whyHtml(q, good = 'this good', money = (y) => `${yoctoToNear(y)} NEAR`) {
  const rows = q.reasons
    .map((r) => `<li><b>${esc(r.rule)}</b> <span class="why-f">${esc(factorText(r.factor_bps))}</span> ${esc(r.why)}</li>`)
    .join('');
  return `<div class="why" role="tooltip"><p>You pay ${esc(money(q.buy))} for ${esc(good)}. The shop pays ${esc(money(q.sell))} to buy it from you.</p><ul>${rows}</ul></div>`;
}
