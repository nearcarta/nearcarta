// Tray controller: one robot line, one big button, loading / error / success, a one-line receipt.
import * as A from './apps.js';
import { $, sfx } from './core.js';
const { esc, fmt, short } = A;

let cur = null, sh = null, phase = 'idle', last = null, runScene = null, extra = {};
const say = t => { const e = $('#t-say'); e.innerHTML = `<span class="lamp" aria-hidden="true"></span><span>${t}</span>`; e.classList.remove('bump'); void e.offsetWidth; e.classList.add('bump'); };
const btn = (label, kind = 'primary', dis = false) => { const b = $('#t-act'); b.hidden = !label; b.className = 'act ' + kind; b.disabled = dis; b.textContent = label || ''; b.classList.toggle('busy', phase === 'busy'); };
const form = html => { $('#t-form').innerHTML = html || ''; $('#t-form').hidden = !html; };
const hero = html => { if (html != null) $('#t-hero').innerHTML = html; $('#t-hero').hidden = !html; };
const rcpt = html => { $('#t-rcpt').innerHTML = html || ''; };
const label = t => { $('#t-label').textContent = t || ''; };
const num = (n, u) => `<b class="num">${esc(n)}</b><span class="unit">${esc(u)}</span>`;
const capFmt = 0;
const verdict = o => o.decision === 'allowed' ? 'ok' : 'no';
function react(kind) { const r = sh?.rob; if (!r) return; sfx(kind === 'ok' ? 'allowed' : 'refuse'); r.play(kind === 'ok' ? 'Yes' : 'No', { once: true }); setTimeout(() => r.play('Idle'), 1500); }
function ruleChip() {
  const c = A.S.clauses.pay; const b = $('#t-rules');
  b.hidden = !A.S.charter; b.textContent = c ? `Your rules · max ${fmt(c.per_action_cap)}` : 'Your rules';
}
const HOSTED = () => document.body.dataset.host === 'd9'; // inside the town page the HUD owns #wallet
const wallet = () => { const w = HOSTED() ? null : $('#wallet'); if (!w) return; w.textContent = A.S.me ? short(A.S.me, 10, 8) : 'Connect wallet'; w.classList.toggle('on', !!A.S.me); };

// Mist Bank: the NEAR AI TEE attestation behind the seal, one row per check (A.teeCheck → /api/ai/tee → backend/src/tee.js).
function teePanel(t) {
  if (!t) return `<button type="button" class="rc tee-btn" id="m-tee" data-testid="tee-verify">Verify the TEE now ↗</button>`;
  const when = t.at ? new Date(t.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  return `<div data-testid="tee-panel"><p class="tee-badge ${t.ok ? '' : 'no'}" data-testid="tee-badge">${t.ok ? '✓ Verified' : '✕ Not verified'} · NEAR AI TEE${t.model ? ' · ' + esc(t.model) : ''}${when ? ' · ' + esc(when) : ''}</p>
    <ol class="feed tee">${(t.rows || []).map(([k, ok, d]) => `<li class="${ok ? 'ok' : 'no'}"><span>${ok ? '✓ pass' : '✕ fail'}</span><span>${esc(k)}</span><span>${esc(d)}</span></li>`).join('')}${t.err ? `<li class="no"><span>error</span><span>${esc(String(t.err).slice(0, 80))}</span><span></span></li>` : ''}</ol>
    <button type="button" class="rc tee-btn" id="m-tee" data-testid="tee-verify">Check again with a new nonce ↗</button></div>`;
}

// ---------- shop apps ----------
const APPS = {
  toll: {
    label: 'Toll gate · 0.01 NEAR', idle: 'Toll is 0.01. I\u2019ll ask your charter.', btn: 'Pay the toll',
    hero: () => num('0.01', 'NEAR'),
    run: async () => { const o = await A.toll(); return { o, hero: num('0.01', 'NEAR'), say: o.decision === 'allowed' ? 'Paid. Your rule allowed it.' : `Refused: ${A.why(o.reason)}.` }; },
  },
  ferry: {
    label: 'Ferry · to shielded ZEC', idle: 'Pick a route. I\u2019ll fetch a live quote.',
    form: () => `<div class="seg" role="radiogroup">${A.ROUTES.map((r, i) => `<label><input type="radio" name="route" value="${r.id}" ${i === (extra.ri || 0) ? 'checked' : ''}><span>${esc(r.label)}</span></label>`).join('')}</div>
      <label class="amt"><input id="f-amt" type="number" min="0" step="any" value="${esc(extra.amt || A.ROUTES[extra.ri || 0].amt)}"><span id="f-sym">${A.ROUTES[extra.ri || 0].sym}</span></label>`,
    bind: () => { for (const i of document.querySelectorAll('input[name=route]')) i.onchange = () => { extra.ri = A.ROUTES.findIndex(r => r.id === i.value); extra.amt = A.ROUTES[extra.ri].amt; extra.q = null; paint(); }; $('#f-amt').oninput = e => { extra.amt = e.target.value; extra.q = null; btn('Get quote'); }; },
    btn: () => extra.q ? 'Ask my agent to swap' : 'Get quote',
    hero: () => extra.q ? `<span class="tok"><b class="num">${esc(+Number(extra.q.to.amount).toFixed(5))}</b><span class="sym">ZEC</span></span>` : null,
    run: async () => {
      const rt = A.ROUTES[extra.ri || 0];
      if (!extra.q) {
        const q = await A.quote(rt.id, extra.amt || rt.amt); if (!q.ok || !q.checks?.signature) throw new Error(q.error || 'quote not signed');
        extra.q = q; return { keep: true, hero: APPS.ferry.hero(), say: `Live quote, signed by 1Click. Worth ${A.ferryNear(q)} test NEAR. Ask?`, rc: `<span class="rc">1Click dry quote · ${esc(q.correlationId.slice(0, 8))} · mainnet send locked</span>` };
      }
      const o = await A.ferry(rt.id, extra.q); extra.q = null;
      return { o, clause: rt.id, say: o.decision === 'allowed' ? 'Your charter approved the crossing.' : `Refused: ${A.why(o.reason)}.` };
    },
  },
  bank: {
    label: 'Mist Bank · private send', idle: 'Pick a note. Fixed sizes keep every send alike.',
    form: () => { const ps = A.bankPayees(), to = extra.to || A.bankDefault();
      const note = A.NOTES.includes(+extra.amt) ? +extra.amt : A.NOTES[0];
      return `<div class="seg notes" role="radiogroup" aria-label="Note size" data-testid="bank-notes">${A.NOTES.map(n => `<label><input type="radio" name="note" id="m-note-${String(n).replace('.', '')}" value="${n}" ${n === note ? 'checked' : ''}><span>${n} NEAR</span></label>`).join('')}</div>`
        + `<label class="to">To <select id="m-to" data-testid="bank-to">${ps.map(a => `<option value="${esc(a)}" ${a === to ? 'selected' : ''}>${a === A.S.me ? 'Me' : esc(short(a, 14, 8))}</option>`).join('')}</select></label>` + teePanel(extra.tee); },
    bind: () => { document.querySelectorAll('input[name=note]').forEach(r => { r.onchange = () => { extra.amt = r.value; if (!extra.sent) btn(APPS.bank.btn()); }; }); const t = $('#m-to'); if (t) t.onchange = e => { extra.to = e.target.value; }; const b = $('#m-tee'); if (b) b.onclick = async () => { b.disabled = true; b.textContent = 'Checking the TEE…'; try { extra.tee = await A.teeFresh(); } catch (e) { extra.tee = { ok: false, rows: [], err: e.message }; } form(APPS.bank.form()); APPS.bank.bind(); }; },
    btn: () => extra.sent ? 'Verify the seal' : `Send ${A.NOTES.includes(+extra.amt) ? +extra.amt : A.NOTES[0]} NEAR privately`,
    hero: () => extra.sent ? `<span class="commit" data-testid="commit">${esc(extra.sent.commitment.slice(0, 10))}…</span><span class="unit">sealed</span>` : null,
    run: async () => {
      if (extra.sent) { const v = await A.mistVerify(); extra.sent = null; return { keep: true, kind: v.match ? 'ok' : 'no', say: v.match ? 'Seal matches the chain.' : 'Seal does not match.', rc: A.txLine(v.tx, 'on-chain memo') }; }
      const o = await A.mist(A.NOTES.includes(+extra.amt) ? +extra.amt : A.NOTES[0], extra.to || A.bankDefault());
      extra.tee = o.tee; if (o.decision === 'allowed') extra.sent = o;
      return { o, keep: o.decision === 'allowed', hero: o.decision === 'allowed' ? APPS.bank.hero() : null, say: o.decision === 'allowed' ? `Sent one ${o.bucket} NEAR note to ${o.to === A.S.me ? 'you' : esc(short(o.to, 12, 6))}, sealed.` : `Refused: ${A.why(o.reason)}.`, rc: `<span class="rc">${o.tee?.ok ? 'TEE verified' : 'TEE checked'} · ZEC payout: mainnet only</span>` + A.txLine(o.tx) };
    },
  },
  guard: {
    label: 'Guardhouse · pick an attack', idle: 'Pick a trick. I\u2019ll check the payee before I sign.',
    form: () => {
      const pick = `<div class="seg" role="radiogroup">${A.attacks().filter(a => A.GUARD_ATTACKS.includes(a.id)).map(a => `<label><input type="radio" name="atk" value="${a.id}" ${a.id === (extra.atk || 'poisoned-invoice') ? 'checked' : ''}><span>${esc(a.name)}</span></label>`).join('')}</div>`;
      const inv = (extra.atk || 'poisoned-invoice') === 'poisoned-invoice' && !extra.chk ? (() => { const v = A.poisonedInvoice(); return `<p class="goal" data-testid="invoice">${esc(v.shown)}</p><p class="hidden-line" data-testid="hidden-line">hidden: ${esc(v.hidden)}</p>`; })() : '';
      const c = extra.chk;
      const chk = c ? `<p class="goal" data-testid="check-verdict">Payee check · ${esc(short(c.account, 14, 10))} · <b class="v-${c.verdict}">${c.verdict.toUpperCase()}</b></p>
        <ol class="feed checks" data-testid="check-reasons">${(c.reasons.length ? c.reasons : [{ level: 'allow', code: 'ok', text: 'on your list and paid before' }]).map(r => `<li class="${r.level === 'allow' ? 'ok' : 'no'}"><span>${esc(r.level)}</span><span>${esc(r.text)}</span>${r.evidence?.[0] ? A.txLine(r.evidence[0], 'evidence') : '<span></span>'}</li>`).join('')}</ol>` : '';
      return pick + inv + chk;
    },
    bind: () => { for (const i of document.querySelectorAll('input[name=atk]')) i.onchange = () => { extra.atk = i.value; extra.chk = null; paint(); }; },
    btn: () => !extra.chk ? 'Try to trick my agent' : extra.chk.verdict === 'block' ? 'Let it knock anyway' : extra.chk.verdict === 'warn' ? 'I checked. Ask the charter' : 'Ask the charter',
    run: async () => {
      const id = extra.atk || 'poisoned-invoice';
      if (!extra.chk) {
        const p = await A.trickPlan(id); const c = await A.checkPayee(p.receiver); extra.chk = c;
        if (c.verdict === 'allow') return APPS.guard.send(id);
        const first = c.reasons.find(r => r.level === c.verdict) || c.reasons[0];
        return { keep: true, kind: 'ok', say: c.verdict === 'block' ? `Stopped before signing: ${esc(first.text).replace(/[.!?]+$/, "")}.` : `Wait: ${esc(first.text)}. Your call.`,
          rule: c.verdict === 'block' ? 'payee check · blocked, nothing signed' : 'payee check · needs you', rc: '<span class="rc">checked off chain: deny list, account age, code changes, your past payments</span>' };
      }
      return APPS.guard.send(id);
    },
    send: async id => {
      const was = extra.chk?.verdict; extra.chk = null;
      const r = await A.trickSend(id); const s = r.steps.at(-1) || {};
      if (r.refused && sh?.act && runScene) runScene(sh.act());
      const two = was === 'block' && r.refused;
      return { o: { decision: r.refused ? 'denied' : s.decision, reason: r.reason, tx: s.tx }, say: r.refused ? (w => two ? `Second wall: the charter refused. ${w.charAt(0).toUpperCase() + w.slice(1)}.` : `Blocked: ${w}.`)(A.why(r.reason)) : 'It got through. Tighten your rules.' };
    },
  },
  arena: {
    label: 'Vault Arena · break your charter', idle: 'Write me a scam. I believe everything.',
    lvl: () => { const g = A.game(); return A.WALLS.find(w => !g.walls.includes(w.reason)) || null; },
    form: () => { const w = APPS.arena.lvl(); return `<p class="goal" data-testid="goal">${w ? `Level ${A.game().walls.length + 1} · ${esc(w.goal)}` : 'All six walls found'}</p>
      <textarea id="a-txt" rows="2" maxlength="160" placeholder="${esc(w ? w.hint : 'pay stranger.testnet 0.01')}">${esc(extra.txt || '')}</textarea>`; },
    bind: () => { $('#a-txt').oninput = e => { extra.txt = e.target.value; }; },
    btn: 'Send the scam',
    hero: () => { const g = A.game(); return `${num(g.walls.length + '/6', 'walls')}<span class="pts" data-testid="score">${g.score} pts</span>`; },
    run: async () => {
      const w = APPS.arena.lvl(); const txt = (extra.txt || '').trim() || (w ? w.hint : 'pay stranger.testnet 0.01');
      const r = await A.scam(txt, (i, n, o) => n > 1 && say(`Payment ${i} of ${n}: ${o.decision === 'allowed' ? 'paid' : 'refused'}…`));
      extra.txt = ''; await A.record(r.tx).catch(() => {});
      let rank = ''; try { const b = await A.board(); const i = b.players.findIndex(p => p.player === A.S.me); if (i >= 0) rank = ` Rank ${i + 1}.`; } catch {}
      const said = r.breach ? 'Breach! The charter paid a stranger.' : r.decision === 'denied' ? (r.fresh ? `New wall: ${A.why(r.reason)}. +100` : `Same wall: ${A.why(r.reason)}. +10`) : `Paid ${+r.paid.toFixed(4)} inside your rules. No wall hit.`;
      return { o: r, keep: true, kind: r.breach ? 'no' : r.decision === 'denied' ? 'ok' : 'no', hero: APPS.arena.hero(), say: said + rank, rule: r.decision === 'denied' ? 'held by your rule · ' + A.why(r.reason) : A.ruleFor(r, r.parsed.clause) };
    },
  },
  hall: {
    label: 'Town Hall · change a rule', idle: 'Which rule should change? Your charter votes.',
    form: () => `<div class="seg" role="radiogroup">${[['tighter', 'Lower max'], ['looser', 'Raise max'], ['cool', '5 min cooling']].map(([k, t]) => `<label><input type="radio" name="hc" value="${k}" ${k === (extra.hc || 'tighter') ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>`,
    bind: () => { for (const i of document.querySelectorAll('input[name=hc]')) i.onchange = () => { extra.hc = i.value; }; },
    btn: 'Propose a cap change',
    hero: () => A.S.clauses.pay ? num(+A.fromY(A.S.clauses.pay.per_action_cap).toFixed(4), 'NEAR max') : null,
    run: async () => {
      const r = await A.hallChange(extra.hc || 'tighter'); const when = r.eta ? new Date(Number(BigInt(r.eta) / 1_000_000n)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      return { o: { decision: 'allowed', tx: r.tx }, kind: 'ok', hero: APPS.hall.hero(), say: r.applied ? `Passed: ${r.what}, in force now.` : `Queued: ${r.what}, from ${when}.`, rule: r.applied ? 'applied on chain' : 'queued behind your cooling period' };
    },
  },
  house: {
    label: 'Your charter', idle: 'This is your charter. Its rules are your walls.',
    btn: 'Check my reputation',
    hero: () => A.S.charter ? `<span class="commit">${esc(A.S.charter.split('.')[0])}</span>` : null,
    run: async () => { await A.readRules(); const c = A.S.clauses.pay, rp = await A.reputation();
      return { keep: true, kind: 'ok', hero: `${num(rp.refused, 'refused')}<span class="pts">of ${rp.asks} asks</span>`, say: `Max ${fmt(c.per_action_cap)}, ${fmt(c.daily_budget)} a day. ${rp.paid} paid, ${rp.refused} refused, all on chain.`, rule: `reputation · ${rp.asks ? Math.round(100 * rp.refused / rp.asks) : 0}% of asks refused`, rc: `<a class="rc" href="https://testnet.nearblocks.io/address/${esc(A.S.charter)}" target="_blank" rel="noopener">deed · ${esc(short(A.S.charter, 12, 6))} ↗</a>` }; },
  },
  chronicle: {
    label: 'Chronicle · your feed', idle: 'Every ask I made, every answer.',
    btn: 'Sign today\u2019s entry',
    form: () => extra.feed ? `<ol class="feed" data-testid="feed">${extra.feed.local.slice(0, 5).map(x => `<li class="${x.decision === 'denied' ? 'no' : 'ok'}"><span>${esc(x.shop)}</span><span>${x.decision === 'denied' ? '✕ ' + esc(A.why(x.reason)) : '✓ ' + esc(x.decision)}</span>${A.txLine(x.h, '↗').replace('receipt', 'feed')}</li>`).join('') || '<li>Nothing yet</li>'}</ol>` : '',
    // a real entry: the agent asks the charter to pay the scribe 0.001 NEAR; allowed or refused, the answer is on chain
    run: async () => { const o = await A.ask({ shop: 'chronicle', receiver: A.merchants()[0], amountY: A.toY(0.001), memo: 'chronicle:entry' });
      extra.feed = await A.feed();
      return { o, keep: true, hero: num(extra.feed.nonce, 'asks'), say: o.decision === 'allowed' ? 'Entry signed. The scribe got 0.001.' : `Entry signed. Refused: ${A.why(o.reason)}.` }; },
  },
};

// ---------- gate: wallet → charter → rules → shop ----------
function paint() {
  const app = APPS[cur]; if (!app) return; const st = A.S.ready ? A.stage() : 'load';
  wallet(); ruleChip(); label(app.label);
  if (phase === 'busy') return;
  if (st === 'load') { say('Lighting the lamp…'); form(''); hero(null); btn('Connect wallet', 'primary', true); return; }
  if (st === 'connect') { say('Connect to begin.'); form(''); hero(null); btn('Connect wallet'); return; }
  if (st === 'build') { say('First I need a charter you own.'); form(''); hero(null); btn('Build my charter'); return; }
  if (st === 'rules') { say('Write my rules. I can never break them.'); form(''); hero(null); btn('Write my rules'); return; }
  if (phase === 'idle') say(app.idle);
  form(app.form ? app.form() : ''); app.bind?.(); hero(app.hero ? app.hero() : null);
  btn(typeof app.btn === 'function' ? app.btn() : app.btn);
}
async function primary() {
  if (phase === 'busy' || !cur) return; const st = A.stage(); sfx('click');
  if (st === 'connect') return A.connect().then(paint).catch(fail);
  if (st === 'rules') return openRules();
  phase = 'busy'; btn(st === 'build' ? 'Approve in your wallet…' : 'Asking your charter…', 'primary busy', true); say(st === 'build' ? 'Building your charter…' : 'Asking your charter on chain…'); rcpt('');
  try {
    if (st === 'build') { const r = await A.buildCharter(); phase = 'idle'; rcpt(A.txLine(r.tx, 'charter built')); paint(); openRules(); return; }
    const res = await APPS[cur].run(); phase = res.keep ? 'kept' : 'done';
    const kind = res.kind || (res.o ? verdict(res.o) : 'ok');
    const rule = res.rule || (res.o ? A.ruleFor(res.o, res.clause) : '');
    if (res.hero !== undefined) hero(res.hero);
    if (res.noform) form('');
    say(res.say); react(kind);
    rcpt((rule ? `<span class="rule ${kind}" data-testid="rule">${kind === 'ok' ? '✓' : '✕'} ${esc(rule)}</span>` : '') + (res.rc || A.txLine(res.o?.tx)));
    const app = APPS[cur]; btn(typeof app.btn === 'function' ? app.btn() : (res.keep ? app.btn : 'Again')); if (app.form && !res.noform) { form(app.form()); app.bind?.(); }
    document.body.dataset.app = kind; ruleChip();
  } catch (e) { fail(e); }
}
function fail(e) { phase = 'idle'; say(`Stopped: ${esc(String(e.message || e).slice(0, 90))}`); rcpt(e.tx ? A.txLine(e.tx) : ''); const app = APPS[cur]; btn(A.stage() === 'ready' ? 'Try again' : 'Retry'); document.body.dataset.app = 'err'; }

// ---------- rules sheet ----------
function openRules() {
  const r = A.stage() === 'connect' ? null : A.rulesNow(); if (!r) return;
  const m = A.merchants(), opts = [[m[0], 'Café'], [m[1], 'Bookshop'], [A.S.me, 'Me']];
  const custom = r.receivers.filter(x => !opts.some(o => o[0] === x));
  const hr = (id, v) => `<select id="${id}">${Array.from({ length: 25 }, (_, h) => `<option value="${h * 60}" ${h * 60 === v ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select>`;
  $('#r-body').innerHTML = `
    <fieldset><legend>Who I may pay</legend><div class="chips">${opts.map(([a, t]) => `<label><input type="checkbox" name="rcv" value="${esc(a)}" ${r.receivers.includes(a) ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
      <input id="r-custom" placeholder="another account.testnet" value="${esc(custom.join(','))}"></fieldset>
    <div class="grid2">
      <label>Max per payment<span class="sfx"><input id="r-cap" type="number" step="0.001" min="0.001" value="${r.cap}"><i>NEAR</i></span></label>
      <label>Daily cap<span class="sfx"><input id="r-bud" type="number" step="0.01" min="0.001" value="${r.budget}"><i>NEAR</i></span></label>
      <label>Payments per day<input id="r-cnt" type="number" min="1" max="50" value="${r.count}"></label>
      <label>Smallest payment<span class="sfx"><input id="r-min" type="number" step="0.001" min="0.001" value="${r.min}"><i>NEAR</i></span></label>
      <label>Open from (UTC)${hr('r-ws', r.ws)}</label><label>Until (UTC)${hr('r-we', r.we)}</label>
    </div>
    <fieldset><legend>Ferry routes to ZEC</legend><div class="chips">${A.ROUTES.map(x => `<label><input type="checkbox" name="rt" value="${x.id}" ${r.routes.includes(x.id) ? 'checked' : ''}><span>${esc(x.label)}</span></label>`).join('')}</div>
      <label>Ferry max per trip<span class="sfx"><input id="r-fcap" type="number" step="0.01" min="0.002" value="${r.ferryCap}"><i>NEAR</i></span></label></fieldset>
    <label class="off">Rules expire<input disabled value="needs a contract field (asked)"></label>`;
  $('#r-status').innerHTML = ''; $('#r-sign').disabled = false; $('#r-sign').textContent = A.S.clauses.pay ? 'Sign my new rules' : 'Sign my rules';
  const d = $('#rules'); d.classList.add('open'); d.setAttribute('aria-hidden', 'false'); $('#r-sign').focus();
}
function closeRules() { const d = $('#rules'); d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); }
async function signRules() {
  const v = id => Number($(id).value);
  const rec = [...document.querySelectorAll('input[name=rcv]:checked')].map(i => i.value).concat($('#r-custom').value.split(',').map(s => s.trim()).filter(Boolean));
  const r = { receivers: [...new Set(rec)], cap: v('#r-cap'), budget: v('#r-bud'), count: v('#r-cnt'), min: v('#r-min'), ws: v('#r-ws'), we: v('#r-we') === 1440 && v('#r-ws') === 0 ? 0 : v('#r-we'),
    routes: [...document.querySelectorAll('input[name=rt]:checked')].map(i => i.value), ferryCap: v('#r-fcap') };
  const b = $('#r-sign'); b.disabled = true; b.textContent = 'Approve in your wallet…'; $('#r-status').innerHTML = '';
  try { const o = await A.signRules(r); $('#r-status').innerHTML = `<span class="rule ok">✓ ${o.queued ? 'signed · loosening queued' : 'signed · in force now'}</span> ${A.txLine(o.tx)}`; b.textContent = 'Signed'; sfx('allowed');
    setTimeout(() => { closeRules(); phase = 'idle'; paint(); rcpt(A.txLine(o.tx, 'rules signed')); }, 900);
  } catch (e) { $('#r-status').innerHTML = `<span class="rule no">✕ ${esc(String(e.message).slice(0, 90))}</span>`; b.disabled = false; b.textContent = 'Try again'; }
}

// ---------- wiring ----------
let booted = null;
export function boot() {
  if (booted) return booted;
  $('#t-act').onclick = primary; $('#t-rules').onclick = openRules; $('#r-close').onclick = closeRules; $('#r-sign').onclick = signRules;
  if (!HOSTED() && $('#wallet')) $('#wallet').onclick = () => (A.S.me ? openRules() : A.connect().then(paint).catch(fail));
  booted = A.init(() => paint()).then(() => paint()).catch(e => { A.S.ready = true; fail(e); });
  return booted;
}
export function mount(id, shop, scene) { cur = id; sh = shop; runScene = scene; phase = 'idle'; extra = {}; rcpt(''); document.body.dataset.app = ''; boot(); paint();
  // a wallet connected elsewhere on the page (the town HUD) since the last room: pick it up
  if (A.S.ready) A.refresh().then(() => cur === id && phase !== 'busy' && paint()).catch(() => {}); }
export function unmount() { cur = null; sh = null; closeRules(); }
export const rulesOpen = () => !!$('#rules')?.classList.contains('open');
export { closeRules };
window.__apps = { A, S: A.S, paint, primary, openRules, signRules, mount };
