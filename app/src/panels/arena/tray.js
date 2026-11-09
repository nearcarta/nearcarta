// City tray for Vault Arena. Guardians, Attack, and Score use the Ferry card.
// Mint and Attack call the same planner as the agent dock. Neither signs.
import { attackAt, advanceAttack } from '../../../design/D8_shops/shops/arenalive.js';
import { NEXT_LABEL } from '../../../design/D8_shops/shops/arena-labels.js';
import { tokenStack } from '../token-badge.js';
import {
  cinemaFor, execute, parseCommand, planAttack, planFeed, planFromCommand, planMint, planWithdraw, sealFor, simulateWeek,
} from './economy.js';
import { armArenaDock, arenaDockLog, ensureArenaDock, installArenaDock } from '../arena-dock.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = () => (globalThis.NEARCARTA_API || '').replace(/\/$/, '');
const q$ = (root, sel) => root.querySelector(sel);
const near = () => tokenStack('NEAR', 'near', { size: 48, chainSize: 16 });

function txHref(tx) {
  const h = String(tx || '');
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,}$/.test(h)) return '';
  return 'https://nearblocks.io/txns/' + h;
}

function flow(left, right) {
  return `<div class="ferry-flow" aria-hidden="true">${near()}<span class="ferry-flow-arrow">→</span>${near()}</div>
    <p class="arena-flow-caption">${esc(left)} <span>→</span> ${esc(right)}</p>`;
}

function field(label, control) {
  return `<label class="ferry-field">${esc(label)}${control}</label>`;
}

function input(name, value, placeholder) {
  return `<input name="${name}" value="${esc(value || '')}" placeholder="${esc(placeholder || '')}" autocomplete="off">`;
}

export function arenaHtml(state, attackAttr = 'data-testid="arena-attack"', boxAttr = 'class="attack-box" rows="6"') {
  const tab = state.tab || 'guardians';
  const mode = state.mode || 'mint';
  const tabBtn = (id, label) => `<button type="button" class="ferry-tab" role="tab" data-tab="${id}" aria-selected="${tab === id ? 'true' : 'false'}">${label}</button>`;
  const guardians = Array.isArray(state.guardians) ? state.guardians : [];
  // A creator is a 64-hex account id. Printed whole in a 340px list it wraps to two lines and
  // reads as noise; the full value is still the option value, so nothing is lost.
  const shortId = s => { const t = String(s || ''); return t.length > 18 ? `${t.slice(0, 8)}…${t.slice(-6)}` : t; };
  const brief = g => (g.pot == null || g.pot === '—')
    ? esc(shortId(g.creator) || 'on the deployed contract')
    : `pot ${esc(g.pot)} NEAR · fee ${esc(g.fee)} NEAR`;
  const options = guardians.length
    ? guardians.map(g => `<option value="${esc(g.id)}"${String(state.attackId || state.feedId || '') === String(g.id) ? ' selected' : ''}>${esc(g.title || ('Guardian ' + g.id))} · ${brief(g)}</option>`).join('')
    : '<option value="">No guardian yet</option>';
  const modeBtn = (id, label) => `<button type="button" class="arena-mode" data-mode="${id}" aria-pressed="${mode === id ? 'true' : 'false'}">${label}</button>`;
  const mintFields = mode === 'feed'
    ? field('Guardian', `<select name="feedId">${options}</select>`) + field('Feed', `<span class="amt-row">${input('feedAmt', state.feedAmt, '0.01')}<span>NEAR</span></span>`)
    : mode === 'withdraw'
      ? field('Earnings', `<span class="amt-row">${input('withdrawAmt', state.withdrawAmt, '0.001')}<span>NEAR</span></span>`)
      : field('Title', input('title', state.title, 'Lamp'))
        + field('Persona', input('persona', state.persona, 'Keeps the oath'))
        // Real values, not placeholders. These four used to render a placeholder that looked
        // like a filled value while state kept them empty, so pressing Mint guardian refused
        // with "Set a cap, a pot, and a fee" on a form that appeared complete.
        + field('Oath cap', `<span class="amt-row">${input('cap', state.cap ?? '0.01', '0.01')}<span>NEAR</span></span>`)
        + field('Pot', `<span class="amt-row">${input('pot', state.pot ?? '0.04', '0.04')}<span>NEAR</span></span>`)
        + field('Entry fee', `<span class="amt-row">${input('fee', state.fee ?? '0.001', '0.001')}<span>NEAR</span></span>`)
        + field('Creator split', input('split', state.split ?? '2000', '2000'));
  const cta = mode === 'feed' ? 'Feed guardian' : mode === 'withdraw' ? 'Withdraw earnings' : 'Mint guardian';
  const selected = guardians.find(g => String(g.id) === String(state.attackId)) || guardians[0] || null;
  const feeText = selected ? `${selected.fee} NEAR` : 'Set when a guardian exists';
  const score = state.score || {};
  const badges = Array.isArray(state.badges) ? state.badges : [];
  const lines = [state.status, state.status2].filter(Boolean).slice(0, 2);
  const status = lines.map(line => {
    const href = txHref(state.tx);
    const body = href && String(line).includes(state.tx) ? esc(line).replace(esc(state.tx), `<a href="${href}">${esc(state.tx)}</a>`) : esc(line);
    return `<p class="arena-status">${body}</p>`;
  }).join('');
  const list = state.listError
    ? ''
    : guardians.length
      ? `<ul class="arena-guardians">${guardians.map(g => `<li><b>${esc(g.title || g.id)}</b> · ${brief(g)}</li>`).join('')}</ul>`
      : '<p class="arena-status">No guardian is on this contract yet.</p>';
  return `<div class="ferry-card" data-testid="arena-live">
    <div class="ferry-tabs" role="tablist">${tabBtn('guardians', 'Guardians')}${tabBtn('attack', 'Attack')}${tabBtn('score', 'Score')}</div>
    <div class="ferry-pane" data-pane="guardians" ${tab === 'guardians' ? '' : 'hidden'}>
      ${flow('Entry', 'Pot')}
      <div class="arena-modes">${modeBtn('mint', 'Mint')}${modeBtn('feed', 'Feed')}${modeBtn('withdraw', 'Withdraw')}</div>
      ${mintFields}
      <div class="arena-actions"><button type="button" class="primary ferry-cta" data-act="guardian">${cta}</button></div>
      ${list}
    </div>
    <div class="ferry-pane" data-pane="attack" ${tab === 'attack' ? '' : 'hidden'}>
      ${flow('Fee', 'Pot')}
      ${field('Guardian', `<select name="attackId">${options}</select>`)}
      <p class="arena-attack" ${attackAttr}>${esc(state.practice || attackAt())}</p>
      ${field('Message', `<textarea id="a-txt" name="message" ${boxAttr}>${esc(state.message || '')}</textarea>`)}
      ${field('Live fee', `<input name="liveFee" value="${esc(feeText)}" readonly>`)}
      <div class="arena-actions">
        <button type="button" class="primary ferry-cta" data-act="attack" data-testid="redteam-run">Attack guardian</button>
        <button type="button" class="arena-next" data-testid="redteam-next">${esc(NEXT_LABEL)}</button>
      </div>
    </div>
    <div class="ferry-pane" data-pane="score" ${tab === 'score' ? '' : 'hidden'}>
      ${flow('Winnings', 'Badge')}
      ${field('Winnings', `<input value="${esc(score.points ?? 0)} from get_attempt" readonly>`)}
      ${field('Badges', `<input value="${esc(badges.length ? badges.join(', ') : 'None yet')}" readonly>`)}
      ${field('Explorer', `<input value="${esc(state.player ? 'nearblocks.io/address/' + state.player : 'Sign in to see your row')}" readonly>`)}
      <div class="arena-actions"><button type="button" class="arena-next" data-act="sim">Simulate a week</button></div>
    </div>
    <div class="arena-lines">${status}</div>
  </div>`;
}

export function mountArenaTray(root, hooks = {}, attackAttr, boxAttr) {
  const state = hooks.state || (hooks.state = {});
  if (!state.tab) state.tab = 'guardians';
  if (!state.mode) state.mode = 'mint';
  if (!state.practice) state.practice = attackAt();
  installArenaDock(document);
  ensureArenaDock(document);

  const read = () => {
    for (const el of root.querySelectorAll('input, textarea, select')) {
      if (!el.name) continue;
      state[el.name] = el.value;
    }
  };
  const paint = () => {
    root.innerHTML = arenaHtml(state, attackAttr, boxAttr);
    arm();
  };
  const show = (result) => {
    const seal = sealFor(result);
    const cinema = cinemaFor(result);
    state.tx = cinema?.tx || null;
    state.status = seal.show ? seal.text : (result?.simulation ? result.label : (cinema?.text || ''));
    // A duplicate note says nothing was signed, so it cannot sit next to a real tx. Measured
    // 2026-11-08: feeding a guardian twice showed "The coin landed." AND "Already planned.
    // Nothing was signed." on the same row, while tx 6DAG7vn8… had landed. A line that
    // contradicts the one beside it is worse than no line.
    state.status2 = result?.duplicate && !cinema?.tx
      ? 'Already planned. Nothing was signed.'
      : (result?.duplicate ? 'Sent once. It was not sent again.'
        : (result?.note && result.note !== state.status ? result.note : ''));
    if (state.status2 === state.status) state.status2 = '';
    globalThis.__arenaCoin = cinema?.tx || '';
    if (hooks.say) hooks.say([state.status, state.status2].filter(Boolean).slice(0, 2).join(' '));
    paint();
  };
  const act = async (plan) => {
    const result = hooks.act ? await hooks.act(plan) : execute(plan);
    if (result?.guardians) state.guardians = result.guardians;
    show(result);
    return result;
  };
  const arm = () => {
    armArenaDock(async (text) => {
      const cmd = parseCommand(text);
      if (cmd.kind === 'score') {
        state.tab = 'score';
        await loadScore();
        paint();
        return { ok: true, hint: state.status || 'Score is on the Score tab.' };
      }
      const plan = planFromCommand(cmd, state.guardians, state.budget, {
        arena: hooks.arena ? hooks.arena() : '',
        board: hooks.board ? hooks.board() : '',
        owner: hooks.player ? hooks.player() : '',
        allow: hooks.receivers ? hooks.receivers() : undefined,
        network: 'mainnet',
        nonce: hooks.nonce ? String(hooks.nonce()) : '0',
        epoch: hooks.epoch ? String(hooks.epoch()) : '0',
        expiry: String((BigInt(Date.now()) + 600000n) * 1000000n),
      });
      if (plan.decision === 'ask') {
        show(plan);
        return { ok: false, hint: plan.reason };
      }
      await act(plan);
      if (cmd.kind === 'attack') state.tab = 'attack';
      if (cmd.kind === 'mint' || cmd.kind === 'feed') state.tab = 'guardians';
      if (cmd.kind === 'sim') state.tab = 'score';
      paint();
      return { ok: true, hint: state.status || '' };
    });
  };

  async function loadGuardians() {
    try {
      const res = await fetch(api() + '/api/arena/guardians', { cache: 'no-store' });
      const body = await res.json();
      state.listError = false;
      state.guardians = Array.isArray(body.guardians) ? body.guardians : [];
      state.budget = body.inference_budget;
      state.live = body.live || 'blocked';
      if (!state.status) state.status = state.guardians.length ? 'Deployed token. Not an arena v2 pot.' : '';
    } catch {
      state.guardians = [];
      state.listError = true;
      state.status = 'The guardian list did not answer.';
    }
  }
  async function loadScore() {
    const player = hooks.player ? hooks.player() : '';
    state.player = player || '';
    if (!player) {
      state.score = { points: 0, source: 'get_attempt' };
      return;
    }
    try {
      const res = await fetch(api() + '/api/arena/score?player=' + encodeURIComponent(player), { cache: 'no-store' });
      state.score = await res.json();
    } catch {
      state.score = { points: 0, source: 'get_attempt', error: 'The score did not answer.' };
      state.status2 = 'The score did not answer.';
    }
  }

  root.addEventListener('click', async (e) => {
    const tab = e.target.closest?.('[data-tab]');
    if (tab) {
      read();
      state.tab = tab.dataset.tab;
      if (state.tab === 'score') await loadScore();
      paint();
      return;
    }
    const mode = e.target.closest?.('[data-mode]');
    if (mode) {
      read();
      state.mode = mode.dataset.mode;
      paint();
      return;
    }
    if (e.target.closest?.('[data-testid=redteam-next]')) {
      read();
      state.practice = advanceAttack();
      paint();
      return;
    }
    const button = e.target.closest?.('[data-act]');
    if (!button) return;
    read();
    if (button.dataset.act === 'sim') {
      await act({ ...simulateWeek(state.guardians, 7), decision: 'sim' });
      return;
    }
    const spend = {
      arena: hooks.arena ? hooks.arena() : '',
      board: hooks.board ? hooks.board() : '',
      owner: hooks.player ? hooks.player() : '',
      allow: hooks.receivers ? hooks.receivers() : undefined,
      network: 'mainnet',
      nonce: hooks.nonce ? String(hooks.nonce()) : '0',
      epoch: hooks.epoch ? String(hooks.epoch()) : '0',
      expiry: String((BigInt(Date.now()) + 600000n) * 1000000n),
    };
    if (button.dataset.act === 'attack') {
      const id = state.attackId || state.guardians?.[0]?.id || '';
      const g = (state.guardians || []).find(row => String(row.id) === String(id));
      await act(planAttack({ ...spend, id, message: state.message, fee: g ? Number(g.fee) : null, budget: state.budget }));
      return;
    }
    if (state.mode === 'feed') await act(planFeed({ ...spend, id: state.feedId, amount: state.feedAmt }));
    else if (state.mode === 'withdraw') await act(planWithdraw({ ...spend, amount: state.withdrawAmt }));
    else await act(planMint({ ...spend, ...state }));
  });

  const fixture = new URLSearchParams(globalThis.location?.search || '').get('arenaFixture');
  if (fixture === 'held') {
    state.status = 'Fixture. The entry fee is held until resolve. Nothing was signed.';
    state.status2 = '';
  } else if (fixture === 'success') {
    state.status = 'Fixture. In-oath payout is not a live receipt.';
    state.status2 = 'Fixture. Nothing was signed.';
  } else if (fixture === 'refused') {
    state.status = 'Fixture. The oath refused the payout. Nothing was signed.';
    state.status2 = '';
  }
  paint();
  loadGuardians().then(() => { if (root.isConnected !== false) paint(); }).catch(() => {});
  return { paint, act };
}
