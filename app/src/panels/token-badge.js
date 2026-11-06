// Token + chain badges for the Ferry hero, flow pills, crate tag, and pickers.
// Resolution order: https token.icon from 1Click, then the vendored web3icons map
// (icon-map.js, MIT), then the existing /tokens files that map points at.
// A library miss becomes a brass letter coin. Never a "?" placeholder.
// No inline onerror (CSP). bindTokenFallbacks wires the image error path.

import { CHAIN_FILE, TOKEN_FILE } from './icon-map.js';

const TOKEN_LOWER = new Map();
for (const [k, v] of Object.entries(TOKEN_FILE)) {
  const l = k.toLowerCase();
  const prev = TOKEN_LOWER.get(l);
  if (prev === undefined) TOKEN_LOWER.set(l, v);
  else if (prev !== v) TOKEN_LOWER.set(l, '');
}

function tokenFile(sym) {
  const s = String(sym || '').trim();
  if (!s) return '';
  if (TOKEN_FILE[s]) return TOKEN_FILE[s];
  return TOKEN_LOWER.get(s.toLowerCase()) || '';
}

export function chainKey(raw) {
  const k = String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return CHAIN_FILE[k] || null;
}

function remoteIcon(icon) {
  const s = String(icon || '').trim();
  if (!/^https:\/\//i.test(s)) return '';
  if (/[\s"'<>]/.test(s)) return '';
  return s;
}

/** (symbol, blockchain) → self-hosted or https sources. Empty string means "no art". */
export function resolveIcons(symbol, blockchain, { icon } = {}) {
  const remote = remoteIcon(icon);
  const file = tokenFile(symbol);
  const tokenSrc = remote || (file ? `/tokens/${file}.svg` : '');
  const ck = chainKey(blockchain);
  const chainSrc = ck ? `/tokens/chains/${ck}.svg` : '';
  return { tokenSrc, chainSrc, chainKey: ck };
}

export function parseRouteFrom(from) {
  const s = String(from || '');
  const at = s.indexOf('@');
  if (at < 0) return { sym: s.trim() || '', chain: '' };
  return { sym: s.slice(0, at).trim(), chain: s.slice(at + 1).trim() };
}

function symKey(sym) {
  return String(sym || '').trim();
}

function letterFallback(sym) {
  const ch = String(sym || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 1);
  return ch ? ch.toUpperCase() : '·';
}

function tokenImg(src, sym, size) {
  const letter = esc(letterFallback(sym));
  return `<img class="ti" src="${esc(src)}" alt="${esc(sym || '')}" width="${size}" height="${size}" loading="lazy" decoding="async" data-letter="${letter}" data-ti-fallback="1">`;
}

/** Wire image→letter fallbacks without inline onerror (CSP script-src blocks inline handlers). */
export function bindTokenFallbacks(root = document) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll('img.ti[data-ti-fallback]').forEach(img => {
    if (img.dataset.tiBound) return;
    img.dataset.tiBound = '1';
    const fail = () => {
      const s = document.createElement('span');
      s.className = 'ti coin';
      s.setAttribute('aria-hidden', 'true');
      s.textContent = img.getAttribute('data-letter') || '·';
      img.replaceWith(s);
    };
    img.addEventListener('error', fail, { once: true });
    if (img.complete && img.naturalWidth === 0) fail();
  });
}

function chainImg(ck, chain, size) {
  return `<img class="ci" src="/tokens/chains/${ck}.svg" alt="" title="on ${esc(String(chain))}" width="${size}" height="${size}" loading="lazy" decoding="async">`;
}

function chainMark(chain, size) {
  const ck = chainKey(chain);
  if (ck) return chainImg(ck, chain, size);
  const name = String(chain || '').trim();
  if (!name) return '';
  return `<span class="ci coin" aria-hidden="true">${esc(letterFallback(name))}</span>`;
}

function tokenArt(sym, chain, { size, chainSize, icon, chainOnly = false } = {}) {
  const key = symKey(sym);
  const { tokenSrc } = resolveIcons(key, chain, { icon });
  const ti = chainOnly
    ? ''
    : (tokenSrc
      ? tokenImg(tokenSrc, key || sym, size)
      : `<span class="ti coin" aria-hidden="true">${esc(letterFallback(key))}</span>`);
  const ci = chainOnly ? chainMark(chain, chainSize) : (String(chain || '').trim() ? chainMark(chain, chainSize) : '');
  return { ti, ci, key };
}

/** Stacked token icon with optional chain badge (D8 tok().tic pattern). */
export function tokenBadge(sym, chain, { size = 22, chainSize = 12, cls = '', amount = null, icon = '' } = {}) {
  const { ti, ci, key } = tokenArt(sym, chain, { size, chainSize, icon });
  const num = amount != null && amount !== '' ? `<b class="num">${esc(amount)}</b>` : '';
  return `<span class="tok ${cls}" data-sym="${esc(key)}" data-chain="${esc(chain || '')}"><span class="tic">${ti}${ci}</span>${num}<span class="sym">${esc(key || sym || '')}</span></span>`;
}

/** Icon-only stack (no symbol text) for dense chips. */
export function tokenStack(sym, chain, { size = 28, chainSize = 14, icon = '' } = {}) {
  const { ti, ci } = tokenArt(sym, chain, { size, chainSize, icon });
  return `<span class="tic" aria-hidden="true">${ti}${ci}</span>`;
}

/** Hero line for the tray and the room: picked token + chain, both sides. */
export function pairHero({ fromSym, fromChain, toSym, toChain, amt = '', outAmt = '', fromIcon = '', toIcon = '' } = {}) {
  const left = tokenBadge(fromSym, fromChain, { amount: amt, icon: fromIcon, size: 26, chainSize: 14 });
  const right = tokenBadge(toSym, toChain, { amount: outAmt, icon: toIcon, size: 26, chainSize: 14 });
  return `${left}<span class="arrow" aria-hidden="true">→</span>${right}`;
}

function optionInner(o) {
  if (o.kind === 'chain') {
    const mark = o.value ? chainMark(o.value, 16) : '';
    return `${mark ? `<span class="chain-mark">${mark}</span>` : ''}<span class="opt-label">${esc(o.label || 'All')}</span>`;
  }
  const stack = tokenStack(o.symbol, o.chain, { size: 22, chainSize: 12, icon: o.icon || '' });
  return `${stack}<span class="opt-label">${esc(o.label || o.symbol || '')}</span>`;
}

/**
 * Accessible listbox. Native <option> cannot show icons.
 * options: { value, label, symbol, chain, icon, kind?: 'chain' }.
 * The closed button shows `selected` only when that value is in the filtered list.
 */
export function pickerListbox({ id, testid, options = [], selected = '' } = {}) {
  const list = options || [];
  const current = list.find(o => o.value === selected) || list[0] || null;
  const btn = current ? optionInner(current) : '<span class="opt-label">No match</span>';
  const value = current ? current.value : '';
  const items = list.map(o => {
    const on = !!(current && o.value === current.value);
    return `<li role="option" class="token-opt${on ? ' on' : ''}" data-value="${esc(o.value)}" aria-selected="${on ? 'true' : 'false'}">${optionInner(o)}</li>`;
  }).join('');
  return `<div class="token-listbox" id="${esc(id)}" data-testid="${esc(testid)}" data-value="${esc(value)}"><button type="button" class="token-listbox-btn" aria-haspopup="listbox" aria-expanded="false" aria-controls="${esc(id)}-menu">${btn}</button><ul class="token-listbox-menu" id="${esc(id)}-menu" role="listbox" hidden>${items}</ul></div>`;
}

let docBound = false;
function ensureDocClose() {
  if (docBound || typeof document === 'undefined') return;
  docBound = true;
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.token-listbox').forEach(box => {
      if (box.contains(e.target)) return;
      const menu = box.querySelector('[role=listbox]');
      const btn = box.querySelector('.token-listbox-btn');
      if (menu) menu.hidden = true;
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  });
}

/** Open/close and choose. Calls onChange(value) when the visitor picks a row. */
export function bindPickerListbox(box, onChange) {
  if (!box?.querySelector || box.dataset.lbBound) return;
  const btn = box.querySelector('.token-listbox-btn');
  const menu = box.querySelector('[role=listbox]');
  if (!btn || !menu) return;
  box.dataset.lbBound = '1';
  ensureDocClose();
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  const open = () => { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); };
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (menu.hidden) open(); else close();
  });
  menu.querySelectorAll('[role=option]').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const value = opt.getAttribute('data-value') ?? '';
      box.dataset.value = value;
      menu.querySelectorAll('[role=option]').forEach(o => {
        const on = o === opt;
        o.setAttribute('aria-selected', on ? 'true' : 'false');
        o.classList.toggle('on', on);
      });
      btn.innerHTML = opt.innerHTML;
      close();
      onChange?.(value);
    });
  });
  btn.addEventListener('keydown', (e) => {
    const opts = [...menu.querySelectorAll('[role=option]')];
    if (!opts.length) return;
    const cur = opts.findIndex(o => o.classList.contains('active') || o.getAttribute('aria-selected') === 'true');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (menu.hidden) open();
      let next = cur;
      if (e.key === 'ArrowDown') next = Math.min(opts.length - 1, (cur < 0 ? -1 : cur) + 1);
      else next = Math.max(0, cur < 0 ? 0 : cur - 1);
      opts.forEach((o, i) => o.classList.toggle('active', i === next));
      opts[next]?.scrollIntoView?.({ block: 'nearest' });
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const active = menu.querySelector('.token-opt.active') || menu.querySelector('[aria-selected=true]');
      active?.dispatchEvent(new Event('click'));
    } else if (e.key === 'Escape') close();
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
