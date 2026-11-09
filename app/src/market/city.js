// Market Day: the city-level game layer over the 3D town. It owns the HUD (clock, level, purse),
// the bag, the market and quest sheet, and the resource nodes on the island. The shop panels stay
// with the shops. Until a player signs in, the round is practice: the rules run in the browser
// from shared/market/sim.js (the same rules as contracts/market) and no transaction is sent.
import * as S from '/shared/market/sim.js';
import { whyHtml, yoctoToNear } from '/market/why.js';
import { ICON, iconFor } from '/market/icons.js';
import * as G from '/shared/market/guide.js';

const $ = (s, r = document) => r.querySelector(s);
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ME = 'you';
const KEY = 'nearcarta.marketday.v1';
const SHORT = { arena: 'Square', hall: 'Hall', ferry: 'Port', toll: 'Bridge', guard: 'Watch', bank: 'Bank', house: 'Council', payouts: 'Tavern', chronicle: 'Chronicle' };
const NAME = { arena: 'Market Square', hall: 'Town Hall', ferry: 'Port', toll: 'Toll Bridge', guard: 'City Watch', bank: 'Mist Bank', house: 'Council House', payouts: 'Payday Tavern', chronicle: 'Chronicle' };
const GOOD = (g) => S.GOODS[g]?.name || S.ITEMS[g]?.name || (g.startsWith('share:') ? `${NAME[g.slice(6)] || g.slice(6)} share` : g);
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
<button class="md-enter" type="button" data-testid="md-enter"><span class="i">${ICON.play}</span><span>Play Market Day</span></button>
<div class="md-hud" role="status" aria-live="polite" data-testid="md-hud">
  <div class="md-clock"><span class="i" data-k="phase"></span><span class="t"><b data-k="day"></b><small data-k="time"></small></span><i class="md-dayb"><i data-k="dayf"></i></i></div>
  <div class="md-lvl" title="Reputation: one point for every order you fill"><b data-k="lvl"></b><small data-k="rep"></small></div>
  <div class="md-purse" title="Practice round: the city's rules run in your browser. No transaction is sent."><span class="i">${ICON.coin}</span><span class="t"><b data-k="near"></b><small>NEAR · practice</small></span></div>
</div>
<div class="md-toasts" aria-live="polite"></div>
<div class="md-nodes" aria-label="Resource nodes"></div>
<nav class="md-dock" aria-label="Market Day">
  <button type="button" class="md-ask" data-v="ask" data-testid="md-ask" aria-label="Ask the Lamplighter"><span class="i">${ICON.lamp}</span><span class="l">Ask</span></button>
  <button type="button" data-v="bag" data-testid="md-bag"><span class="i">${ICON.bag}</span><span class="l">Bag</span><em data-k="bagn"></em></button>
  <button type="button" data-v="market" data-testid="md-market"><span class="i">${ICON.market}</span><span class="l">Market</span></button>
  <button type="button" data-v="quests" data-testid="md-quests"><span class="i">${ICON.quest}</span><span class="l">Orders</span><em data-k="qn"></em></button>
  <button type="button" class="md-exit" data-testid="md-exit" aria-label="Leave Market Day"><span class="i">${ICON.close}</span></button>
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
  ERR_BALANCE: 'Not enough in your bag.', ERR_FUNDS: 'Not enough NEAR. Sell something first.', ERR_STOCK: 'The shelf is empty.',
  ERR_TILL: 'The till cannot pay that much.', ERR_PLAYER_DAILY_CAP: 'Daily limit reached: you can earn more tomorrow.',
  ERR_CITY_DAILY_CAP: 'The city has paid its daily limit. Back tomorrow.', ERR_OWN_ORDER: 'That is your own order.', ERR_SMALL: 'Invest at least 0.001 NEAR.',
};
const fail = (e) => toast(WHY[e.code] || e.message, 'no');

// ---------- HUD ----------
const PH = { dawn: ['dawn', 'Dawn'], market: ['sun', 'Market'], dusk: ['dusk', 'Dusk'], night: ['night', 'Night'] };
let lastPhase = null;
function hud() {
  const c = S.cityClock(city.t), p = me();
  K('phase').innerHTML = ICON[PH[c.phase][0]];
  K('day').textContent = `Day ${c.day} · ${PH[c.phase][1]}`;
  K('time').textContent = `${c.hh}:${c.mm}`;
  K('dayf').style.width = (c.f * 100).toFixed(1) + '%';
  K('lvl').textContent = 'Lv ' + S.level(p.rep);
  K('rep').textContent = p.rep + ' rep';
  K('near').textContent = near(p.near);
  const n = Object.entries(p.bag).filter(([g]) => !g.startsWith('share:')).reduce((a, [, v]) => a + v, 0);
  K('bagn').textContent = n || ''; K('bagn').hidden = !n;
  const q = city.orders.filter((o) => o.poster !== ME).length; K('qn').textContent = q || ''; K('qn').hidden = !q;
  if (c.phase !== lastPhase) { lastPhase = c.phase; sky(c.phase); if (c.phase === 'dawn') dawnOrders(); }
}
let lifeMod = null;
function sky(phase) {
  if (!playing) return;
  const m = { dawn: 'day', market: 'day', dusk: 'dusk', night: 'night' }[phase];
  (lifeMod ||= import('/design/D9_world/js/life.js').catch(() => null)).then((L) => L?.setSky?.(m));
}

// ---------- nodes on the island ----------
let THREE = null, core = null;
const pins = [];
async function nodes() {
  if (pins.length) return;
  try { [THREE, core] = await Promise.all([import('three'), import('/design/D9_world/js/core.js')]); } catch { return; }
  const box = root.querySelector('.md-nodes');
  for (const [id, good, q, r] of S.NODES) {
    const b = h('button', 'md-node', `<span class="ring"></span><span class="i">${iconFor(good)}</span><span class="nm">${esc(GOOD(good))}</span>`);
    b.type = 'button'; b.dataset.node = id; b.dataset.testid = 'md-node-' + id; b.setAttribute('aria-label', `Gather ${GOOD(good)}`);
    b.addEventListener('click', () => gatherAt(id, b));
    box.append(b);
    pins.push({ id, good, el: b, pos: core.hx(q, r).setY(0.9) });
  }
}
let safeTop = 0, safeBottom = 0;
function measureSafe() {
  safeTop = root.querySelector('.md-hud').getBoundingClientRect().bottom || 64;
  const d = root.querySelector('.md-dock').getBoundingClientRect(); safeBottom = d.height ? innerHeight - d.top + 8 : 96;
}
addEventListener('resize', () => playing && measureSafe());
function placeNodes() {
  const cam = window.W?.camera; if (!cam || !THREE) return;
  const v = new THREE.Vector3(); const w = innerWidth, hh = innerHeight;
  // A shop's name tag never peeks out from under the open sheet: hide it while the sheet covers it.
  const sh = view ? sheet().getBoundingClientRect() : null;
  const under = (r) => sh && sh.width && r.right + 8 > sh.left && r.left - 8 < sh.right && r.bottom + 8 > sh.top && r.top - 8 < sh.bottom;
  for (const pin of document.querySelectorAll('#pins .pin')) {
    const tag = pin.querySelector('.ban'); pin.classList.remove('md-under');
    if (tag && pin.classList.contains('on') && under(tag.getBoundingClientRect())) pin.classList.add('md-under');
  }
  const bans = [...document.querySelectorAll('#pins .pin.on:not(.md-under) .ban')].map((e) => e.getBoundingClientRect()).filter((r) => r.width);
  for (const p of pins) {
    v.copy(p.pos).project(cam);
    const x = (v.x * 0.5 + 0.5) * w; let y = (-v.y * 0.5 + 0.5) * hh;
    // A spot never sits on a shop's name tag: step it just below the tag instead.
    // The spot is 48 px tall above its anchor and its name runs 24 px below it.
    const hit = () => bans.find((r) => x + 30 > r.left && x - 30 < r.right && y + 26 > r.top && y - 50 < r.bottom);
    for (let k = 0, r; k < 3 && (r = hit()); k++) y = r.bottom + 54;
    // Keep spots clear of the HUD, the dock, the screen edges and shop tags, so none is half hidden.
    const on = !hit() && !under({ left: x - 30, right: x + 30, top: y - 50, bottom: y + 26 }) && v.z < 1 && x > 32 && x < w - 32 && y > safeTop + 56 && y < hh - safeBottom && !document.body.classList.contains('in-shop');
    p.el.style.display = on ? '' : 'none'; if (!on) continue;
    p.el.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px) translate(-50%,-100%)`;
    const cd = S.cooldown(city, ME, p.id);
    p.el.classList.toggle('rest', cd > 0);
    p.el.style.setProperty('--cd', ((cd / S.GATHER_S) * 360).toFixed(0) + 'deg');
  }
}
function gatherAt(id, el) {
  try {
    const n = S.gather(city, ME, id); const good = S.NODES.find((x) => x[0] === id)[1];
    fly(el, good, n); save(); hud(); refresh();
  } catch (e) { fail(e); }
}
function fly(from, good, n) {
  const bag = root.querySelector('[data-v=bag]'); const a = from.getBoundingClientRect(), b = bag.getBoundingClientRect();
  const chip = h('div', 'md-fly', `<span class="i">${iconFor(good)}</span>+${n}`);
  document.body.append(chip);
  chip.style.left = a.left + a.width / 2 + 'px'; chip.style.top = a.top + 'px';
  if (RM) { setTimeout(() => chip.remove(), 600); bag.classList.add('bump'); setTimeout(() => bag.classList.remove('bump'), 400); return; }
  chip.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${b.left + b.width / 2 - a.left - a.width / 2}px), calc(-50% + ${b.top - a.top}px)) scale(.6)`, opacity: 0.2 }], { duration: 700, easing: 'cubic-bezier(.5,0,.3,1)' }).finished.then(() => { chip.remove(); bag.classList.add('bump'); setTimeout(() => bag.classList.remove('bump'), 400); });
}

// ---------- sheet ----------
let view = null, viewArg = null, why = null, qty = 1;
const sheet = () => root.querySelector('.md-sheet');
function open(v, arg) { document.body.classList.add('md-sheet-open'); view = v; viewArg = arg; why = null; if (v !== 'counter') qty = 1; render(); sheet().classList.add('open'); sheet().setAttribute('aria-hidden', 'false'); root.querySelectorAll('.md-dock [data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === (v === 'counter' ? 'market' : v))); }
function close() { document.body.classList.remove('md-sheet-open'); view = null; sheet().classList.remove('open'); sheet().setAttribute('aria-hidden', 'true'); root.querySelectorAll('.md-dock [data-v]').forEach((b) => b.classList.remove('on')); }
const refresh = () => { if (view) render(); };
const head = (icon, title, sub, back) => `<header class="md-head">${back ? `<button type="button" class="md-icon md-back" data-act="back" aria-label="Back">${ICON.back}</button>` : `<span class="md-badge">${icon}</span>`}<div><h2>${esc(title)}</h2><p>${esc(sub)}</p></div><button type="button" class="md-icon" data-act="close" aria-label="Close">${ICON.close}</button></header>`;

function best(good) {
  let lo = null, hi = null;
  for (const [id, s] of Object.entries(city.shops)) {
    if (!s.goods[good]) continue; const q = S.quoteAt(city, id, good);
    if (s.goods[good].stock > 0 && (!lo || BigInt(q.buy) < lo.p)) lo = { id, p: BigInt(q.buy) };
    if (S.isOpen(s) && (!hi || BigInt(q.sell) > hi.p)) hi = { id, p: BigInt(q.sell) };
  }
  return { lo, hi };
}

function vMarket() {
  const rows = Object.keys(S.GOODS).map((g) => { const { lo, hi } = best(g); const have = me().bag[g] || 0;
    return `<button type="button" class="md-row" data-act="counter" data-shop="${hi?.id || lo?.id}" data-good="${g}" data-testid="md-good-${g.slice(5)}">
      <span class="md-tok">${iconFor(g)}</span><span class="md-nm"><b>${GOOD(g)}</b><small>${have ? `You have ${have}` : 'None in your bag'}</small></span>
      <span class="md-px"><small>Best sell</small><b>${hi ? near(hi.p) : '—'}</b><small>${hi ? esc(NAME[hi.id]) : 'all closed'}</small></span></button>`; }).join('');
  const shops = Object.entries(city.shops).map(([id, s]) => `<button type="button" class="md-shop ${S.isOpen(s) ? '' : 'dark'}" data-act="counter" data-shop="${id}" data-testid="md-shop-${id}" title="${esc(NAME[id])}${S.isOpen(s) ? '' : ': closed, out of funds'}"><i></i>${esc(SHORT[id])}</button>`).join('');
  return head(ICON.market, 'Market', 'Prices move with every trade.') + `<div class="md-list">${rows}</div><h3 class="md-sub">Counters</h3><div class="md-shops">${shops}</div>`;
}

function vCounter() {
  const id = viewArg.shop, s = city.shops[id]; const goods = Object.keys(s.goods);
  const sel = viewArg.good && s.goods[viewArg.good] ? viewArg.good : goods[0]; viewArg.good = sel;
  const open_ = S.isOpen(s); const have = me().bag[sel] || 0;
  const rows = goods.map((g) => { const q = S.quoteAt(city, id, g); return `<button type="button" class="md-row ${g === sel ? 'sel' : ''}" data-act="pick" data-good="${g}" aria-pressed="${g === sel}">
    <span class="md-tok">${iconFor(g)}</span><span class="md-nm"><b>${GOOD(g)}</b><small>${s.goods[g].stock} on the shelf</small></span>
    <span class="md-px two"><span><small>Sell</small><b>${open_ ? near(q.sell) : '—'}</b></span><span><small>Buy</small><b>${near(q.buy)}</b></span></span></button>`; }).join('');
  const q = S.quoteAt(city, id, sel);
  const sellN = Math.min(qty, have), canSell = open_ && sellN > 0;
  let sellTotal = 0n; if (canSell) { const c2 = structuredClone(city); try { sellTotal = S.sell(c2, ME, id, sel, sellN); } catch {} }
  const status = open_ ? `<span class="md-pill ok">Open</span>` : `<span class="md-pill no">Closed: out of funds</span>`;
  const whyBox = why === sel ? `<div class="md-why">${whyHtml(q, GOOD(sel))}</div>` : '';
  const cta = !open_
    ? `<button type="button" class="md-cta" data-act="invest" data-testid="md-invest">Invest 0.0100 to reopen</button>`
    : canSell ? `<button type="button" class="md-cta" data-act="sell" data-testid="md-sell">Sell ${sellN} ${esc(GOOD(sel))} · ${near(sellTotal)}</button>`
    : `<p class="md-hint" data-testid="md-sell-hint">Gather ${esc(GOOD(sel).toLowerCase())} on the island to sell it here.</p>`;
  return head(null, NAME[id], open_ ? 'Sell what you gather. Buy for orders.' : 'Out of funds. It still sells.', true)
    + `<div class="md-stat">${status}<button type="button" class="md-link" data-act="why" aria-expanded="${why === sel}" data-testid="md-why">${ICON.info}<span>Why this price?</span></button></div>${whyBox}<div class="md-list">${rows}</div>
    <div class="md-trade"><div class="md-step" role="group" aria-label="Quantity"><button type="button" data-act="qty" data-d="-1" aria-label="One less">−</button><b data-testid="md-qty">${qty}</b><button type="button" data-act="qty" data-d="1" aria-label="One more">+</button></div>
    <button type="button" class="md-ghost grow" data-act="buy" data-testid="md-buy">Buy ${qty} ${esc(GOOD(sel))} · ${near(BigInt(q.buy) * BigInt(qty))}</button></div>${cta}`;
}

function vBag() {
  const p = me(); const tiles = [...Object.keys(S.GOODS), ...Object.keys(S.ITEMS)].map((g) => `<div class="md-tile ${p.bag[g] ? '' : 'empty'}"><span class="md-tok">${iconFor(g)}</span><b>${p.bag[g] || 0}</b><small>${GOOD(g)}</small></div>`).join('');
  const shares = Object.entries(p.bag).filter(([g]) => g.startsWith('share:'));
  const sh = shares.length ? `<h3 class="md-sub">Shares</h3><div class="md-list">${shares.map(([g, n]) => { const id = g.slice(6); const d = S.pending(city, ME, id); return `<div class="md-row static"><span class="md-tok">${ICON.share}</span><span class="md-nm"><b>${esc(NAME[id])}</b><small>${n} shares</small></span><button type="button" class="md-ghost sm" data-act="claim" data-shop="${id}" ${d > 0n ? '' : 'disabled'}>Claim ${near(d)}</button></div>`; }).join('')}</div>` : '';
  const recipes = Object.entries(S.ITEMS).map(([item, r]) => { const ok = Object.entries(r.inputs).every(([g, n]) => (p.bag[g] || 0) >= n);
    const ins = Object.entries(r.inputs).map(([g, n]) => `<span class="md-in ${(p.bag[g] || 0) >= n ? '' : 'miss'}"><span class="md-tok xs">${iconFor(g)}</span>${n}</span>`).join('<span class="md-plus">+</span>');
    return `<div class="md-recipe"><div class="md-ins">${ins}<span class="md-arrow">→</span><span class="md-tok">${iconFor(item)}</span></div><div class="md-rtxt"><b>${GOOD(item)}</b><small>${esc(r.use)}</small></div><button type="button" class="md-ghost sm" data-act="craft" data-item="${item}" ${ok ? '' : 'disabled'} data-testid="md-craft-${item.slice(5)}">Craft</button></div>`; }).join('');
  const sellable = Object.keys(S.GOODS).find((g) => p.bag[g]);
  return head(ICON.bag, 'Your bag', `${near(p.near)} NEAR` + (p.bag['item:tool'] ? ` · tool: ${S.TOOL_LIFE - p.toolUses} gathers left` : ''))
    + `<div class="md-grid">${tiles}</div>${sh}<h3 class="md-sub">Craft</h3>${recipes}`
    + (sellable ? `<button type="button" class="md-cta" data-act="counter" data-good="${sellable}" data-shop="${best(sellable).hi?.id || 'arena'}">Sell ${esc(GOOD(sellable))} at the best counter</button>` : `<p class="md-hint">Tap a glowing spot on the island to gather.</p>`);
}

function vQuests() {
  const p = me(); const list = city.orders.filter((o) => o.poster !== ME);
  const first = list.find((o) => (p.bag[o.good] || 0) >= 1);
  const rows = list.map((o) => { const n = Math.min(o.qty, p.bag[o.good] || 0);
    return `<div class="md-order"><span class="md-tok">${iconFor(o.good)}</span><div class="md-nm"><b>${esc(o.text)}</b><small>${o.qty} ${esc(GOOD(o.good))} · ${near(o.reward)} · +1 rep</small></div>
    ${o === first ? '' : `<button type="button" class="md-ghost sm" data-act="fill" data-id="${o.id}" ${n ? '' : 'disabled'}>${n ? `Deliver ${n}` : `Need ${esc(GOOD(o.good))}`}</button>`}</div>`; }).join('');
  const cta = first ? `<button type="button" class="md-cta" data-act="fill" data-id="${first.id}" data-testid="md-fill">Deliver ${Math.min(first.qty, p.bag[first.good])} ${esc(GOOD(first.good))} · ${near(first.reward * BigInt(Math.min(first.qty, p.bag[first.good])))}</button>` : '';
  return head(ICON.quest, 'Town Hall orders', 'New orders at dawn. Goods are used up.')
    + (rows ? `<div class="md-list">${rows}</div>` : `<p class="md-hint">No orders right now. New ones come at dawn.</p>`) + cta;
}

function render() {
  const body = root.querySelector('.md-body');
  body.innerHTML = view === 'market' ? vMarket() : view === 'counter' ? vCounter() : view === 'bag' ? vBag() : view === 'quests' ? vQuests() : view === 'ask' ? vAsk() : '';
}

root.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-act],[data-v]'); if (!b || b.disabled) return;
  if (b.dataset.v) { if (guiding) return; view === b.dataset.v ? close() : open(b.dataset.v); if (view === 'ask') setTimeout(() => root.querySelector('.md-say input')?.focus(), 60); return; }
  if (b.dataset.act === 'ask') { ask(b.dataset.text || root.querySelector('.md-say input')?.value || ''); return; }
  const a = b.dataset.act;
  try {
    if (a === 'close') close();
    else if (a === 'back') open('market');
    else if (a === 'counter') open('counter', { shop: b.dataset.shop, good: b.dataset.good });
    else if (a === 'pick') { viewArg.good = b.dataset.good; why = null; render(); }
    else if (a === 'qty') { qty = Math.max(1, Math.min(S.MAX_QTY, qty + +b.dataset.d)); render(); }
    else if (a === 'why') { why = why === viewArg.good ? null : viewArg.good; render(); }
    else if (a === 'sell') { const n = Math.min(qty, me().bag[viewArg.good] || 0); const t = S.sell(city, ME, viewArg.shop, viewArg.good, n); toast(`Sold ${n} ${GOOD(viewArg.good)} for ${near(t)} NEAR`); seal(b); }
    else if (a === 'buy') { const t = S.buy(city, ME, viewArg.shop, viewArg.good, qty); toast(`Bought ${qty} ${GOOD(viewArg.good)} for ${near(t)} NEAR`); }
    else if (a === 'invest') { const u = S.invest(city, ME, viewArg.shop, 10n * S.MILLI); toast(`You own ${u} shares. 20% of sales come back until 110% is repaid.`); }
    else if (a === 'claim') toast(`Claimed ${near(S.claim(city, ME, b.dataset.shop))} NEAR`);
    else if (a === 'craft') { S.craft(city, ME, b.dataset.item); toast(`Crafted a ${GOOD(b.dataset.item).toLowerCase()}`); }
    else if (a === 'fill') { const o = city.orders.find((x) => x.id === +b.dataset.id); const n = Math.min(o.qty, me().bag[o.good] || 0); const w = S.fillOrder(city, ME, o.id, n); toast(`Delivered. Wage ${near(w)} NEAR, +1 rep`); }
    save(); hud(); refresh();
  } catch (e) { fail(e); }
});
function seal(b) { if (RM) return; b.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(.97)' }, { transform: 'scale(1)' }], { duration: 220 }); }
addEventListener('keydown', (e) => { if (e.key === 'Escape' && view) { close(); e.stopPropagation(); } }, true);

// ---------- the guide: talk to the Lamplighter; it walks to the right shop and acts ----------
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
  if (out.length < 3) out.push('Send 1 NEAR to stranger.near');
  return out.slice(0, 3);
}
function vAsk() {
  return head(ICON.lamp, 'Lamplighter', 'Say it. I walk there and do it.')
    + `<form class="md-say" data-testid="md-say"><input type="text" maxlength="200" autocomplete="off" placeholder="Sell my iron" aria-label="What should the Lamplighter do?"><button type="submit" class="md-icon md-send" aria-label="Send">${ICON.send}</button></form>`
    + `<div class="md-chips">${chips().map((c) => `<button type="button" class="md-ghost" data-act="ask" data-text="${esc(c)}">${esc(c)}</button>`).join('')}</div>`;
}
root.addEventListener('submit', (e) => { if (!e.target.closest('.md-say')) return; e.preventDefault(); ask(e.target.querySelector('input').value); });
async function think(text) {
  try {
    const r = await fetch(API() + '/api/market/guide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(12000) });
    if (r.ok) { const j = await r.json(); if (j.intent) return j; }
  } catch {}
  return { intent: G.parseIntent(text), by: 'browser' };
}
const WD = () => window.world || {};
async function ask(text) {
  text = String(text || '').trim(); if (!text || guiding) return;
  guiding = true; document.body.classList.add('md-guiding'); close();
  const say = (t, o) => { try { WD().guideSay?.(t, o); } catch {} };
  say('Let me see…', { style: 'think', dur: 1.6 });
  const ans = await think(text);
  const step = G.plan(city, ME, ans.intent);
  const was = WD().zoom?.(innerWidth < 720 ? 0.34 : 0.3);
  try {
    if (step.shop && (step.ok || step.walk)) { say(step.say, { dur: 3.2 }); await WD().walkTo?.(step.shop); }
    else { say(step.say, { dur: 3.4 }); toast(step.say, 'no'); return; }
    if (!step.ok) { say(step.say, { style: 'warn', dur: 3.6 }); toast('Refused: not on the charter', 'no'); return; }
    const line = G.act(city, ME, step);
    save(); hud(); refresh();
    say(line + '.', { tone: 'ok', dur: 3 });
    toast(line + (ans.proof?.verified ? ' · TEE ✓' : ''), 'ok');
  } catch (e) { say(WHY[e.code] || 'That did not work.', { style: 'warn', dur: 3 }); fail(e); }
  finally {
    window.__marketday.lastGuide = { text, by: ans.by, intent: ans.intent, step: { ...step, amount: step.amount?.toString() }, proof: ans.proof || null };
    setTimeout(() => { if (was != null) WD().zoom?.(was); guiding = false; document.body.classList.remove('md-guiding'); }, 1400);
  }
}

// ---------- play mode ----------
let playing = false, timer = 0, raf = 0, lastT = 0;
function enter() {
  playing = true; document.body.classList.add('md-play');
  try { window.__skipTownIntro?.(); } catch {}
  // Pull the camera back to the town view so the resource spots on the island are in sight.
  setTimeout(() => { const out = document.querySelector('#zoom .zb[data-d="1"]'); for (let i = 0; i < (innerWidth < 720 ? 5 : 3); i++) out?.click(); }, 400);
  history.replaceState(null, '', location.pathname + (location.search.includes('play') ? location.search : (location.search ? location.search + '&' : '?') + 'play'));
  nodes().then(() => { const tick = () => { placeNodes(); raf = requestAnimationFrame(tick); }; cancelAnimationFrame(raf); tick(); });
  lastT = performance.now(); lastPhase = null; dawnOrders(); hud(); requestAnimationFrame(measureSafe);
  clearInterval(timer); timer = setInterval(() => { const now = performance.now(); S.advance(city, Math.round((now - lastT) / 1000)); lastT += Math.round((now - lastT) / 1000) * 1000; hud(); if (view === 'quests' || view === 'counter') { /* prices and orders keep their place */ } save(); }, 1000);
  if (!localStorage.getItem(KEY + '.seen')) { localStorage.setItem(KEY + '.seen', '1'); toast('Tap a glowing spot to gather. Sell at a counter. Fill orders for wages.'); }
}
function leave() {
  playing = false; document.body.classList.remove('md-play'); close(); clearInterval(timer); cancelAnimationFrame(raf);
  history.replaceState(null, '', location.pathname + location.search.replace(/([?&])play(&|$)/, '$1').replace(/[?&]$/, ''));
  (lifeMod ||= import('/design/D9_world/js/life.js').catch(() => null)).then((L) => L?.setSky?.('auto'));
}
root.querySelector('.md-enter').addEventListener('click', enter);
root.querySelector('.md-exit').addEventListener('click', leave);

function mount() {
  document.body.append(root);
  hud();
  if (/[?&]play\b/.test(location.search)) { const go = () => (window.__ready ? enter() : setTimeout(go, 300)); go(); }
}
if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mount); else mount();
window.__marketday = { get city() { return city; }, enter, leave, open, reset() { city = S.createCity(); save(); hud(); refresh(); } };
