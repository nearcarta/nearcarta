// Market Day: the city is the game. A new merchant's first day runs through all nine shops, one step
// each (shared/market/story.js). This layer owns the HUD (day progress, purse), the quest bar, the
// strip inside each shop panel (./quest-strip.js), the bag and the guide. The 3D cues (glowing door,
// lit road, the Town Crier) live in the world (design/D9_world/js/quest.js). Until a player signs in,
// the round is practice: the rules run in the browser and no transaction is sent.
import { API_PATH, txUrl } from '../../../shared/net/net.js';
import * as S from '/shared/market/sim.js';
import { whyHtml, yoctoToNear } from '/market/why.js';
import { ICON, iconFor } from '/market/icons.js';
import * as G from '/shared/market/guide.js';
import * as Q from '/shared/market/story.js';
import { createStrip } from '/market/quest-strip.js';
import * as R from '/market/live-play.js';

// The guest's real path on testnet. It is ~460 KB because it carries near-api-js, and a visitor who
// never presses a step must not download it on first load: this is a lazy proxy with the same shape as
// live-play.js, resolved on the first call a guest actually makes. Everything before that only asks
// `on()`, which is answered from localStorage with no network and no bundle.
let guestMod = null;
const guestReady = () => (guestMod ||= import('/market/live-guest.js'));
const GT = {
  on() {
    try {
      if (globalThis.NEARCARTA_NET?.net !== 'testnet') return false;
      const v = JSON.parse(globalThis.localStorage?.getItem('nearcarta.guest.v1') || 'null');
      return !!v?.account && v.net === 'testnet';
    } catch { return false; }
  },
  GUEST_STEPS: ['cargo', 'sell', 'invest', 'seal', 'pay', 'order', 'cross', 'check', 'write'],
  async step(id, ctx) { return (await guestReady()).step(id, ctx); },
  async history() { return (await guestReady()).history(); },
};

const $ = (s, r = document) => r.querySelector(s);
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ME = 'you';
const KEY = 'nearcarta.marketday.v1';
const NAME = { arena: 'Vault Arena', hall: 'Town Hall', ferry: 'Ferry', toll: 'Toll Bridge', guard: 'Guardhouse', bank: 'Mist Bank', house: 'Your House', payouts: 'Payouts', chronicle: 'Chronicle' };
const GOOD = (g) => S.GOODS[g]?.name || S.ITEMS[g]?.name || (g.startsWith('share:') ? `${NAME[g.slice(6)] || g.slice(6)} share` : g);
// Plain game words: the purse counts coins (1 coin = 0.0001 NEAR). The chain shows only in the Receipt.
const coins = (y) => { const t = (BigInt(y) * 10n) / Q.COIN; const w = t / 10n, f = t % 10n; return f ? `${w}.${f}` : `${w}`; };
const near = (y) => { const s = yoctoToNear(String(y)); const [a, b = ''] = s.split('.'); return b ? `${a}.${b.slice(0, 4).padEnd(4, '0')}` : `${a}.0000`; };

// ---------- state (practice) ----------
const reviver = (k, v) => (typeof v === 'string' && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v);
const replacer = (k, v) => (typeof v === 'bigint' ? v + 'n' : v);
function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) { const c = JSON.parse(raw, reviver); if (c?.shops && c.players) { c.caps ||= S.CAPS; return c; } } } catch {}
  return S.createCity();
}
let city = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(city, replacer)); } catch {} };
const me = () => S.player(city, ME);

// Town Hall posts three orders at each dawn (practice clerk, funded by the city).
const ORDERS = [
  ['good:timber', 3, 'Planks for the bridge'], ['good:iron', 2, 'Nails for the ferry'], ['good:salt', 2, 'Salt for the port'],
  ['good:herb', 2, 'Herbs for the watch'], ['item:tonic', 1, 'A tonic for the night shift'], ['item:tool', 1, 'A tool for the mill'],
];
function dawnOrders() {
  const day = S.cityClock(city.t).day;
  if (city.ordersDay === day) return;
  city.ordersDay = day;
  const clerk = S.player(city, 'clerk'); clerk.near = 100n * S.MILLI;
  city.orders = city.orders.filter((o) => o.poster !== 'clerk');
  for (let i = 0; i < 3; i++) {
    const [good, qty, text] = ORDERS[(day * 3 + i) % ORDERS.length];
    const reward = (good.startsWith('item:') ? 9n : 3n) * S.MILLI / 2n;
    S.postOrder(city, 'clerk', good, qty, reward, text);
  }
}

// ---------- DOM ----------
const root = h('div', 'md', '');
root.id = 'marketday';
root.innerHTML = `
<button class="md-enter" type="button" data-testid="md-enter"><span class="i">${ICON.play}</span><span>Market Day</span></button>
<div class="md-hud" role="status" aria-live="polite" data-testid="md-hud">
  <div class="md-day" title="Market Day: one step at each shop"><span class="i" data-k="phase"></span><span class="md-dots" data-k="dots"></span><b data-k="prog"></b>
    <!-- Progress a player can feel: a ring that fills, the step count, and the reward at the end. -->
    <span class="md-ring" data-k="ring" data-testid="md-ring" role="img" aria-label="Day progress">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="9" class="bg"/><circle cx="12" cy="12" r="9" class="fg" data-k="ringfg"/></svg>
    </span>
    <span class="md-reward" data-k="reward" data-testid="md-reward" hidden></span>
  </div>
  <button type="button" class="md-purse" data-v="receipt" data-testid="md-receipt" aria-label="Purse and receipt"><span class="i" data-k="pi">${ICON.coin}</span><b data-k="near"></b></button>
  <button type="button" class="md-exit" data-testid="md-exit" aria-label="Leave Market Day"><span class="i">${ICON.close}</span></button>
</div>
<div class="md-toasts" aria-live="polite"></div>
<nav class="md-dock" aria-label="Market Day">
  <button type="button" class="md-ask" data-v="ask" data-testid="md-ask" aria-label="Ask the Town Crier"><span class="i">${ICON.lamp}</span></button>
  <div class="md-quest" data-testid="md-quest"><span class="md-qn" data-k="qn"></span><span class="md-qt"><b data-k="qshop"></b><small data-k="qneed"></small></span><button type="button" class="md-week" data-v="week" data-testid="md-week" data-k="qweek" aria-label="A week in a minute" hidden><span class="i">${ICON.star}</span><span class="t">Week</span></button><button type="button" class="md-go" data-act="go" data-testid="md-go" data-k="qgo">Go</button></div>
  <button type="button" data-v="bag" data-testid="md-bag" aria-label="Your bag"><span class="i">${ICON.bag}</span><em data-k="bagn"></em></button>
</nav>
<section class="md-sheet" aria-hidden="true" data-testid="md-sheet"><div class="md-grab" aria-hidden="true"></div><div class="md-body"></div></section>`;
const K = (k) => root.querySelector(`[data-k="${k}"]`);

function toast(text, kind = 'ok') {
  const box = root.querySelector('.md-toasts'); const t = h('div', 'md-toast ' + kind, esc(text));
  box.append(t); while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => t.classList.add('out'), 2600); setTimeout(() => t.remove(), 3100);
}
const WHY = {
  ERR_TOO_SOON: 'This spot is resting. Try another one.', ERR_SHOP_CLOSED: 'Closed: out of funds. It still sells, or invest to reopen it.',
  ERR_BALANCE: 'Not enough in your bag.', ERR_FUNDS: 'Not enough coins. Sell something first.', ERR_STOCK: 'The shelf is empty.',
  ERR_TILL: 'The till cannot pay that much.', ERR_PLAYER_DAILY_CAP: 'Daily limit reached: you can earn more tomorrow.',
  ERR_CITY_DAILY_CAP: 'The city has paid its daily limit. Back tomorrow.', ERR_OWN_ORDER: 'That is your own order.', ERR_SMALL: 'Invest at least 10 coins.',
};
const fail = (e) => toast(WHY[e.code] || e.message, 'no');

// The reward a finished day pays, said in words: what you keep and what the day proved. Practice, the
// demo purse and a guest all end here; only the receipt line under it differs.
const REWARD_LINE = () => {
  const st = Q.state(city);
  const coinsEarned = BigInt(Q.STEPS.length) * BigInt(Q.COIN);
  return `you keep ${coins(coinsEarned)} coins${st.toll ? ` after ${coins(st.toll)} toll` : ''}${GT.on() ? ' · every step is a testnet receipt' : ''}`;
};

// ---------- HUD ----------
const PH = { dawn: 'dawn', market: 'sun', dusk: 'dusk', night: 'night' };
let lastPhase = null;
// Signed in: the purse is the real one, read from the market.
let realPurse = null;
const purse = () => (Q.state(city).sealed ? '••••' : coins(R.on() && realPurse != null ? realPurse : me().near));
async function readPurse() { if (!R.on()) return; const v = await R.coins(); if (v != null) { realPurse = v; hud(); } }
function hud() {
  const c = S.cityClock(city.t), p = me(), pr = Q.progress(city);
  K('phase').innerHTML = ICON[PH[c.phase]];
  K('dots').innerHTML = Q.STEPS.map((s, i) => `<i class="${i < pr.done ? 'done' : i === pr.done ? 'now' : ''}" title="${esc(NAME[s.shop])}"></i>`).join('');
  K('prog').textContent = `${pr.done}/${pr.total}`;
  // The ring fills with the day; a finished day shows the reward instead of a count.
  const ring = K('ringfg');
  if (ring) { const C = 2 * Math.PI * 9; ring.setAttribute('stroke-dasharray', String(C)); ring.setAttribute('stroke-dashoffset', String(C * (1 - Math.min(1, pr.done / pr.total)))); }
  const reward = K('reward');
  if (reward) {
    const done = pr.done >= pr.total;
    reward.hidden = !done;
    reward.innerHTML = done ? `${ICON.seal} <b>Day ${Q.state(city).day} sealed</b> <small>${REWARD_LINE()}</small>` : '';
  }
  K('near').textContent = purse();
  K('pi').innerHTML = Q.state(city).sealed ? ICON.seal : ICON.coin;
  const n = Object.entries(p.bag).filter(([g]) => !g.startsWith('share:')).reduce((a, [, v]) => a + v, 0);
  K('bagn').textContent = n || ''; K('bagn').hidden = !n;
  if (c.phase !== lastPhase) { lastPhase = c.phase; sky(c.phase); if (c.phase === 'dawn') dawnOrders(); }
}
let lifeMod = null;
function sky(phase) {
  if (!playing) return;
  const m = { dawn: 'day', market: 'day', dusk: 'dusk', night: 'night' }[phase];
  (lifeMod ||= import('/design/D9_world/js/life.js').catch(() => null)).then((L) => L?.setSky?.(m));
}

// ---------- the quest bar and the world cues ----------
let walking = false;
function quest() {
  const s = Q.current(city), pr = Q.progress(city);
  K('qn').textContent = s ? String(pr.done + 1) : '✓';
  K('qshop').textContent = s ? NAME[s.shop] : `Day ${Q.state(city).day} done`;
  K('qneed').textContent = s ? s.need : 'Your first coin is in the purse';
  const go = K('qgo'); go.textContent = walking ? 'On the way' : s ? 'Go' : `Day ${Q.state(city).day + 1}`; go.disabled = walking || guiding;
  K('qweek').hidden = !!s || walking;
  root.querySelector('.md-quest').classList.toggle('walking', walking);
}
// Light the road to the next shop and frame the guide and its door together.
function aim() {
  if (!playing || document.body.classList.contains('in-shop')) return;
  const s = Q.current(city); try { if (s) WD().quest?.target(s.shop); else WD().quest?.clear(); } catch {}
}
async function go() {
  if (walking || guiding) return;
  if (Q.finished(city)) { Q.nextDay(city); save(); hud(); quest(); aim(); WD().guideSay?.('A new day. The Hall has work.', { dur: 2.6 }); return; }
  const s = Q.current(city); walking = true; close(); quest();
  try {
    WD().guideSay?.(`To the ${NAME[s.shop]}.`, { dur: 1.8 });
    await WD().walkTo?.(s.shop); WD().guideWave?.();
    if (Q.firstVisit(city, s.shop)) { save(); if (!WD().keeperSay?.(s.shop, s.intro, { dur: 2.6 })) WD().guideSay?.(s.intro, { dur: 2.6 }); await new Promise((r) => setTimeout(r, 2000)); }
    WD().quest?.clear();
    await WD().enterShop?.(s.shop);
  } finally { walking = false; quest(); }
}

// ---------- the strip inside each shop ----------
let inShop = null, lastDone = null, whyOpen = false, flash = null, busy = false;
const strip = createStrip({ onClick: stripClick });
const num = (i) => `<span class="qs-n">${i}</span>`;
const okMark = `<span class="qs-n ok">${ICON.seal}</span>`;
const row = (lead, title, sub, btn) => `<div class="qs-row">${lead}<div class="qs-t"><b>${esc(title)}</b>${sub ? `<small>${sub}</small>` : ''}</div>${btn || ''}</div>`;
const gold = (act, label, extra = '') => `<button type="button" class="qs-go" data-qs="${act}" data-testid="qs-${act}" ${extra}>${esc(label)}</button>`;
const ghost = (act, label, extra = '') => `<button type="button" class="qs-ghost" data-qs="${act}" data-testid="qs-${act}" ${extra}>${esc(label)}</button>`;
const proofLink = (p) => (p ? `<a class="qs-proof" href="${p.url}" target="_blank" rel="noopener">${esc(p.label)} ↗</a>` : '');
const whyBlock = (good) => { const q = S.quoteAt(city, 'arena', good); return `<button type="button" class="qs-link" data-qs="why" aria-expanded="${whyOpen}">${ICON.info}<span>Why this price?</span></button>${whyOpen ? `<div class="qs-why md-why">${whyHtml(q, GOOD(good), (y) => `${coins(y)} coins`)}</div>` : ''}`; };

// What each step costs, said before the press, and what it cost after, with THIS action's receipt.
// Only the steps with a market move are real; the rest say so: practice, no spend.
const REAL_STEP = { seal: 'The Bank seals it for you and pays the gas', cargo: 'Free: 3 salt from the berths', sell: 'Coins go into your purse', invest: 'Spends 10 coins (0.001 NEAR) from your purse' };
const nearTxt = (y) => { const v = Number(BigInt(y || 0) / 10n ** 18n) / 1e6; return `${v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} NEAR`; };
const testnetPill = '<span class="qs-net-pill" data-testid="testnet-pill">TESTNET</span>';
const costLine = (s) => (GT.on() && GT.GUEST_STEPS.includes(s.id)
  ? `${testnetPill} Real testnet move · free`
  : (!R.on() && R.DEMO_STEPS.includes(s.id) ? 'Real move, played with the city’s demo purse · the city pays the gas' : R.on() && REAL_STEP[s.id] ? `${REAL_STEP[s.id]} · no gas, the city pays it` : '<span class="qs-chip">Practice, no spend</span>'));
// One pill a judge cannot miss, plus the receipt link, on every real guest step.
const guestReceipt = (r) => {
  const pill = testnetPill;
  if (r.real?.refused_hash) {
    return `${pill} The con artist was refused on testnet · <a class="qs-proof" href="${txUrl(esc(r.real.refused_hash))}" target="_blank" rel="noopener">Refused ↗</a>${r.real.hash ? ` · <a class="qs-proof" href="${txUrl(esc(r.real.hash))}" target="_blank" rel="noopener">Paid ↗</a>` : ''}`;
  }
  if (r.real?.broadcast === false) {
    // No Base Sepolia ETH: the MPC signature is real, the foreign transaction is not sent.
    const signed = r.real.raw_signed ? ` Signed transaction: <code>${esc(String(r.real.raw_signed).slice(0, 22))}…</code>` : '';
    const evm = r.real.evm_hash ? ` Base Sepolia hash <code>${esc(String(r.real.evm_hash).slice(0, 14))}…</code> (never broadcast, so no explorer page).` : '';
    if (r.real.failure && !r.real.evm_hash) return `${pill} The MPC signature did not come back this time: ${esc(String(r.real.failure).slice(0, 90))}${r.real.hash ? ` · <a class="qs-proof" href="${txUrl(esc(r.real.hash))}" target="_blank" rel="noopener">Receipt ↗</a>` : ''}`;
    return `${pill} Signed by NEAR's MPC network on testnet, not sent to Base Sepolia.${signed}${evm}${r.real.hash ? ` <a class="qs-proof" href="${txUrl(esc(r.real.hash))}" target="_blank" rel="noopener">Signature ↗</a>` : ''}`;
  }
  if (r.real?.failure) {
    const why = (/panicked: ([^"\\]+)/.exec(String(r.real.failure)) || [])[1] || String(r.real.failure).slice(0, 90);
    return `${pill} The testnet transaction was refused: ${esc(why)}${r.real.hash ? ` · <a class="qs-proof" href="${txUrl(esc(r.real.hash))}" target="_blank" rel="noopener">Receipt ↗</a>` : ''}`;
  }
  if (r.real?.hash) return `${pill} <a class="qs-proof" href="${txUrl(esc(r.real.hash))}" target="_blank" rel="noopener">Receipt ↗</a> · a real testnet transaction`;
  return `${pill} No transaction this time. Practice mode still works.`;
};
const receiptLine = (step, r) => {
  if (GT.on() && r.real) return guestReceipt(r);
  if (r.real?.hash && r.real.demo) return `Played with the city’s demo purse · <a class="qs-proof" href="${txUrl(esc(r.real.hash))}" target="_blank" rel="noopener">Receipt ↗</a> · the city paid ${esc(r.real.burnt_near)} NEAR gas`;
  if (r.real?.hash) return `<a class="qs-proof" href="${txUrl(esc(r.real.hash))}" target="_blank" rel="noopener">Receipt ↗</a> · you paid 0 NEAR${r.real.burnt_near ? `, the city paid ${esc(r.real.burnt_near)} NEAR gas` : ''}`;
  return '<span class="qs-chip">Practice, no spend</span>';
};
function stripHtml(id) {
  const s = Q.current(city), pr = Q.progress(city), p = me();
  if (lastDone && lastDone.shop === id) {
    const r = lastDone.res, nx = Q.current(city);
    let sub = receiptLine(lastDone.step, r);
    if (lastDone.step.id === 'sell') sub = `+${coins(r.total)} coins · price ${coins(r.before)} → ${coins(r.after)}<br>Your sale pushed the price down: the shelf has more salt now.<br>${receiptLine(lastDone.step, r)}`;
    if (lastDone.step.id === 'invest' && r.real?.saving) sub = `The city’s demo purse is saving up: ${coins(BigInt(r.real.have || 0))} of 10 coins for its next share<br><span class="qs-chip">Practice, no spend</span>`;
    else if (lastDone.step.id === 'invest') sub = `${r.real?.demo ? '1 Ferry share bought by the demo purse for 10 coins (0.001 NEAR)' : '1 Ferry share for 10 coins (0.001 NEAR) · it pays you a part of the Ferry’s sales'}<br>${receiptLine(lastDone.step, r)}`;
    const ex = (pf) => (pf ? ` · <a class="qs-proof" href="${pf.url}" target="_blank" rel="noopener">Example on chain ↗</a>` : '');
    const done = lastDone.step.id, pr0 = lastDone.step.proof;
    if (done === 'cargo') sub = `3 salt from the berths, no swap needed<br>${receiptLine(lastDone.step, r)}`;
    if (done === 'cross') sub = `Toll: 1 coin, taken at the sale<br><span class="qs-chip">Practice, no spend</span>${ex(pr0)}`;
    if (done === 'check') sub = `✓ Square keeper: cleared<br>✗ Stranger: refused, not on your list<br><span class="qs-chip">Practice, no spend</span>${ex(pr0)}`;
    if (done === 'seal' && r.real?.hash) sub = `Check passed · the amount stays hidden<br>The Bank sealed it for you: <a class="qs-proof" href="${txUrl(esc(r.real.hash))}" target="_blank" rel="noopener">Receipt ↗</a> · ${esc(r.real.burnt_near)} NEAR gas, paid by the Bank<br>Your reveal key stays in this browser`;
    else if (done === 'seal') sub = `Check passed · the amount stays hidden<br>On chain the Bank logs only a fingerprint: <a class="qs-proof" href="${pr0.url}" target="_blank" rel="noopener">Bank anchor ↗</a> · ${pr0.cost} NEAR gas, paid by the Bank<br><span class="qs-chip">Your seal: practice, no spend</span>`;
    if (done === 'pay') sub = `Paid to: your porter · 3 coins from your purse · invoice #${Q.state(city).day} kept<br><span class="qs-chip">Practice, no spend</span>`;
    if (GT.on() && r.real && (done === 'cross' || done === 'check' || done === 'pay' || done === 'seal')) {
      const what = { cross: 'Toll: the fee paid from your row', check: '✓ Square keeper: paid<br>✗ Look-alike: refused, not on your list', pay: 'Porter paid 3 test dollars, under your cap', seal: 'Check passed · the amount stays hidden<br>Your own row anchored only a fingerprint; the reveal key stays in this browser' }[done];
      sub = `${what}<br>${guestReceipt(r)}`;
    }
    if (done === 'write') { const today = Q.state(city).log.map((e) => `${NAME[e.shop]}: ${esc(Q.STEP[e.id].done)}`); sub = `Level ${r.level}${GT.on() ? '' : ` · your purse keeps ${coins(p.near)} coins`}<br>Today, ${today.length} entries:<br>${today.join('<br>')}<br>${receiptLine(lastDone.step, r)}`; }
    const extra = lastDone.step.id === 'sell' ? `<div class="qs-more">${whyBlock('good:salt')}</div>` : '';
    return { gold: true, html: row(okMark, r.line, sub, gold('next', nx ? `Next: ${NAME[nx.shop]}` : 'Back to town')) + extra };
  }
  if (s && s.shop === id) {
    let reward = esc(s.reward), extra = '';
    if (s.id === 'sell') { const pv = Q.salePreview(city); const c2 = structuredClone(city); let t = 0n; try { t = S.sell(c2, Q.ME, 'arena', 'good:salt', pv.n); } catch {} reward = `+${coins(t)} coins · ${coins(pv.before)} each`; extra = `<div class="qs-more">${whyBlock('good:salt')}</div>`; }
    return { gold: true, html: row(num(pr.done + 1), s.need, `${reward}<br>${costLine(s)}`, gold('act', s.btn)) + extra };
  }
  // off the story path: the Square is still the market and producing shops still make goods
  if (id === 'arena' && R.on() && !s && !R.live.stall) return { gold: true, html: row(`<span class="qs-n tok">${ICON.bag}</span>`, 'Rent a stall', '10 coins a week, from your purse', gold('stall', 'Rent')) };
  if (id === 'arena') { const g = Object.keys(S.GOODS).find((k) => p.bag[k] && city.shops.arena.goods[k]); if (g) { const n = Math.min(p.bag[g], S.MAX_QTY); const c2 = structuredClone(city); let t = 0n; try { t = S.sell(c2, Q.ME, 'arena', g, n); } catch {} return { gold: true, html: row(`<span class="qs-n tok">${iconFor(g)}</span>`, `Sell ${n} ${GOOD(g).toLowerCase()}`, `+${coins(t)} coins`, gold('sell', 'Sell', `data-good="${g}" data-n="${n}"`)) + `<div class="qs-more">${whyBlock(g)}</div>` }; } }
  const berths = S.nodesAt(id);
  if (berths.length) { const good = berths[0][1]; const wait = Math.min(...berths.map(([n]) => S.cooldown(city, Q.ME, n))); return { gold: !wait, html: row(`<span class="qs-n tok">${iconFor(good)}</span>`, `${NAME[id]} makes ${GOOD(good).toLowerCase()}`, wait ? `Ready in ${wait}s` : '+1 each berth', wait ? ghost('collect', 'Collect', 'disabled') : gold('collect', 'Collect')) }; }
  if (s) return { gold: false, html: row(`<span class="qs-n dim">${pr.done + 1}</span>`, `Next stop: ${NAME[s.shop]}`, esc(s.need), ghost('there', 'Go')) };
  return null;
}
function paintStrip() {
  if (!playing || !inShop) { strip.hide(); return; }
  const v = stripHtml(inShop); if (!v) { strip.hide(); return; }
  if (flash && flash.shop === inShop) v.html = v.html.replace(/<small>[\s\S]*?<\/small>/, `<small class="qs-flash${flash.no ? ' no' : ''}">${esc(flash.text)}</small>`);
  strip.show(v.html, { gold: v.gold });
}
async function stripClick(a, b) {
  try {
    if (a === 'act') {
      if (busy) return;
      const step = Q.current(city); let real = null;
      if (GT.on()) { busy = true; flash = { shop: inShop, text: 'Sending one testnet transaction…' }; paintStrip(); try { real = await GT.step(step.id, { shop: Q.state(city).dark || 'ferry' }); } finally { busy = false; } }
      else if (R.on()) { busy = true; flash = { shop: inShop, text: 'One moment…' }; paintStrip(); try { real = await R.step(step.id, { shop: Q.state(city).dark || 'ferry' }); } finally { busy = false; } }
      else if (R.DEMO_STEPS.includes(step.id)) { busy = true; flash = { shop: inShop, text: 'One moment…' }; paintStrip(); try { real = await R.demo(step.id); } finally { busy = false; } }
      const res = Q.act(city, inShop); if (real) { res.real = real; if (step.id === 'sell' && real.total != null && BigInt(real.total) > 0n) res.total = BigInt(real.total); }
      lastDone = { shop: inShop, step, res }; lastDeed = { shop: inShop, text: DEED[step.id] };
      save(); hud(); quest(); seal(b); whyOpen = false; flash = null; readPurse();
    } else if (a === 'why') whyOpen = !whyOpen;
    else if (a === 'stall') { if (busy) return; busy = true; flash = { shop: inShop, text: 'One moment…' }; paintStrip(); try { await R.rentStall(1); R.live.stall = 1; flash = { shop: inShop, text: 'Stall 1 is yours for a week' }; readPurse(); } finally { busy = false; } }
    else if (a === 'sell') { const t = S.sell(city, Q.ME, 'arena', b.dataset.good, +b.dataset.n); flash = { shop: inShop, text: `Sold for ${coins(t)} coins` }; save(); hud(); }
    else if (a === 'collect') { let got = 0, good = null; for (const [n, g] of S.nodesAt(inShop)) { try { got += S.gather(city, Q.ME, n); good = g; } catch {} } if (got) flash = { shop: inShop, text: `+${got} ${GOOD(good).toLowerCase()} in your bag` }; save(); hud(); }
    else if (a === 'next' || a === 'there') { lastDone = null; strip.hide(); await WD().exitShop?.(); if (Q.current(city)) setTimeout(go, 350); return; }
    paintStrip();
  } catch (e) { flash = { shop: inShop, text: WHY[e.code] || e.message, no: true }; paintStrip(); }
}
addEventListener('world:interior-ready', (e) => { inShop = e.detail?.id || null; flash = null; if (lastDone && lastDone.shop !== inShop) lastDone = null; whyOpen = false; setTimeout(paintStrip, 30); });
// what a keeper did while you were inside, said in the street as you step out: the world shows them buying, selling, refusing
const DEED = { order: 'Order posted: 3 salt.', cargo: 'Salt unloaded. My till paid for it.', cross: 'Toll noted. Paid at the sale.', check: 'Refused the stranger. A con artist.',
  sell: 'Bought your salt. My shelf is fuller now.', seal: 'Your profit is hidden.', pay: 'Porter paid, under your cap.', invest: 'Lights are back on. Thank you, partner.', write: 'Day written in the book.' };
let lastDeed = null;
addEventListener('world:exterior-ready', (e) => { const was = inShop || e.detail?.id; inShop = null; lastDone = null; strip.hide(); aim();
  if (playing && lastDeed && lastDeed.shop === was) { const d = lastDeed; lastDeed = null; setTimeout(() => WD().keeperSay?.(d.shop, d.text), 400); } });
// tap a keeper: their card (name, mood, purse, what they did today)
let keeperId = null;
addEventListener('world:keeper-tap', (e) => { if (!playing || walking || guiding) return; keeperId = e.detail.id; open('keeper'); liveMarket(); });
// The keepers are real: their purse, till and shelf come from the market and their own wallets (GET /api/market/live).
let live = null, liveAt = 0;
async function liveMarket() { if (Date.now() - liveAt < 15000) return; liveAt = Date.now();
  try { const r = await fetch(API() + API_PATH + '/market/live', { signal: AbortSignal.timeout(8000) }); if (r.ok) { live = await r.json(); if (view === 'keeper') render(); } } catch { /* the practice values stay */ } }
setInterval(() => { if (playing && inShop && !lastDone && S.nodesAt(inShop).length) paintStrip(); }, 1000);

// ---------- sheet: the bag and the guide ----------
let view = null;
const sheet = () => root.querySelector('.md-sheet');
function open(v) { document.body.classList.add('md-sheet-open'); view = v; render(); sheet().classList.add('open'); sheet().setAttribute('aria-hidden', 'false'); root.querySelectorAll('.md-dock [data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); }
function close() { document.body.classList.remove('md-sheet-open'); view = null; sheet().classList.remove('open'); sheet().setAttribute('aria-hidden', 'true'); root.querySelectorAll('.md-dock [data-v]').forEach((b) => b.classList.remove('on')); }
const refresh = () => { if (view) render(); };
const head = (icon, title, sub) => `<header class="md-head"><span class="md-badge">${icon}</span><div><h2>${esc(title)}</h2><p>${esc(sub)}</p></div><button type="button" class="md-icon" data-act="close" aria-label="Close">${ICON.close}</button></header>`;

function vBag() {
  const p = me(); const tiles = [...Object.keys(S.GOODS), ...Object.keys(S.ITEMS)].map((g) => `<div class="md-tile ${p.bag[g] ? '' : 'empty'}"><span class="md-tok">${iconFor(g)}</span><b>${p.bag[g] || 0}</b><small>${GOOD(g)}</small></div>`).join('');
  const shares = Object.entries(p.bag).filter(([g]) => g.startsWith('share:'));
  const sh = shares.length ? `<h3 class="md-sub">Shares</h3><div class="md-list">${shares.map(([g, n]) => { const id = g.slice(6); const d = S.pending(city, ME, id); return `<div class="md-row static"><span class="md-tok">${ICON.share}</span><span class="md-nm"><b>${esc(NAME[id])}</b><small>${n} shares</small></span><button type="button" class="md-ghost sm" data-act="claim" data-shop="${id}" ${d > 0n ? '' : 'disabled'}>Claim ${near(d)}</button></div>`; }).join('')}</div>` : '';
  const recipes = Object.entries(S.ITEMS).map(([item, r]) => { const ok = Object.entries(r.inputs).every(([g, n]) => (p.bag[g] || 0) >= n);
    const ins = Object.entries(r.inputs).map(([g, n]) => `<span class="md-in ${(p.bag[g] || 0) >= n ? '' : 'miss'}"><span class="md-tok xs">${iconFor(g)}</span>${n}</span>`).join('<span class="md-plus">+</span>');
    return `<div class="md-recipe"><div class="md-ins">${ins}<span class="md-arrow">→</span><span class="md-tok">${iconFor(item)}</span></div><div class="md-rtxt"><b>${GOOD(item)}</b><small>${esc(r.use)}</small></div><button type="button" class="md-ghost sm" data-act="craft" data-item="${item}" ${ok ? '' : 'disabled'} data-testid="md-craft-${item.slice(5)}">Craft</button></div>`; }).join('');
  const sellable = Object.keys(S.GOODS).some((g) => p.bag[g]);
  return head(ICON.bag, 'Your bag', `${purse()} coins` + (p.bag['item:tool'] ? ` · tool: ${S.TOOL_LIFE - p.toolUses} gathers left` : ''))
    + `<div class="md-grid">${tiles}</div>${sh}<h3 class="md-sub">Craft</h3>${recipes}`
    + `<p class="md-hint">${sellable ? 'Sell at the Vault Arena square.' : 'Shops make goods: the Ferry, the Toll Bridge, the Guardhouse and your House.'}</p>`;
}

// The Receipt: the only place the chain shows. Quiet, for the curious and for judges.
function vReceipt() {
  const done = Q.STEPS.slice(0, Q.progress(city).done);
  const rows = done.map((x) => `<div class="md-row static"><span class="md-tok">${ICON.seal}</span><span class="md-nm"><b>${esc(NAME[x.shop])}</b><small>${esc(x.done)}</small></span>${x.proof ? `<a class="md-ghost sm" href="${x.proof.url}" target="_blank" rel="noopener" title="${esc(x.proof.label)}">Record ↗</a>` : ''}</div>`).join('');
  const txs = R.on() ? (R.live.txs || []) : [];
  const real = txs.map((t) => `<div class="md-row static"><span class="md-tok">${ICON.coin}</span><span class="md-nm"><b>${esc(t.what)}</b><small>${esc(t.hash.slice(0, 10))}…${t.burnt ? ` · gas ${esc(t.burnt)} NEAR, paid by the city` : ''}</small></span><a class="md-ghost sm" href="${txUrl(encodeURIComponent(t.hash))}" target="_blank" rel="noopener">Tx ↗</a></div>`).join('');
  return head(ICON.seal, 'Receipt', `${purse()} coins · ${done.length}/9 steps`)
    + (real ? `<h3 class="md-sub">Your moves on NEAR mainnet</h3><div class="md-list" data-testid="md-real-txs">${real}</div>` : '')
    + (rows ? `<div class="md-list">${rows}</div>` : '<p class="md-hint">Nothing yet. Your first stop is the Town Hall.</p>')
    + (R.on() ? `<p class="md-hint">Real round as ${esc(R.live.account.slice(0, 8))}…: market moves are mainnet transactions from your wallet, gas paid by the city. Other steps link the recorded transaction of the same action. 1 coin = 0.0001 NEAR. All proofs: <a href="/judge">/judge</a>.</p>`
      : '<p class="md-hint">Practice round: the city’s rules run here. Each Record is a real mainnet transaction of the same action. 1 coin = 0.0001 NEAR. All proofs: <a href="/judge">/judge</a>.</p>');
}
function mood(sh) { if (!S.isOpen(sh)) return ['Worried', 'The till is under the floor. The shop is dark.']; if (sh.till >= sh.floor * 2n) return ['Cheerful', 'A full till and steady trade.']; return ['Steady', 'Enough in the till to trade.']; }
function vKeeper() {
  const id = keeperId, st = Q.STEPS.find((x) => x.shop === id); const name = st?.keeper || 'Keeper';
  const ls = live?.shops?.find((x) => x.id === id), lk = live?.keepers?.[id];
  const sh = ls ? { till: BigInt(ls.till), floor: BigInt(ls.floor), trades: Number(ls.trades) } : city.shops[id];
  if (!sh) return head(ICON.lamp, name, NAME[id] || '');
  const [m, why] = mood(sh); const done = Q.progress(city).done > Q.STEPS.indexOf(st);
  const shelf = ls ? ls.goods.map((g) => `${S.GOODS[g.good]?.name || g.good} ${coins(BigInt(g.buy || 0))} · ${g.stock} left`).join(', ') : '';
  const rows = [['Mood', `${m}`, why], ['Purse', `${coins(lk ? BigInt(lk.purse) : sh.till)} coins`, lk ? 'Their own wallet' : 'Their own till. They buy and sell from it'],
    ...(ls ? [['Till', `${coins(sh.till)} coins`, shelf]] : []), ['Trades today', String(sh.trades), done && st ? DEED[st.id] : 'Waiting for you']];
  return head(ICON.lamp, name, NAME[id]) + `<div class="md-list">${rows.map(([k, v, sub]) => `<div class="md-row static"><span class="md-nm"><b>${esc(k)}</b><small>${esc(sub)}</small></span><b class="md-val">${esc(v)}</b></div>`).join('')}</div>`;
}
// Fast-forward: a week of the city in a minute. The crowd trades, prices follow the shelves, a con artist is refused,
// dark shops reopen, and mid-week the council changes a rule. Nobody ships code. Practice round: a preview, your day is kept.
let week = null;
const DAYH = (h) => `Day ${Math.floor((h - 1) / 24) + 1}`;
const evText = (e) => e.kind === 'refused' ? `Con artist refused at ${NAME[e.shop] || e.shop}` : e.kind === 'rule' ? 'Council vote: a lower floor keeps shops open' : `${NAME[e.shop] || e.shop} reopened`;
function weekStart() { const w = S.runWeek({ seed: 7 + Q.state(city).day, city: structuredClone(city) }); const g = 'good:salt';
  const ys = w.rows.map((r) => Number(r.avg[g] / (Q.COIN / 10n)) / 10); week = { w, ys, min: Math.min(...ys), max: Math.max(...ys), h: 0, t0: performance.now(), raf: 0 }; weekTick(); }
function weekTick() { if (!week || view !== 'week') return; const H = week.w.rows.length; week.h = Math.min(H, Math.max(1, Math.floor(((performance.now() - week.t0) / 60000) * H)));
  const body = root.querySelector('.md-body'); const sv = body.querySelector('.md-wk-line'); if (!sv) return;
  const X = (i) => (i / (H - 1)) * 300, Y = (v) => 88 - ((v - week.min) / Math.max(.1, week.max - week.min)) * 76;
  sv.setAttribute('points', week.ys.slice(0, week.h).map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' '));
  const r = week.w.rows[week.h - 1]; body.querySelector('[data-w=clock]').textContent = `${DAYH(week.h)} · ${String((week.h - 1) % 24).padStart(2, '0')}:00`;
  body.querySelector('[data-w=price]').textContent = `${week.ys[week.h - 1].toFixed(1)} coins`; body.querySelector('[data-w=open]').textContent = `${r.open}/9`;
  const seen = week.w.events.filter((e) => e.hour <= week.h), rule = seen.find((e) => e.kind === 'rule'); const evs = [...(rule ? [rule] : []), ...seen.filter((e) => e !== rule).slice(rule ? -1 : -2).reverse()];
  body.querySelector('[data-w=feed]').innerHTML = evs.map((e) => `<div class="md-row static"><span class="md-nm"><b>${esc(evText(e))}</b><small>${DAYH(e.hour)}</small></span></div>`).join('');
  const vote = week.w.events.find((e) => e.kind === 'rule'); const vm = body.querySelector('.md-wk-vote'); if (vote && vm) { vm.style.display = week.h >= vote.hour ? '' : 'none'; vm.setAttribute('x1', X(vote.hour - 1)); vm.setAttribute('x2', X(vote.hour - 1)); }
  const done = week.h >= H; body.querySelector('[data-w=end]').hidden = !done; body.querySelector('[data-act=wskip]').hidden = done;
  if (!done) week.raf = requestAnimationFrame(weekTick); }
// First the real thing: the market's own history from the chain, replayed. Then a practice tail.
let replay = null;
const ago = (t) => { const m = Math.max(1, Math.round((Date.now() - t) / 60000)); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
async function replayStart() {
  replay = { events: null, i: 0, t0: performance.now(), raf: 0, err: '' };
  try { const r = await fetch(API() + API_PATH + '/market/history', { signal: AbortSignal.timeout(9000) }); const j = await r.json(); replay.events = j.events || []; } catch { replay.events = []; replay.err = 'The history did not load.'; }
  if (view === 'week') render();
}
function replayTick() {
  if (!replay?.events || view !== 'week' || week) return; const body = root.querySelector('.md-body'); const feed = body.querySelector('[data-w=real]'); if (!feed) return;
  const n = replay.events.length; replay.i = Math.min(n, Math.floor((performance.now() - replay.t0) / 350) + 1);
  const shown = replay.events.slice(0, replay.i).slice(-5).reverse();
  feed.innerHTML = shown.map((e) => `<div class="md-row static ${e.kind === 'refused' ? 'no' : ''}"><span class="md-nm"><b>${esc(e.line)}</b><small>${ago(e.t)}</small></span></div>`).join('');
  body.querySelector('[data-w=count]').textContent = `${replay.i}/${n}`;
  const done = replay.i >= n; body.querySelector('[data-act=wnext]').hidden = !done; body.querySelector('[data-act=wskip]').hidden = done;
  if (!done) replay.raf = requestAnimationFrame(replayTick);
}
function vReplay() {
  const ev = replay?.events;
  return head(ICON.star, 'The market so far', 'Replayed from the chain') + `<div class="md-wk"><div class="md-wk-top"><span class="md-chip real">Real</span><span>Moves <b data-w="count">${ev ? `0/${ev.length}` : '…'}</b></span></div>
  <div class="md-list" data-w="real">${ev ? '' : '<p class="md-hint" role="status">Reading the market…</p>'}</div>${replay?.err ? `<p class="md-hint no">${esc(replay.err)}</p>` : ''}
  <button type="button" class="md-ghost sm" data-act="wskip" ${ev?.length ? '' : 'hidden'}>Skip to now</button><button type="button" class="md-gold" data-act="wnext" hidden data-testid="md-wnext">Practice the next week</button></div>`;
}
function vWeek() {
  if (!week) return vReplay();
  return head(ICON.star, 'Practice: the next week', 'A preview. Nothing here is sent') + `<div class="md-wk"><div class="md-wk-top"><span class="md-chip practice">Practice</span><b data-w="clock">Day 1</b><span>Salt <b data-w="price"></b></span><span>Open <b data-w="open"></b></span></div>
  <svg class="md-wk-chart" viewBox="0 0 300 96" preserveAspectRatio="none" aria-label="Salt price over the week"><line class="md-wk-vote" x1="0" x2="0" y1="4" y2="92" style="display:none"/><polyline class="md-wk-line" points=""/></svg>
  <div class="md-list" data-w="feed"></div><p class="md-hint" data-w="end" hidden>Practice: a week passed. No patch, no developer: prices followed the shelves, and the council changed a rule.</p>
  <button type="button" class="md-ghost sm" data-act="wskip">Skip to the end</button></div>`;
}
let signStage = 'email', signEmail = '', signErr = '';
function vSign() {
  const f = signStage === 'email'
    ? `<input type="email" required autocomplete="email" placeholder="you@example.com" aria-label="Email" data-testid="md-email" value="${esc(signEmail)}"><button type="submit" class="md-gold" data-testid="md-send">Send code</button>`
    : signStage === 'code' ? `<input inputmode="numeric" required autocomplete="one-time-code" placeholder="Code from your email" aria-label="Code" data-testid="md-code"><button type="submit" class="md-gold" data-testid="md-login">Start</button>`
    : '<p class="md-hint" role="status">One moment…</p>';
  return head(ICON.coin, 'Play for real', 'Your email opens your purse. No wallet, no fees.')
    + `<form class="md-sign" data-testid="md-sign">${f}</form>${signErr ? `<p class="md-hint no" role="alert">${esc(signErr)}</p>` : ''}`
    + '<button type="button" class="md-ghost sm" data-act="practice" data-testid="md-practice">Practice first</button>';
}
root.addEventListener('submit', async (e) => {
  if (!e.target.closest('.md-sign')) return; e.preventDefault(); signErr = '';
  const v = e.target.querySelector('input')?.value || '';
  try {
    if (signStage === 'email') { signEmail = v; signStage = 'sending'; render(); await R.sendCode(v); signStage = 'code'; }
    else if (signStage === 'code') { signStage = 'opening'; render(); await R.login(signEmail, v); signStage = 'email'; close(); toast('Your purse is open'); readPurse(); return; }
  } catch (x) { signStage = signStage === 'opening' ? 'code' : 'email'; signErr = x?.message || 'That did not work. Try again.'; }
  if (view === 'signin') render();
});
function render() {
  const body = root.querySelector('.md-body');
  body.innerHTML = view === 'signin' ? vSign() : view === 'bag' ? vBag() : view === 'ask' ? vAsk() : view === 'receipt' ? vReceipt() : view === 'keeper' ? vKeeper() : view === 'week' ? vWeek() : '';
  if (view === 'week') { cancelAnimationFrame(week?.raf || 0); cancelAnimationFrame(replay?.raf || 0); if (!week) { if (!replay) replayStart(); else replayTick(); } else weekTick(); }
}

root.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-act],[data-v]'); if (!b || b.disabled) return;
  if (b.dataset.v) { if (guiding || walking) return; if (b.dataset.v === 'week') { week = null; replay = null; } view === b.dataset.v ? close() : open(b.dataset.v); if (view === 'ask') setTimeout(() => root.querySelector('.md-say input')?.focus(), 60); return; }
  if (b.dataset.act === 'ask') { ask(b.dataset.text || root.querySelector('.md-say input')?.value || ''); return; }
  const a = b.dataset.act;
  try {
    if (a === 'close') close();
    else if (a === 'practice') { R.live.practice = 1; try { localStorage.setItem('nearcarta.marketday.live', JSON.stringify(R.live)); } catch {} close(); }
    else if (a === 'go') go();
    else if (a === 'wskip') { if (week) { week.t0 = performance.now() - 60000; weekTick(); } else if (replay) { replay.t0 = -1e9; replayTick(); } return; }
    else if (a === 'wnext') { weekStart(); render(); return; }
    else if (a === 'claim') toast(`Claimed ${coins(S.claim(city, ME, b.dataset.shop))} coins`);
    else if (a === 'craft') { S.craft(city, ME, b.dataset.item); toast(`Crafted a ${GOOD(b.dataset.item).toLowerCase()}`); }
    save(); hud(); refresh();
  } catch (e) { fail(e); }
});
function seal(b) { if (RM) return; b.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(.97)' }, { transform: 'scale(1)' }], { duration: 220 }); }
// Escape closes an open agent sheet first and stays in the shop; only when no sheet is open does
// it leave. A capture-phase listener runs before the sheet's own, so this must know about it.
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !view) return;
  const pop = document.querySelector("[id$='-agent-pop']:not([hidden])");
  if (pop) {
    pop.hidden = true;
    const toggle = document.getElementById(pop.id.replace(/-pop$/, '-toggle'));
    if (toggle) { toggle.setAttribute('aria-expanded', 'false'); try { toggle.focus(); } catch {} }
    e.stopPropagation();
    e.preventDefault();
    return;
  }
  close();
  e.stopPropagation();
}, true);

// ---------- the guide: talk to the Town Crier; it walks to the right shop and acts ----------
const API = () => (window.NEARCARTA_API || '').replace(/\/$/, '');
let guiding = false;
function chips() {
  const p = me(); const out = [];
  const g = Object.keys(S.GOODS).filter((k) => (p.bag[k] || 0) > 0).sort((a, b) => p.bag[b] - p.bag[a])[0];
  if (g) out.push(`Sell my ${GOOD(g).toLowerCase()}`);
  if (city.orders.some((o) => o.poster !== ME && (p.bag[o.good] || 0) > 0)) out.push('Fill an order');
  if (Object.values(city.shops).some((s) => !S.isOpen(s))) out.push('Reopen a shop');
  else if (Object.entries(S.ITEMS).some(([, r]) => Object.entries(r.inputs).every(([k, n]) => (p.bag[k] || 0) >= n))) out.push('Craft a tool');
  if (out.length < 3) out.push('Buy 2 salt');
  if (out.length < 3) out.push('Is the stranger safe to pay?');
  return out.slice(0, 3);
}
function vAsk() {
  return head(ICON.lamp, 'Town Crier', 'Say it. I walk there and do it.')
    + `<form class="md-say" data-testid="md-say"><input type="text" maxlength="200" autocomplete="off" placeholder="Tell me what to do" aria-label="What should the Town Crier do?"><button type="submit" class="md-icon md-send" aria-label="Send">${ICON.send}</button></form>`
    + `<div class="md-chips">${chips().map((c) => `<button type="button" class="md-ghost" data-act="ask" data-text="${esc(c)}">${esc(c)}</button>`).join('')}</div>`;
}
root.addEventListener('submit', (e) => { if (!e.target.closest('.md-say')) return; e.preventDefault(); ask(e.target.querySelector('input').value); });
async function think(text) {
  try {
    const r = await fetch(API() + API_PATH + '/market/guide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(12000) });
    if (r.ok) { const j = await r.json(); if (j.intent) return j; }
  } catch {}
  return { intent: G.parseIntent(text), by: 'browser' };
}
const WD = () => window.world || {};
async function ask(text) {
  text = String(text || '').trim(); if (!text || guiding) return;
  guiding = true; document.body.classList.add('md-guiding'); close(); quest();
  const say = (t, o) => { try { WD().guideSay?.(t, o); } catch {} };
  say('Let me see…', { style: 'think', dur: 1.6 });
  const ans = await think(text);
  const step = G.plan(city, ME, ans.intent);
  const was = WD().zoom?.(innerWidth < 720 ? 0.34 : 0.3);
  try {
    if (step.shop && (step.ok || step.walk)) { say(step.say, { dur: 3.2 }); await WD().walkTo?.(step.shop); }
    else { say(step.say, { dur: 3.4 }); toast(step.say, 'no'); return; }
    if (!step.ok) { say(step.say, { style: 'warn', dur: 3.6 }); toast('Refused: not on your list', 'no'); return; }
    const line = G.act(city, ME, step);
    save(); hud(); refresh();
    say(line + '.', { tone: 'ok', dur: 3 });
    toast(line + (ans.proof?.verified ? ' · TEE ✓' : ''), 'ok');
  } catch (e) { say(WHY[e.code] || 'That did not work.', { style: 'warn', dur: 3 }); fail(e); }
  finally {
    window.__marketday.lastGuide = { text, by: ans.by, intent: ans.intent, step: { ...step, amount: step.amount?.toString() }, proof: ans.proof || null };
    setTimeout(() => { if (was != null) WD().zoom?.(was); guiding = false; document.body.classList.remove('md-guiding'); quest(); aim(); }, 1400);
  }
}

// ---------- play mode ----------
let playing = false, timer = 0;
let lastT = 0;
function enter() {
  playing = true; document.body.classList.add('md-play');
  try { window.__skipTownIntro?.(); } catch {}
  history.replaceState(null, '', location.pathname + (location.search.includes('play') ? location.search : (location.search ? location.search + '&' : '?') + 'play'));
  try { WD().guideLook?.('crier'); } catch {}
  lastT = performance.now(); lastPhase = null; dawnOrders(); hud(); quest();
  R.resume().then(() => { readPurse(); if (!R.on() && !GT.on() && !R.live.practice && Q.progress(city).done === 0) setTimeout(() => { if (playing && !view) open('signin'); }, 900); });
  setTimeout(() => { aim(); if (!Q.state(city).met.intro) { Q.state(city).met.intro = 1; save(); WD().guideSay?.('New merchant? Earn your first coin by dusk.', { dur: 4.2 }); } }, 500);
  clearInterval(timer); timer = setInterval(() => { const now = performance.now(); S.advance(city, Math.round((now - lastT) / 1000)); lastT += Math.round((now - lastT) / 1000) * 1000; hud(); save(); }, 1000);
}
function leave() {
  playing = false; document.body.classList.remove('md-play'); close(); clearInterval(timer); strip.hide();
  try { WD().quest?.clear(); WD().guideLook?.('robot'); } catch {}
  history.replaceState(null, '', location.pathname + location.search.replace(/([?&])play(&|$)/, '$1').replace(/[?&]$/, ''));
  (lifeMod ||= import('/design/D9_world/js/life.js').catch(() => null)).then((L) => L?.setSky?.('auto'));
}
root.querySelector('.md-enter').addEventListener('click', enter);
root.querySelector('.md-exit').addEventListener('click', leave);

function mount() {
  document.body.append(root);
  hud(); quest();
  if (/[?&]play\b/.test(location.search)) { const go_ = () => (window.__ready ? (enter(), /[?&]receipt\b/.test(location.search) && setTimeout(() => open('receipt'), 600)) : setTimeout(go_, 300)); go_(); }
}
if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mount); else mount();
window.__marketday = { get city() { return city; }, live: R, enter, leave, open, go, story: Q, reset() { city = S.createCity(); save(); hud(); quest(); refresh(); aim(); } };
