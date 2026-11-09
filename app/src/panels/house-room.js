// City and /shops/house/ tray. Deed, Vaults, Heirs.
// One gold button. The AI Agent calls the same runHouseTurn. Neither signs.

import { visitor } from '../../design/D8_shops/js/session.js';
import { deedMarkup } from './deed.js';
import { charterSetupCta } from './hall-ui.js';
import { BOARD, ROW_WAIT_MS, nearOf, normalizeRow, rowWaitWhy, withRowWait } from './hall.js';
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
      ${field('Derived address', '<input id="house-address" data-testid="house-address" readonly value="Reading the signer…" title="The address Toll signs for on this row.">')}
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
    <details class="house-history" data-testid="house-history"><summary>Every transaction on this deed</summary><div data-testid="house-history-body" role="status">Reading the deed's history…</div></details>
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
  // The mint path is a wallet approval, so the page supplies it. Without it the room still
  // reads the deed and never pretends it could mint.
  const mintDeed = typeof hooks.mintDeed === 'function' ? hooks.mintDeed : () => { throw new Error('Minting needs the wallet. Open this shop from the city.'); };
  state.id = id;
  state.tab = state.tab || 'deed';
  state.seen = state.seen || new Set();
  root.innerHTML = shell();
  bindTokenFallbacks(root);
  const slot = root.querySelector('[data-testid=house-read]');
  const holder = root.querySelector('#house-holder');
  if (holder) {
    holder.value = id || 'Sign in';
    // A 64-char account id cannot fit a 360px field. Without this the value was cut mid-character
    // with no ellipsis and no way to see the end, so the one identity on the deed was unreadable.
    // The input still holds the full value (selectable and copyable); this only makes the cut visible
    // and puts the whole id in the native tooltip.
    if (id) holder.title = id;
  }

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
      // No deed yet: the only useful action is minting one, and the mint plan came with
      // the deed read, so the button names what the press will do.
      if (state.needsMint && state.tab === 'deed') cta.textContent = 'Mint my deed';
      else if (state.tab === 'vaults') cta.textContent = 'Send from house';
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
    // Signed out there is no row owner, so no plan can be built or sent. Say that, in the words a
    // visitor understands, instead of returning a hint about `propose_call_as` — which is what a
    // visitor saw when they pressed the only button on this page.
    if (!id) {
      const hint = 'Sign in first. A deed belongs to an account, and your check-in is sent from your own charter row. Open /setup, sign in, then come back.';
      setStatus(hint);
      return { ok: false, hint };
    }
    const result = await runHouseTurn(text, {
      row: state.row,
      vault: state.tab === 'vaults' ? vaultFromFields() : state.vault,
      line: state.line,
      seen: state.seen,
      account: id || '',
      house: DEED.contract,
      tokenId: state.token?.token_id || id || '',
      board: BOARD,
      nonce: state.row?.nonce,
      epoch: state.row?.epoch ? state.row.epoch : undefined,
      showTab,
      showSeal,
      hideRefuse: hideSeal,
      onDelivered: (out) => hooks.onDelivered?.(out),
    });
    if (result?.seal && result.hint) showSeal(result.hint);
    else setStatus(result?.hint || '');
    if (result?.tab) showTab(result.tab);
    // A plan is only half the job: `runHouseTurn` builds the `propose_call_as` call and never
    // sends it, so "I'm alive" used to end at a hint. When the page supplies an executor, hand
    // the plan over and show what the chain said.
    if (result?.ok && result.call && typeof hooks.houseSend === 'function') {
      setStatus('Sending through the board…');
      try {
        const sent = await hooks.houseSend(result);
        if (sent?.tx) {
          setStatus(sent.ok ? `Sent · ${sent.tx.slice(0, 10)}…` : `${sent.hint || 'Refused.'}`);
          if (sent.ok) hooks.onDelivered?.(sent);
          else hooks.hideRefuse?.();
        } else if (sent?.hint) setStatus(sent.hint);
      } catch (e) {
        setStatus(String(e?.message || e).slice(0, 180) || 'Nothing was signed.');
      }
      return result;
    }
    return result;
  }
  root.querySelectorAll('[data-tab]').forEach(btn => {
    btn.onclick = () => showTab(btn.dataset.tab);
  });
  const cta = root.querySelector('[data-testid=house-cta]');
  if (cta) cta.onclick = async () => {
    // mint_deed reads the predecessor and carries a 0.02 NEAR deposit, so a function-call
    // session key cannot sign it. This is the one House action that needs a wallet approval,
    // once per account; check-in, vault sends and heirs all use the session afterwards.
    if (state.needsMint && state.tab === 'deed') {
      cta.disabled = true;
      setStatus('One approval mints your deed. After that the agent acts with no prompt.');
      try {
        const out = await mintDeed();
        state.needsMint = false; state.token = out.tokenId; state.mintTx = out.tx;
        setStatus(`Deed minted. tx ${String(out.tx).slice(0, 10)}…`);
        paintVault();
      } catch (e) {
        setStatus(String(e?.message || 'The deed was not minted.').slice(0, 170));
      } finally { cta.disabled = false; }
      return;
    }
    return turn(sentence());
  };
  showTab(state.tab);

  const dockDoc = typeof document !== 'undefined' ? document : null;
  if (dockDoc) {
    ensureHouseDock(dockDoc);
    installHouseDock(dockDoc);
    armHouseDock((text) => turn(text));
  }

  function paintVault() {
    // The CTA is renamed here too: minting changes which action the button means, and
    // leaving the label on the mint after a successful mint is how a visitor ends up
    // pressing it twice.
    const ctaBtn = root.querySelector('[data-testid=house-cta]');
    if (ctaBtn && state.tab === 'deed') ctaBtn.textContent = state.needsMint ? 'Mint my deed' : "I'm alive";
    const rows = state.derived?.rows || [];
    const eth = rows.find(r => r.chain === 'eth');
    const addr = root.querySelector('#house-address');
    if (!addr) return;
    if (eth?.address) addr.value = eth.address;
    else if (state.derivedError) addr.value = 'Signer did not answer.';
    else if (state.derived && state.derived.live === false) addr.value = 'No key for this row yet';
    else addr.value = 'Reading the signer…';
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
    // A 404 is a real state, not a failure: the visitor has no deed yet and the body carries
    // the mint plan. Treating it as null left the tray on its "Still opening" fallback with a
    // dead button, which is exactly what a first-time visitor sees.
    .then(r => r.json().catch(() => null))
    .then(body => {
      const purses = body?.purses || {};
      state.purse = purses[id] || Object.values(purses)[0] || null;
      state.token = body?.token || null;
      state.mintPlan = body?.mint || null;
      if (!state.token) state.needsMint = true;
      paintVault();
    })
    .catch(() => { state.deedError = 'The deed did not answer. Nothing was signed.'; paintVault(); });
  fetch(api() + '/api/house/derived/' + encodeURIComponent(id), { cache: 'no-store' })
    .then(r => r.ok ? r.json() : Promise.reject(new Error('signer did not answer')))
    .then(body => { state.derived = body; paintVault(); })
    .catch(() => { state.derivedError = 'The signer did not answer. Nothing was signed.'; paintVault(); });
  fetch(api() + '/api/house/line/' + encodeURIComponent(id), { cache: 'no-store' })
    .then(r => r.json())
    .then(body => { state.line = body; paintHeirs(); })
    .catch(() => { state.line = { live: false, why: 'house_line is not on this deed. Nothing was signed.' }; paintHeirs(); });
  // The NFT track asks for a history per deed. Every row here is a real transaction, linked.
  fetch(api() + '/api/house/history/' + encodeURIComponent(id), { cache: 'no-store' })
    .then(r => r.json())
    .then(body => {
      const box = root.querySelector('[data-testid=house-history-body]');
      if (!box) return;
      const rows = body?.rows || [];
      if (!rows.length) {
        box.innerHTML = esc(body?.note || body?.gap || 'No transactions touch this deed yet.');
        return;
      }
      // A bad timestamp must never take the panel down: `toISOString` throws RangeError on an
      // invalid date, and that is exactly what happened when the units were wrong.
      const when = (ms) => {
        const n = Number(ms);
        if (!Number.isFinite(n) || n <= 0) return '';
        const d = new Date(n);
        return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
      };
      box.innerHTML = `<ol class="house-hist-list">${rows.map(r => `<li data-testid="house-hist-row"><b>${esc(r.what)}</b> <span class="muted">${esc(when(r.at))}</span> <a href="https://nearblocks.io/txns/${esc(r.hash)}" target="_blank" rel="noopener" title="${esc(r.method)}">${esc(String(r.hash).slice(0, 10))}… ↗</a></li>`).join('')}</ol>`
        + (body?.gap ? `<p class="small muted">${esc(body.gap)}</p>` : '');
    })
    .catch(() => {
      const box = root.querySelector('[data-testid=house-history-body]');
      if (box) box.innerHTML = 'The history did not answer. Nothing was signed.';
    });

  state.contract = DEED.contract;
  return { turn, state };
}
