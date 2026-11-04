// /setup: one guided page from "who are you" to a working agent with on-chain limits.
// Sign-in uses NEAR Connect (wallets, MetaMask) or Privy (email code inline, Google), which makes a NEAR account.
// The page never holds the owner's key: the two owner steps are approved in the wallet. The agent key made here
// can only call `propose` on the new charter, and the charter decides every payment.
import { Buffer } from 'buffer';
globalThis.Buffer = globalThis.Buffer || Buffer;
import Privy, { LocalStorage, create as createWallet } from '@privy-io/js-sdk-core';
import qrcode from 'qrcode-generator';
import { wallet, mainnetWallet, account, mainnetAccount, connect, startGuest, disconnect, onWallet } from './house.js';
import { balanceOn, faucet } from './onboard.js';
import { setupJourney } from '../../shared/setup/path.js';
import MAIN from '../../shared/deployments/mainnet.json' with { type: 'json' };
import { txHashOf } from '../shops/vault/wallet.js';
import { rpcClient, viewFn, keyFrom, pubkeyHex, signMessage, sendPropose } from '../../shared/vault/tx.js';
import { proposalMessage } from '../../shared/board/message.js';
import { refusalOf } from '../design/D8_shops/js/board.js';
import { runAsk } from '../../shared/vault/run.js';
import { LOOKS, DYES, OUTFITS, portraitHTML, writeHero, displayOk } from './hero.js';

const PRIVY_ON = typeof __PRIVY_ON__ !== 'undefined' && __PRIVY_ON__;
const PUBLIC_MAINNET = __PUBLIC_MAINNET__ === '1';
const privy = PRIVY_ON ? new Privy({ appId: __PRIVY_APP_ID__, ...(__PRIVY_CLIENT_ID__ ? { clientId: __PRIVY_CLIENT_ID__ } : {}), storage: new LocalStorage() }) : null;
let API = (window.NEARCARTA_API || '').replace(/\/$/, '');
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const YN = 10n ** 24n, TG = 10n ** 12n;
const toY = n => (BigInt(Math.round(Number(n) * 1e6)) * 10n ** 18n).toString();
const nearOf = y => y == null ? null : Number(BigInt(y) / 10n ** 18n) / 1e6;
const fmtN = v => v == null ? '?' : (+v.toFixed(v > 0 && v < 0.01 ? 4 : 3)).toLocaleString('en');
const short = a => { const s = String(a || ''); return s.length > 26 ? s.slice(0, 10) + '…' + s.slice(-8) : s; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const agentLS = c => 'nearcarta.vault.agent.' + c, pendLS = c => 'nearcarta.vault.agent.pending.' + c;
const SAVE = 'nearcarta.setup.v1';
const PREVIEW = new URLSearchParams(location.search).has('preview');

const STEPS = [
  ['signin', 'Sign in', 'Google, email or wallet'],
  ['fund', 'Fund', 'Put NEAR in the account'],
  ['privacy', 'Privacy', 'What the world sees'],
  ['character', 'Character', 'Your agent and its name'],
  ['rules', 'Rules', 'Cap, shops, expiry'],
  ['sign', 'Sign', 'Charter and agent key'],
  ['try', 'Try it', 'One yes, one no'],
];
const st = Object.assign({ step: 0, done: [], trial: false, persona: 'mage', dye: 'brass', outfit: 'lantern', displayName: '', agentName: '', mist: false, cap: null, daily: null, per: null, days: 30, receivers: null, charter: null, deposit: 0.5 }, JSON.parse(localStorage.getItem(SAVE) || '{}'));
const save = () => localStorage.setItem(SAVE, JSON.stringify(st));
let CFG = null, rpc = null, me = null, bal = undefined, balTimer = 0, busy = false, msg = '';
const view = (c, m, a) => viewFn(rpc, c, m, a);
const boardLive = () => PUBLIC_MAINNET && MAIN.board?.status === 'deployed' && !!MAIN.board.contract;
const journey = () => setupJourney(st.trial, { publicMainnet: PUBLIC_MAINNET, boardDeployed: boardLive() });
const explorer = () => journey().explorer;
const txA = h => h ? `<a href="${explorer()}/txns/${esc(h)}" target="_blank" rel="noopener" data-testid="setup-tx">${esc(h.slice(0, 8))}…</a>` : '';
const acA = a => `<a href="${explorer()}/address/${esc(a)}" target="_blank" rel="noopener">${esc(short(a))}</a>`;
const persona = () => LOOKS.find(p => p.id === st.persona) || LOOKS[1];
const dyeOf = () => DYES.find(d => d.id === st.dye) || DYES[0];
const remember = () => writeHero({ look: persona(), dye: dyeOf(), outfit: st.outfit, name: st.displayName || persona().name });

function go(i) { st.step = Math.max(0, Math.min(STEPS.length - 1, i)); msg = ''; save(); history.replaceState(null, '', location.pathname + location.search + '#' + STEPS[st.step][0]); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function done(i) { if (!st.done.includes(i)) st.done.push(i); save(); }
const canOpen = i => i === 0 || (me && (i <= Math.max(-1, ...st.done) + 1));

function rail() {
  $('#rail').innerHTML = STEPS.map(([id, t, s], i) => `<li class="${i === st.step ? 'now' : (i < st.step || st.done.includes(i)) ? 'done' : ''}" data-i="${i}" ${i === st.step ? 'aria-current="step"' : ''}><span>${esc(t)}<small>${esc(s)}</small></span></li>`).join('');
  $('#rail').querySelectorAll('li.done, li.now').forEach(li => { const i = +li.dataset.i; if (i <= st.step || st.done.includes(i)) li.onclick = () => go(i); });
  $('#bar').style.width = ((st.step + 1) / STEPS.length * 100) + '%';
}
function top() {
  const net = $('#net');
  net.textContent = journey().badge;
  net.dataset.testid = 'setup-net';
  $('#who').innerHTML = me ? `<span data-testid="setup-who">${esc(short(me))}</span> · <span data-testid="setup-bal">${bal === undefined ? '…' : bal == null ? '? NEAR' : fmtN(nearOf(bal)) + ' NEAR'}</span><button class="btn link sm" id="out">Sign out</button>` : '';
  const o = $('#out'); if (o) o.onclick = async () => { await disconnect(); await mainnetWallet().disconnect().catch(() => {}); await privy?.auth.logout().catch(() => {}); me = null; bal = undefined; st.done = []; st.trial = false; save(); go(0); };
}
const head = (eye, h, lede) => `<p class="eyebrow">Step ${st.step + 1} of ${STEPS.length} · ${esc(eye)}</p><h1>${h}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}`;
const nav = (next, { back = true, nextOk = true, label = 'Continue' } = {}) => `<div class="actions">${back && st.step > 0 ? '<button class="btn" id="back">Back</button>' : '<span></span>'}${next ? `<button class="btn gold" id="next" data-testid="setup-next" ${nextOk ? '' : 'disabled'}>${esc(label)} →</button>` : ''}</div>`;
const errP = () => msg ? `<p class="err" role="alert" data-testid="setup-err">${esc(msg)}</p>` : '';
function wire(nextFn) { const b = $('#back'); if (b) b.onclick = () => go(st.step - 1); const n = $('#next'); if (n) n.onclick = nextFn || (() => { done(st.step); go(st.step + 1); }); }
async function act(btn, f) {
  if (PREVIEW) { msg = ''; done(st.step); go(Math.min(STEPS.length - 1, st.step + 1)); return; }
  if (busy) return; busy = true; const t = btn?.innerHTML; if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> ' + t; } msg = '';
  try { await f(); } catch (e) { msg = e?.message || String(e); } finally { busy = false; if (btn && document.contains(btn)) { btn.disabled = false; btn.innerHTML = t; } render(); } }

// ---------- 1. Sign in ----------
let emailStage = 'email', email = '';
function sSignin() {
  const signed = !!me && !PREVIEW;
  return head('Sign in', signed ? 'You are in.' : 'Start here.',
    signed ? `Signed in as <b>${esc(me)}</b>.` : 'One path: sign in, fund, pick a character, write the rules, sign them, then try one payment the charter allows and one it refuses.')
    + (signed ? `<div class="addr"><div><small class="muted">Your NEAR account</small><br><code>${esc(me)}</code></div></div>` :
    (PRIVY_ON ? `<button class="btn google big" id="google" data-testid="setup-google"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.6 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.2 0-11.5-4.1-13.4-9.9l-8 6.1C6.6 42.6 14.6 48 24 48z"/></svg>Continue with Google</button>
      <form id="emailf" style="margin-top:12px">${emailStage === 'finish'
        ? `<p class="lede">You are logged in${email ? ` as <b>${esc(email)}</b>` : ''}. One click opens the Nearcarta sign-in window and links your NEAR account.</p><button type="button" class="btn gold big" id="finish" data-testid="setup-finish">Finish sign in →</button>`
        : emailStage === 'email'
        ? `<label for="em">Email</label><div class="row" style="flex-wrap:nowrap"><input id="em" type="email" required autocomplete="email" placeholder="you@example.com" value="${esc(email)}" data-testid="setup-email"><button class="btn" data-testid="setup-send">Send code</button></div>`
        : `<label for="code">6-digit code sent to ${esc(email)}</label><div class="row" style="flex-wrap:nowrap"><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" required data-testid="setup-code" style="font:600 20px var(--mono);letter-spacing:.3em"><button class="btn gold" data-testid="setup-verify">Verify</button></div><button type="button" class="btn link sm" id="reemail" data-testid="setup-reemail">Use another email</button>`}</form>
      <p id="status" class="small muted" role="status" aria-live="polite" data-testid="setup-status"></p>
      <div class="or">or</div>` : '')
    + `<div class="tiles" data-testid="setup-choices"><button class="tile" id="wallet" data-testid="setup-wallet"><i>◈</i><b>NEAR wallet</b><span>Meteor, Intear, HOT, Ledger… on mainnet</span></button>
      <button class="tile" id="mm" data-testid="setup-metamask"><i>🦊</i><b>MetaMask</b><span>Your EVM wallet signs NEAR mainnet</span></button></div>
      <p class="assure">Google or email makes a NEAR mainnet account for you. Nothing is sent until you approve. Funding is real NEAR.</p>`
    + (journey().showGuest ? `<p class="trial-note"><button class="btn link" id="guest" data-testid="setup-guest">Use a free testnet account instead</button><span class="small"> A separate trial. No real NEAR. Its key stays in this browser.</span></p>` : ''))
    + errP() + nav(signed, { back: false });
}
const say = t => { const el = $('#status'); if (el) el.textContent = t; };
async function ensureWallet() {
  const { user } = await privy.user.get();
  const hasNear = u => (u?.linked_accounts || []).some(a => a.type === 'wallet' && a.chain_type === 'near');
  if (!hasNear(user)) await createWallet({ fetchPrivyRoute: privy.fetchPrivyRoute.bind(privy), getCompiledPath: privy.getCompiledPath.bind(privy), app: { appId: privy.app.appId } }, { request: { chain_type: 'near' } });
}
async function afterPrivy() {
  // Logged in to Privy on this origin: make sure a NEAR wallet exists, then let NEAR Connect pick it up (its /sign window reuses the session).
  // Called from a click, so the browser opens that window in front instead of as a background tab.
  await ensureWallet();
  const c = mainnetWallet(); await c.whenManifestLoaded;
  await c.connect({ walletId: 'nearcarta-privy' });
  st.trial = false; save();
  await signedIn(await mainnetAccount());
}
function wireSignin() {
  if (me) return wire();
  const g = $('#google'); if (g) g.onclick = () => act(g, async () => { const { url } = await privy.auth.oauth.generateURL('google', location.origin + '/setup/'); sessionStorage.setItem('nc_setup_google', '1'); location.assign(url); });
  const f = $('#emailf'); if (f) f.onsubmit = e => { e.preventDefault(); const b = f.querySelector('button:not([type])');
    if (emailStage === 'email') act(b, async () => { email = $('#em').value.trim(); await privy.auth.email.sendCode(email); emailStage = 'code'; });
    else act(b, async () => { say('Checking your code…'); await privy.auth.email.loginWithCode(email, $('#code').value.trim());
      say('Code accepted. Making your NEAR wallet…'); await ensureWallet(); emailStage = 'finish'; say(''); }); };
  const fin = $('#finish'); if (fin) fin.onclick = () => act(fin, async () => { say('Opening the Nearcarta sign-in window…'); await afterPrivy(); emailStage = 'email'; say(''); });
  const re = $('#reemail'); if (re) re.onclick = e => { e.preventDefault(); e.stopPropagation(); emailStage = 'email'; msg = ''; render(); };
  $('#wallet').onclick = e => act(e.currentTarget, async () => { st.trial = false; save(); signedIn(await connect(t => { msg = t; }, 'mainnet')); });
  $('#mm').onclick = e => act(e.currentTarget, async () => { msg = ''; st.trial = false; save(); await mainnetWallet().connect({ walletId: 'ethereum-wallets' }); await signedIn(await mainnetAccount()); });
  const gu = $('#guest'); if (gu) gu.onclick = e => act(e.currentTarget, async () => { st.trial = true; save(); signedIn(await startGuest()); });
}
async function signedIn(id) {
  if (!id) return;
  me = id; done(0); await refreshBal();
  // A brand-new account has nothing yet: the next stop is always Fund.
  go(bal === 0n || bal == null || bal < YN / 2n ? 1 : Math.max(1, st.step));
}

// ---------- 2. Fund ----------
async function refreshBal() { if (!me) return; bal = await balanceOn(me, st.trial ? 'testnet' : 'mainnet'); top(); const el = $('#bigbal'); if (el) el.innerHTML = balHtml(); }
const balHtml = () => `${bal === undefined ? '…' : bal == null ? '?' : fmtN(nearOf(bal))} <small>NEAR</small>`;
const need = () => {
  if (st.trial && !PUBLIC_MAINNET) return Number(st.deposit) + 0.05;
  if (boardLive()) return 0.03;
  return 0.05;
};
const holdsForCharter = () => st.trial && !PUBLIC_MAINNET;
function sFund() {
  let qr = ''; try { const q = qrcode(0, 'M'); q.addData(me); q.make(); qr = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch {}
  const enough = bal != null && nearOf(bal) >= need();
  const j = journey();
  const shown = short(me);
  const lead = st.trial
    ? `This trial charter needs about <b>${fmtN(need())} testnet NEAR</b>. That is not real NEAR.`
    : `You can continue now. Add real NEAR on mainnet when you want to pay gas. This page does not hold you here, and it does not move your NEAR.`;
  return head('Fund', bal === 0n ? 'Your account is ready. It has 0 NEAR.' : (st.trial ? 'Add testnet NEAR to the trial account.' : 'Add real NEAR when you want to.'), lead)
    + `<div class="addr"><div class="qr" aria-label="QR code of your account id">${qr}</div><div style="flex:1;min-width:200px">
       <small class="muted">${st.trial ? 'Send testnet NEAR to' : 'Send NEAR on mainnet to'}</small><br><code data-testid="setup-address" title="${esc(me)}">${esc(shown)}</code>
       <div class="row" style="margin-top:10px"><button class="btn sm" id="copy" data-testid="setup-copy">Copy address</button>${acA(me)}</div>
       <div style="margin-top:14px"><span class="live">live balance</span><div class="bal" id="bigbal" data-testid="setup-balance">${balHtml()}</div></div></div></div>
     <p class="small">${esc(j.fundLead)}</p>
     <h2>Ways to add NEAR</h2><div class="tiles">
       ${j.showFaucet ? `<button class="tile" id="drip" data-testid="setup-faucet"><i>✦</i><b>Free testnet NEAR</b><span>10 testnet NEAR from the public faucet. Not real NEAR.</span></button>` : ''}
       <a class="tile" href="https://app.near-intents.org/" target="_blank" rel="noopener" data-testid="setup-intents"><i>⇄</i><b>Swap into NEAR</b><span>${esc(j.intentsNote)}</span></a>
       <button class="tile" id="copy2"><i>⎘</i><b>From an exchange</b><span>${st.trial ? 'This trial is not an exchange withdrawal. Use the faucet above.' : 'Withdraw NEAR on NEAR mainnet to this address.'}</span></button></div>
     ${errP()}` + nav(true, { nextOk: holdsForCharter() ? enough : true, label: holdsForCharter() && !enough ? `Waiting for ${fmtN(need())} NEAR` : 'Continue' });
}
function wireFund() {
  const cp = () => navigator.clipboard?.writeText(me).then(() => { const b = $('#copy'); if (b) { b.textContent = 'Copied ✓'; setTimeout(() => b && (b.textContent = 'Copy address'), 1600); } });
  $('#copy').onclick = cp; $('#copy2').onclick = cp;
  const d = $('#drip'); if (d) d.onclick = () => act(d, async () => { const h = await faucet(me, t => { const s = d.querySelector('span'); if (s) s.textContent = t; }); await refreshBal(); msg = ''; lastFaucet = h; });
  wire();
  clearInterval(balTimer); balTimer = setInterval(async () => { if (STEPS[st.step][0] !== 'fund') return clearInterval(balTimer); const was = bal; await refreshBal(); if (String(was) !== String(bal)) render(); }, 5000);
}
let lastFaucet = null;

// ---------- 3. Privacy ----------
function sPrivacy() {
  return head('Privacy', 'Know what is public before you start.', 'NEAR is a public ledger. Your rules are public on purpose: anyone can check what your agent may and may not do.')
    + `<div class="two"><div class="panel pub"><h3>Public on chain</h3><ul><li>Your account id and its balance</li><li>Your charter and every rule in it (cap, daily budget, allowed shops, expiry)</li><li>Each payment your agent asks for, and whether the charter allowed or refused it</li><li>The agent's public key</li></ul></div>
       <div class="panel priv"><h3>Stays private</h3><ul><li>Your email or Google profile (held by the login provider, never on chain)</li><li>The agent's secret key: it stays in this browser</li><li>Your character art and its nickname: kept in this browser only</li></ul></div></div>
     <label class="toggle"><input type="checkbox" id="mist" ${st.mist ? 'checked' : ''} data-testid="setup-mist"><span><b>Use Mist for payouts</b><br><span class="muted small">Mist Bank pays out through shielded Zcash, so the receiving side and amount are hidden after the bridge. This is a site preference: the charter on NEAR still records the payment request, and the contract does not enforce Mist.</span></span></label>`
    + nav(true);
}
function wirePrivacy() { $('#mist').onchange = e => { st.mist = e.target.checked; save(); }; wire(); }

// ---------- 4. Character ----------
const nameOk = n => /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/.test(n) && !n.includes('--');
function defName() { const b = (me || 'agent').split('.')[0].replace(/[^a-z0-9]/g, '').slice(0, 10) || 'agent'; return `${persona().id}-${b}`.slice(0, 24); }
function sCharacter() {
  if (!st.agentName) st.agentName = defName();
  if (!st.displayName) st.displayName = persona().name;
  const shown = st.displayName || persona().name;
  const accountField = holdsForCharter()
    ? `<div class="field"><label for="an">Charter account</label><div class="suffix"><input id="an" value="${esc(st.agentName)}" maxlength="24" autocomplete="off" spellcheck="false" data-testid="setup-name"><span>.${esc(short(CFG?.factory || ''))}</span></div>
       <p class="small muted" id="nhint">Lowercase letters, digits and single dashes. This trial charter is on testnet.</p></div>`
    : `<p class="small muted">This name stays in this browser and in the town. ${boardLive() ? 'Your charter is a row on the mainnet board, under the account you signed in with.' : 'A personal charter is a row on the mainnet board. That contract is not deployed yet, so this page will not create one.'}</p>`;
  return head('Character', 'Choose who walks the town.', 'The look, colour and name stay in this browser and appear in the town.')
    + `<div class="cast"><div class="picks" role="group" aria-label="Looks">${LOOKS.map(p => `<button class="pick" data-p="${p.id}" aria-pressed="${p.id === st.persona}" data-testid="persona-${p.id}"><img src="/setup/chars/${p.img}.webp" alt="" width="160" height="160"><b>${esc(p.name)}</b><span>${esc(p.blurb)}</span></button>`).join('')}</div>
     <aside class="liveprev">${portraitHTML(persona(), dyeOf(), st.outfit, shown)}
       <p class="small muted">Colour</p><div class="swatches" role="group" aria-label="Colours">${DYES.map(d => `<button type="button" class="swatch" data-dye="${d.id}" aria-pressed="${d.id === st.dye}" title="${esc(d.name)}" style="--dye:${d.hex}" data-testid="dye-${d.id}"></button>`).join('')}</div>
       <p class="small muted">Outfit</p><div class="swatches" role="group" aria-label="Outfits">${OUTFITS.map(o => `<button type="button" class="fit" data-fit="${o.id}" aria-pressed="${o.id === st.outfit}" data-testid="outfit-${o.id}">${esc(o.name)}</button>`).join('')}</div>
       <div class="field"><label for="dn">Name in town</label><input id="dn" value="${esc(st.displayName)}" maxlength="24" autocomplete="off" data-testid="setup-display"></div>
       ${accountField}</aside></div>` + nav(true, { nextOk: (holdsForCharter() ? nameOk(st.agentName) : true) && displayOk(st.displayName) });
}
function wireCharacter() {
  const paint = () => { remember(); const ok = (holdsForCharter() ? nameOk(st.agentName) : true) && displayOk(st.displayName); const n = $('#next'); if (n) n.disabled = !ok; const h = $('#nhint'); if (h) { h.textContent = nameOk(st.agentName) ? (st.trial ? 'Lowercase letters, digits and single dashes. This trial charter is on testnet.' : 'Lowercase letters, digits and single dashes.') : 'Use 2–24 lowercase letters, digits or single dashes.'; h.className = 'small ' + (nameOk(st.agentName) ? 'muted' : 'err'); } };
  document.querySelectorAll('.pick').forEach(b => b.onclick = () => { const old = defName(), oldShow = persona().name; st.persona = b.dataset.p; const p = persona(); if (st.agentName === old || !st.agentName) st.agentName = defName(); if (!st.displayName || st.displayName === oldShow) st.displayName = p.name; st.cap = p.cap; st.daily = p.daily; st.per = p.per; save(); render(); });
  document.querySelectorAll('[data-dye]').forEach(b => b.onclick = () => { st.dye = b.dataset.dye; save(); render(); });
  document.querySelectorAll('[data-fit]').forEach(b => b.onclick = () => { st.outfit = b.dataset.fit; save(); render(); });
  $('#dn').oninput = e => { st.displayName = e.target.value.replace(/\s+/g, ' ').trimStart(); save(); paint(); const port = document.querySelector('.portrait b'); if (port) port.textContent = st.displayName || persona().name; };
  const an = $('#an'); if (an) an.oninput = e => { st.agentName = e.target.value.toLowerCase(); save(); paint(); };
  paint();
  wire(async () => { if (!displayOk(st.displayName)) { msg = 'Give your agent a name, 2–24 letters.'; return render(); }
    remember(); if (!holdsForCharter()) { done(st.step); go(st.step + 1); return; }
    const id = `${st.agentName}.${CFG.factory}`; const b = $('#next');
    await act(b, async () => { if (PREVIEW) return; const r = await fetch(API + '/api/vault/charter/' + encodeURIComponent(id)).then(r => r.json()).catch(() => ({}));
      if (r?.exists && r?.owner && r.owner !== me) throw new Error(`${id} is taken. Pick another name.`); done(st.step); go(st.step + 1); }); });
}

// ---------- 5. Rules ----------
function rules() {
  const p = persona();
  const mainShops = [MAIN.charter?.contract, MAIN.toll?.contract].filter(Boolean);
  const fallback = st.trial ? (CFG?.arena?.merchants || []).slice(0, 2) : mainShops;
  const saved = st.receivers;
  const useSaved = saved && (st.trial || saved.some(a => !String(a).endsWith('.testnet')));
  return { cap: st.cap ?? p.cap, daily: st.daily ?? p.daily, per: st.per ?? p.per, days: st.days, receivers: useSaved ? saved : fallback };
}
function preview(r) {
  const until = new Date(Date.now() + r.days * 864e5).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
  return `<b>${esc(persona().name)}</b> may pay only <b>${r.receivers.map(esc).join('</b> or <b>') || 'nobody yet'}</b>, at most <b>${fmtN(+r.cap)} NEAR</b> per payment, <b>${fmtN(+r.daily)} NEAR</b> and <b>${r.per}</b> payments per day, until <b>${until}</b>. Anything else is refused by the contract, even if the agent is tricked.`;
}
function sRules() {
  const r = rules();
  return head('Rules', 'Write the rules it cannot break.', st.trial
    ? 'These become a clause in your testnet trial charter. Changing them later needs your wallet, and safety changes wait out a delay.'
    : (boardLive()
      ? 'These become your row on the mainnet board. Closing the row sends its storage and whatever is left unspent back to you.'
      : 'These stay in this browser with your character. The mainnet board is not deployed yet, so this page does not write them into a contract.'))
    + `<div class="grid2"><div class="field"><label for="cap">Max per payment</label><div class="suffix"><input id="cap" type="number" step="0.001" min="0.001" value="${r.cap}" data-testid="rule-cap"><span>NEAR</span></div></div>
       <div class="field"><label for="daily">Daily budget</label><div class="suffix"><input id="daily" type="number" step="0.001" min="0.001" value="${r.daily}" data-testid="rule-daily"><span>NEAR</span></div></div>
       <div class="field"><label for="per">Payments per day</label><input id="per" type="number" min="1" max="100" value="${r.per}" data-testid="rule-per"></div>
       <div class="field"><label for="days">Rule expires after</label><select id="days" data-testid="rule-days">${[7, 30, 90, 365].map(d => `<option value="${d}" ${d == r.days ? 'selected' : ''}>${d} days</option>`).join('')}</select></div></div>
     <div class="field"><label for="rcv">Allowed shops (account ids, comma separated)</label><input id="rcv" value="${esc(r.receivers.join(', '))}" spellcheck="false" data-testid="rule-receivers"></div>
     <div class="preview" id="prev" data-testid="rule-preview">${preview(r)}</div>${errP()}` + nav(true);
}
function wireRules() {
  const upd = () => { st.cap = +$('#cap').value; st.daily = +$('#daily').value; st.per = +$('#per').value; st.days = +$('#days').value; st.receivers = $('#rcv').value.split(/[\s,]+/).map(s => s.trim().toLowerCase()).filter(Boolean); save(); $('#prev').innerHTML = preview(rules()); };
  ['cap', 'daily', 'per', 'days', 'rcv'].forEach(id => $('#' + id).oninput = upd);
  wire(() => { const r = rules();
    if (!(r.cap > 0) || !(r.daily >= r.cap)) { msg = 'The daily budget must be at least the per-payment cap.'; return render(); }
    if (!r.receivers.length || r.receivers.some(a => !/^[a-z0-9._-]{2,64}$/.test(a))) { msg = 'Add at least one valid account id.'; return render(); }
    done(st.step); go(st.step + 1); });
}

// ---------- 6. Sign ----------
let signLog = [];
function sSign() {
  if (!st.trial && !boardLive()) {
    const allowed = MAIN.charter?.txs?.['agent_propose_allowed_0.001'];
    const refused = MAIN.charter?.txs?.['agent_propose_over_cap_0.003'];
    return head('Sign', 'Your account is on mainnet.', 'A personal charter is a row on the mainnet board. That contract is not deployed yet, so this page will not send a transaction that pretends to create one. The town charter, toll, arena, house and town hall already run on mainnet.')
      + `<div class="agent">${portraitHTML(persona(), dyeOf(), st.outfit, st.displayName || persona().name)}<div><b>${esc(st.displayName || persona().name)}</b><br><span class="small muted">Saved in this browser</span></div></div>`
      + `<div class="facts"><div class="fact"><small>Town charter</small><b>${acA(MAIN.charter.contract)}</b></div>
         <div class="fact"><small>Allowed 0.001 NEAR</small><b>${txA(allowed)}</b></div>
         <div class="fact"><small>Refused 0.003 NEAR</small><b>${txA(refused)}</b></div></div>`
      + errP() + nav(true, { label: 'Continue' });
  }
  const onBoard = boardLive() && !st.trial;
  const r = rules(), id = st.charter || (onBoard ? me : `${st.agentName}.${CFG.factory}`), live = st.charter && localStorage.getItem(agentLS(st.charter));
  const stake = onBoard ? '0.02' : fmtN(st.deposit);
  const L = onBoard ? [['Open your row', 'create']] : [['Create your charter', 'create'], ['Write the rule and add the agent key', 'rules']];
  return head('Sign', live ? 'Your agent is live.' : (onBoard ? 'One approval in your wallet.' : 'Two approvals in your wallet.'), live ? 'These limits are read back from the chain, not from this page.' : (onBoard ? `This opens your row. At most ${stake} NEAR is attached. The contract keeps the row's storage and a small spendable balance, and sends the rest back. Closing the row returns both.` : `First the charter is made (${stake} NEAR goes into it, and comes back if the charter is deleted). Then one transaction writes your rule and adds a limited agent key that can only ask the charter to pay.`))
    + `<div class="agent">${portraitHTML(persona(), dyeOf(), st.outfit, st.displayName || persona().name)}<div><b>${esc(st.displayName || persona().name)}</b><br><code class="small">${esc(id)}</code></div></div>`
    + (live ? `<div class="facts" id="facts" data-testid="setup-facts"><div class="fact"><small>Loading</small><b>…</b></div></div>` : `<div class="preview">${preview(r)}</div>`)
    + `<ul class="steps">${L.map(([t, k]) => { const s = signLog.find(x => x.k === k); return `<li class="${s?.state || ''}">${esc(t)}${s?.tx ? txA(s.tx) : ''}</li>`; }).join('')}</ul>`
    + (live ? '' : `<button class="btn gold big" id="sign" data-testid="setup-sign">Approve in wallet</button>`) + errP() + nav(live, { label: 'Try your agent' });
}
async function charterState(id) { return fetch(API + '/api/vault/charter/' + encodeURIComponent(id) + '?fresh=1').then(r => r.json()).catch(() => ({})); }
async function accountOn(id, network) {
  if (network !== 'mainnet') return (await charterState(id)).exists;
  const r = await fetch(MAIN.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: id } }) });
  const j = await r.json();
  return !j.error && !!j.result;
}
function boardArgs(r, agent) {
  const exp = BigInt(Date.now() + r.days * 864e5) * 1_000_000n;
  return {
    rules: { receivers: r.receivers, per_action_cap: toY(r.cap), daily_budget: toY(r.daily), max_actions_per_day: r.per, window_start_min: 0, window_end_min: 0, min_amount: toY(0.0001), expires_at: exp.toString() },
    agent, fund: (YN / 1000n).toString(),
  };
}
async function signBoard() {
  const r = rules(), w = await mainnetWallet().wallet(), contract = MAIN.board.contract;
  const mark = (k, state, tx) => { const s = signLog.find(x => x.k === k); if (s) Object.assign(s, { state, tx: tx || s.tx }); else signLog.push({ k, state, tx }); render(); };
  const readRpc = rpcClient([MAIN.rpc]);
  let row = await viewFn(readRpc, contract, 'get_charter', { owner: me }).catch(() => null);
  const sec = localStorage.getItem(agentLS(me)) || keyFrom().secretKey;
  localStorage.setItem(agentLS(me), sec);
  if (!row) {
    mark('create', 'run');
    const res = await w.signAndSendTransaction({ receiverId: contract, actions: [{ type: 'FunctionCall', params: { methodName: 'open_charter', args: boardArgs(r, keyFrom(sec).publicKey), gas: (80n * TG).toString(), deposit: String(MAIN.board.max_row_yocto) } }] });
    mark('create', 'run', txHashOf(res));
    for (let i = 0; i < 20 && !row; i++) { await wait(1500); row = await viewFn(readRpc, contract, 'get_charter', { owner: me }).catch(() => null); }
    if (!row) throw new Error('The row did not appear yet. Wait a few seconds and press Approve again.');
  }
  mark('create', 'ok'); st.charter = me; save();
  if (row.agent !== pubkeyHex(keyFrom(sec))) {
    const res = await w.signAndSendTransaction({ receiverId: contract, actions: [{ type: 'FunctionCall', params: { methodName: 'set_agent', args: { agent: keyFrom(sec).publicKey }, gas: (40n * TG).toString(), deposit: '1' } }] });
    mark('create', 'ok', txHashOf(res));
  }
  done(5); await refreshBal();
}
async function sign() {
  if (boardLive() && !st.trial) return signBoard();
  const r = rules(), w = await wallet().wallet(), id = `${st.agentName}.${CFG.factory}`;
  const mark = (k, state, tx) => { const s = signLog.find(x => x.k === k); if (s) Object.assign(s, { state, tx: tx || s.tx }); else signLog.push({ k, state, tx }); render(); };
  let exists = await accountOn(id, 'testnet');
  if (!exists) {
    mark('create', 'run');
    const res = await w.signAndSendTransaction({ receiverId: CFG.factory, actions: [{ type: 'FunctionCall', params: { methodName: 'create_charter', args: { name: st.agentName, policy_delay_ns: String(CFG.policy_delay?.default_ns || '86400000000000') }, gas: (150n * TG).toString(), deposit: toY(st.deposit) } }] });
    mark('create', 'run', txHashOf(res));
    for (let i = 0; i < 20 && !exists; i++) { await wait(1500); exists = await accountOn(id, 'testnet'); }
    if (!exists) throw new Error('The charter did not appear yet. Wait a few seconds and press Approve again.');
  }
  mark('create', 'ok'); st.charter = id; save();
  mark('rules', 'run');
  const sec = localStorage.getItem(pendLS(id)) || keyFrom().secretKey; localStorage.setItem(pendLS(id), sec);
  const exp = BigInt(Date.now() + r.days * 864e5) * 1_000_000n;
  const clause = { asset: 'Native', receivers: r.receivers, per_action_cap: toY(r.cap), daily_budget: toY(r.daily), window_start_min: 0, window_end_min: 0, requires_receipt: false, escalation_max: null, min_amount: toY(0.0001), max_actions_per_day: r.per };
  const fc = (methodName, args, g) => ({ type: 'FunctionCall', params: { methodName, args, gas: (g * TG).toString(), deposit: '0' } });
  const res = await w.signAndSendTransaction({ receiverId: id, actions: [fc('set_clause', { clause_id: 'pay', clause }, 40n), fc('set_clause_expiry', { clause_id: 'pay', expires_at: exp.toString() }, 30n), fc('set_agent_key', { public_key: keyFrom(sec).publicKey, allowance: (YN / 4n).toString() }, 60n)] });
  localStorage.setItem(agentLS(id), sec); localStorage.removeItem(pendLS(id));
  mark('rules', 'ok', txHashOf(res)); done(5); await refreshBal();
}
async function facts() {
  const el = $('#facts'); if (!el || !st.charter) return;
  try {
    if (boardLive() && !st.trial) {
      const readRpc = rpcClient([MAIN.rpc]);
      const row = await viewFn(readRpc, MAIN.board.contract, 'get_charter', { owner: me });
      const key = localStorage.getItem(agentLS(me));
      el.innerHTML = [['Charter', acA(me)], ['Row balance', fmtN(nearOf(row?.balance)) + ' NEAR'], ['Row storage', fmtN(nearOf(row?.storage_locked)) + ' NEAR'],
        ['Max per payment', fmtN(nearOf(row?.per_action_cap)) + ' NEAR'], ['Daily budget', fmtN(nearOf(row?.daily_budget)) + ' NEAR'],
        ['Allowed shops', esc((row?.receivers || []).join(', '))],
        ['Expires', row?.expires_at && row.expires_at !== '0' ? new Date(Number(BigInt(row.expires_at) / 1_000_000n)).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : 'none'],
        ['Agent key', key && pubkeyHex(keyFrom(key)) === row?.agent ? 'bound to this browser' : 'not the key in this browser']]
        .map(([a, b]) => `<div class="fact"><small>${a}</small><b>${b}</b></div>`).join('');
      return;
    }
    const readRpc = st.trial ? rpc : rpcClient([MAIN.rpc]);
    const read = (m, a) => viewFn(readRpc, st.charter, m, a);
    const cl = await read('get_clauses'); const c = (Array.isArray(cl) ? cl.find(x => (x.id || x[0]) === 'pay') : cl?.pay) || cl?.[0]; const k = c?.clause || c?.[1] || c;
    const acct = await readRpc('query', { request_type: 'view_account', finality: 'final', account_id: st.charter });
    const pk = keyFrom(localStorage.getItem(agentLS(st.charter))).publicKey;
    const ak = await readRpc('query', { request_type: 'view_access_key', finality: 'final', account_id: st.charter, public_key: pk }).catch(() => null);
    const fp = ak?.permission?.FunctionCall; const ex = await read('get_clause_expiry', { clause_id: 'pay' }).catch(() => null);
    el.innerHTML = [['Charter', acA(st.charter)], ['Holds', fmtN(nearOf(acct.amount)) + ' NEAR'], ['Max per payment', fmtN(nearOf(k?.per_action_cap)) + ' NEAR'], ['Daily budget', fmtN(nearOf(k?.daily_budget)) + ' NEAR'],
      ['Allowed shops', esc((k?.receivers || []).join(', '))], ['Expires', ex ? new Date(Number(BigInt(ex) / 1_000_000n)).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : 'none'],
      ['Agent key may call', fp ? esc(fp.method_names.join(', ') || 'any method') + ' on ' + esc(short(fp.receiver_id)) : 'not found yet'], ['Agent gas allowance', fp?.allowance ? fmtN(nearOf(fp.allowance)) + ' NEAR' : '—']]
      .map(([a, b]) => `<div class="fact"><small>${a}</small><b>${b}</b></div>`).join('');
  } catch (e) { el.innerHTML = `<div class="fact"><small>Read</small><b>${esc(e?.message || e)}</b></div>`; }
}
function wireSign() {
  if (!st.trial && !boardLive()) { wire(() => { done(5); go(6); }); return; }
  const b = $('#sign'); if (b) b.onclick = () => act(b, sign); wire(() => { done(5); go(6); }); facts();
}

// ---------- 7. Try ----------
let tries = [];
const WHY = { over_per_action_cap: 'over your per-payment cap', over_daily_budget: 'over your daily budget', over_daily_action_count: 'over your payments-per-day limit', receiver_not_allowlisted: 'that shop is not on your list', below_min_amount: 'below the smallest payment', clause_expired: 'your rule has expired', frozen: 'the charter is frozen' };
async function boardAsk(amt) {
  const contract = MAIN.board.contract, amount = toY(amt), receiver = rules().receivers[0];
  const rpcCall = rpcClient([MAIN.rpc]);
  const row = await viewFn(rpcCall, contract, 'get_charter', { owner: me });
  const msg = proposalMessage({ contract, owner: me, receiver, amount, nonce: String(row.nonce) });
  const signature = signMessage(keyFrom(localStorage.getItem(agentLS(me))), msg);
  const w = await mainnetWallet().wallet();
  try {
    const res = await w.signAndSendTransaction({ receiverId: contract, actions: [{ type: 'FunctionCall', params: { methodName: 'propose', args: { owner: me, receiver, amount, signature, reveal: null }, gas: (80n * TG).toString(), deposit: '0' } }] });
    return { passed: true, reason: 'ok', tx: txHashOf(res), amount, receiver, decision: 'allowed' };
  } catch (e) {
    const reason = refusalOf(e) || String(e.message || e);
    return { passed: false, reason, tx: e.tx || null, amount, receiver, decision: 'refused' };
  }
}
function sTry() {
  if (!st.trial && !(boardLive() && st.charter)) {
    const allowed = MAIN.charter?.txs?.['agent_propose_allowed_0.001'];
    const refused = MAIN.charter?.txs?.['agent_propose_over_cap_0.003'];
    return head('Try it', 'The town charter already decides on mainnet.', 'These two transactions are on mainnet. One payment inside the cap was allowed. One over the cap was refused. Your NEAR is not spent here.')
      + `<div class="verdict good" data-testid="try-verdict"><span class="tag">ALLOWED</span><div><b>0.001 NEAR on ${esc(MAIN.charter.contract)}</b><br><span class="muted small">inside the cap</span> ${txA(allowed)}</div></div>`
      + `<div class="verdict bad" data-testid="try-verdict"><span class="tag">REFUSED</span><div><b>0.003 NEAR on ${esc(MAIN.charter.contract)}</b><br><span class="muted small">over the per-payment cap</span> ${txA(refused)}</div></div>`
      + `<div class="actions"><button class="btn" id="back">Back</button><span class="row"><a class="btn" href="/shops/vault/" data-testid="setup-office">Charter office</a><a class="btn gold" href="${esc(next())}" data-testid="setup-finish">Enter the town</a></span></div>`;
  }
  const r = rules(), to = r.receivers[0], ok = Math.min(+r.cap, 0.001 > +r.cap ? +r.cap : 0.001), over = +(+r.cap * 2).toFixed(4);
  return head('Try it', 'Watch the charter decide.', `Your agent signs two real requests with its own key. The contract checks each against your rule.`)
    + `<div class="tiles" style="grid-template-columns:1fr 1fr"><button class="tile" id="t-ok" data-testid="try-allowed"><i>✓</i><b>Pay ${fmtN(ok)} NEAR to ${esc(short(to))}</b><span>Inside your rule: should pass</span></button>
       <button class="tile" id="t-no" data-testid="try-refused"><i>✕</i><b>Pay ${fmtN(over)} NEAR to ${esc(short(to))}</b><span>Twice your cap: should be refused</span></button></div>
     ${tries.map(t => `<div class="verdict ${t.passed ? 'good' : 'bad'}" data-testid="try-verdict"><span class="tag">${t.passed ? 'ALLOWED' : 'REFUSED'}</span><div><b>${fmtN(nearOf(t.amount))} NEAR → ${esc(short(t.receiver))}</b><br><span class="muted small">${esc(t.passed ? 'inside your rule · the charter paid' : (WHY[t.reason] || t.reason || t.decision))}</span> ${txA(t.tx)}</div></div>`).join('')}
     ${errP()}<div class="actions"><button class="btn" id="back">Back</button><span class="row"><a class="btn" href="/shops/vault/" data-testid="setup-office">Charter office</a><a class="btn gold" href="${esc(next())}" data-testid="setup-finish">${tries.length >= 2 ? 'Enter the town' : 'Skip to the town'}</a></span></div>`;
}
function next() { const n = new URLSearchParams(location.search).get('next'); return n && n.startsWith('/') && !n.startsWith('//') ? n : '/'; }
function wireTry() {
  if (!st.trial && !(boardLive() && st.charter)) { wire(); return; }
  const r = rules(), to = r.receivers[0];
  const rpcCall = st.trial ? rpc : rpcClient([MAIN.rpc]);
  const ask = boardLive() && !st.trial
    ? amt => boardAsk(amt)
    : (amt, memo) => runAsk({ charter: st.charter, key: keyFrom(localStorage.getItem(agentLS(st.charter))), receiver: to, amount: toY(amt), memo, viewF: (c, m, a) => viewFn(rpcCall, c, m, a), send: sendPropose, rpcCall });
  $('#t-ok').onclick = e => act(e.currentTarget, async () => { tries.push(await ask(Math.min(+r.cap, 0.001), 'setup: allowed')); });
  $('#t-no').onclick = e => act(e.currentTarget, async () => { tries.push(await ask(+(+r.cap * 2).toFixed(4), 'setup: over cap')); });
  wire();
}

const VIEWS = { signin: [sSignin, wireSignin], fund: [sFund, wireFund], privacy: [sPrivacy, wirePrivacy], character: [sCharacter, wireCharacter], rules: [sRules, wireRules], sign: [sSign, wireSign], try: [sTry, wireTry] };
function render() {
  if (!PREVIEW && !me && st.step > 0) st.step = 0;
  if (!PREVIEW && (st.trial || boardLive()) && st.step === 6 && !(st.charter && localStorage.getItem(agentLS(st.charter)))) st.step = 5;
  document.body.classList.toggle('previewing', PREVIEW);
  rail(); top(); const [v, w] = VIEWS[STEPS[st.step][0]]; const c = $('#card');
  c.innerHTML = (PREVIEW ? '<p class="preview-banner" data-testid="preview-banner">Preview. Nothing is signed.</p>' : '') + v();
  c.style.animation = 'none'; void c.offsetWidth; c.style.animation = ''; w();
  if (['character', 'sign', 'try'].includes(STEPS[st.step][0])) remember();
}

async function boot() {
  // The API host from config.js, else this origin's /api rewrite.
  try {
    CFG = await fetch(API + '/api/vault/config').then(r => r.json()).catch(() => { API = ''; return fetch('/api/vault/config').then(r => r.json()); });
  } catch (e) {
    if (!PREVIEW) throw e;
    CFG = { factory: 'preview.testnet', network: 'testnet', arena: { merchants: ['cafe.preview.testnet'] }, rpc: 'https://rpc.testnet.fastnear.com', rpc_fallbacks: [] };
  }
  rpc = rpcClient([CFG.rpc, ...(CFG.rpc_fallbacks || [])].filter(Boolean).length ? [CFG.rpc, ...(CFG.rpc_fallbacks || [])].filter(Boolean) : ['https://rpc.testnet.fastnear.com']);
  if (CFG.min_deposit) st.deposit = Math.max(st.deposit, nearOf(CFG.min_deposit));
  // One session for the whole site: if the preferred network has nobody, use whichever wallet the HUD and /console see.
  if (PUBLIC_MAINNET && st.trial) { st.trial = false; save(); }
  const who = async () => {
    if (PUBLIC_MAINNET) return mainnetAccount();
    const a = await (st.trial ? account() : mainnetAccount()); if (a) return a;
    const b = await (st.trial ? mainnetAccount() : account()); if (b) { st.trial = !st.trial; save(); } return b; };
  if (!PREVIEW) onWallet(async () => { const a = await who(); if (a !== me) { me = a; bal = undefined; if (me) await refreshBal(); render(); } });
  // Back from Google: finish the Privy login, then connect.
  const q = new URLSearchParams(location.search);
  if (privy && sessionStorage.getItem('nc_setup_google') && q.get('privy_oauth_code')) {
    sessionStorage.removeItem('nc_setup_google');
    try { await privy.auth.oauth.loginWithCode(q.get('privy_oauth_code'), q.get('privy_oauth_state'), 'google'); history.replaceState(null, '', '/setup/'); await ensureWallet(); emailStage = 'finish'; }
    catch (e) { msg = 'Google sign-in did not finish: ' + (e?.message || e); }
  }
  if (!PREVIEW) { me = await who(); if (me) await refreshBal(); }
  const want = STEPS.findIndex(s => s[0] === location.hash.slice(1));
  if (PREVIEW) {
    if (!CFG) CFG = { factory: 'preview.testnet', network: 'testnet', arena: { merchants: ['cafe.preview.testnet'] } };
    if (want > 0) { me = me || 'preview.near'; bal = bal ?? 2n * YN; }
    st.step = want >= 0 ? want : 0;
    if (!st.displayName) st.displayName = persona().name;
    if (!st.agentName) st.agentName = 'preview-agent';
    render(); return;
  }
  if (me && (bal === 0n || bal == null)) st.step = 1; else if (want >= 0 && canOpen(want)) st.step = want; else if (!me) st.step = 0;
  render();
}
boot().catch(e => { $('#card').innerHTML = `<h1>Could not load</h1><p class="err">${esc(e?.message || e)}</p>`; });
