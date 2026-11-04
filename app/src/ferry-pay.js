// Embeddable Pay button. A host page includes this script; it renders into #nearcarta-pay
// (or the element named by data-root) and talks to this origin's /api. The charter is read
// before a deposit address is asked for. This file never sends the deposit.
(function () {
  const me = document.currentScript;
  const origin = me ? new URL(me.src).origin : '';
  const rootId = (me && me.dataset.root) || 'nearcarta-pay';
  const root = document.getElementById(rootId);
  if (!root) return;
  const preset = {
    charter: (me && me.dataset.charter) || new URLSearchParams(location.search).get('charter') || '',
    clause: (me && me.dataset.clause) || new URLSearchParams(location.search).get('clause') || 'pay',
    recipient: (me && me.dataset.recipient) || new URLSearchParams(location.search).get('recipient') || '',
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CHAINS = [
    { id: 'USDC|base', label: 'USDC on Base', amount: '0.2' },
    { id: 'USDC|arb', label: 'USDC on Arbitrum', amount: '0.2' },
    { id: 'ETH|base', label: 'ETH on Base', amount: '0.00005' },
    { id: 'ETH|eth', label: 'ETH on Ethereum', amount: '0.00005' },
  ];
  root.innerHTML = `
    <form id="nc-pay">
      <label>Pay with <select name="from" data-testid="widget-chain">${CHAINS.map(c => `<option value="${c.id}" data-amount="${c.amount}">${esc(c.label)}</option>`).join('')}</select></label>
      <label>Amount <input name="amount" value="0.2" inputmode="decimal" data-testid="widget-amount"></label>
      <label>Receive USDC on NEAR, paid to <input name="recipient" readonly data-testid="widget-recipient" placeholder="the charter’s recipient"></label>
      <label>Your refund address, on the chain you pay from <input name="refundTo" required placeholder="0x…" data-testid="widget-refund"></label>
      <button type="submit" data-testid="widget-pay">Pay</button>
    </form>
    <p id="nc-out" data-testid="widget-out"></p>
    <p id="nc-status" data-testid="widget-status"></p>`;
  const out = root.querySelector('#nc-out');
  const statusEl = root.querySelector('#nc-status');
  const form = root.querySelector('#nc-pay');
  const chain = form.querySelector('[name=from]');
  const amount = form.querySelector('[name=amount]');
  const recipient = form.querySelector('[name=recipient]');
  chain.onchange = () => {
    const opt = chain.selectedOptions[0];
    if (opt && opt.dataset.amount) amount.value = opt.dataset.amount;
  };
  let rules = null;
  const api = p => fetch(origin + p).then(r => r.json().then(j => ({ ok: r.ok, j })));
  async function loadRules(charter) {
    out.textContent = 'Reading the charter…';
    const q = new URLSearchParams({ charter, clause: preset.clause });
    const { j } = await api('/api/ferry/rules?' + q);
    rules = j;
    const list = j.receivers || [];
    const pick = preset.recipient || list[0] || '';
    recipient.value = pick;
    if (preset.recipient && list.length && !list.includes(preset.recipient)) { out.textContent = 'That recipient is not on the charter list.'; return; }
    if (!j.ok) { out.textContent = 'The charter will not take this payment' + (j.reason ? ': ' + j.reason : '') + '.'; return; }
    out.textContent = 'The charter allows ' + pick + '. At most 0.20 USD. Pay asks for a deposit address. You send the tokens yourself.';
  }
  (async () => {
    let charter = preset.charter;
    if (!charter) {
      try { const { j } = await api('/api/mainnet'); charter = j.charter && j.charter.contract || ''; } catch { charter = ''; }
    }
    if (!charter) { out.textContent = 'Name a charter account to pay.'; return; }
    form.dataset.charter = charter;
    await loadRules(charter);
  })();
  let timer = null;
  async function track(depositAddress, memo) {
    const q = new URLSearchParams({ env: 'ONECLICK', depositAddress });
    if (memo) q.set('depositMemo', memo);
    const { j } = await api('/api/ferry/status?' + q);
    statusEl.textContent = j.help || j.error || j.status || '';
    if (j.tx) statusEl.textContent += ' Tx ' + j.tx;
    if (j.final) clearInterval(timer);
  }
  form.onsubmit = async e => {
    e.preventDefault();
    clearInterval(timer);
    statusEl.textContent = '';
    if (!rules || !rules.ok || !rules.settlement_yocto) { out.textContent = 'The charter has not allowed a payment.'; return; }
    const [symbol, chainName] = String(new FormData(form).get('from')).split('|');
    out.textContent = 'Asking the charter, then 1Click…';
    const r = await fetch(origin + '/api/ferry/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      from: { symbol, chain: chainName }, to: { symbol: 'USDC', chain: 'near' },
      amount: String(amount.value), recipient: recipient.value, refundTo: String(new FormData(form).get('refundTo')),
      charter: form.dataset.charter, clause_id: preset.clause, amount_yocto: rules.settlement_yocto, privacy: 'public',
    }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { out.textContent = j.error || 'The payment was refused.'; return; }
    if (!j.ok || !j.depositAddress) { out.textContent = 'Refused' + (j.reason ? ': ' + j.reason : '') + '. No deposit address.'; return; }
    out.innerHTML = 'Send <b>' + esc(j.usd || amount.value) + ' USD</b> or less to <code data-testid="widget-deposit">' + esc(j.depositAddress) + '</code>'
      + (j.depositMemo ? '<br>Memo <code>' + esc(j.depositMemo) + '</code>' : '')
      + '<br>The charter allowed ' + esc(j.receipt && j.receipt.to) + '. This page does not send the tokens.';
    statusEl.textContent = j.help || '';
    timer = setInterval(() => track(j.depositAddress, j.depositMemo), 4000);
    track(j.depositAddress, j.depositMemo);
  };
})();
