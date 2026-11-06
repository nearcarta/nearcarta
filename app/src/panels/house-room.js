// City and /shops/house/ tray: Deed, Purse, Guardians.
// The deed links and the charter row stay in the Deed tab.
// A session pay uses the caller's ask hook (board propose). This file does not sign.

import { visitor } from '../../design/D8_shops/js/session.js';
import { deedMarkup } from './deed.js';
import { charterSetupCta } from './hall-ui.js';
import { ROW_WAIT_MS, nearOf, normalizeRow, rowWaitWhy, withRowWait } from './hall.js';
import { DEED } from '../deed-control.js';
import { runHouseTurn } from './house-agent.js';
import { armHouseDock, ensureHouseDock, installHouseDock } from './house-dock.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = () => (globalThis.NEARCARTA_API || '').replace(/\/$/, '');

const ICO = {
  deed: '<svg class="house-ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="8" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M11 12h9M16 12v3M19 12v2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  purse: '<svg class="house-ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><ellipse cx="12" cy="8" rx="7" ry="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 8v8c0 1.7 3.1 3 7 3s7-1.3 7-3V8" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  guard: '<svg class="house-ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3l7 3v6c0 4.2-2.8 7.2-7 9-4.2-1.8-7-4.8-7-9V6l7-3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
};

export function houseCharterMarkup({ accountId = '', row = null, failed = false } = {}) {
  if (row && row.per_action_cap != null && row.per_action_cap !== '') {
    const cap = nearOf(row.per_action_cap);
    const owner = accountId || row.owner || '';
    return `<div class="house-state" data-testid="house-state" role="status"><p>This account has a charter row on the board.</p><p>Max per payment <b data-testid="house-cap">${esc(cap)}</b> NEAR.</p><p>The next step is Town Hall, where that cap can be changed. Nothing was signed here.</p><p><a class="primary" href="/shops/hall/?owner=${encodeURIComponent(owner)}">Open Town Hall</a></p></div>`;
  }
  if (failed) {
    return `<div class="house-empty" data-testid="house-empty" role="status"><p>The charter read did not answer.</p><p>Try again in a moment. The buttons above are the public deed record. Nothing was signed.</p></div>`;
  }
  if (accountId) {
    return charterSetupCta({ accountId, note: 'This account has no charter row. Nothing was signed.' });
  }
  return `<div class="house-empty" data-testid="house-empty" role="status"><p>Sign in to read your charter row.</p><p>The buttons above are the public deed record. Nothing was signed.</p><p><a class="primary" href="/setup/?next=%2Fshops%2Fhouse%2F">Sign in</a></p></div>`;
}

function tabBtn(id, label, icon, on) {
  return `<button type="button" class="house-tab" role="tab" data-tab="${id}" aria-selected="${on ? 'true' : 'false'}" data-testid="house-tab-${id}">${icon}<span>${label}</span></button>`;
}

function shell() {
  return `<div id="house" class="house-room" data-testid="house-room">
    <div class="house-tabs" role="tablist">${tabBtn('deed', 'Deed', ICO.deed, true)}${tabBtn('purse', 'Purse', ICO.purse, false)}${tabBtn('guardians', 'Guardians', ICO.guard, false)}</div>
    <div class="house-panel" data-panel="deed" data-testid="house-panel-deed">${deedMarkup()}<div data-testid="house-read"></div></div>
    <div class="house-panel" data-panel="purse" data-testid="house-panel-purse" hidden></div>
    <div class="house-panel" data-panel="guardians" data-testid="house-panel-guardians" hidden></div>
    <p class="house-seal" data-testid="house-seal" role="alert" hidden></p>
    <p class="house-hint" data-testid="house-hint"></p>
  </div>`;
}

function nearText(y) {
  if (y == null || y === '') return '–';
  try { return String(nearOf(y)); } catch { return '–'; }
}

function purseHtml(state) {
  const p = state.purse;
  const receivers = state.row?.receivers || [];
  const opts = receivers.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
  const figures = p
    ? `<p data-testid="house-purse">Purse <b>${esc(nearText(p.balance))}</b> NEAR. Cap <b data-testid="house-purse-cap">${esc(nearText(p.cap))}</b> NEAR a payment. Paid ${esc(nearText(p.paid))} in ${esc(p.pays ?? 0)}.</p>`
    : `<p data-testid="house-purse">No deed purse for this account yet. The public deed record is on the Deed tab.</p>`;
  return `${figures}
    <p>Pay from your charter row with the session key. The deed purse is separate: house_pay needs 1 yocto from the holder, and this key cannot attach NEAR.</p>
    <div class="house-fields">
      <label>Amount<input id="house-amt" data-testid="house-amt" inputmode="decimal" value="0.001" autocomplete="off"></label>
      <label>To<select id="house-to" data-testid="house-to">${opts || '<option value="">No payee on the row</option>'}</select></label>
    </div>
    <button type="button" class="house-cta" data-testid="house-pay">Pay from my row</button>`;
}

function guardiansHtml(state) {
  const rows = state.derived?.rows || [];
  const keys = rows.length
    ? rows.map(r => `<p class="house-key" data-testid="house-derived-${esc(r.chain)}"><b>${r.chain === 'eth' ? 'Ethereum' : 'Bitcoin'}</b> · path ${esc(r.path)} · predecessor ${esc(r.predecessor)} · domain ${esc(r.domain_id)}<br>${r.address ? esc(r.address) : 'No address on this page.'}<br>${esc(r.public_key || r.note || '')}</p>`).join('')
    : `<p data-testid="house-derived-wait">${esc(state.derivedError || 'Reading the signer…')}</p>`;
  const line = state.line;
  const live = line?.live
    ? `<p data-testid="house-line">Check-in is on this contract. Last check-in ${esc(line.line?.last_check_in_ns || '0')}.</p>`
    : `<p data-testid="house-line">${esc(line?.why || 'Inheritance is prepared in the contract source. This live deed has no house_line view. Nothing was signed.')}</p>`;
  return `${keys}${live}
    <ul class="house-notes" data-testid="house-failures">
      <li>Lost guardian keys: a release never starts. The purse stays with the deed holder.</li>
      <li>A hostile guardian: one voice is not enough when the threshold is higher. The owner can cancel until the wait ends.</li>
      <li>The owner is alive but offline: check-in, or cancel during the wait. Nothing releases by itself. Someone must send the transaction.</li>
    </ul>
    <button type="button" class="house-cta" data-testid="house-checkin">Check in</button>`;
}

export function mountHouseRoom(root, hooks = {}) {
  if (!root) return;
  const who = typeof hooks.visitor === 'function' ? hooks.visitor() : visitor();
  const params = new URLSearchParams(globalThis.location?.search || '');
  const id = params.get('owner') || who.accountId || '';
  const state = hooks.state || (hooks.state = {});
  state.id = id;
  state.tab = state.tab || 'deed';
  root.innerHTML = shell();
  const slot = root.querySelector('[data-testid=house-read]');

  function showTab(name) {
    state.tab = name || 'deed';
    root.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== state.tab; });
    root.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === state.tab ? 'true' : 'false'));
  }
  function setHint(text) {
    const el = root.querySelector('[data-testid=house-hint]');
    if (el) el.textContent = text || '';
  }
  function showSeal(text) {
    const el = root.querySelector('[data-testid=house-seal]');
    if (el) { el.hidden = !text; el.textContent = text || ''; }
    hooks.onRefuse?.(text);
  }
  function hideSeal() {
    const el = root.querySelector('[data-testid=house-seal]');
    if (el) { el.hidden = true; el.textContent = ''; }
    hooks.hideRefuse?.();
  }
  function paintPurse() {
    const panel = root.querySelector('[data-panel=purse]');
    if (!panel) return;
    panel.innerHTML = purseHtml(state);
    const go = panel.querySelector('[data-testid=house-pay]');
    if (go) go.onclick = () => {
      const amt = panel.querySelector('#house-amt')?.value || '0.001';
      const to = panel.querySelector('#house-to')?.value || '';
      const text = to ? `Pay ${amt} NEAR to ${to}` : `Pay ${amt} NEAR`;
      turn(text);
    };
  }
  function paintGuardians() {
    const panel = root.querySelector('[data-panel=guardians]');
    if (!panel) return;
    panel.innerHTML = guardiansHtml(state);
    const go = panel.querySelector('[data-testid=house-checkin]');
    if (go) go.onclick = () => turn('Check in');
  }
  async function turn(text) {
    hideSeal();
    const result = await runHouseTurn(text, {
      row: state.row,
      showTab,
      showSeal,
      hideRefuse: hideSeal,
      onDelivered: (out) => hooks.onDelivered?.(out),
      ask: hooks.ask,
    });
    if (result?.seal && result.hint) showSeal(result.hint);
    setHint(result?.hint || '');
    if (result?.action === 'propose' || result?.tab === 'purse') paintPurse();
    if (result?.tab) showTab(result.tab);
    return result;
  }
  root.querySelectorAll('[data-tab]').forEach(btn => {
    btn.onclick = () => showTab(btn.dataset.tab);
  });
  paintPurse();
  paintGuardians();
  showTab(state.tab);

  const dockDoc = typeof document !== 'undefined' ? document : null;
  if (dockDoc) {
    ensureHouseDock(dockDoc);
    installHouseDock(dockDoc);
    armHouseDock((text) => turn(text));
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
    if (slot) slot.innerHTML = `<div class="house-state" data-testid="house-reading" role="status"><p>Reading the charter row…</p></div>`;
    const job = mine === 1 && hooks.row != null
      ? Promise.resolve(hooks.row).then(body => normalizeRow(body))
      : readRow();
    const timer = setTimeout(() => {
      if (mine !== gen || !slot?.isConnected || !slot.querySelector('[data-testid=house-reading]')) return;
      slot.innerHTML = `<div class="house-state" data-testid="house-row-reason" role="alert"><p>${esc(rowWaitWhy(ROW_WAIT_MS))}</p><p><button type="button" class="house-cta" data-testid="house-retry">Try again</button></p></div>`;
      const retry = slot.querySelector('[data-testid=house-retry]');
      if (retry) retry.onclick = () => start();
    }, ROW_WAIT_MS);
    const paint = row => {
      if (mine !== gen || (slot && !slot.isConnected)) return;
      clearTimeout(timer);
      state.row = row;
      if (slot) slot.innerHTML = houseCharterMarkup({ accountId: id, row });
      paintPurse();
    };
    withRowWait(() => job, ROW_WAIT_MS).then(row => paint(row)).catch(e => {
      if (mine !== gen || (slot && !slot.isConnected)) return;
      clearTimeout(timer);
      if (slot?.querySelector('[data-testid=house-reading]')) {
        const why = e?.code === 'row-wait' ? e.message : `The row could not be read. ${e?.message || 'The charter read did not answer.'} Nothing was signed.`;
        slot.innerHTML = `<div class="house-state" data-testid="house-row-reason" role="alert"><p>${esc(why)}</p><p><button type="button" class="house-cta" data-testid="house-retry">Try again</button></p></div>`;
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
      paintPurse();
    })
    .catch(() => {});
  fetch(api() + '/api/house/derived/' + encodeURIComponent(id), { cache: 'no-store' })
    .then(r => r.ok ? r.json() : Promise.reject(new Error('signer did not answer')))
    .then(body => { state.derived = body; paintGuardians(); })
    .catch(() => { state.derivedError = 'The signer did not answer. Nothing was signed.'; paintGuardians(); });
  fetch(api() + '/api/house/line/' + encodeURIComponent(id), { cache: 'no-store' })
    .then(r => r.json())
    .then(body => { state.line = body; paintGuardians(); })
    .catch(() => { state.line = { live: false, why: 'house_line is not on this deed. Nothing was signed.' }; paintGuardians(); });

  state.contract = DEED.contract;
  return { turn, state };
}
