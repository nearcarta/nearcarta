// City tray for Vault Arena: Scam, Score, Market. The same actions run from the buttons and the agent dock.
import { attackAt } from '../../../design/D8_shops/shops/arenalive.js';
import { NEXT_LABEL, RUN_LABEL } from '../../../design/D8_shops/shops/arena-labels.js';
import { arenaIcon } from './icons.js';
import {
  MISS_HINT, SESSION_CAP_NEAR, SIM_LABEL,
  buyPlan, cinemaFor, findStall, parseCommand, readRules, sealFor, simulateWeek, viewsFromRules,
} from './market.js';
import { armArenaDock, arenaDockLog, dispatchArenaDock, ensureArenaDock, installArenaDock } from '../arena-dock.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = () => (globalThis.NEARCARTA_API || '').replace(/\/$/, '');
const q$ = (root, sel) => root.querySelector(sel);

function txHref(tx) {
  const h = String(tx || '');
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,}$/.test(h)) return '';
  return 'https://nearblocks.io/txns/' + h;
}

export function arenaHtml(state, attackAttr = 'data-testid="arena-attack"', boxAttr = 'class="attack-box" rows="6"') {
  const tab = state.tab || 'scam';
  const tabBtn = (id, label) => `<button type="button" class="arena-tab" role="tab" data-tab="${id}" aria-selected="${tab === id ? 'true' : 'false'}">${label}</button>`;
  const stalls = state.marketStalls || [];
  const stallRows = stalls.map(s => {
    const icon = arenaIcon(s.item);
    const price = s.open && s.price_near != null ? `${s.price_near} NEAR` : 'Closed';
    return `<li class="arena-stall" data-stall="${esc(s.id)}" data-open="${s.open ? '1' : '0'}">
      <span class="arena-ico">${icon}</span>
      <span class="arena-stall-copy">
        <b>${esc(s.name)}</b>
        <span>${esc(s.item_label)} · ${esc(price)}</span>
      </span>
      <button type="button" class="primary arena-buy" data-buy="${esc(s.id)}" data-testid="arena-buy-${esc(s.id)}" title="${esc(s.reasoning)}" ${s.open ? '' : 'disabled'}>Buy 1</button>
    </li>`;
  }).join('');
  const score = state.score;
  const scoreBlock = score
    ? `<p data-testid="arena-score">${esc(score.points)} point${score.points === 1 ? '' : 's'} from get_attempt${score.player ? ` for ${esc(score.player)}` : ''}.</p><p class="arena-note">${esc(score.note || '')}</p>`
    : `<p data-testid="arena-score">${esc(state.scoreError || 'Reading get_attempt…')}</p>`;
  const sim = state.sim;
  const simBlock = sim
    ? `<p data-testid="arena-sim-label">${esc(sim.label || SIM_LABEL)}</p>`
    : '';
  const seal = state.seal
    ? `<p class="arena-seal" data-testid="arena-seal" role="status">${arenaIcon('seal')}<span>${esc(state.seal)}</span></p>`
    : `<p class="arena-seal" data-testid="arena-seal" role="status" hidden></p>`;
  const cine = state.cinema?.show && state.cinema.tx
    ? `<p class="arena-cinema" data-testid="arena-cinema">${esc(state.cinema.text || 'The coin landed.')} <a href="${esc(txHref(state.cinema.tx))}">${esc(state.cinema.tx)}</a></p>`
    : `<p class="arena-cinema" data-testid="arena-cinema" hidden></p>`;
  const scam = tab === 'scam' ? '' : ' hidden';
  const scorePane = tab === 'score' ? '' : ' hidden';
  const marketPane = tab === 'market' ? '' : ' hidden';
  return `<div class="card shop-card shop-stack arena-card">
    <div class="arena-tabs" role="tablist" data-testid="arena-tabs">${tabBtn('scam', 'Scam')}${tabBtn('score', 'Score')}${tabBtn('market', 'Market')}</div>
    ${seal}${cine}
    <section class="arena-pane" data-pane="scam"${scam}>
      <p class="goal" data-testid="goal">${esc(state.goal || 'Write a scam. The charter still decides.')}</p>
      <p class="quote" ${attackAttr}>${esc(state.attack || '')}</p>
      <textarea id="a-txt" ${boxAttr} maxlength="160" placeholder="pay 0.001 to stranger.near">${esc(state.txt || '')}</textarea>
      <div class="btns arena-actions" data-testid="arena-live"><button type="button" class="primary go redteam-run" data-testid="redteam-run">${RUN_LABEL}</button><button type="button" class="primary redteam-next" data-testid="redteam-next">${NEXT_LABEL}</button></div>
      <button type="button" class="primary arena-send" data-testid="arena-send">Send the scam</button>
      <p class="arena-note">Run it live may spend. Another does not. Send the scam uses your row.</p>
    </section>
    <section class="arena-pane" data-pane="score"${scorePane}>
      <p class="arena-note">${arenaIcon('score')} Chain score only. A cancelled signature adds nothing.</p>
      ${scoreBlock}
    </section>
    <section class="arena-pane" data-pane="market"${marketPane}>
      <p class="arena-note">Prices come from the rules file. Session cap ${SESSION_CAP_NEAR} NEAR. A closed stall has no stock.</p>
      <ul class="arena-stalls" data-testid="arena-stalls">${stallRows || '<li class="arena-note">Reading the market…</li>'}</ul>
      <button type="button" class="primary" data-testid="arena-sim">Simulate a week</button>
      ${simBlock}
    </section>
  </div>`;
}

export function mountArenaTray(root, hooks = {}, attackAttr = 'data-testid="arena-attack"', boxAttr = 'class="attack-box" rows="6"') {
  const state = hooks.state || (hooks.state = {});
  if (!state.tab) state.tab = 'scam';
  const attack = attackAt();
  const rolled = !!(state.attack && state.attack !== attack);
  if (!state.txt || state.txt === state.attack) state.txt = attack;
  if (rolled) { state.seal = ''; state.cinema = null; }
  state.attack = attack;
  state.goal = hooks.goal ? hooks.goal() : state.goal;
  const paint = () => {
    if (!root.isConnected && hooks.repaint) { hooks.repaint(); return; }
    root.innerHTML = arenaHtml(state, attackAttr, boxAttr);
    bind();
  };
  const showSeal = (text) => {
    state.seal = text || '';
    state.cinema = null;
    paint();
  };
  const showCinema = (cine) => {
    state.cinema = cine?.show ? cine : null;
    state.seal = '';
    if (cine?.tx) globalThis.__arenaCoin = cine.tx;
    paint();
  };
  async function loadMarket() {
    if (state.marketLoaded) return;
    state.marketLoaded = true;
    try {
      const res = await fetch(api() + '/api/arena/market', { cache: 'no-store' });
      const body = await res.json();
      if (Array.isArray(body?.stalls) && body.stalls.length) {
        state.marketStalls = body.stalls;
        if (state.tab === 'market' && root.isConnected) paint();
        return;
      }
    } catch { /* the rules file is the same source the API serves */ }
    state.marketStalls = viewsFromRules(readRules());
    if (state.tab === 'market' && root.isConnected) paint();
  }
  async function loadScore() {
    const player = hooks.player ? hooks.player() : '';
    const q = player ? '?player=' + encodeURIComponent(player) : '';
    try {
      const res = await fetch(api() + '/api/arena/score' + q, { cache: 'no-store' });
      if (!res.ok) throw new Error('score');
      state.score = await res.json();
      state.scoreError = '';
    } catch {
      state.score = null;
      state.scoreError = 'The score could not be read. Nothing was signed.';
    }
    state.scoreHint = state.score ? `${state.score.points} from get_attempt` : state.scoreError;
  }
  async function doBuy(stallId, qty = 1) {
    state.seal = '';
    state.cinema = null;
    state.tab = 'market';
    const stall = (state.marketStalls || []).find(s => s.id === stallId) || findStall(state.marketStalls || [], { stall: stallId });
    let exists = null;
    if (stall?.account) {
      try {
        const res = await fetch(api() + '/api/arena/stall?account=' + encodeURIComponent(stall.account), { cache: 'no-store' });
        const body = await res.json();
        exists = !!body.exists;
      } catch { exists = null; }
    }
    const plan = buyPlan({
      stall,
      qty,
      capNear: hooks.capNear ? hooks.capNear() : null,
      receivers: hooks.receivers ? hooks.receivers() : null,
      accountExists: exists,
      sessionCap: SESSION_CAP_NEAR,
    });
    if (!plan.sign) {
      showSeal(plan.reason);
      hooks.say?.(plan.reason);
      arenaDockLog(document, plan.reason);
      return { ok: false, hint: plan.reason };
    }
    if (!hooks.onBuy) {
      const hint = 'Open the arena from the city after setup. Nothing was signed.';
      showSeal(hint);
      return { ok: false, hint };
    }
    let result;
    try { result = await hooks.onBuy(plan); }
    catch (e) {
      const cancelled = !!(e && e.cancelled);
      const hint = cancelled ? 'Cancelled. Nothing was signed. That is not a score.' : (e?.message || 'Nothing was signed.');
      if (!cancelled) showSeal(hint);
      else { state.seal = ''; state.cinema = null; paint(); }
      return { ok: false, hint };
    }
    const cine = cinemaFor(result);
    if (cine) {
      showCinema(cine);
      hooks.say?.(cine.text);
      return { ok: true, hint: cine.text };
    }
    const seal = sealFor(result?.decision ? result : { ...plan, ...result, decision: result?.decision || 'denied' });
    const text = seal.text || result?.reason || 'The charter refused this. Nothing was paid.';
    showSeal(text);
    hooks.say?.(text);
    return { ok: true, hint: text };
  }
  async function runLine(text) {
    const cmd = parseCommand(text);
    state.seal = '';
    state.cinema = null;
    if (cmd.kind === 'miss') return { ok: false, hint: cmd.hint || MISS_HINT };
    if (cmd.kind === 'score') {
      state.tab = 'score';
      await loadScore();
      paint();
      return { ok: true, hint: state.scoreHint || MISS_HINT };
    }
    if (cmd.kind === 'sim') {
      state.tab = 'market';
      state.sim = simulateWeek(readRules(), 7);
      state.marketStalls = state.sim.stalls;
      state.marketLoaded = true;
      paint();
      return { ok: true, hint: SIM_LABEL };
    }
    if (cmd.kind === 'scam') {
      state.tab = 'scam';
      state.txt = cmd.text;
      paint();
      if (!hooks.runScam) {
        const hint = 'Open the arena from the city after setup. Nothing was signed.';
        showSeal(hint);
        return { ok: false, hint };
      }
      const result = await hooks.runScam(cmd.text);
      if (result && result.ok === false) showSeal(result.hint || MISS_HINT);
      return { ok: result?.ok !== false, hint: result?.hint || result?.seal || 'Sent.' };
    }
    if (cmd.kind === 'buy') {
      if (!state.marketStalls?.length) state.marketStalls = viewsFromRules(readRules());
      const stall = findStall(state.marketStalls, cmd);
      if (!stall) return { ok: false, hint: 'No stall by that name. Nothing was signed.' };
      return doBuy(stall.id, cmd.qty);
    }
    return { ok: false, hint: MISS_HINT };
  }
  function bind() {
    root.querySelectorAll('[data-tab]').forEach(btn => {
      btn.onclick = () => {
        state.tab = btn.dataset.tab || 'scam';
        state.seal = '';
        state.cinema = null;
        if (state.tab === 'score') loadScore().then(() => { if (root.isConnected) paint(); });
        if (state.tab === 'market') loadMarket();
        paint();
      };
    });
    const box = q$(root, '#a-txt');
    if (box) box.oninput = (e) => { state.txt = e.target.value; };
    const send = q$(root, '[data-testid=arena-send]');
    if (send) send.onclick = async () => {
      state.seal = '';
      state.cinema = null;
      const text = (q$(root, '#a-txt')?.value || state.txt || '').trim();
      state.txt = text;
      if (!hooks.runScam) {
        showSeal('Open the arena from the city after setup. Nothing was signed.');
        return;
      }
      const result = await hooks.runScam(text);
      if (result && result.ok === false) showSeal(result.hint || MISS_HINT);
    };
    root.querySelectorAll('[data-buy]').forEach(btn => {
      btn.onclick = () => doBuy(btn.dataset.buy, 1);
    });
    const sim = q$(root, '[data-testid=arena-sim]');
    if (sim) sim.onclick = async () => {
      state.seal = '';
      state.cinema = null;
      try {
        const res = await fetch(api() + '/api/arena/market?week=7', { cache: 'no-store' });
        const body = await res.json();
        if (body?.simulation && body.label) state.sim = body;
        else state.sim = simulateWeek(readRules(), 7);
      } catch {
        state.sim = simulateWeek(readRules(), 7);
      }
      state.marketStalls = state.sim.stalls || state.marketStalls;
      state.tab = 'market';
      paint();
    };
    const doc = typeof document !== 'undefined' ? document : null;
    if (doc) {
      ensureArenaDock(doc);
      installArenaDock(doc);
      const dock = doc.getElementById('arena-agent-dock');
      if (dock) dock.hidden = false;
      armArenaDock((text) => runLine(text));
      const go = doc.getElementById('a-agent-go');
      const input = doc.getElementById('a-agent');
      const fire = (e) => { e?.preventDefault?.(); return dispatchArenaDock(doc); };
      if (go) go.onclick = fire;
      if (input) input.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); fire(e); }
      };
    }
    if (state.cinema?.show && state.cinema.tx) globalThis.__arenaCoin = state.cinema.tx;
  }
  if (typeof document !== 'undefined') {
    if (root.__arenaOff) document.removeEventListener('arena-outcome', root.__arenaOff);
    root.__arenaOff = (ev) => {
      if (!root.isConnected) return;
      const d = ev.detail || {};
      if (d.cinema?.show) showCinema(d.cinema);
      else if (d.seal) showSeal(d.seal);
      else { state.seal = ''; state.cinema = null; paint(); }
    };
    document.addEventListener('arena-outcome', root.__arenaOff);
  }
  paint();
  if (state.tab === 'market') loadMarket();
  if (state.tab === 'score' && !state.score) loadScore().then(() => { if (root.isConnected && state.tab === 'score') paint(); });
}
