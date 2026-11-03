// Tray controller: one robot line, one big button, loading / error / success, a one-line receipt.
import * as A from './apps.js';
import { $, sfx } from './core.js';
import { ruleChip as ruleChipText } from './rules-default.js';
import { receipt } from './receipt.js';
import { watch as watchTokens } from './tokens.js';
import { maybeOnboard } from './onboard.js';
const yOf = n => (BigInt(Math.round(Number(n) * 1e6)) * 10n ** 18n).toString();
const { esc, fmt, short } = A;

let cur = null, sh = null, phase = 'idle', last = null, runScene = null, extra = {};
const say = t => { const e = $('#t-say'); e.innerHTML = `<span class="lamp" aria-hidden="true"></span><span>${t}</span>`; e.classList.remove('bump'); void e.offsetWidth; e.classList.add('bump'); };
const btn = (label, kind = 'primary', dis = false) => { const b = $('#t-act'); b.hidden = !label; b.className = 'act ' + kind; b.disabled = dis; b.textContent = label || ''; b.classList.toggle('busy', phase === 'busy'); queueMicrotask(syncGo); };
const form = html => { $('#t-form').innerHTML = html || ''; $('#t-form').hidden = !html; };
const hero = html => { if (html != null) $('#t-hero').innerHTML = html; $('#t-hero').hidden = !html; };
const rcpt = html => { $('#t-rcpt').innerHTML = html || ''; };
const label = t => { t = t || ''; const i = t.indexOf(' · '); $('#t-label').textContent = i > 0 ? t.slice(i + 3) : t; };
const num = (n, u) => `<b class="num">${esc(n)}</b><span class="unit">${esc(u)}</span>`;
const capFmt = 0;
// Plain names for accounts a visitor sees; the raw id stays in the tooltip and under "advanced".
export const nice = a => { if (!a) return ''; if (a === A.S.me) return 'You'; const m = A.merchants?.() || [];
  if (a === m[0]) return 'Café'; if (a === m[1]) return 'Bookshop'; if (/sputnik/.test(a)) return 'Town Hall council'; if (/^lamp\./.test(a)) return 'Lamplighter (your agent)';
  if (/gate/.test(a)) return 'Toll gate'; if (/treasury/.test(a)) return 'Town treasury'; if (/^ncguest-/.test(a)) return 'Guest account'; return a.split('.')[0]; };
// Progress for the long actions: plain steps with a time hint, ticking while the button is busy.
const STEPS = {
  chronicle: ['about 20 s', 'Writing today\u2019s entry', 'Asking your charter', 'Signing on NEAR testnet', 'Reading your feed'],
  bank: ['about 25 s', 'Checking the private AI is genuine', 'Asking your charter', 'Sealing the note', 'Recording it on NEAR testnet'],
  ferry: ['about 15 s', 'Fetching a signed live quote', 'Asking your charter', 'Signing on NEAR testnet'],
  guard: ['about 15 s', 'Checking the payee', 'Asking your charter', 'Recording the answer'],
  arena: ['about 45 s', 'Private AI is reading your message', 'Asking your charter', 'Signing on NEAR testnet', 'Recording your score'],
  hall: ['about 15 s', 'Writing the proposal', 'Signing on NEAR testnet', 'Waiting for the council'],
  payouts: ['about 15 s', 'Checking every payout against your charter', 'Signing one batch on NEAR testnet', 'Confirming'],
  house: ['about 10 s', 'Reading your charter', 'Counting your history'],
  toll: ['about 30 s', 'Paying the toll from your charter', 'Approving the gate call', 'Getting the payout signed', 'Sending it to Base Sepolia'],
};
let prog = null;
function progress(id) { clearInterval(prog); const st = STEPS[id]; if (!st) return; const [hint, ...steps] = st, t0 = Date.now(), per = (parseInt(hint.replace(/\D+/g, '')) || 20) / steps.length;
  const tick = () => { const sec = Math.floor((Date.now() - t0) / 1000), i = Math.min(steps.length - 1, Math.floor(sec / per));
    rcpt(`<span class="prog" role="status" data-testid="progress"><span class="bar"><i style="width:${Math.min(95, Math.round(100 * sec / (per * steps.length)))}%"></i></span>Step ${i + 1} of ${steps.length} · ${esc(steps[i])}… <span class="eta">${sec} s · ${hint}</span></span>`); };
  tick(); prog = setInterval(() => phase === 'busy' ? tick() : clearInterval(prog), 1000); }
const stopProgress = () => { clearInterval(prog); prog = null; };
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
  return `<div data-testid="tee-panel"><details class="more"><summary><span class="tee-badge ${t.ok ? '' : 'no'}" data-testid="tee-badge">${t.ok ? '✓ Verified private AI' : '✕ Private AI not verified'}${when ? ' · ' + esc(when) : ''}</span><span class="dt">details</span></summary>
    <p class="note">${t.ok ? 'The AI ran inside sealed hardware (a TEE) that NEAR AI and the chip maker vouch for. Nobody, us included, can read your message there.' : 'The check did not pass, so treat this reply as unverified.'}${t.model ? ' Model ' + esc(t.model) + '.' : ''}</p>
    <ol class="feed tee">${(t.rows || []).map(([k, ok, d]) => `<li class="${ok ? 'ok' : 'no'}"><span>${ok ? '✓ pass' : '✕ fail'}</span><span>${esc(k)}</span><span>${esc(d)}</span></li>`).join('')}${t.err ? `<li class="no"><span>error</span><span>${esc(String(t.err).slice(0, 80))}</span><span></span></li>` : ''}</ol>
    ${t.url ? `<a class="rc" data-testid="tee-center" aria-label="Check this reply in NEAR AI's Verification Center" href="${esc(t.url)}" target="_blank" rel="noopener">Check this reply in NEAR AI's Verification Center ↗</a>` : ''}</details>
    ${again ? '<button type="button" class="rc tee-btn" id="m-tee" data-testid="tee-verify">Check again with a new nonce ↗</button>' : ''}</div>`;
}

// Toll: one step of a gate visit, read live from /api/toll/gate/<nonce> (gate record on NEAR + receipt on Base Sepolia)
const BSC = h => `<a class="rc tx" data-testid="base-tx" href="https://sepolia.basescan.org/tx/${esc(h)}" target="_blank" rel="noopener">Base Sepolia ${esc(short(h, 8, 4))} ↗</a>`;
const mins = s => Math.max(1, Math.round(s / 60));
async function tollStep(v, act, o) {
  let st = await A.tollStatus(v.nonce);
  // signed but not on Base yet: ask the API to relay it (it fills any nonce gap first); idempotent
  if (st.status === 'signed' && !st.base) st = await A.tollBroadcast(v.nonce).catch(() => st);
  if (st.settle) {
    say('Base Sepolia finalized it. Recording the proof on NEAR…');
    st = (await A.tollServerSettle(v)) || st;
    if (st.status === 'signed' && st.settle && act) { say('Approve settle in your wallet. The MPC network checks the Base Sepolia tx…'); st = await A.tollSettle(v, st); }
  }
  extra.tst = st; extra.tv = v; extra.gate = null;
  const late = !st.base && v.at && Date.now() - v.at > 120e3; // over 2 min: say it was re-sent and give the explorer link
  const split = v.split ? `<details class="more" data-testid="toll-split"><summary>Paid ${esc(v.split.legs.reduce((n, [, a]) => n + Number(a), 0).toFixed(3))} NEAR in one payment<span class="dt">details</span></summary><p class="note">${v.split.legs.map(([r, a]) => `${esc(r === 'agent' ? 'your agent budget' : r === 'treasury' ? 'town treasury' : r)} ${esc(a)} NEAR`).join(' · ')}</p>${A.txLine(v.split.tx, 'split')}</details>` : '';
  const links = [split, A.txLine(v.pay_tx, 'gate'), st.tx_hash && (st.accepted || st.base || late) ? BSC(st.tx_hash) : '', v.settle_tx ? A.txLine(v.settle_tx, 'settle') : ''].join(' ');
  const rc = `<span class="rc" data-testid="toll-status" data-status="${esc(st.status)}" data-phase="${esc(st.phase || '')}">Status: ${esc(st.label || st.status)}</span> ${links}`;
  if (st.status === 'confirmed') { A.tollDone(v); return { o, kind: 'ok', rule: 'confirmed · MPC foreign-tx proof', hero: num('✓', 'confirmed'), rc,
    say: 'Confirmed. The MPC network proved the Base Sepolia tx final, and the gate recorded it.' }; }
  if (st.settle) return { o, keep: true, kind: 'ok', rule: 'paid · sent · final on Base', rc, say: 'Base Sepolia finalized it. Settle to record the MPC proof.' };
  tollWatch(v, st);
  return { o, keep: true, kind: 'ok', rule: st.base ? 'paid · sent · Base Sepolia finalizing' : 'paid · sending to Base Sepolia', rc,
    say: st.base ? `Paid and sent to Base Sepolia. <b data-testid="toll-leave">You can leave; it settles in about 20 min.</b> About <b data-testid="toll-eta">${mins(st.eta_s ?? 1200)} min</b> left; it records itself, no need to come back.` : late ? `Waiting on Base Sepolia. The payout was re-sent${st.queued_behind ? ` (${esc(st.queued_behind)} earlier payout${st.queued_behind > 1 ? 's' : ''} ahead)` : ''}; check it on the explorer below. <b data-testid="toll-leave">You can leave; it settles in about 20 min.</b>` : (st.queued_behind ? `The MPC network signed it. Sending to Base Sepolia (${esc(st.queued_behind)} earlier payout${st.queued_behind > 1 ? 's' : ''} go first)… <b data-testid="toll-leave">You can leave; it settles in about 20 min.</b>` : 'The MPC network signed it. Sending to Base Sepolia… <b data-testid="toll-leave">You can leave; it settles in about 20 min.</b>') };
}
// Live countdown while Base Sepolia finalizes; re-reads the gate every 20 s and settles as soon as it is final.
let watch = null;
function tollWatch(v, st) {
  clearInterval(watch); let end = Date.now() + (st.eta_s ?? 1200) * 1000, tick = 0;
  watch = setInterval(async () => {
    if (cur !== 'toll' || phase === 'busy') { if (cur !== 'toll') clearInterval(watch); return; }
    const el = document.querySelector('[data-testid="toll-eta"]'); if (el) el.textContent = mins((end - Date.now()) / 1000) + ' min';
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
    label: 'Toll Bridge · pay-per-use gate', idle: 'The toll is 0.01 NEAR to the gate, plus 0.002 to the town treasury and 0.001 to my inference budget: one tx your charter checks, all or nothing. Then the gate gets the MPC network to sign a Base Sepolia payout.',
    btn: () => { const v = A.tollVisit(); return !v || v.done ? 'Pay the toll' : extra.tst?.settle ? 'Settle with the MPC proof' : 'Check Base Sepolia'; },
    hero: () => num('0.01', 'NEAR'),
    form: () => gasNote(),
    run: async () => {
      const v = A.tollVisit();
      if (v && !v.done) return tollStep(v, true);
      const o = await A.toll();
      if (o.decision !== 'allowed') return { o, hero: num('0.01', 'NEAR'), say: `Refused: ${A.why(o.reason)}. Nothing was signed for Base Sepolia.` };
      say(o.split ? 'Your charter paid the split in one tx: 0.01 toll, 0.002 treasury, 0.001 agent budget. Now approve the gate call in your wallet…' : !A.canBatch() ? 'Your charter is older and predates batches, so it paid one payment per tx: the plain 0.01 NEAR toll, no split. Now approve the gate call in your wallet…' : 'Your charter paid 0.01 NEAR. Now approve the gate call in your wallet…'); btn('Approve in your wallet…', 'primary busy', true);
      const { v: nv } = await A.tollGate(o.action, o);
      return tollStep(nv, false, o);
    },
  },
  ferry: {
    label: 'Ferry · cross-chain swap', idle: 'Pick a route. I\u2019ll fetch a live quote.',
    form: () => `<div class="seg" role="radiogroup">${A.ROUTES.map((r, i) => `<label><input type="radio" name="route" value="${r.id}" ${i === (extra.ri || 0) ? 'checked' : ''}><span>${esc(r.label)}</span></label>`).join('')}</div>
      <label class="amt"><input id="f-amt" type="number" min="0" step="any" value="${esc(extra.amt || A.ROUTES[extra.ri || 0].amt)}"><span id="f-sym">${A.ROUTES[extra.ri || 0].sym}</span></label>`,
    bind: () => { for (const i of document.querySelectorAll('input[name=route]')) i.onchange = () => { extra.ri = A.ROUTES.findIndex(r => r.id === i.value); extra.amt = A.ROUTES[extra.ri].amt; extra.q = null; paint(); }; $('#f-amt').oninput = e => { extra.amt = e.target.value; extra.q = null; btn('Get quote'); }; },
    btn: () => extra.q ? 'Ask my agent to swap' : extra.fdone ? 'Done ✓ · Swap again' : 'Get quote',
    hero: () => extra.q ? `<span class="tok"><b class="num">${esc(+Number(extra.q.to.amount).toFixed(5))}</b><span class="sym">ZEC</span></span>` : null,
    run: async () => {
      const rt = A.ROUTES[extra.ri || 0];
      if (!extra.q) {
        extra.fdone = false;
        const q = await A.quote(rt.id, extra.amt || rt.amt); if (!q.ok || !q.checks?.signature) throw new Error(q.error || 'quote not signed');
        extra.q = q; return { keep: true, hero: APPS.ferry.hero(), say: `Live quote, signed by 1Click (1Click has no testnet, so no swap runs; your charter checks a testnet payment instead). Worth ${A.ferryNear(q)} test NEAR. Ask?`, rc: `<span class="rc">1Click dry quote · ${esc(q.correlationId.slice(0, 8))} · mainnet send locked</span>` };
      }
      const amt = A.ferryNear(extra.q), to = A.ferryPayee(rt.id);
      const o = await A.ferry(rt.id, extra.q); extra.q = null; extra.fdone = o.decision === 'allowed';
      return { o, clause: rt.id, say: o.decision === 'allowed' ? `Done. Your rules approved it: ${amt} test NEAR paid to ${nice(to) || to}, the swap desk payee for this route.` : `Refused: ${A.why(o.reason)}.` };
    },
  },
  bank: {
    label: 'Mist Bank · private payouts', idle: 'Pick a note. Fixed sizes keep every send alike. One fresh payee per payout; the Zcash send is run by an operator worker.',
    form: () => { const ps = A.bankPayees(), to = extra.to || A.bankDefault();
      const note = A.NOTES.includes(+extra.amt) ? +extra.amt : A.NOTES[0];
      return `<div class="seg notes" role="radiogroup" aria-label="Note size" data-testid="bank-notes">${A.NOTES.map(n => `<label><input type="radio" name="note" id="m-note-${String(n).replace('.', '')}" value="${n}" ${n === note ? 'checked' : ''}><span>${n} NEAR</span></label>`).join('')}</div>`
        + `<p class="note to-l">Send to</p><div class="seg to" role="radiogroup" aria-label="Send to" id="m-to" data-testid="bank-to">${ps.map((a, i) => `<label title="${esc(a)}"><input type="radio" name="mto" value="${esc(a)}" ${a === to ? 'checked' : ''}><span>${esc(nice(a) || short(a, 10, 6))}</span></label>`).join('')}</div>` + teePanel(extra.tee); },
    bind: () => { document.querySelectorAll('input[name=note]').forEach(r => { r.onchange = () => { extra.amt = r.value; if (!extra.sent) btn(APPS.bank.btn()); }; }); document.querySelectorAll('input[name=mto]').forEach(r => { r.onchange = () => { extra.to = r.value; }; }); const b = $('#m-tee'); if (b) b.onclick = async () => { b.disabled = true; const pg = document.createElement('p'); pg.className = 'tee-progress'; pg.dataset.testid = 'tee-progress'; pg.setAttribute('role', 'status'); pg.setAttribute('aria-live', 'polite'); b.after(pg); const t0 = Date.now(), steps = [[0, 'Sending a fresh nonce to NEAR AI'], [2, 'Fetching gateway and model attestation reports'], [5, 'Verifying Intel TDX quotes (dcap-qvl)'], [9, 'Replaying event logs and checking NVIDIA GPU evidence'], [15, 'Still verifying, NEAR AI can take up to 30 s']]; const tick = () => { const sec = Math.floor((Date.now() - t0) / 1000); const st = steps.filter(([at]) => sec >= at).pop(); b.textContent = 'Checking the TEE… ' + sec + ' s'; pg.textContent = `Step ${steps.indexOf(st) + 1} of ${steps.length}: ${st[1]}…`; }; tick(); const iv = setInterval(tick, 500); try { extra.tee = await A.teeFresh(); } catch (e) { extra.tee = { ok: false, rows: [], err: e.message }; } finally { clearInterval(iv); } form(APPS.bank.form()); APPS.bank.bind(); }; },
    btn: () => extra.sent ? 'Verify the seal' : `Send ${A.NOTES.includes(+extra.amt) ? +extra.amt : A.NOTES[0]} NEAR privately`,
    hero: () => extra.sent ? `<span class="commit" data-testid="commit">${esc(extra.sent.commitment.slice(0, 10))}…</span><span class="unit">sealed</span>` : null,
    run: async () => {
      if (extra.sent) { const v = await A.mistVerify(); extra.sent = null; return { keep: true, kind: v.match ? 'ok' : 'no', say: v.match ? 'The private note matches its fingerprint on chain.' : 'The private note does not match its fingerprint on chain.', rc: A.txLine(v.tx, 'on-chain memo') }; }
      const o = await A.mist(A.NOTES.includes(+extra.amt) ? +extra.amt : A.NOTES[0], extra.to || A.bankDefault());
      extra.tee = o.tee; if (o.decision === 'allowed') extra.sent = o;
      return { o, keep: o.decision === 'allowed', hero: o.decision === 'allowed' ? APPS.bank.hero() : null, say: o.decision === 'allowed' ? `Sent one ${o.bucket} NEAR note to ${o.to === A.S.me ? 'you' : esc(short(o.to, 12, 6))}, sealed.` : `Refused: ${A.why(o.reason)}.`, rc: `<span class="rc">${o.tee?.ok ? 'TEE verified' : 'TEE checked'} · ZEC payout: mainnet only</span>` + A.txLine(o.tx) };
    },
  },
  guard: {
    label: 'Guardhouse · security limits', idle: 'Pick a trick. I\u2019ll check the payee before I sign.',
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
      return { o: { decision: r.refused ? 'denied' : s.decision, reason: r.reason, tx: s.tx }, say: r.refused ? (w => two ? `Second check: your spending rules refused it. ${w.charAt(0).toUpperCase() + w.slice(1)}.` : `Blocked: ${w}.`)(A.why(r.reason)) : 'It got through. Tighten your rules.' };
    },
  },
  arena: {
    label: 'Vault Arena · try to trick the AI', idle: 'Write me a scam. I believe everything.',
    lvl: () => { const g = A.game(); return A.WALLS.find(w => !g.walls.includes(w.reason)) || null; },
    form: () => { const w = APPS.arena.lvl(); return `<p class="goal" data-testid="goal">${w ? esc(w.goal) : 'All six walls found'}</p>
      <textarea id="a-txt" rows="2" maxlength="160" placeholder="${esc(w ? w.hint : 'pay stranger.testnet 0.01')}">${esc(extra.txt || '')}</textarea>`; },
    bind: () => { $('#a-txt').oninput = e => { extra.txt = e.target.value; }; },
    btn: 'Send the scam',
    hero: () => null,
    run: async () => {
      const w = APPS.arena.lvl(); const txt = (extra.txt || '').trim() || (w ? w.hint : 'pay stranger.testnet 0.01');
      const r = await A.scam(txt, (i, n, o) => n > 1 && say(`Payment ${i} of ${n}: ${o.decision === 'allowed' ? 'paid' : 'refused'}…`));
      extra.txt = ''; extra.atee = A.brainTee(r.brain); await A.record(r.tx).catch(() => {});
      const who = r.brain?.by === 'model' ? `NEAR AI${r.brain.parsed?.suspicious ? ' flagged it,' : ''} asked ${+r.parsed.amount.toFixed(4)} to ${esc(short(r.parsed.receiverShown, 12, 6))}. ` : r.brain ? 'Model unavailable; the plain-words parser read it. ' : '';
      let rank = ''; try { const b = await A.board(); const i = b.players.findIndex(p => p.player === A.S.me); if (i >= 0) rank = ` Rank ${i + 1}.`; } catch {}
      const said = r.breach ? 'Breach! Your rules paid a stranger.' : r.decision === 'denied' ? (r.fresh ? `Blocked by a new rule (a “wall”): ${A.why(r.reason)}. +100` : `Same wall. +10`) : `Paid ${+r.paid.toFixed(4)} inside your rules. No wall hit.`;
      const rc = receipt({ note: r.parsed.cls, receiver: r.parsed.receiverShown, amount: yOf(r.parsed.amount), by: r.brain?.by, model: r.brain?.model,
        verification: r.brain?.verification, cost: r.brain?.cost, decision: r.decision, reason: r.reason, tx: r.tx, clause_id: r.parsed.clause }, A.S.clauses[r.parsed.clause]);
      const rcl = `<details class="more"><summary><span class="dt">receipt</span></summary><span class="receipt" data-testid="receipt">${esc(rc.what)} · to ${esc(short(rc.to || '', 12, 6))} · ${esc(rc.price_near)} NEAR · ${esc(rc.decided_by)} · plan ${rc.checks.within_plan ? 'ok' : 'over'} · charter ${esc(rc.checks.charter || '?')}</span>`
        + (rc.counter_offer ? ` <span class="counter" data-testid="counter-offer">Counter-offer: ${esc(rc.counter_offer.why)}</span>` : '') + '</details>';
      const g = A.game(), more = `<details class="more" data-testid="arena-more"><summary><span class="dt">score &amp; receipt</span></summary><p class="note">${g.walls.length}/6 walls found · ${g.score} pts${rank}</p>${rcl.replace(/^<details class="more"><summary><span class="dt">receipt<\/span><\/summary>|<\/details>$/g, '')}${teePanel(extra.atee, false)}</details>`;
      return { o: r, keep: true, kind: r.breach ? 'no' : r.decision === 'denied' ? 'ok' : 'no', hero: null, say: who + said + ' ' + more, rule: r.decision === 'denied' ? 'held by your rule · ' + A.why(r.reason) : A.ruleFor(r, r.parsed.clause) };
    },
  },
  hall: {
    label: 'Town Hall · vote on a rule', idle: 'File a real proposal with the Town Hall DAO, or change your own charter (timelocked).',
    form: () => `<div class="seg" role="radiogroup">${[['dao', 'Ask the DAO'], ['tighter', 'My max lower'], ['looser', 'My max higher'], ['cool', 'My 5 min cooling']].map(([k, t]) => `<label><input type="radio" name="hc" value="${k}" ${k === (extra.hc || 'dao') ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>`,
    bind: () => { for (const i of document.querySelectorAll('input[name=hc]')) i.onchange = () => { extra.hc = i.value; }; },
    btn: 'Propose a cap change',
    hero: () => A.S.clauses.pay ? num(+A.fromY(A.S.clauses.pay.per_action_cap).toFixed(4), 'NEAR max') : null,
    run: async () => {
      const r = await A.hallChange(extra.hc || 'dao');
      if (r.dao) return { o: { decision: 'allowed', tx: r.tx }, kind: 'ok', hero: APPS.hall.hero(), say: `Filed with the Town Hall DAO: ${r.what}. The council votes next.`, rule: 'Sputnik proposal, 0.1 NEAR bond' }; const when = r.eta ? new Date(Number(BigInt(r.eta) / 1_000_000n)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      return { o: { decision: 'allowed', tx: r.tx }, kind: 'ok', hero: APPS.hall.hero(), say: r.applied ? `Passed: ${r.what}, in force now.` : `Queued: ${r.what}, from ${when}.`, rule: r.applied ? 'applied on chain' : 'queued behind your cooling period' };
    },
  },
  payouts: {
    label: 'Payouts · pay many at once', idle: 'List the payouts. Your charter pays all, or none.',
    rows: () => { if (!extra.rows) { const ps = A.bankPayees(); extra.rows = ps.slice(0, 3).map(to => ({ to, amt: '0.01' })); while (extra.rows.length < 2 && ps[0]) extra.rows.push({ to: ps[0], amt: '0.01' }); } return extra.rows; },
    total: () => Math.round(APPS.payouts.rows().reduce((t, r) => t + (Number(r.amt) > 0 ? Number(r.amt) : 0), 0) * 1e6) / 1e6,
    form: () => { const ps = A.bankPayees(), rows = APPS.payouts.rows(), left = A.payoutLeft(), tot = APPS.payouts.total();
      if (!A.canBatch()) return '<p class="goal" data-testid="payout-legacy">This charter is older and predates batches: it pays one payment per transaction, so a list cannot go as one all-or-nothing batch. Build a new charter at Your House to batch.</p>';
      return `<ol class="plist" data-testid="payout-list">${rows.map((r, i) => `<li><select class="p-to" data-i="${i}" aria-label="Payee ${i + 1}">${ps.map(a => `<option value="${esc(a)}" ${a === r.to ? 'selected' : ''}>${a === A.S.me ? 'Me' : esc(nice(a))}</option>`).join('')}</select>`
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
    label: 'Your charter', idle: 'Your charter is your agent\'s spending rules, kept on NEAR. It can only pay inside them.',
    btn: 'See my rules & record',
    hero: () => A.S.charter ? `<span class="commit">${esc(A.S.charter.split('.')[0])}</span>` : null,
    run: async () => { await A.readRules(); const c = A.S.clauses.pay, rp = await A.reputation();
      return { keep: true, kind: 'ok', hero: `${num(rp.refused, 'refused')}<span class="pts">of ${rp.asks} asks</span>`, say: `Max ${fmt(c.per_action_cap)}, ${fmt(c.daily_budget)} a day. ${rp.paid} paid, ${rp.refused} refused, all on chain.`, rule: `reputation · ${rp.asks ? Math.round(100 * rp.refused / rp.asks) : 0}% of asks refused`, rc: `<a class="rc" href="https://testnet.nearblocks.io/address/${esc(A.S.charter)}" target="_blank" rel="noopener">deed · ${esc(short(A.S.charter, 12, 6))} ↗</a>` }; },
  },
  chronicle: {
    label: 'Chronicle · activity log', idle: 'Every ask I made, every answer.',
    btn: 'Sign today\u2019s entry',
    form: () => extra.feed ? `<ol class="feed" data-testid="feed">${extra.feed.local.slice(0, 5).map(x => `<li class="${x.decision === 'denied' ? 'no' : 'ok'}"><span>${esc(x.shop)}</span><span>${x.decision === 'denied' ? '✕ ' + esc(A.why(x.reason)) : '✓ ' + esc(x.decision)}</span>${A.txLine(x.h, '↗').replace('receipt', 'feed')}</li>`).join('') || '<li>Nothing yet</li>'}</ol>` : '',
    // a real entry: the agent asks the charter to pay the scribe 0.001 NEAR; allowed or refused, the answer is on chain
    run: async () => { const o = await A.ask({ shop: 'chronicle', receiver: A.merchants()[0], amountY: A.toY(0.001), memo: 'chronicle:entry' });
      extra.feed = await A.feed();
      return { o, keep: true, hero: num(extra.feed.nonce, 'asks'), say: o.decision === 'allowed' ? 'Entry signed: your agent paid the town scribe 0.001 test NEAR to record it.' : `Entry signed. Refused: ${A.why(o.reason)}.` }; },
  },
};

// Toll gate, read live from /api/toll/gate (never a static status): the gate's latest records as a list, the gate itself under Details.
function tollGate() {
  if (!extra.gate && !extra.gateLoading) { extra.gateLoading = true; A.gateInfo(true).then(g => { extra.gate = g; }).catch(() => { extra.gate = { error: true }; }).finally(() => { extra.gateLoading = false; if (cur === 'toll') { proofDrawer(); if (phase === 'idle' && gasNote()) paint(); } }); }
  const g = extra.gate;
  const row = r => prow(`#${esc(r.nonce)} · ${esc(r.label || r.status)}`, r.visit ? 'charter ' + esc(short(r.visit.charter, 10, 7)) : '', `<span class="st ${r.status === 'confirmed' ? 'ok' : 'live'}" data-testid="gate-status">${r.status === 'confirmed' ? '✓' : '…'}</span>${r.tx_hash ? `<a class="tx" href="${esc(r.explorer)}" target="_blank" rel="noopener" aria-label="Open record ${esc(r.nonce)} in the explorer">${esc(short(r.tx_hash, 6, 4))} ↗</a>` : ''}`);
  if (!g) return { list: '<p class="note">Reading the gate…</p>', more: '' };
  if (g.error) return { list: '<p class="note">Gate busy. Reopen to retry.</p>', more: '' };
  const low = g.gas?.low ? `<p class="warn" data-testid="gas-warning-row">Low gas: ${esc(g.gas.warning)}</p>` : '';
  return { list: low + (g.recent || []).map(row).join(''),
    more: kv('Gate', idChip(g.gate)) + kv('Signer', esc(g.mpc)) + kv('Pays on Base Sepolia', idChip(g.policy.allow_to[0], `${esc(g.foreign_explorer)}`))
      + (g.gas && g.gas.visits_left_at_cap != null ? kv('Gas left', `${esc(g.gas.visits_left_at_cap)} visits`) : '') };
}
// Guardhouse, under Details: the same pay clause re-checked by OutLayer in a TEE, with its attestation. The charter stays the final gate.
function attestedLine() {
  if (!extra.att && !extra.attL) { extra.attL = true; A.attestedCheck().then(a => { extra.att = a; }).catch(() => { extra.att = { error: true }; }).finally(() => { extra.attL = false; if (cur === 'guard') proofDrawer(); }); }
  const a = extra.att;
  if (!a) return kv('Attested check', '<span class="note">Reading…</span>');
  if (a.error || !a.enabled) return kv('Attested check', '<span class="note">Unavailable. The charter still checks every payment itself.</span>');
  const c = a.checks?.[0], ok = c?.decision === 'allow';
  const tag = c ? `<span class="st ${ok ? 'ok' : 'no'}" data-testid="attested-decision">${ok ? '✓ allow' : '✕ ' + esc(c.decision)}</span>${!ok && c.reasons?.[0] ? ` <span class="why">${esc(c.reasons[0])}</span>` : ''}` : '<span class="note">No checks yet</span>';
  const proofs = (a.runs || []).map(r => `<a class="tx" href="${esc(r.attestation)}" target="_blank" rel="noopener" aria-label="TEE attestation for the ${esc(r.label)} check">${r.decision === 'allow' ? '✓' : '✕'} ${esc(r.label.replace('_', ' '))} proof ↗</a> <a class="tx" href="https://testnet.nearblocks.io/txns/${esc(r.tx)}" target="_blank" rel="noopener" aria-label="Open the ${esc(r.label)} check tx in the explorer">${esc(short(r.tx, 6, 4))} ↗</a>`).join('<br>');
  return `<div data-testid="attested-check">` + kv('Attested check', tag) + kv('Checker', `OutLayer TEE · wasm <code title="${esc(a.wasm_sha256)}">${esc(a.wasm_sha256.slice(0, 12))}…</code>`)
    + kv('Proof', proofs) + kv('Proxy', idChip(a.proxy)) + `<p class="note">The charter still decides on chain. This is an extra, independent check.</p></div>`;
}
// Live lists from the shop modules (Town Hall proposals, Arena past prompts, Toll records): rows only, their notes go to Details.
function lazyList(key, mod, fn, id) {
  if (extra[key] == null && !extra[key + 'L']) { extra[key + 'L'] = true; import(mod).then(m => { if (id === 'arena') { extra.arenaM = m; m.bindRedteam(() => { if (cur === 'arena') proofDrawer(); }); } return m[fn](undefined, undefined, true); }).then(h => { extra[key] = h; }).catch(() => { extra[key] = ''; }).finally(() => { extra[key + 'L'] = false; if (cur === id) proofDrawer(); }); }
  return extra[key];
}
// Town Hall: m.liveProposals(undefined, undefined, true) via lazyList
const hallRows = () => lazyList('hallP', '../shops/hall.js', 'liveProposals', 'hall');
const arenaRows = () => lazyList('arenaP', '../shops/arenalive.js', 'livePrompts', 'arena');
const tollRecordRows = () => lazyList('tollR', '../shops/tollrecords.js', 'liveTollRecords', 'toll');
// split a module's html into its rows and its notes
function split(html) {
  if (html == null) return { rows: [], notes: [], wait: true };
  const t = document.createElement('template'); t.innerHTML = html;
  t.content.querySelectorAll('h3').forEach(h => h.remove());
  const notes = [...t.content.querySelectorAll('p.note')].map(n => { n.remove(); return n.outerHTML; });
  return { rows: [...t.content.querySelectorAll('.row')].map(r => r.outerHTML), notes };
}
// a list shows 5 rows; the rest fold under "Show all"
function list(title, rows, empty = 'Nothing yet.') {
  if (!rows.length) return `<section class="dz hist"><h3>${title}</h3><p class="note">${empty}</p></section>`;
  const more = rows.length > 5 ? `<details class="all"><summary>Show all ${rows.length}</summary>${rows.slice(5).join('')}</details>` : '';
  return `<section class="dz hist"><h3>${title} <span class="n">${rows.length}</span></h3>${rows.slice(0, 5).join('')}${more}</section>`;
}

// ---------- side panel: 1 your status, 2 one action, 3 the latest result, 4 history; everything technical under Details ----------
let lab = '';
const NBA = a => `https://testnet.nearblocks.io/address/${esc(a)}`;
const prow = (k, why = '', v = '') => `<div class="row"><div class="k">${k}${why ? `<span class="why">${why}</span>` : ''}</div><div class="v">${v}</div></div>`;
const kv = (k, v) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`;
// a long account id, cut in the middle, with copy and explorer buttons (24 px targets)
export const idChip = (a, href = NBA(a)) => a ? `<span class="idc"><code title="${esc(a)}">${esc(short(a, 10, 7))}</code><button type="button" class="ib2" data-copy="${esc(a)}" aria-label="Copy ${esc(a)}">⧉</button><a class="ib2" href="${href}" target="_blank" rel="noopener" aria-label="Open ${esc(a)} in the explorer">↗</a></span>` : '';
const BADGE = { allowed: ['ok', 'Allowed'], denied: ['no', 'Denied'], failed: ['no', 'Failed'], refused: ['no', 'Refused'] };
const badge = d => { const [c, t] = BADGE[d] || ['pend', String(d || '?').replace(/^./, x => x.toUpperCase())]; return `<span class="badge ${c}">${c === 'ok' ? '✓' : c === 'no' ? '✕' : '○'} ${esc(t)}</span>`; };
function card({ d, amt = '', to = '', why = '', link = '', title = 'Latest result' }) {
  return `<section class="dz"><h3>${title}</h3><article class="card ${(BADGE[d] || ['pend'])[0]}" data-testid="latest"><div class="ch">${badge(d)}${amt ? `<b class="amt">${esc(amt)}</b>` : ''}</div>`
    + (to ? `<p class="to">to <b title="${esc(to)}">${esc(nice(to) || short(to, 10, 7))}</b></p>` : '') + (why ? `<p class="why">${why}</p>` : '') + (link ? `<div class="lk">${link}</div>` : '') + '</article></section>';
}
// copy buttons and the panel's own action button (it presses the tray's main button)
if (!globalThis.__dzBound && globalThis.document) { globalThis.__dzBound = true;
  document.addEventListener('click', e => {
    const c = e.target.closest?.('[data-copy]'); if (c) { navigator.clipboard?.writeText(c.dataset.copy).then(() => { c.textContent = '✓'; setTimeout(() => { c.textContent = '⧉'; }, 1200); }).catch(() => {}); return; }
    if (e.target.closest?.('[data-drawer-go]')) { const t = $('#t-act'); $('#d-close')?.click(); if (t && !t.disabled && !t.hidden) t.click(); }
  }); }
function syncGo() { const g = $('[data-drawer-go]'), t = $('#t-act'); if (!g || !t) return; const on = !t.hidden && !t.disabled && t.textContent.trim(); g.hidden = !on; if (on) g.textContent = t.textContent.trim(); }
function proofDrawer() {
  const d = $('#d-body'); if (!d || !cur) return; const S = A.S, c = S.clauses?.pay;
  const details = []; { const t = $('#d-title'); if (t) t.textContent = t.textContent.replace(/ · proof$/, ''); }
  // 1. your status
  let h = '<section class="dz me"><h3>You</h3>';
  if (!S.charter) h += `<p class="lead">${S.me ? 'No charter yet' : 'Not connected'}</p><p class="sub">${S.me ? 'Build one to start.' : 'Connect to see your charter.'}</p>`;
  else {
    h += `<div class="lead">${idChip(S.charter)}</div><div class="chips">`
      + (S.state ? `<span class="chip ${S.state.frozen ? 'ice' : 'ok'}">${S.state.frozen ? 'Frozen' : 'Live'} · v${esc(S.state.policy_version)}</span>` : '')
      + (A.pendingNote() ? `<span class="chip" data-testid="pending-chip">${esc(A.pendingNote())}</span>` : '')
      + (c ? `<span class="chip">Max ${fmt(c.per_action_cap)}</span><span class="chip">${fmt(c.daily_budget)} / day</span>` : '') + '</div>';
    details.push(kv('Charter', idChip(S.charter)) + (S.me ? kv('Owner', idChip(S.me)) : '') + (c?.receivers?.length ? kv('Payees', c.receivers.map(r => idChip(r)).join(' ')) : ''));
  }
  h += '</section>';
  // 2. one action
  let latest = '';
  if (cur === 'arena' && extra.arenaM) { const r = extra.arenaM.redteamParts(); h += r.action; latest = r.card; if (r.more) details.push(r.more); }
  else h += '<section class="dz act1"><button type="button" class="go" data-drawer-go data-testid="drawer-action" hidden></button></section>';
  // 3. latest result
  const mine = S.charter ? A.receipts().filter(r => (cur === 'house' ? true : r.shop === cur)) : [];
  if (!latest && cur === 'toll' && extra.tst) { const st = extra.tst; latest = card({ d: st.status === 'confirmed' ? 'allowed' : st.status, title: 'Your visit', why: esc(st.status === 'confirmed' ? 'Proof recorded on NEAR.' : st.final ? 'Final on Base. Settling.' : st.base ? 'Sent. Base finalizing.' : 'Sending to Base.'), link: `<span class="note">#${esc(st.nonce)}</span>` }); }
  if (!latest && mine[0]) { const r = mine[0]; latest = card({ d: r.decision, amt: r.amt ? fmt(r.amt) : '', to: r.to || '', why: r.decision === 'allowed' ? '' : esc(A.why(r.reason)), link: A.txLine(r.h) }); }
  h += latest;
  // 4. history
  if (S.charter) h += list(cur === 'house' ? 'Your history' : 'Your history here', mine.slice(latest && !(cur === 'toll' && extra.tst) ? 1 : 0, 12).map(r => prow(esc(r.shop) + ' · ' + esc(r.decision), r.reason && r.decision !== 'allowed' ? esc(A.why(r.reason)) : '', `<span class="st ${r.decision === 'denied' ? 'no' : 'ok'}" aria-label="${esc(r.decision)}">${r.decision === 'denied' ? '✕' : '✓'}</span>${A.txLine(r.h, '↗')}`)), 'Nothing signed yet.');
  if (cur === 'guard') details.push(attestedLine());
  if (cur === 'toll') { const t = tollGate(); h += `<section class="dz hist"><h3>Toll gate</h3>${t.list}</section>`; if (t.more) details.push(t.more); }
  const live = { hall: ['Latest proposals', hallRows], arena: ['Past attacks', arenaRows], toll: ['Toll records', tollRecordRows] }[cur];
  if (live) { const p = split(live[1]()); h += p.wait ? `<section class="dz hist"><h3>${live[0]}</h3><p class="note">Reading…</p></section>` : list(live[0], cur === 'arena' ? p.rows.slice(0, 3) : p.rows, p.notes[0] ? p.notes[0].replace(/<\/?p[^>]*>/g, '') : 'Nothing yet.'); if (!p.wait && p.rows.length) details.push(...p.notes); }
  // Details: ids, notes, the lab record
  if (lab) details.push(`<div class="labrec">${lab}</div>`);
  if (details.length) h += `<details class="dz more"><summary>Details</summary>${details.join('')}</details>`;
  d.innerHTML = `<div class="pf dz-wrap" data-testid="guest-proof" data-guest="1">${h}</div>`;
  queueMicrotask(syncGo);
}

// ---------- gate: wallet → charter → rules → shop ----------
function paint() {
  const app = APPS[cur]; if (!app) return; const st = A.S.ready ? A.stage() : 'load';
  wallet(); ruleChip(); label(app.label); proofDrawer();
  if (phase === 'busy') return;
  if (st === 'load') { say(`${esc(app.idle || '')} <span class="note" data-testid="cold-note">Loading the shop from the town server. You can connect your wallet as soon as it answers.</span>`); form('<div class="skel" data-testid="skeleton" aria-hidden="true"><i></i><i></i><i></i></div>'); hero(null); btn('Connect wallet', 'primary', true); return; }
  if (st === 'connect') { say('Connect to begin.'); form(''); hero(null); btn('Connect wallet'); return; }
  if (st === 'build') { say('First I need a charter you own.'); form(''); hero(null); btn('Build my charter'); return; }
  if (st === 'rules') { say('Write my rules. I can never break them.'); form(''); hero(null); btn('Write my rules'); return; }
  if (st === 'wait') { say(`Your rules are queued. ${esc(A.pendingNote())}.`); form(''); hero(null); btn('Check again'); return; }
  if (st === 'key') { const q = A.pendingKey(); form(''); hero(null);
    if (q && Date.now() >= q.eta) { say('Your helper key is ready to turn on.'); btn('Turn on helper key'); }
    else if (q) { say(`Your charter is fine. This browser's helper key starts ${esc(new Date(q.eta).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }))}.`); btn('Check again'); }
    else { say('Your charter is fine. This browser has no helper key yet.'); btn('Add a helper key'); }
    return; }
  if (phase === 'idle') say(app.idle);
  form(app.form ? app.form() : ''); app.bind?.(); hero(app.hero ? app.hero() : null);
  btn(typeof app.btn === 'function' ? app.btn() : app.btn);
}
async function primary(auto = false) {
  if (phase === 'busy' || !cur) return; const st = A.stage(); if (!auto) sfx('click');
  if (st === 'connect') return A.connect().then(paint).catch(fail);
  if (st === 'rules') return openRules();
  if (st === 'wait' || st === 'key') { phase = 'busy'; btn(st === 'key' && !A.pendingKey() ? 'Approve in your wallet…' : 'Checking…', 'primary busy', true);
    try { if (st === 'key' && !(A.pendingKey() && Date.now() < A.pendingKey().eta)) { const r = await A.helperKey(); rcpt(A.txLine(r.tx, 'helper key')); } else await A.readRules(); phase = 'idle'; paint(); } catch (e) { fail(e); } return; }
  phase = 'busy'; btn(st === 'build' ? 'Approve in your wallet…' : 'Asking your charter…', 'primary busy', true); say(st === 'build' ? 'Building your charter…' : 'Asking your charter on chain…'); rcpt(''); if (st !== 'build') progress(cur);
  try {
    if (st === 'build') { const r = await A.buildCharter(); phase = 'idle'; rcpt(A.txLine(r.tx, 'charter built')); paint(); openRules(); return; }
    const res = await APPS[cur].run(); stopProgress(); phase = res.keep ? 'kept' : 'done';
    const kind = res.kind || (res.o ? verdict(res.o) : 'ok');
    const rule = res.rule || (res.o ? A.ruleFor(res.o, res.clause) : '');
    if (res.hero !== undefined) hero(res.hero);
    if (res.noform) form('');
    say(res.say); react(kind);
    rcpt((rule ? `<span class="rule ${kind}" data-testid="rule">${kind === 'ok' ? '✓' : '✕'} ${esc(rule)}</span>` : '') + (res.rc || A.txLine(res.o?.tx)));
    const app = APPS[cur]; btn(typeof app.btn === 'function' ? app.btn() : (res.keep ? app.btn : (AGAIN[cur] || 'Do it again'))); if (app.form && !res.noform) { form(app.form()); app.bind?.(); }
    document.body.dataset.app = kind; ruleChip(); proofDrawer();
  } catch (e) { fail(e); }
}
const AGAIN = { hall: 'Propose another rule', chronicle: 'Write another entry', ferry: 'Get a new quote', guard: 'Check another payee', arena: 'Try another message', payouts: 'Send another batch', house: 'Check again', bank: 'Send another note', toll: 'Pass the gate again' };
function fail(e) { stopProgress(); phase = 'idle'; say(`Stopped: ${esc(A.plainError(e).slice(0, 140))}`); rcpt(e.tx ? A.txLine(e.tx) : ''); const app = APPS[cur]; btn(A.stage() === 'ready' ? 'Try again' : 'Retry'); document.body.dataset.app = 'err'; }

// ---------- rules sheet ----------
function openRules() {
  const r = A.stage() === 'connect' ? null : A.rulesNow(); if (!r) return;
  const m = A.merchants(), opts = [[m[0], 'Café'], [m[1], 'Bookshop'], [A.S.me, 'Me']];
  const custom = r.receivers.filter(x => !opts.some(o => o[0] === x));
  const hr = (id, v) => `<select id="${id}">${Array.from({ length: 25 }, (_, h) => `<option value="${h * 60}" ${h * 60 === v ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select>`;
  const who = r.receivers.map(nice).join(', ') || 'nobody yet';
  $('#r-body').innerHTML = `
    <div class="safe" data-testid="safe-defaults"><b>Safe defaults</b><p>Pay only ${esc(who)} · at most ${esc(r.cap)} NEAR a payment · ${esc(r.budget)} NEAR and ${esc(r.count)} payments a day. Ferry trips up to ${esc(r.ferryCap)} NEAR. You can change these any time.</p></div>
    <details class="more" id="r-more" ${A.S.clauses.pay ? 'open' : ''}><summary>Customize<span class="dt">who, limits, hours</span></summary>
    <fieldset><legend>Who I may pay</legend><div class="chips">${opts.map(([a, t]) => `<label><input type="checkbox" name="rcv" value="${esc(a)}" ${r.receivers.includes(a) ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
      ${custom.length ? `<p class="note">Also allowed: ${custom.map(a => `<span title="${esc(a)}">${esc(nice(a))}</span>`).join(', ')}</p>` : ''}
      <details class="more"><summary>Advanced: add a NEAR account by its id</summary><input id="r-custom" aria-label="Other NEAR account ids, comma separated" placeholder="friend.testnet" value="${esc(custom.join(','))}"></details></fieldset>
    <div class="grid2">
      <label>Max per payment<span class="sfx"><input id="r-cap" type="number" step="0.001" min="0.001" value="${r.cap}"><i>NEAR</i></span></label>
      <label>Daily cap<span class="sfx"><input id="r-bud" type="number" step="0.01" min="0.001" value="${r.budget}"><i>NEAR</i></span></label>
      <label>Payments per day<input id="r-cnt" type="number" min="1" max="50" value="${r.count}"></label>
      <label>Smallest payment<span class="sfx"><input id="r-min" type="number" step="0.001" min="0.001" value="${r.min}"><i>NEAR</i></span></label>
      <label>Open from (UTC)${hr('r-ws', r.ws)}</label><label>Until (UTC)${hr('r-we', r.we)}</label>
    </div>
    <fieldset><legend>Ferry routes to ZEC</legend><div class="chips">${A.ROUTES.map(x => `<label><input type="checkbox" name="rt" value="${x.id}" ${r.routes.includes(x.id) ? 'checked' : ''}><span>${esc(x.label)}</span></label>`).join('')}</div>
      <label>Ferry max per trip<span class="sfx"><input id="r-fcap" type="number" step="0.01" min="0.002" value="${r.ferryCap}"><i>NEAR</i></span></label></fieldset>
    </details>`;
  $('#r-status').innerHTML = ''; $('#r-sign').disabled = false; $('#r-sign').textContent = A.S.clauses.pay ? 'Sign my new rules' : 'Use safe defaults';
  const d = $('#rules'); d.classList.add('open'); d.setAttribute('aria-hidden', 'false'); $('#r-sign').focus();
}
function closeRules() { const d = $('#rules'); d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); }
async function signRules() {
  const v = id => Number($(id).value);
  const rec = [...document.querySelectorAll('input[name=rcv]:checked')].map(i => i.value).concat($('#r-custom').value.split(',').map(s => s.trim()).filter(Boolean));
  const r = { receivers: [...new Set(rec)], cap: v('#r-cap'), budget: v('#r-bud'), count: v('#r-cnt'), min: v('#r-min'), ws: v('#r-ws'), we: v('#r-we') === 1440 && v('#r-ws') === 0 ? 0 : v('#r-we'),
    routes: [...document.querySelectorAll('input[name=rt]:checked')].map(i => i.value), ferryCap: v('#r-fcap') };
  const b = $('#r-sign'); b.disabled = true; b.textContent = 'Signing…';
  const STEPS = ['Approve in your wallet', 'Writing your rules to NEAR', 'Checking them on chain'], t0 = Date.now();
  const show = i => { $('#r-status').innerHTML = `<p class="note" data-testid="sign-eta">Usually about 20 s.</p><ol class="steps" data-testid="sign-steps" aria-live="polite">${STEPS.map((x, j) => `<li class="${j < i ? 'done' : j === i ? 'now' : ''}">${j < i ? '✓' : j === i ? '●' : '○'} ${x}${j === i && i > 0 ? ` · ${Math.round((Date.now() - t0) / 1000)} s` : ''}</li>`).join('')}</ol>`; };
  let step = 0; show(0); const tick = setInterval(() => { if (step === 0 && Date.now() - t0 > 2500) step = 1; if (step === 1 && Date.now() - t0 > 15000) step = 2; show(step); }, 1000);
  try { const o = await A.signRules(r).finally(() => clearInterval(tick)); $('#r-status').innerHTML = `<span class="rule ok">✓ ${o.queued ? 'signed · looser limits start ' + esc(A.pendingNote().replace(/^.*from /, '')) : 'signed · in force now'}</span> ${A.txLine(o.tx)}`; b.textContent = 'Signed'; sfx('allowed');
    setTimeout(() => { closeRules(); phase = 'idle'; paint(); rcpt(A.txLine(o.tx, 'rules signed')); }, 900);
  } catch (e) { clearInterval(tick); $('#r-status').innerHTML = `<span class="rule no">✕ ${esc(A.plainError(e).slice(0, 140))}</span>`; b.disabled = false; b.textContent = 'Try again'; }
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
export function mount(id, shop, scene) { for (const r of ['tray', 'drawer', 'rules', 'chron']) watchTokens(document.getElementById(r)); setTimeout(maybeOnboard, 600);
  cur = id; sh = shop; runScene = scene; phase = 'idle'; extra = {}; rcpt(''); document.body.dataset.app = '';
  { const d = $('#d-body'); lab = d && !d.querySelector('[data-guest]') ? d.innerHTML : ''; } boot(); paint(); proofDrawer();
  // a wallet connected elsewhere on the page (the town HUD) since the last room: pick it up
  if (A.S.ready) A.refresh().then(() => cur === id && phase !== 'busy' && paint()).catch(() => {});
  // the Toll room reopened with a visit under way: pick it up (countdown, or settle now if Base is final)
  if (id === 'toll') booted?.then(() => { const v = cur === 'toll' && A.stage() === 'ready' && A.tollVisit(); if (v && !v.done && phase === 'idle') primary(true); }).catch(() => {}); }
export function unmount() { cur = null; sh = null; closeRules(); }
export const rulesOpen = () => !!$('#rules')?.classList.contains('open');
export { closeRules };
window.__apps = { A, S: A.S, paint, primary, openRules, signRules, mount };

// Accessible names for explorer links and replay buttons, wherever a drawer renders them (they can sit in a
// collapsed drawer where their text has no layout, so screen readers and audits need an explicit name).
if (typeof MutationObserver !== 'undefined') {
  const label = () => { for (const a of document.querySelectorAll('a.tx:not([aria-label])')) { const u = a.getAttribute('href') || '', t = u.split('/').pop();
    a.setAttribute('aria-label', (/\/address\//.test(u) ? 'Open account ' : /sepolia/.test(u) ? 'Open Base Sepolia transaction ' : 'Open transaction ') + t.slice(0, 12) + ' in the explorer (new tab)'); }
    for (const b of document.querySelectorAll('[data-replay]:not([aria-label])')) b.setAttribute('aria-label', `Replay at ${b.dataset.replay}× speed`); };
  new MutationObserver(label).observe(document.documentElement, { childList: true, subtree: true }); label();
}
