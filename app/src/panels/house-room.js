// City and /shops/house/ tray. Deed, Vaults, Heirs.
// One gold button. The AI Agent calls the same runHouseTurn. Neither signs.

import { visitor } from '../../design/D8_shops/js/session.js';
import { deedMarkup } from './deed.js';
import { charterSetupCta } from './hall-ui.js';
import { ROW_WAIT_MS, nearOf, normalizeRow, rowWaitWhy, withRowWait } from './hall.js';
import { DEED } from '../deed-control.js';
import { runHouseTurn } from './house-agent.js';
import { armHouseDock, ensureHouseDock, installHouseDock } from './house-dock.js';
import { bindTokenFallbacks, tokenStack } from './token-badge.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = () => (globalThis.NEARCARTA_API || '').replace(/\/$/, '');

export function houseCharterMarkup({ accountId = '', row = null, failed = false } = {}) {
  if (row && row.per_action_cap != null && row.per_action_cap !== '') {
    const cap = nearOf(row.per_action_cap);
    return `<div class="house-state" data-testid="house-state" role="status"><p class="ferry-rate">Max per payment <b data-testid="house-cap">${esc(cap)}</b> NEAR. Change it in Town Hall.</p></div>`;
  }
  if (failed) {
    return `<div class="house-empty" data-testid="house-empty" role="status"><p>The charter read did not answer. Nothing was signed.</p></div>`;
  }
  if (accountId) {
    return charterSetupCta({ accountId, note: 'This account has no charter row. Nothing was signed.' });
  }
  return `<div class="house-empty" data-testid="house-empty" role="status"><p>Sign in to read your charter row. Nothing was signed.</p><p><a href="/setup/?next=%2Fshops%2Fhouse%2F">Sign in</a></p></div>`;
}

function tabBtn(id, label, on) {
  return `<button type="button" role="tab" class="ferry-tab${on ? ' on' : ''}" data-tab="${id}" aria-selected="${on ? 'true' : 'false'}" data-testid="house-tab-${id}">${label}</button>`;
}

function flow(toSym, toChain) {
  return `<div class="ferry-flow" data-testid="house-flow" aria-hidden="true">${tokenStack('NEAR', 'near', { size: 48, chainSize: 16 })}<span class="ferry-flow-arrow">→</span>${tokenStack(toSym, toChain, { size: 48, chainSize: 16 })}</div>`;
}

function field(label, inner) {
  return `<label class="field ferry-field"><span>${label}</span>${inner}</label>`;
}

function shell() {
  return `<div id="house" class="house-room ferry-card" data-testid="house-room">
    <div class="ferry-tabs" role="tablist" data-testid="house-tabs">${tabBtn('deed', 'Deed', true)}${tabBtn('vaults', 'Vaults', false)}${tabBtn('heirs', 'Heirs', false)}</div>
    <div class="ferry-pane" data-panel="deed" data-testid="house-panel-deed">
      ${flow('ETH', 'base')}
      ${field('Holder', '<input id="house-holder" data-testid="house-holder" readonly>')}
      ${field('Check-in', '<input id="house-check" data-testid="house-check" value="Not on this deed yet" readonly>')}
    </div>
    <div class="ferry-pane" data-panel="vaults" data-testid="house-panel-vaults" hidden>
      ${flow('ETH', 'base')}
      ${field('Chain', '<select id="house-chain" data-testid="house-chain"><option value="base">Base</option><option value="btc">Bitcoin · signing only</option></select>')}
      ${field('Derived address', '<input id="house-address" data-testid="house-address" readonly value="Not live yet" title="The deed contract does not call the signer.">')}
      ${field('Payee', '<input id="house-payee" data-testid="house-payee" placeholder="0x… or a named payee" autocomplete="off">')}
      <div class="house-pair">
        ${field('Balance', '<input id="house-balance" data-testid="house-balance" readonly value="Not read">')}
        ${field('Asset', '<input id="house-asset" data-testid="house-asset" value="ETH" autocomplete="off">')}
        ${field('Amount', '<input id="house-amt" data-testid="house-amt" inputmode="decimal" value="0.001" autocomplete="off">')}
        ${field('Gas', '<input id="house-gas" data-testid="house-gas" inputmode="numeric" value="21000" autocomplete="off">')}
      </div>
    </div>
    <div class="ferry-pane" data-panel="heirs" data-testid="house-panel-heirs" hidden>
      ${flow('ETH', 'base')}
      ${field('Heir', '<input id="house-heir" data-testid="house-heir" readonly value="Not set">')}
      ${field('Guardians', '<input id="house-guardians" data-testid="house-guardians" readonly value="Not set">')}
      <div class="house-pair">
        ${field('Threshold', '<input id="house-threshold" data-testid="house-threshold" readonly value="—">')}
        ${field('Period', '<input id="house-period" data-testid="house-period" readonly value="—">')}
        ${field('Wait', '<input id="house-wait" data-testid="house-wait" readonly value="—">')}
        ${field('Approvals', '<input id="house-approvals" data-testid="house-approvals" readonly value="0">')}
      </div>
      ${field('Countdown', '<input id="house-countdown" data-testid="house-countdown" readonly value="No release waiting">')}
    </div>
    <button type="button" class="primary ferry-cta" data-testid="house-cta" id="house-cta">I'm alive</button>
    <p class="ferry-rate" data-testid="house-status"></p>
    <p class="ferry-quote-err" data-testid="house-status-2" hidden></p>
    <p class="note" data-testid="house-failures" hidden>A lost or hostile guardian cannot release this deed. The owner can cancel.</p>
    <details class="house-record" data-testid="house-record" open><summary>Recorded payments</summary>${deedMarkup()}<div data-testid="house-read"></div></details>
  </div>`;
}

function nearText(y) {
  if (y == null || y === '') return '';
  try { return String(nearOf(y)); } catch { return ''; }
}

export function mountHouseRoom(root, hooks = {}) {
  if (!root) return;
  const who = typeof hooks.visitor === 'function' ? hooks.visitor() : visitor();
  const params = new URLSearchParams(globalThis.location?.search || '');
  const id = params.get('owner') || who.accountId || '';
  const state = hooks.state || (hooks.state = {});
  state.id = id;
  state.tab = state.tab || 'deed';
  state.seen = state.seen || new Set();
  root.innerHTML = shell();
  bindTokenFallbacks(root);
  const slot = root.querySelector('[data-testid=house-read]');
  const holder = root.querySelector('#house-holder');
  if (holder) holder.value = id || 'Sign in';

  function showTab(name) {
    state.tab = name || 'deed';
    root.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== state.tab; });
    root.querySelectorAll('[data-tab]').forEach(b => {
      const on = b.dataset.tab === state.tab;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.classList.toggle('on', on);
    });
    const cta = root.querySelector('[data-testid=house-cta]');
    if (cta) {
      if (state.tab === 'vaults') cta.textContent = 'Send from house';
      else if (state.tab === 'heirs' && state.line?.line?.pending_ns) cta.textContent = 'Cancel release';
      else cta.textContent = "I'm alive";
    }
    setStatus('');
    const note = root.querySelector('[data-testid=house-failures]');
    if (note) note.hidden = state.tab !== 'heirs';
    const record = root.querySelector('[data-testid=house-record]');
    if (record) {
      record.hidden = state.tab !== 'deed';
      if (document.getElementById('shopUI')) record.open = false;
    }
  }
  function setStatus(text, second) {
    const a = root.querySelector('[data-testid=house-status]');
    const b = root.querySelector('[data-testid=house-status-2]');
    if (a) a.textContent = text || '';
    if (b) {
      b.hidden = !second;
      b.textContent = second || '';
    }
  }
  function showSeal(text) {
    setStatus('', text || 'Refused. Nothing was signed.');
    hooks.onRefuse?.(text);
  }
  function hideSeal() {
    const b = root.querySelector('[data-testid=house-status-2]');
    if (b && !b.hidden) { b.hidden = true; b.textContent = ''; }
    hooks.hideRefuse?.();
  }
  function vaultFromFields() {
    const chain = root.querySelector('#house-chain')?.value || 'base';
    const asset = (root.querySelector('#house-asset')?.value || (chain === 'btc' ? 'BTC' : 'ETH')).toUpperCase();
    const payee = root.querySelector('#house-payee')?.value?.trim() || '';
    return {
      chain, asset, max_value: '0.05', max_gas: 100000,
      receivers: payee ? [payee] : [],
    };
  }
  function sentence() {
    if (state.tab === 'vaults') {
      const chain = root.querySelector('#house-chain')?.value || 'base';
      const asset = root.querySelector('#house-asset')?.value || 'ETH';
      const amt = root.querySelector('#house-amt')?.value || '';
      const payee = root.querySelector('#house-payee')?.value?.trim() || '';
      const gas = root.querySelector('#house-gas')?.value || '21000';
      const who = payee ? ` to ${payee}` : '';
      return `Send ${amt} ${asset} on ${chain}${who} gas ${gas}`;
    }
    if (state.tab === 'heirs' && state.line?.line?.pending_ns) return 'Cancel the release';
    return "I'm alive";
  }
  async function turn(text) {
    hideSeal();
    const result = await runHouseTurn(text, {
      row: state.row,
      vault: state.tab === 'vaults' ? vaultFromFields() : state.vault,
      line: state.line,
      seen: state.seen,
      showTab,
      showSeal,
      hideRefuse: hideSeal,
      onDelivered: (out) => hooks.onDelivered?.(out),
    });
    if (result?.seal && result.hint) showSeal(result.hint);
    else setStatus(result?.hint || '');
    if (result?.tab) showTab(result.tab);
    return result;
  }
  root.querySelectorAll('[data-tab]').forEach(btn => {
    btn.onclick = () => showTab(btn.dataset.tab);
  });
  const cta = root.querySelector('[data-testid=house-cta]');
  if (cta) cta.onclick = () => turn(sentence());
  showTab(state.tab);

  const dockDoc = typeof document !== 'undefined' ? document : null;
  if (dockDoc) {
    ensureHouseDock(dockDoc);
    installHouseDock(dockDoc);
    armHouseDock((text) => turn(text));
  }

  function paintVault() {
    const rows = state.derived?.rows || [];
    const eth = rows.find(r => r.chain === 'eth');
    const addr = root.querySelector('#house-address');
    if (!addr) return;
    if (eth?.address) addr.value = eth.address;
    else if (state.derivedError) addr.value = 'Signer did not answer.';
    else addr.value = 'Not live yet';
    const bal = root.querySelector('#house-balance');
    if (bal) {
      const purse = nearText(state.purse?.balance);
      bal.value = purse ? `${purse} NEAR in the purse. Foreign balance is not read.` : 'Foreign balance is not read.';
    }
  }
  function paintHeirs() {
    const line = state.line?.line;
    const set = (sel, val) => { const el = root.querySelector(sel); if (el) el.value = val; };
    if (!line) {
      set('#house-check', state.line?.why || 'Inheritance is not on this live deed.');
      set('#house-heir', 'Not set');
      return;
    }
    set('#house-check', line.last_check_in_ns ? `Last check-in ${line.last_check_in_ns}` : 'No check-in yet');
    set('#house-heir', (line.heirs || []).join(', ') || 'Not set');
    set('#house-guardians', (line.guardians || []).join(', ') || 'Not set');
    set('#house-threshold', String(line.threshold ?? '—'));
    set('#house-period', String(line.period_ns ?? '—'));
    set('#house-wait', String(line.wait_ns ?? '—'));
    set('#house-approvals', String((line.approvals || []).length));
    set('#house-countdown', line.pending_ns ? `Waiting since ${line.pending_ns}` : 'No release waiting');
    showTab(state.tab);
  }

  if (!id) {
    if (slot) slot.innerHTML = houseCharterMarkup({});
    return { turn, state };
  }

  let gen = 0;
  const readRow = () => fetch(api() + '/api/board/row/' + encodeURIComponent(id), { cache: 'no-store' })
    .then(r => r.json())
    .then(body => normalizeRow(body));
  function start() {
    const mine = ++gen;
    if (slot) slot.innerHTML = `<div class="house-state" data-testid="house-reading" role="status"><p class="note">Reading the charter row…</p></div>`;
    const job = mine === 1 && hooks.row != null
      ? Promise.resolve(hooks.row).then(body => normalizeRow(body))
      : readRow();
    const timer = setTimeout(() => {
      if (mine !== gen || !slot?.isConnected || !slot.querySelector('[data-testid=house-reading]')) return;
      slot.innerHTML = `<div class="house-state" data-testid="house-row-reason" role="alert"><p class="note">${esc(rowWaitWhy(ROW_WAIT_MS))}</p><p><button type="button" data-testid="house-retry">Try again</button></p></div>`;
      const retry = slot.querySelector('[data-testid=house-retry]');
      if (retry) retry.onclick = () => start();
    }, ROW_WAIT_MS);
    const paint = row => {
      if (mine !== gen || (slot && !slot.isConnected)) return;
      clearTimeout(timer);
      state.row = row;
      if (slot) slot.innerHTML = houseCharterMarkup({ accountId: id, row });
    };
    withRowWait(() => job, ROW_WAIT_MS).then(row => paint(row)).catch(e => {
      if (mine !== gen || (slot && !slot.isConnected)) return;
      clearTimeout(timer);
      if (slot?.querySelector('[data-testid=house-reading]')) {
        const why = e?.code === 'row-wait' ? e.message : `The row could not be read. ${e?.message || 'The charter read did not answer.'} Nothing was signed.`;
        slot.innerHTML = `<div class="house-state" data-testid="house-row-reason" role="alert"><p class="note">${esc(why)}</p><p><button type="button" data-testid="house-retry">Try again</button></p></div>`;
        const retry = slot.querySelector('[data-testid=house-retry]');
        if (retry) retry.onclick = () => start();
      }
    });
  }
  start();

  fetch(api() + '/api/house/deed/' + encodeURIComponent(id), { cache: 'no-store' })
    .then(r => r.ok ? r.json() : null)
    .then(body => {
      const purses = body?.purses || {};
      state.purse = purses[id] || Object.values(purses)[0] || null;
      state.token = body?.token || null;
      paintVault();
    })
    .catch(() => {});
  fetch(api() + '/api/house/derived/' + encodeURIComponent(id), { cache: 'no-store' })
    .then(r => r.ok ? r.json() : Promise.reject(new Error('signer did not answer')))
    .then(body => { state.derived = body; paintVault(); })
    .catch(() => { state.derivedError = 'The signer did not answer. Nothing was signed.'; paintVault(); });
  fetch(api() + '/api/house/line/' + encodeURIComponent(id), { cache: 'no-store' })
    .then(r => r.json())
    .then(body => { state.line = body; paintHeirs(); })
    .catch(() => { state.line = { live: false, why: 'house_line is not on this deed. Nothing was signed.' }; paintHeirs(); });

  state.contract = DEED.contract;
  return { turn, state };
}
