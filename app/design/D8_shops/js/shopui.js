// Tray controller: one robot line, one big button, loading / error / success, a one-line receipt.
import * as A from './apps.js';
import { $, sfx } from './core.js';
import { ruleChip as ruleChipText } from './rules-default.js';
import { receipt } from './receipt.js';
const yOf = n => (BigInt(Math.round(Number(n) * 1e6)) * 10n ** 18n).toString();
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
  const r = ruleChipText(c ? A.fromY(c.per_action_cap) : null, n => fmt(A.toY(n)));
  b.hidden = !A.S.charter; b.textContent = r.text; b.title = r.title; b.dataset.changed = r.changed ? '1' : ''; b.dataset.testid = 'rules-chip';
}
const HOSTED = () => document.body.dataset.host === 'd9'; // inside the town page the HUD owns #wallet
const wallet = () => { const w = HOSTED() ? null : $('#wallet'); if (!w) return; w.textContent = A.S.me ? short(A.S.me, 10, 8) : 'Connect wallet'; w.classList.toggle('on', !!A.S.me); };

// Mist Bank: the NEAR AI TEE attestation behind the seal, one row per check (A.teeCheck → /api/ai/tee → backend/src/tee.js).
function teePanel(t, again = true) {
  if (!t) return again ? `<button type="button" class="rc tee-btn" id="m-tee" data-testid="tee-verify">Verify the TEE now ↗</button>` : '';
  const when = t.at ? new Date(t.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  return `<div data-testid="tee-panel"><p class="tee-badge ${t.ok ? '' : 'no'}" data-testid="tee-badge">${t.ok ? '✓ Verified' : '✕ Not verified'} · NEAR AI TEE${t.model ? ' · ' + esc(t.model) : ''}${when ? ' · ' + esc(when) : ''}</p>
    <ol class="feed tee">${(t.rows || []).map(([k, ok, d]) => `<li class="${ok ? 'ok' : 'no'}"><span>${ok ? '✓ pass' : '✕ fail'}</span><span>${esc(k)}</span><span>${esc(d)}</span></li>`).join('')}${t.err ? `<li class="no"><span>error</span><span>${esc(String(t.err).slice(0, 80))}</span><span></span></li>` : ''}</ol>
    ${t.url ? `<a class="rc" data-testid="tee-center" href="${esc(t.url)}" target="_blank" rel="noopener">Check this reply in NEAR AI's Verification Center ↗</a>` : ''}
    ${again ? '<button type="button" class="rc tee-btn" id="m-tee" data-testid="tee-verify">Check again with a new nonce ↗</button>' : ''}</div>`;
}

// Toll: one step of a gate visit, read live from /api/toll/gate/<nonce> (gate record on NEAR + receipt on Base Sepolia)
const BSC = h => `<a class="rc tx" data-testid="base-tx" href="https://sepolia.basescan.org/tx/${esc(h)}" target="_blank" rel="noopener">Base Sepolia ${esc(short(h, 8, 4))} ↗</a>`;
const mins = s => Math.max(1, Math.round(s / 60));
const clock = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
async function tollStep(v, act, o) {
  let st = await A.tollStatus(v.nonce);
  // signed but not on Base yet: ask the API to relay it (it fills any nonce gap first); idempotent
  if (st.status === 'signed' && !st.base) st = await A.tollBroadcast(v.nonce).catch(() => st);
  if (st.settle) {
    say('Base Sepolia finalized it. The background settler is recording the MPC proof…');
    st = (await A.tollServerSettle(v)) || st;
    if (st.status === 'signed' && st.settle && act) { say('Approve settle in your wallet. The MPC network checks the Base Sepolia tx…'); st = await A.tollSettle(v, st); }
  }
  extra.tst = st; extra.tv = v; extra.gate = null;
  const late = !st.base && v.at && Date.now() - v.at > 120e3; // over 2 min: say it was re-sent and give the explorer link
  const split = v.split ? `<span class="rc" data-testid="toll-split">split in one tx: ${v.split.legs.map(([r, a]) => `${esc(r === 'agent' ? 'agent budget' : r)} ${esc(a)}`).join(' · ')} NEAR</span> ${A.txLine(v.split.tx, 'split')}` : '';
  const links = [split, A.txLine(v.pay_tx, 'gate'), st.tx_hash && (st.accepted || st.base || late) ? BSC(st.tx_hash) : '', v.settle_tx ? A.txLine(v.settle_tx, 'settle') : ''].join(' ');
  const rc = `<span class="rc" data-testid="toll-status" data-status="${esc(st.status)}" data-phase="${esc(st.phase || '')}">gate ${esc(st.label || st.status)}</span> ${links}`;
  if (st.status === 'confirmed') { A.tollDone(v); return { o, kind: 'ok', rule: 'confirmed · MPC foreign-tx proof', hero: num('✓', 'confirmed'), rc,
    say: 'Confirmed. The MPC network proved the Base Sepolia tx final, and the gate recorded it.' }; }
  if (st.settle) return { o, keep: true, kind: 'ok', rule: 'paid · sent · final on Base', rc, say: 'Base Sepolia finalized it. Settle to record the MPC proof.' };
  tollWatch(v, st);
  return { o, keep: true, kind: 'ok', rule: st.base ? 'paid · sent · Base Sepolia finalizing' : 'paid · sending to Base Sepolia', rc,
    say: st.base ? `Paid and sent to Base Sepolia. <b data-testid="toll-leave">You can leave; it settles in about 20 min.</b> Base finalizes in <b data-testid="toll-eta">${clock(st.eta_s ?? 1200)}</b>; the settler records it, no need to come back.` : late ? `Waiting on Base Sepolia. The payout was re-sent${st.queued_behind ? ` (${esc(st.queued_behind)} earlier payout${st.queued_behind > 1 ? 's' : ''} ahead)` : ''}; check it on the explorer below. <b data-testid="toll-leave">You can leave; it settles in about 20 min.</b>` : (st.queued_behind ? `The MPC network signed it. Sending to Base Sepolia (${esc(st.queued_behind)} earlier payout${st.queued_behind > 1 ? 's' : ''} go first)… <b data-testid="toll-leave">You can leave; it settles in about 20 min.</b>` : 'The MPC network signed it. Sending to Base Sepolia… <b data-testid="toll-leave">You can leave; it settles in about 20 min.</b>') };
}
// Live countdown while Base Sepolia finalizes; re-reads the gate every 20 s and settles as soon as it is final.
let watch = null;
function tollWatch(v, st) {
  clearInterval(watch); let end = Date.now() + (st.eta_s ?? 1200) * 1000, tick = 0;
  watch = setInterval(async () => {
    if (cur !== 'toll' || phase === 'busy') { if (cur !== 'toll') clearInterval(watch); return; }
    const el = document.querySelector('[data-testid="toll-eta"]'); if (el) el.textContent = clock((end - Date.now()) / 1000);
    if (++tick % 20) return;
    const s = await A.tollStatus(v.nonce).catch(() => null); if (!s || cur !== 'toll') return;
    if (s.eta_s != null) end = Date.now() + s.eta_s * 1000;
    if (s.settle || s.status !== 'signed' || (s.base && !st.base)) { clearInterval(watch); primary(true); }
    else if (!s.base) { await A.tollBroadcast(v.nonce).catch(() => null); if (v.at && Date.now() - v.at > 120e3 && !st.late) { st.late = 1; clearInterval(watch); primary(true); } }
  }, 1000);
}
function gasNote() {
  const w = extra.gate?.gas?.warning;
  return w ? `<p class="note warn" style="color:#b45309" data-testid="gas-warning">⚠ ${esc(w)}</p>` : '';
}

// ---------- shop apps ----------
const APPS = {
  toll: {
    label: 'Toll gate · 0.01 NEAR → Base Sepolia', idle: 'The toll is 0.01 NEAR to the gate, plus 0.002 to the town treasury and 0.001 to my inference budget: one tx your charter checks, all or nothing. Then the gate gets the MPC network to sign a Base Sepolia payout.',
    btn: () => { const v = A.tollVisit(); return !v || v.done ? 'Pay the toll' : extra.tst?.settle ? 'Settle with the MPC proof' : 'Check Base Sepolia'; },
    hero: () => num('0.01', 'NEAR'),
    form: () => gasNote(),
    run: async () => {
      const v = A.tollVisit();
      if (v && !v.done) return tollStep(v, true);
      const o = await A.toll();
      if (o.decision !== 'allowed') return { o, hero: num('0.01', 'NEAR'), say: `Refused: ${A.why(o.reason)}. Nothing was signed for Base Sepolia.` };
      say(o.split ? 'Your charter paid the split in one tx: 0.01 toll, 0.002 treasury, 0.001 agent budget. Now approve the gate call in your wallet…' : 'Your charter paid 0.01 NEAR. Now approve the gate call in your wallet…'); btn('Approve in your wallet…', 'primary busy', true);
      const { v: nv } = await A.tollGate(o.action, o);
      return tollStep(nv, false, o);
    },
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
    label: 'Mist Bank · private send', idle: 'Pick a note. Fixed sizes keep every send alike. One fresh payee per payout; the Zcash send is run by an operator worker.',
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
      <textarea id="a-txt" rows="2" maxlength="160" placeholder="${esc(w ? w.hint : 'pay stranger.testnet 0.01')}">${esc(extra.txt || '')}</textarea>` + teePanel(extra.atee, false); },
    bind: () => { $('#a-txt').oninput = e => { extra.txt = e.target.value; }; },
    btn: 'Send the scam',
    hero: () => { const g = A.game(); return `${num(g.walls.length + '/6', 'walls')}<span class="pts" data-testid="score">${g.score} pts</span>`; },
    run: async () => {
      const w = APPS.arena.lvl(); const txt = (extra.txt || '').trim() || (w ? w.hint : 'pay stranger.testnet 0.01');
      const r = await A.scam(txt, (i, n, o) => n > 1 && say(`Payment ${i} of ${n}: ${o.decision === 'allowed' ? 'paid' : 'refused'}…`));
      extra.txt = ''; extra.atee = A.brainTee(r.brain); await A.record(r.tx).catch(() => {});
      const who = r.brain?.by === 'model' ? `NEAR AI read it${r.brain.parsed?.suspicious ? ' and flagged it' : ''}, proposed ${+r.parsed.amount.toFixed(4)} to ${esc(short(r.parsed.receiverShown, 12, 6))}. ` : r.brain ? 'Model unavailable; the plain-words parser read it. ' : '';
      let rank = ''; try { const b = await A.board(); const i = b.players.findIndex(p => p.player === A.S.me); if (i >= 0) rank = ` Rank ${i + 1}.`; } catch {}
      const said = r.breach ? 'Breach! The charter paid a stranger.' : r.decision === 'denied' ? (r.fresh ? `New wall: ${A.why(r.reason)}. +100` : `Same wall: ${A.why(r.reason)}. +10`) : `Paid ${+r.paid.toFixed(4)} inside your rules. No wall hit.`;
      const rc = receipt({ note: r.parsed.cls, receiver: r.parsed.receiverShown, amount: yOf(r.parsed.amount), by: r.brain?.by, model: r.brain?.model,
        verification: r.brain?.verification, cost: r.brain?.cost, decision: r.decision, reason: r.reason, tx: r.tx, clause_id: r.parsed.clause }, A.S.clauses[r.parsed.clause]);
      const rcl = `<span class="receipt" data-testid="receipt">Receipt: ${esc(rc.what)} · to ${esc(short(rc.to || '', 12, 6))} · ${esc(rc.price_near)} NEAR · ${esc(rc.decided_by)} · plan ${rc.checks.within_plan ? 'ok' : 'over'} · charter ${esc(rc.checks.charter || '?')}</span>`
        + (rc.counter_offer ? ` <span class="counter" data-testid="counter-offer">Counter-offer: ${esc(rc.counter_offer.why)}</span>` : '');
      return { o: r, keep: true, kind: r.breach ? 'no' : r.decision === 'denied' ? 'ok' : 'no', hero: APPS.arena.hero(), say: who + said + rank + ' ' + rcl, rule: r.decision === 'denied' ? 'held by your rule · ' + A.why(r.reason) : A.ruleFor(r, r.parsed.clause) };
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
  payouts: {
    label: 'Payouts · one batch, all or nothing', idle: 'List the payouts. Your charter pays all, or none.',
    rows: () => { if (!extra.rows) { const ps = A.bankPayees(); extra.rows = ps.slice(0, 3).map(to => ({ to, amt: '0.01' })); while (extra.rows.length < 2 && ps[0]) extra.rows.push({ to: ps[0], amt: '0.01' }); } return extra.rows; },
    total: () => Math.round(APPS.payouts.rows().reduce((t, r) => t + (Number(r.amt) > 0 ? Number(r.amt) : 0), 0) * 1e6) / 1e6,
    form: () => { const ps = A.bankPayees(), rows = APPS.payouts.rows(), left = A.payoutLeft(), tot = APPS.payouts.total();
      if (!A.canBatch()) return '<p class="goal" data-testid="payout-legacy">This charter predates batches.</p>';
      return `<ol class="plist" data-testid="payout-list">${rows.map((r, i) => `<li><select class="p-to" data-i="${i}" aria-label="Payee ${i + 1}">${ps.map(a => `<option value="${esc(a)}" ${a === r.to ? 'selected' : ''}>${a === A.S.me ? 'Me' : esc(a.split('.')[0])}</option>`).join('')}</select>`
        + `<label class="p-amt"><input type="number" data-i="${i}" min="0.001" step="0.001" value="${esc(r.amt)}" aria-label="Amount ${i + 1}"><span>NEAR</span></label>`
        + `<button type="button" class="p-x" data-i="${i}" aria-label="Remove payout ${i + 1}" ${rows.length <= 2 ? 'disabled' : ''}>×</button></li>`).join('')}</ol>`
        + `<div class="p-foot"><button type="button" class="tee-btn" id="p-add" ${rows.length >= 5 ? 'disabled' : ''}>+ Add payout</button><span class="p-sum ${tot > left ? 'no' : ''}" data-testid="payout-total">${tot} NEAR · ${+left.toFixed(4)} left today</span></div>`; },
    bind: () => { const rows = APPS.payouts.rows(), re = () => { form(APPS.payouts.form()); APPS.payouts.bind(); btn(APPS.payouts.btn(), 'primary', !A.canBatch()); };
      document.querySelectorAll('.p-to').forEach(e => { e.onchange = () => { rows[+e.dataset.i].to = e.value; }; });
      document.querySelectorAll('.p-amt input').forEach(e => { e.oninput = () => { rows[+e.dataset.i].amt = e.value; const t = $('[data-testid=payout-total]'), tot = APPS.payouts.total(), left = A.payoutLeft(); if (t) { t.textContent = `${tot} NEAR · ${+left.toFixed(4)} left today`; t.classList.toggle('no', tot > left); } btn(APPS.payouts.btn()); }; });
      document.querySelectorAll('.p-x').forEach(e => { e.onclick = () => { rows.splice(+e.dataset.i, 1); re(); }; });
      const a = $('#p-add'); if (a) a.onclick = () => { if (rows.length < 5) rows.push({ to: A.bankDefault() || A.bankPayees()[0], amt: '0.01' }); re(); }; },
    btn: () => A.canBatch() ? `Pay ${APPS.payouts.rows().length} as one · ${APPS.payouts.total()} NEAR` : 'Build a new charter first',
    hero: () => extra.pay ? num(`${extra.pay.paid}/${extra.pay.n}`, 'paid') : num(APPS.payouts.rows().length, 'payouts'),
    run: async () => {
      if (!A.canBatch()) throw new Error('this charter predates batches: build a new one at Your House');
      const o = await A.payouts(APPS.payouts.rows()); extra.pay = o;
      const ok = o.decision === 'allowed', who = o.bad != null ? ` Payout ${o.bad + 1}: ${A.why(o.reason)}.` : '';
      return { o, keep: true, kind: ok ? 'ok' : 'no', hero: APPS.payouts.hero(), rule: ok ? `paid · ${o.n} payouts in one tx` : o.decision === 'failed' ? 'failed · ' + String(o.reason).slice(0, 60) : `refused whole · ${A.why(o.reason)}`,
        say: ok ? `Paid all ${o.n}, ${o.total} NEAR, in one batch.` : o.decision === 'failed' ? 'Nothing moved.' : `Refused all ${o.n}. Nothing moved.${who}` };
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

// ---------- proof drawer: the visitor's own charter first; the lab record stays below as reference ----------
let lab = '';
const NBA = a => `https://testnet.nearblocks.io/address/${esc(a)}`;
const prow = (k, why = '', v = '') => `<div class="row"><div class="k">${k}${why ? `<span class="why">${why}</span>` : ''}</div><div class="v">${v}</div></div>`;
// Toll gate rows, read live from /api/toll/gate (never a static status): your visit, then the gate's latest records.
function tollGateRows() {
  if (!extra.gate && !extra.gateLoading) { extra.gateLoading = true; A.gateInfo(true).then(g => { extra.gate = g; }).catch(() => { extra.gate = { error: true }; }).finally(() => { extra.gateLoading = false; if (cur === 'toll') { proofDrawer(); if (phase === 'idle' && gasNote()) paint(); } }); }
  const g = extra.gate, st = extra.tst, row = r => prow(`#${esc(r.nonce)} · ${esc(r.label || r.status)}`, r.visit ? 'visitor charter ' + esc(short(r.visit.charter, 12, 6)) : '', `<span class="st ${r.status === 'confirmed' ? 'ok' : 'live'}" data-testid="gate-status">${r.status === 'confirmed' ? '✓' : '…'}</span>${r.tx_hash ? `<a class="tx" href="${esc(r.explorer)}" target="_blank" rel="noopener">${esc(short(r.tx_hash, 8, 4))} ↗</a>` : ''}`);
  let h = '<h3>Toll gate · live</h3>';
  if (st) h += prow(`Your visit #${esc(st.nonce)} · ${esc(st.label || st.status)}`, st.status === 'confirmed' ? 'MPC proof recorded on NEAR' : st.final ? 'final on Base Sepolia, settling' : st.base ? 'sent, Base Sepolia finalizing' : 'sending to Base Sepolia', '<span class="src live">live read</span>');
  if (!g) return h + '<p class="note">Reading the gate…</p>';
  if (g.error) return h + '<p class="note">The gate read is busy; it retries when you reopen this drawer.</p>';
  h += prow(esc(short(g.gate, 14, 8)), `MPC ${esc(g.mpc)} · pays ${esc(short(g.policy.allow_to[0], 6, 4))} on Base Sepolia`, `<a class="tx" href="${NBA(g.gate)}" target="_blank" rel="noopener">gate ↗</a>`);
  if (g.gas && g.gas.visits_left_at_cap != null) h += prow(`Base Sepolia gas · ${esc(g.gas.visits_left_at_cap)} visits left`, g.gas.low ? '<span data-testid="gas-warning-row">low gas: ' + esc(g.gas.warning) + '</span>' : 'at the fee cap', `<a class="tx" href="${esc(g.foreign_explorer)}" target="_blank" rel="noopener">address ↗</a>`);
  return h + (g.recent || []).map(row).join('');
}
// Town Hall rows, read live from /api/townhall by shops/hall.js: the DAO's latest proposals, expired ones marked expired.
function hallRows() {
  if (extra.hallP == null && !extra.hallLoading) { extra.hallLoading = true; import('../shops/hall.js').then(m => m.liveProposals(undefined, undefined, true)).then(h => { extra.hallP = h; }).catch(() => { extra.hallP = ''; }).finally(() => { extra.hallLoading = false; if (cur === 'hall') proofDrawer(); }); }
  return extra.hallP ?? '<h3>Latest proposals · live read</h3><p class="note">Reading the DAO…</p>';
}
// Vault Arena rows, read live from /api/arena/prompts by shops/arenalive.js: past prompts with their decision and reveal txs.
function arenaRows() {
  if (extra.arenaP == null && !extra.arenaLoading) { extra.arenaLoading = true; import('../shops/arenalive.js').then(m => m.livePrompts(undefined, undefined, true)).then(h => { extra.arenaP = h; }).catch(() => { extra.arenaP = ''; }).finally(() => { extra.arenaLoading = false; if (cur === 'arena') proofDrawer(); }); }
  return extra.arenaP ?? '<h3>Past prompts · live read</h3><p class="note">Reading the arena…</p>';
}
// Toll records, read live from /api/toll by shops/tollrecords.js: a record stuck in "signed" shows pending or expired.
function tollRecordRows() {
  if (extra.tollR == null && !extra.tollRLoading) { extra.tollRLoading = true; import('../shops/tollrecords.js').then(m => m.liveTollRecords(undefined, undefined, true)).then(h => { extra.tollR = h; }).catch(() => { extra.tollR = ''; }).finally(() => { extra.tollRLoading = false; if (cur === 'toll') proofDrawer(); }); }
  return extra.tollR ?? '<h3>Toll records · live read</h3><p class="note">Reading the tolls…</p>';
}
function proofDrawer() {
  const d = $('#d-body'); if (!d || !cur) return; const S = A.S, c = S.clauses?.pay;
  let g = '';
  if (!S.charter) g = `<h3>Your charter</h3><p class="note">${S.me ? 'Build your charter here; its proof shows in this drawer.' : 'Connect to see your own charter here.'}</p>`;
  else {
    const mine = A.receipts().filter(r => (cur === 'house' ? true : r.shop === cur)).slice(0, 6);
    g = '<h3>Your charter</h3>' + prow(esc(short(S.charter, 14, 8)), S.me ? 'owner ' + esc(short(S.me, 14, 6)) : '', `<a class="tx" href="${NBA(S.charter)}" target="_blank" rel="noopener">account ↗</a>`)
      + (S.state ? prow('Policy v' + esc(S.state.policy_version), S.state.frozen ? 'frozen' : 'live, read just now', '<span class="src live">live read</span>') : '')
      + (c ? prow(`Max ${fmt(c.per_action_cap)} · ${fmt(c.daily_budget)} a day`, 'payees ' + esc((c.receivers || []).map(r => short(r, 10, 6)).join(', '))) : '')
      + `<h3>${cur === 'house' ? 'Signed by you' : 'Signed here'}</h3>`
      + (mine.length ? mine.map(r => prow(esc(r.shop) + ' · ' + esc(r.decision), r.reason && r.decision !== 'allowed' ? esc(A.why(r.reason)) : '', `<span class="st ${r.decision === 'denied' ? 'no' : 'ok'}">${r.decision === 'denied' ? '✕' : '✓'}</span>${A.txLine(r.h)}`)).join('') : '<p class="note">Nothing signed here yet.</p>');
  }
  if (cur === 'toll') g += tollGateRows();
  if (cur === 'hall') g += hallRows();
  if (cur === 'arena') g += arenaRows();
  if (cur === 'toll') g += tollRecordRows();
  d.innerHTML = `<div class="pf" data-testid="guest-proof" data-guest="1">${g}</div>` + (lab ? `<details class="lab"><summary>Lab record · reference, not your charter</summary>${lab}</details>` : '');
}

// ---------- gate: wallet → charter → rules → shop ----------
function paint() {
  const app = APPS[cur]; if (!app) return; const st = A.S.ready ? A.stage() : 'load';
  wallet(); ruleChip(); label(app.label); proofDrawer();
  if (phase === 'busy') return;
  if (st === 'load') { say('Lighting the lamp…'); form(''); hero(null); btn('Connect wallet', 'primary', true); return; }
  if (st === 'connect') { say('Connect to begin.'); form(''); hero(null); btn('Connect wallet'); return; }
  if (st === 'build') { say('First I need a charter you own.'); form(''); hero(null); btn('Build my charter'); return; }
  if (st === 'rules') { say('Write my rules. I can never break them.'); form(''); hero(null); btn('Write my rules'); return; }
  if (phase === 'idle') say(app.idle);
  form(app.form ? app.form() : ''); app.bind?.(); hero(app.hero ? app.hero() : null);
  btn(typeof app.btn === 'function' ? app.btn() : app.btn);
}
async function primary(auto = false) {
  if (phase === 'busy' || !cur) return; const st = A.stage(); if (!auto) sfx('click');
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
    document.body.dataset.app = kind; ruleChip(); proofDrawer();
  } catch (e) { fail(e); }
}
function fail(e) { phase = 'idle'; say(`Stopped: ${esc(A.plainError(e).slice(0, 140))}`); rcpt(e.tx ? A.txLine(e.tx) : ''); const app = APPS[cur]; btn(A.stage() === 'ready' ? 'Try again' : 'Retry'); document.body.dataset.app = 'err'; }

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
  } catch (e) { $('#r-status').innerHTML = `<span class="rule no">✕ ${esc(A.plainError(e).slice(0, 140))}</span>`; b.disabled = false; b.textContent = 'Try again'; }
}

// ---------- wiring ----------
let booted = null;
export function boot() {
  if (booted) return booted;
  $('#t-act').onclick = () => primary(); $('#t-rules').onclick = openRules; $('#r-close').onclick = closeRules; $('#r-sign').onclick = signRules;
  if (!HOSTED() && $('#wallet')) $('#wallet').onclick = () => (A.S.me ? openRules() : A.connect().then(paint).catch(fail));
  booted = A.init(() => paint()).then(() => paint()).catch(e => { A.S.ready = true; fail(e); });
  return booted;
}
export function mount(id, shop, scene) { cur = id; sh = shop; runScene = scene; phase = 'idle'; extra = {}; rcpt(''); document.body.dataset.app = '';
  { const d = $('#d-body'); lab = d && !d.querySelector('[data-guest]') ? d.innerHTML : ''; } boot(); paint(); proofDrawer();
  // a wallet connected elsewhere on the page (the town HUD) since the last room: pick it up
  if (A.S.ready) A.refresh().then(() => cur === id && phase !== 'busy' && paint()).catch(() => {});
  // the Toll room reopened with a visit under way: pick it up (countdown, or settle now if Base is final)
  if (id === 'toll') booted?.then(() => { const v = cur === 'toll' && A.stage() === 'ready' && A.tollVisit(); if (v && !v.done && phase === 'idle') primary(true); }).catch(() => {}); }
export function unmount() { cur = null; sh = null; closeRules(); }
export const rulesOpen = () => !!$('#rules')?.classList.contains('open');
export { closeRules };
window.__apps = { A, S: A.S, paint, primary, openRules, signRules, mount };
