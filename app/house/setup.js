// /setup: one guided page from "who are you" to a working agent with on-chain limits.
// Sign-in uses NEAR Connect (wallets, MetaMask) or Privy (email code inline, Google), which makes a NEAR account.
// The page never holds the owner's key: the two owner steps are approved in the wallet. The agent key made here
// can call propose on the new row. The town charter key calls propose and propose_batch. The charter decides every payment.
import { Buffer } from 'buffer';
globalThis.Buffer = globalThis.Buffer || Buffer;
import Privy, { LocalStorage, create as createWallet } from '@privy-io/js-sdk-core';
import qrcode from 'qrcode-generator';
import { wallet, mainnetWallet, account, mainnetAccount, connect, disconnect, onWallet, readyBoardKey } from './house.js';
import { balanceOn } from './onboard.js';
import { setupJourney } from '../../shared/setup/path.js';
import { callsFailedPanel, expiresToWrite, formatExpiry, hashesFromError, liveShops, migrateShops, plainRulesError, rulesDiff, rulesLiveHint, signRulesUpdate, txHashForMethod, updatePlan, RULES_DEPOSIT_YOCTO } from '../../shared/setup/rules-diff.js';
import { openRowTransactions } from '../../shared/setup/open-row.js';
import { tryTiles } from '../../shared/setup/try-tiles.js';
import { TOPUP_MIN_YOCTO, TOPUP_RESERVE_YOCTO, charterFundMarkup, charterTopUpYocto, nearStringFromYocto, topUpRoom } from '../../shared/setup/charter-fund.js';
import MAIN from '../../shared/deployments/mainnet.json' with { type: 'json' };
import { txHashOf } from '../shops/vault/wallet.js';
import { rpcClient, viewFn, keyFrom, pubkeyHex, signMessage, sendPropose, signTx, functionCall, outcomeOf, storedAgentKey } from '../../shared/vault/tx.js';
import { proposalMessage } from '../../shared/board/message.js';
import { SESSION_METHODS, BOARD_PROPOSE_TGAS, CALLS_DEPOSIT_YOCTO, FERRY_CALL_TARGETS, GAS_TOPUP_YOCTO, SESSION_HOURS, agentMethodsReady, callPolicy, callsFitRow, dropOptionalPairs, fittingShops, classifyBoardAgentKeys, payoutsCalls, renewAgentKeyActions, sessionExpiresAt, sessionLabel, rowHeadroomBytes } from '../../shared/board/session.js';
import { HOUSE_CALLS, HOUSE_SHOP } from '../../shared/house/shop.js';
import { pluginKeyName } from './board-key.js';
import { refusalOf } from '../design/D8_shops/js/board.js';
import { runAsk } from '../../shared/vault/run.js';
import { LOOKS, DYES, OUTFITS, portraitHTML, writeHero, displayOk } from './hero.js';
import { nextPath, readSessionAccount, writeSession } from '../design/D8_shops/js/session.js';

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
/** The wallet plugin keeps its own copy. Point it at the same secret the vault slot just stored. */
function syncPluginAgent(account, secret) {
  try {
    const name = pluginKeyName(account);
    const prev = JSON.parse(localStorage.getItem(name) || 'null');
    if (prev && typeof prev === 'object') localStorage.setItem(name, JSON.stringify({ ...prev, privateKey: secret }));
  } catch { /* the vault slot is the signer */ }
}
const SAVE = 'nearcarta.setup.v1';
const RETURN_TO = nextPath(location.search);
const PREVIEW = new URLSearchParams(location.search).has('preview') && !RETURN_TO;

const STEPS = [
  ['signin', 'Sign in', 'Google, email or wallet'],
  ['fund', 'Fund', 'Put NEAR in the account'],
  ['privacy', 'Privacy', 'What the world sees'],
  ['character', 'Character', 'Your agent and its name'],
  ['rules', 'Rules', 'Cap, shops, expiry'],
  ['sign', 'Sign', 'Charter and agent key'],
  ['try', 'Try it', 'One yes, one no'],
];
const st = Object.assign({ step: 0, done: [], trial: false, persona: 'mage', dye: 'brass', outfit: 'lantern', displayName: '', agentName: '', mist: false, cap: null, daily: null, per: null, hours: 1, receivers: null, charter: null, deposit: 0.5 }, JSON.parse(localStorage.getItem(SAVE) || '{}'));
const save = () => localStorage.setItem(SAVE, JSON.stringify(st));
let CFG = null, rpc = null, me = null, bal = undefined, balTimer = 0, busy = false, busySince = 0, msg = '';
const view = (c, m, a) => viewFn(rpc, c, m, a);
const boardLive = () => PUBLIC_MAINNET && MAIN.board?.status === 'deployed' && !!MAIN.board.contract;
// The board build whose `charge_acts` pays an effect budget from the side reserve instead of the
// row's own bytes. `set_effects` is only sent while this is the code on chain: on the older
// build it would make opening a row fail for everyone. Read from the record, which is updated
// when the upgrade is applied.
const EFFECTS_CODE_HASH = MAIN.board?.effects_code_hash || 'FzUSX26CnmveE2vPg4dcdczmBXFJv6mAx7YAuJPghZZf';
const journey = () => setupJourney(st.trial, { publicMainnet: PUBLIC_MAINNET, boardDeployed: boardLive() });
const explorer = () => journey().explorer;
const txA = h => h ? `<a href="${explorer()}/txns/${esc(h)}" target="_blank" rel="noopener" data-testid="setup-tx" aria-label="View transaction ${esc(h)} on nearblocks">View on nearblocks (${esc(h.slice(0, 4))}…)</a> <button type="button" class="btn link sm" data-copy="${esc(h)}" data-testid="setup-copy-tx" aria-label="Copy transaction hash">Copy</button>` : '';
// The town links are re-rendered by balance and key polls; navigate on pointerdown/click so a re-render cannot swallow the tap.
const toTown = e => { const a = e.target.closest?.('a[data-testid=setup-finish],a[data-testid=setup-office]'); if (!a || e.button > 0 || e.metaKey || e.ctrlKey) return; e.preventDefault(); location.assign(a.getAttribute('href')); };
document.addEventListener('click', toTown, true);
document.addEventListener('click', e => { const b = e.target.closest?.('[data-copy]'); if (!b) return; e.preventDefault(); navigator.clipboard?.writeText(b.dataset.copy).then(() => { b.textContent = 'Copied'; setTimeout(() => { if (document.contains(b)) b.textContent = 'Copy'; }, 1500); }).catch(() => {}); });
const acA = a => `<a href="${explorer()}/address/${esc(a)}" target="_blank" rel="noopener">${esc(short(a))}</a>`;
for (const p of LOOKS) { const i = new Image(); i.src = `/setup/chars/${p.img}.webp`; (window.__chars ||= []).push(i); }
const persona = () => LOOKS.find(p => p.id === st.persona) || LOOKS[1];
const dyeOf = () => DYES.find(d => d.id === st.dye) || DYES[0];
const remember = () => writeHero({ look: persona(), dye: dyeOf(), outfit: st.outfit, name: st.displayName || persona().name });

function go(i) { st.step = Math.max(0, Math.min(STEPS.length - 1, i)); msg = ''; save(); history.replaceState(null, '', location.pathname + location.search + '#' + STEPS[st.step][0]); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function done(i) { if (!st.done.includes(i)) st.done.push(i); save(); }
const canOpen = i => i === 0 || (me && (i <= Math.max(-1, ...st.done) + 1));

function stepNav() {
  return `<nav class="stepnav" data-testid="setup-steps" aria-label="Steps">${STEPS.map(([id, t], i) => {
    const open = i === 0 || i <= st.step || st.done.includes(i);
    return `<button type="button" data-testid="setup-step" data-step="${i}" data-id="${id}"${i === st.step ? ' aria-current="step"' : ''}${open ? '' : ' disabled'}>${i + 1}. ${esc(t)}</button>`;
  }).join('')}</nav>`;
}
function rail() {
  $('#rail').innerHTML = STEPS.map(([id, t, s], i) => `<li class="${i === st.step ? 'now' : (i < st.step || st.done.includes(i)) ? 'done' : ''}" data-i="${i}" ${i === st.step ? 'aria-current="step"' : ''}><span>${esc(t)}<small>${esc(s)}</small></span></li>`).join('');
  $('#rail').querySelectorAll('li.done, li.now').forEach(li => { const i = +li.dataset.i; if (i <= st.step || st.done.includes(i)) { li.tabIndex = 0; li.onclick = () => go(i); li.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(i); } }; } });
  $('#bar').style.width = ((st.step + 1) / STEPS.length * 100) + '%';
}
function top() {
  const net = $('#net');
  net.textContent = journey().badge;
  net.dataset.testid = 'setup-net';
  $('#who').innerHTML = me ? `<span data-testid="setup-who">${esc(short(me))}</span> · <span data-testid="setup-bal">${bal === undefined ? '…' : bal == null ? '? NEAR' : fmtN(nearOf(bal)) + ' NEAR'}</span><button class="btn link sm" id="out">Sign out</button>` : '';
  const o = $('#out'); if (o) o.onclick = async () => { await disconnect(); await mainnetWallet().disconnect().catch(() => {}); await privy?.auth.logout().catch(() => {}); me = null; bal = undefined; st.done = []; st.trial = false; delete st.accountId; chainRow = null; chainLoadedFor = ''; chainError = ''; save(); go(0); };
}
const head = (eye, h, lede) => `${stepNav()}<p class="eyebrow">Step ${st.step + 1} of ${STEPS.length} · ${esc(eye)}</p><h1>${h}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}`;
const nav = (next, { back = true, nextOk = true, label = 'Continue' } = {}) => `<div class="actions">${back && st.step > 0 ? '<button class="btn" id="back">Back</button>' : '<span></span>'}${next ? `<button class="btn gold" id="next" data-testid="setup-next" ${nextOk ? '' : 'disabled'}>${esc(label)} →</button>` : ''}</div>`;
const errP = () => msg ? `<p class="err" role="alert" data-testid="setup-err">${esc(msg)}</p>` : '';
function wire(nextFn) { const b = $('#back'); if (b) b.onclick = () => go(st.step - 1); const n = $('#next'); if (n) n.onclick = nextFn || (() => { done(st.step); go(st.step + 1); }); }
async function act(btn, f) {
  if (PREVIEW) { msg = ''; done(st.step); go(Math.min(STEPS.length - 1, st.step + 1)); return; }
  // A click while an approval is open says so instead of doing nothing; after 45 s a new attempt is allowed.
  if (busy && Date.now() - busySince < 45000) { msg = 'Still waiting for the approval you opened. Finish or close it, then try again.'; const oe = $('[data-testid=setup-err]'); if (oe) oe.textContent = msg; else btn?.insertAdjacentHTML('afterend', errP()); return; }
  busy = true; busySince = Date.now(); const t = btn?.innerHTML; if (btn) { btn.style.minWidth = btn.offsetWidth + 'px'; btn.disabled = true; btn.innerHTML = '<span class="spin"></span> ' + t; } msg = '';
  try { await f(); } catch (e) { msg = plainErr(e); } finally { busy = false; if (btn && document.contains(btn)) { btn.disabled = false; btn.innerHTML = t; } render(); } }

// ---------- 1. Sign in ----------
let emailStage = 'email', email = '';
function sSignin() {
  const signed = !!me && !PREVIEW;
  return head('Sign in', signed ? 'You are in.' : 'Start here.',
    signed ? `Signed in as <b>${esc(me)}</b>.` : 'Sign in to get your own NEAR account. Next you pick a character and set spending limits your agent can never go past.')
    + (signed ? `<div class="addr"><div><small class="muted">Your NEAR account</small><br><code>${esc(me)}</code></div></div>` :
    (PRIVY_ON ? `<button class="btn google big" id="google" data-testid="setup-google"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.6 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.2 0-11.5-4.1-13.4-9.9l-8 6.1C6.6 42.6 14.6 48 24 48z"/></svg>Continue with Google</button>
      <form id="emailf" class="signbox" style="margin-top:12px">${emailStage === 'finish'
        ? `<p class="lede">You are logged in${email ? ` as <b>${esc(email)}</b>` : ''}. One click opens the Nearcarta sign-in tab and links your NEAR account.</p><button type="button" class="btn gold big" id="finish" data-testid="setup-finish">Finish sign in →</button><div id="tabhelp" class="tabhelp" hidden data-testid="setup-tabhelp"><p class="small">The sign-in opened in another browser tab. Switch to it and press <b>Connect</b>. This page moves on by itself.</p><button type="button" class="btn" id="reopen" data-testid="setup-reopen">Switch to the sign-in tab</button></div>`
        : emailStage === 'email'
        ? `<label for="em">Email</label><div class="row" style="flex-wrap:nowrap"><input id="em" type="email" required autocomplete="email" placeholder="you@example.com" value="${esc(email)}" data-testid="setup-email"><button class="btn gold" data-testid="setup-send">Send code</button></div>`
        : `<label for="code">6-digit code sent to ${esc(email)}</label><div class="row" style="flex-wrap:nowrap"><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" required data-testid="setup-code" style="font:600 20px var(--mono);letter-spacing:.3em"><button class="btn gold" data-testid="setup-verify">Verify</button></div><button type="button" class="btn link sm" id="reemail" data-testid="setup-reemail">Use another email</button>`}</form>
      <p id="status" class="small muted" role="status" aria-live="polite" data-testid="setup-status"></p>
      <div class="or">or</div>` : '')
    + `<div class="tiles" data-testid="setup-choices"><button class="tile" id="wallet" data-testid="setup-wallet"><i>◈</i><b>NEAR wallet</b><span>Meteor, Intear, HOT, Ledger… on mainnet</span></button>
      <button class="tile" id="mm" data-testid="setup-metamask"><i>🦊</i><b>MetaMask</b><span>Your EVM wallet signs NEAR mainnet</span></button></div>
      <p class="assure">Google or email makes a NEAR account for you. Nothing is sent until you approve it.</p>`
    + '')
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
  await readyBoardKey();
  await c.connect({ walletId: 'nearcarta-privy' });
  st.trial = false; save();
  await signedIn(await mainnetAccount(), 'nearcarta-privy');
}
function wireSignin() {
  if (me) return wire();
  const g = $('#google'); if (g) g.onclick = () => act(g, async () => { const { url } = await privy.auth.oauth.generateURL('google', location.origin + '/setup/'); sessionStorage.setItem('nc_setup_google', '1'); if (RETURN_TO) sessionStorage.setItem('nc_setup_next', RETURN_TO); else sessionStorage.removeItem('nc_setup_next'); location.assign(url); });
  const f = $('#emailf'); if (f) f.onsubmit = e => { e.preventDefault(); const b = f.querySelector('button:not([type])'); msg = ''; const oe = $('[data-testid=setup-err]'); if (oe) oe.remove();
    if (emailStage === 'email') act(b, async () => { email = $('#em').value.trim(); await privy.auth.email.sendCode(email); emailStage = 'code'; });
    else act(b, async () => { say('Checking your code…'); await privy.auth.email.loginWithCode(email, $('#code').value.trim());
      say('Code accepted. Making your NEAR wallet…'); await ensureWallet(); emailStage = 'finish'; msg = ''; say(''); }); };
  const fin = $('#finish'); if (fin) fin.onclick = () => finishSignin(fin);
  const ro = $('#reopen'); if (ro) ro.onclick = () => { finishTry++; busy = false; finishSignin(fin, true); };
  const re = $('#reemail'); if (re) re.onclick = e => { e.preventDefault(); e.stopPropagation(); emailStage = 'email'; msg = ''; render(); };
  $('#wallet').onclick = e => act(e.currentTarget, async () => { st.trial = false; save(); signedIn(await connect(t => { msg = t; }, 'mainnet')); });
  $('#mm').onclick = e => act(e.currentTarget, async () => { msg = ''; st.trial = false; save(); await mainnetWallet().connect({ walletId: 'ethereum-wallets' }); await signedIn(await mainnetAccount(), 'ethereum-wallets'); });
}
// The sign-in tab can open behind this one. Watch for it to connect (storage event from the same origin, or the
// wallet callback), move on by itself, and after 3 s offer a button that opens it again in front.
let finishTry = 0, helpTimer = 0;
async function finishSignin(btn, again) {
  const my = ++finishTry; msg = ''; const oe = $('[data-testid=setup-err]'); if (oe) oe.remove();
  const help = $('#tabhelp'); if (help) help.hidden = true; clearTimeout(helpTimer);
  say(again ? 'Opening the sign-in tab again…' : 'Opening the Nearcarta sign-in tab…');
  helpTimer = setTimeout(() => { if (my !== finishTry || me) return; if (document.hasFocus()) { const h = $('#tabhelp'); if (h) h.hidden = false; say('Waiting for you to press Connect in the sign-in tab…'); } }, 3000);
  if (btn) { btn.disabled = true; btn.dataset.label = btn.dataset.label || btn.innerHTML; btn.style.minWidth = btn.offsetWidth + 'px'; btn.innerHTML = '<span class="spin"></span> Waiting for the sign-in tab'; }
  try { await afterPrivy(); if (my !== finishTry) return; emailStage = 'email'; say(''); }
  catch (e) { if (my !== finishTry || me) return; msg = e?.message || String(e); say(''); render(); }
  finally { clearTimeout(helpTimer); if (btn && document.contains(btn) && my === finishTry) { btn.disabled = false; btn.innerHTML = btn.dataset.label; } }
}
window.addEventListener('storage', async () => {
  if (me || emailStage !== 'finish') return;
  const a = await mainnetAccount().catch(() => null); if (a && !me) { finishTry++; clearTimeout(helpTimer); emailStage = 'email'; msg = ''; await signedIn(a); }
});
async function signedIn(id, walletId) {
  if (!id) return;
  me = id; st.accountId = id; save();
  const patch = { accountId: id, displayName: st.displayName || '' };
  if (walletId) patch.walletId = walletId;
  writeSession(patch);
  const dest = nextPath(location.search);
  if (dest) { location.replace(dest); return; }
  done(0); await refreshBal();
  // A brand-new account has nothing yet: the next stop is always Fund.
  go(bal === 0n || bal == null || bal < YN / 2n ? 1 : Math.max(1, st.step));
}

// ---------- 2. Fund ----------
async function refreshBal() { if (!me) return; bal = await balanceOn(me); top(); const el = $('#bigbal'); if (el) el.innerHTML = balHtml(); }
const balHtml = () => `${bal === undefined ? '…' : bal == null ? '?' : fmtN(nearOf(bal))} <small>NEAR</small>`;
const need = () => {
  if (st.trial && !PUBLIC_MAINNET) return Number(st.deposit) + 0.05;
  if (boardLive()) return SIGN_MIN;
  return 0.05;
};
// Gas. open_charter and set_calls are separate receipts on the board, so each action
// needs the whole burn of its own receipt; an underfunded one fails with
// "Exceeded the prepaid gas" and the row never opens. Measured on the committed wasm in
// contracts/charter_board_sandbox/tests/setup_open_gas.rs:
//   open_charter, six receivers ......... 4.01 Tgas
//   set_calls, widest list the row holds . 5.09 Tgas
//   the two together, one transaction .... 8.53 Tgas
// Sandbox gas runs low against mainnet (mainnet burnt 3.36 Tgas on the receipt that
// the sandbox says needs 4.0), so this is 60 Tgas per action: far past the burn on
// both, well under the 300 Tgas ceiling for the whole transaction, and about 0.12 NEAR
// of prepaid gas that comes back unused.
// set_agent was 2.54 TGas on mainnet (DqMrsEJj…); propose needs BOARD_PROPOSE_TGAS (40)
// so the 20 Tgas on_paid callback fits, and 80 TGas would exceed the 0.05 key allowance.
const GAS = { open: 60n, agent: 60n, propose: BigInt(BOARD_PROPOSE_TGAS) };
const GAS_NEAR = t => Number(t) * 0.001;
// Both board actions are funded by the wallet up front, and the call allowlist deposit is
// attached on top of the row deposit. A little is left for the wallet's own overhead.
const ROW_NEAR = Number(BigInt(MAIN.board.max_row_yocto) / 10n ** 18n) / 1e6;
const CALLS_NEAR = Number(BigInt(CALLS_DEPOSIT_YOCTO) / 10n ** 18n) / 1e6;
const SIGN_MIN = Math.round((ROW_NEAR + GAS_NEAR(GAS.open) + GAS_NEAR(GAS.agent) + CALLS_NEAR + 0.002) * 1000) / 1000;
const yToN = y => { try { return Number(BigInt(y) / 10n ** 18n) / 1e6; } catch { return NaN; } };
// Wallet errors in plain words: yocto numbers become NEAR and a shortfall.
function plainErr(e) {
  const t = String(e?.message || e || '');
  if (/ERR_RECEIVERS/.test(t)) return plainRulesError(e, { rulesSaved: /set_rules was saved/.test(t) || !!e?.rulesSaved });
  if (/window closed|popup closed|user (closed|rejected|cancel)|cancel+ed by user|rejected/i.test(t)) return 'You closed the approval tab. Nothing was sent.';
  if (/not enough balance|NotEnoughBalance|LackBalanceForState|insufficient/i.test(t)) {
    const nums = (t.match(/\d{19,}/g) || []).map(yToN).filter(n => n > 0);
    const have = bal != null ? nearOf(bal) : (nums.length > 1 ? Math.min(...nums) : NaN);
    const cost = nums.length ? Math.max(...nums) : SIGN_MIN;
    const short = Math.max(0, cost - (isNaN(have) ? 0 : have));
    return `Not enough NEAR. This approval can cost up to ${fmtN(cost)} NEAR (deposit plus gas held back for a moment)${isNaN(have) ? '' : `, and the account has ${fmtN(have)} NEAR`}. Add ${fmtN(Math.max(short, 0.001))} NEAR on the Fund step, then try again.`;
  }
  return t.replace(/\d{19,}/g, d => fmtN(yToN(d)) + ' NEAR');
}
const holdsForCharter = () => st.trial && !PUBLIC_MAINNET;
function sFund() {
  let qr = ''; try { const q = qrcode(0, 'M'); q.addData(me); q.make(); qr = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch {}
  const enough = bal != null && nearOf(bal) >= need();
  const j = journey();
  const lead = (bal === 0n
      ? `With 0 NEAR you can still pick a character, write your rules and walk the town. To save your rules on chain and let your agent pay, add about <b>${fmtN(need())} NEAR</b>.`
      : `You can continue now. This page never moves your NEAR.`)
    + (boardLive() ? ` <span data-testid="fund-min">To open your charter later you need at least <b>${fmtN(SIGN_MIN)} NEAR</b>: ${fmtN(ROW_NEAR)} NEAR deposit that comes back when you close it, plus up to ${fmtN(GAS_NEAR(GAS.open))} NEAR of gas the wallet holds back for a moment (unused gas is returned).</span>` : '');
  return head('Fund', bal === 0n ? 'Your account is ready. It has 0 NEAR.' : 'Add real NEAR when you want to.', lead)
    + `<div class="addr"><figure class="qrfig"><div class="qr" role="img" aria-label="QR code: scan to send NEAR to this account">${qr}</div><figcaption>Scan to send NEAR to this account</figcaption></figure><div style="flex:1;min-width:200px">
       <label for="acct" class="small">Your NEAR account id</label><code id="acct" class="acct" data-testid="setup-address" tabindex="0">${esc(me)}</code>
       <div class="row" style="margin-top:10px"><button class="btn sm" id="copy" data-testid="setup-copy">Copy account id</button><a href="${explorer()}/address/${esc(me)}" target="_blank" rel="noopener">View on explorer ↗</a></div>
       <div style="margin-top:14px"><span class="live">live balance</span><div class="bal" id="bigbal" data-testid="setup-balance">${balHtml()}</div></div></div></div>
     <p class="small gasline">Gas is the tiny fee NEAR charges for each transaction, usually less than 0.001 NEAR.</p>
     <h2>Ways to add NEAR</h2><div class="tiles">
       <a class="tile" href="https://app.near-intents.org/" target="_blank" rel="noopener" data-testid="setup-intents"><i>⇄</i><b>Swap into NEAR</b><span>${esc(j.intentsNote)}</span></a>
       <button class="tile" id="copy2"><i>⎘</i><b>From an exchange</b><span>Withdraw NEAR on the NEAR network to the account id above. Tap to copy it.</span></button></div>
     ${errP()}` + nav(true, { nextOk: holdsForCharter() ? enough : true, label: holdsForCharter() && !enough ? `Waiting for ${fmtN(need())} NEAR` : 'Continue' });
}
function wireFund() {
  const cp = () => navigator.clipboard?.writeText(me).then(() => { const b = $('#copy'); if (b) { b.textContent = 'Copied ✓'; setTimeout(() => b && (b.textContent = 'Copy account id'), 1600); } });
  $('#copy').onclick = cp; $('#copy2').onclick = cp;
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
       <p class="small muted" id="nhint">Lowercase letters, digits and single dashes.</p></div>`
    : `<p class="small muted">This name stays in this browser and in the town. ${boardLive() ? 'Your charter is a row on the mainnet board, under the account you signed in with.' : 'A personal charter is a row on the mainnet board. That contract is not deployed yet, so this page will not create one.'}</p>`;
  return head('Character', 'Choose who walks the town.', 'The look, colour and name stay in this browser and appear in the town.')
    + `<div class="cast"><div class="picks" role="group" aria-label="Looks">${LOOKS.map(p => `<button class="pick" data-p="${p.id}" aria-pressed="${p.id === st.persona}" data-testid="persona-${p.id}"><img src="/setup/chars/${p.img}.webp" alt="${esc(p.name)}" width="160" height="160" loading="eager" decoding="sync" fetchpriority="high"><b>${esc(p.name)}</b><span>${esc(p.blurb)}</span></button>`).join('')}</div>
     <aside class="liveprev">${portraitHTML(persona(), dyeOf(), st.outfit, shown)}
       <p class="small muted">Colour</p><div class="swatches" role="group" aria-label="Colours">${DYES.map(d => `<button type="button" class="swatch" data-dye="${d.id}" aria-pressed="${d.id === st.dye}" title="${esc(d.name)}" style="--dye:${d.hex}" data-testid="dye-${d.id}"></button>`).join('')}</div>
       <p class="small muted">Outfit</p><div class="swatches" role="group" aria-label="Outfits">${OUTFITS.map(o => `<button type="button" class="fit" data-fit="${o.id}" aria-pressed="${o.id === st.outfit}" data-testid="outfit-${o.id}">${esc(o.name)}</button>`).join('')}</div>
       <div class="field"><label for="dn">Name in town</label><input id="dn" value="${esc(st.displayName)}" maxlength="24" autocomplete="off" data-testid="setup-display"></div>
       ${accountField}</aside></div>` + nav(true, { nextOk: (holdsForCharter() ? nameOk(st.agentName) : true) && displayOk(st.displayName) });
}
function wireCharacter() {
  const paint = () => { remember(); const ok = (holdsForCharter() ? nameOk(st.agentName) : true) && displayOk(st.displayName); const n = $('#next'); if (n) n.disabled = !ok; const h = $('#nhint'); if (h) { h.textContent = nameOk(st.agentName) ? 'Lowercase letters, digits and single dashes.' : 'Use 2–24 lowercase letters, digits or single dashes.'; h.className = 'small ' + (nameOk(st.agentName) ? 'muted' : 'err'); } };
  document.querySelectorAll('.pick').forEach(b => b.onclick = () => { const old = defName(), oldShow = persona().name; st.persona = b.dataset.p; const p = persona(); if (st.agentName === old || !st.agentName) st.agentName = defName(); if (!st.displayName || st.displayName === oldShow) st.displayName = p.name; st.cap = p.cap; st.daily = p.daily; st.per = p.per; save(); render(); });
  document.querySelectorAll('[data-dye]').forEach(b => b.onclick = () => { st.dye = b.dataset.dye; save(); render(); });
  document.querySelectorAll('[data-fit]').forEach(b => b.onclick = () => { st.outfit = b.dataset.fit; save(); render(); });
  $('#dn').oninput = e => { st.displayName = e.target.value.replace(/\s+/g, ' ').trimStart(); save(); paint(); const port = document.querySelector('.portrait b'); if (port) port.textContent = st.displayName || persona().name; };
  const an = $('#an'); if (an) an.oninput = e => { st.agentName = e.target.value.toLowerCase(); save(); paint(); };
  paint();
  wire(async () => { if (!displayOk(st.displayName)) { msg = 'Give your agent a name, 2–24 letters.'; return render(); }
    remember(); if (!holdsForCharter()) { done(st.step); go(st.step + 1); return; }
    const id = `${st.agentName}.${CFG.factory}`; const b = $('#next');
    await act(b, async () => { if (PREVIEW) return; const r = await fetch(API + (globalThis.NEARCARTA_NET?.apiPath || '/api') + '/vault/charter/' + encodeURIComponent(id)).then(r => r.json()).catch(() => ({}));
      if (r?.exists && r?.owner && r.owner !== me) throw new Error(`${id} is taken. Pick another name.`); done(st.step); go(st.step + 1); }); });
}

// ---------- 5. Rules ----------
// Shops a row can reach through propose_call_as. Toll, Guardhouse and House are the shops
// whose own contracts take a call; each one contributes only the method it answers on.
// charter.nearcarta.near is retired (mainnet.json `retired`), so a saved list that still
// names it is stale; Guardhouse was deployed after the old default was written.
const DEFAULT_SHOPS = [MAIN.toll?.contract, MAIN.guard?.contract, HOUSE_SHOP].filter(Boolean);
const RETIRED_ACCOUNTS = Object.keys(MAIN.retired || {});
// A list saved before the charter was retired still names `charter.nearcarta.near`. Filtering
// it on every read hides it but leaves the stale value in localStorage, so this repairs the
// saved list once at load and keeps the names it dropped for the note on the Rules step.
let retiredDropped = [];
function migrateSavedShops() {
  if (!Array.isArray(st.receivers) || !st.receivers.length) return;
  const { receivers, dropped } = migrateShops(st.receivers, RETIRED_ACCOUNTS);
  if (!dropped.length) return;
  retiredDropped = dropped;
  st.receivers = receivers.length ? receivers : null;
  save();
}
function rules() {
  const p = persona();
  const mainShops = DEFAULT_SHOPS;
  const fallback = st.trial ? (CFG?.arena?.merchants || []).slice(0, 2) : mainShops;
  // The field is the source of truth when this step is on screen. A list typed or pasted
  // without an `input` event used to be ignored and the row kept its old receivers.
  const field = typeof document !== 'undefined' ? document.getElementById('rcv') : null;
  const typed = field ? liveShops(String(field.value || '').split(/[\s,]+/), RETIRED_ACCOUNTS) : [];
  const saved = liveShops(st.receivers, RETIRED_ACCOUNTS);
  const useTyped = typed.length > 0;
  const useSaved = saved.length > 0;
  return { cap: st.cap ?? p.cap, daily: st.daily ?? p.daily, per: st.per ?? p.per, hours: SESSION_HOURS.includes(+st.hours) ? +st.hours : 1, receivers: useTyped ? typed : (useSaved ? saved : fallback) };
}
function preview(r) {
  const until = sessionLabel(r.hours);
  return `<b>${esc(persona().name)}</b> may pay only <b>${r.receivers.map(esc).join('</b> or <b>') || 'nobody yet'}</b>, at most <b>${fmtN(+r.cap)} NEAR</b> per payment, <b>${fmtN(+r.daily)} NEAR</b> and <b>${r.per}</b> payments per day, for <b>${until}</b>. Anything else is refused by ${boardLive() && !st.trial ? `your charter on <b>${esc(MAIN.board.contract)}</b>` : 'the contract'}, even if the agent is tricked.`;
}
function sRules() {
  const r = rules();
  return head('Rules', 'Write the rules it cannot break.', (boardLive()
      ? 'These become your row on the mainnet board. Closing the row sends its storage and whatever is left unspent back to you.'
      : 'These stay in this browser with your character. The mainnet board is not deployed yet, so this page does not write them into a contract.')
    + rulesLiveHint(boardLive() && !st.trial && rowLive())
    + `<div class="grid2"><div class="field"><label for="cap">Max per payment</label><div class="suffix"><input id="cap" type="number" step="0.001" min="0.001" value="${r.cap}" data-testid="rule-cap"><span>NEAR</span></div><p class="small muted">The most one payment can be. Bigger ones are refused.</p></div>
       <div class="field"><label for="daily">Daily budget</label><div class="suffix"><input id="daily" type="number" step="0.001" min="0.001" value="${r.daily}" data-testid="rule-daily"><span>NEAR</span></div><p class="small muted">All payments in one day added up.</p></div>
       <div class="field"><label for="per">Payments per day</label><div class="suffix"><input id="per" type="number" min="1" max="100" value="${r.per}" data-testid="rule-per"><span>per day</span></div><p class="small muted">How many payments the agent may make each day.</p></div>
       <div class="field"><label for="hours">Session</label><select id="hours" data-testid="rule-hours">${SESSION_HOURS.map(h => `<option value="${h}" ${h == r.hours ? 'selected' : ''}>${sessionLabel(h)}</option>`).join('')}</select><p class="small muted">After this the contract refuses every payment. You can write a new session later.</p></div></div>
     <div class="field"><label for="rcv">Allowed shops (account ids, comma separated)</label><input id="rcv" value="${esc(r.receivers.join(', '))}" spellcheck="false" data-testid="rule-receivers"><p class="small muted">The only accounts your agent may pay. A Try payment goes to the first listed shop. Ferry Ask charter calls stamp on the board and returns that NEAR to your row; it still uses one payment of your cap. The session key also carries the call allowlist, which adds wrap.near's deposit and transfer calls and the house shop's check-in and prepare calls. Those are calls, not payees: to move NEAR through wrap.near yourself, add <code>wrap.near</code> to this list.</p></div>
     ${retiredDropped.length
      ? `<p class="small" data-testid="rule-retired-note">Your saved list named ${esc(retiredDropped.join(', '))}, which no longer exists on mainnet, so ${retiredDropped.length > 1 ? 'they were' : 'it was'} removed. Toll, Guardhouse and House are live.</p>`
      : ''}
     <div class="preview" id="prev" data-testid="rule-preview">${preview(r)}</div>${errP()}` + nav(true));
}
function wireRules() {
  const upd = () => { st.cap = +$('#cap').value; st.daily = +$('#daily').value; st.per = +$('#per').value; st.hours = +$('#hours').value; st.receivers = liveShops($('#rcv').value.split(/[\s,]+/), RETIRED_ACCOUNTS); save(); $('#prev').innerHTML = preview(rules()); };
  ['cap', 'daily', 'per', 'rcv'].forEach(id => {
    const el = $('#' + id);
    if (!el) return;
    // `input` alone misses a programmatic set, an autofill, and any paste a browser delivers
    // without key events. A shop list typed that way was silently ignored: the row kept the
    // old receivers. `change` fires when the field is committed, so listen for both.
    el.oninput = upd;
    el.onchange = upd;
    el.onblur = upd;
  });
  const hours = $('#hours');
  const onHours = e => { if (+e.target.value !== +st.hours) st.hoursEdited = true; upd(); };
  if (hours) { hours.oninput = onHours; hours.onchange = onHours; }
  wire(() => { const r = rules();
    if (!(r.cap > 0) || !(r.daily >= r.cap)) { msg = 'The daily budget must be at least the per-payment cap.'; return render(); }
    if (!r.receivers.length || r.receivers.some(a => !/^[a-z0-9._-]{2,64}$/.test(a))) { msg = 'Add at least one valid account id.'; return render(); }
    // The row on chain reports how much of its 0.02 NEAR is already spent on storage. When
    // there is no room left, ANY rule change panics ERR_ROW_TOO_BIG after the wallet has
    // already approved it. Refuse here, with the real number, instead of modelling a fresh row.
    if (boardLive() && !st.trial && chainRow) {
      const room = rowHeadroomBytes(chainRow);
      // A full row still accepts a change that does not add a receiver: the contract only
      // charges when the encoded row grows. Blocking a cap-only edit would be wrong.
      const known = new Set((chainRow.receivers || []).map(a => String(a)));
      const adds = r.receivers.some(a => !known.has(String(a)));
      if (room === 0 && adds) {
        // A full row can often still take a new shop: `set_calls` is rewritten before
        // `set_rules`, and that rewrite can free far more than a receiver costs. Measured on
        // the live row: held list 468 bytes, the list for the new shops 281, so shrinking
        // frees 187 while a receiver costs about 70. Only refuse when the arithmetic says the
        // new list still would not fit, instead of refusing every add on a full row.
        const before = callsFor(chainRow.receivers ? { ...r, receivers: chainRow.receivers } : r, MAIN.board.contract);
        const after = callsFor(r, MAIN.board.contract);
        const used = calls => calls.reduce((n, c) => n + String(c.receiver).length + String(c.method).length + 24, 0);
        const freed = Math.max(0, used(before) - used(after));
        const need = r.receivers.reduce((n, a) => n + (!known.has(String(a)) ? 22 + String(a).length : 0), 0);
        if (freed < need + 24) {
          msg = `This row is full: its ${fmtN(ROW_NEAR)} NEAR of storage is all used and this shop list would not fit even after the call list is rewritten. Close the row in Your House and open a new one to change the shop list. Changing a cap or the expiry still works.`;
          return render();
        }
      }
    }
    if (boardLive() && !st.trial && !callsFitRow(callsFor(r, MAIN.board.contract), r.receivers.length)) {
      const keep = fittingShops(r.receivers, list => callsFor({ ...r, receivers: list }, MAIN.board.contract));
      msg = keep.length
        ? `That shop list is too long for one row. A row holds ${fmtN(ROW_NEAR)} NEAR of storage, and it can hold ${keep.length} of your ${r.receivers.length} shops. Keep ${keep.join(', ')} and drop the rest.`
        : `A row holds ${fmtN(ROW_NEAR)} NEAR of storage and this list does not fit even one shop. Use a shorter account id.`;
      return render();
    }
    done(st.step); go(st.step + 1); });
}

// ---------- 6. Sign ----------
let signLog = [];
let chainRow = null, chainLoadedFor = '', chainError = '', chainRead = false, readError = false;
// True when this browser holds the agent key for the account's row. It does not mean
// the row exists: a closed row leaves the key behind, and board v2 returns `null` from
// `get_charter` once it is gone. `rowOnChain` is the check that matters.
const rowLive = () => !!(st.charter && localStorage.getItem(agentLS(st.charter)));
/** True only when the chain actually answered with a row. */
const rowOnChain = () => !!chainRow;
function agentMismatch(row) {
  if (!row?.agent || !me) return false;
  const sec = localStorage.getItem(agentLS(me));
  if (!sec) return false;
  try { return pubkeyHex(keyFrom(sec)) !== row.agent; } catch { return false; }
}
function limitLine(row) {
  const shops = (row.receivers || []).join(', ');
  return `On chain now: ${fmtN(nearOf(row.per_action_cap))} NEAR per payment, ${fmtN(nearOf(row.daily_budget))} NEAR a day, ${row.max_actions_per_day} payments, ${shops}`;
}
function signItems(onBoard, live, changed) {
  if (!onBoard) return [['Create your charter', 'create'], ['Write the rule and add the agent key', 'rules']];
  const updating = !!(live && (changed || signLog.some(x => x.k === 'rules' || x.k === 'calls' || x.k === 'agent')));
  if (!updating) return [['Open your row', 'create'], ['Let your agent sign by itself', 'key']];
  const items = [];
  if (signLog.some(x => x.k === 'agent') || agentMismatch(chainRow)) items.push(['Set the agent key', 'agent']);
  items.push(['Write your rules', 'rules'], ['Write the shop allowlist', 'calls']);
  const wrote = signLog.find(x => x.k === 'rules');
  if (wrote?.state === 'ok' && chainRow && !changed) items.push([limitLine(chainRow), 'now']);
  return items;
}
function sSign() {
  if (!st.trial && !boardLive()) {
    // The town charter (charter.nearcarta.near) was retired and its NEAR returned to
    // nearcarta.near, so this page no longer names it or links its old txs. What is
    // left is the honest state: the board holds the row, and this page will not
    // pretend to create one.
    return head('Sign', 'Your account is on mainnet.', 'A personal charter is a row on the mainnet board. That contract is not reachable right now, so this page will not send a transaction that pretends to create one. Toll, arena, house and town hall already run on mainnet.')
      + `<div class="agent">${portraitHTML(persona(), dyeOf(), st.outfit, st.displayName || persona().name)}<div><b>${esc(st.displayName || persona().name)}</b><br><span class="small muted">Saved in this browser</span></div></div>`
      + errP() + nav(true, { label: 'Continue' });
  }
  const onBoard = boardLive() && !st.trial;
  const r = rules(), id = st.charter || (onBoard ? me : `${st.agentName}.${CFG.factory}`), live = rowLive();
  // A row is open only when the chain returns one. A browser that still holds an agent
  // key from a row that was closed (or force_closed) must get the open-row primary
  // action, not the update panel for a row that is not there.
  const onChain = live && rowOnChain();
  const local = { ...r, expiresAt: onChain ? expiresToWrite({ hoursEdited: !!st.hoursEdited, hours: r.hours, chainExpiresAt: chainRow.expires_at }) : undefined };
  let update = signRulesUpdate({ live: !!(onChain && onBoard), local, row: onChain && onBoard ? chainRow : null });
  const callsFailed = signLog.some(x => x.k === 'calls' && x.state === 'bad');
  if (!update.changed && callsFailed && onChain && onBoard) update = { changed: true, html: callsFailedPanel() };
  const stake = onBoard ? '0.02' : fmtN(st.deposit);
  const L = signItems(onBoard, onChain, update.changed);
  const help = `<div id="signhelp" class="tabhelp" hidden data-testid="sign-tabhelp"><p class="small">The approval opened in another browser tab. Switch to it and approve. This page moves on by itself.</p><button type="button" class="btn" id="resign" data-testid="sign-reopen">Switch to approval tab</button></div>`;
  // `closedRow` is the case that used to read as a broken page: this browser still holds
  // an agent key, but the board has no row (it was closed, force_closed, or never made).
  const closedRow = onBoard && !onChain && chainRead && !readError;
  const noAccount = !me;
  const rowMissing = onBoard && !onChain;
  // Without an account there is nothing to read, so show the open-row copy rather than
  // waiting on a read that cannot start.
  const lede = closedRow || (rowMissing && noAccount)
    ? `There is no row on <code>${esc(MAIN.board.contract)}</code> for <code>${esc(me || 'your account')}</code> yet. Open your row to write these rules and let your agent pay inside them. At most ${stake} NEAR is attached; the contract keeps the row's storage and a small spendable balance and sends the rest back.`
    : rowMissing && !chainRead
      ? 'Checking your row on the board.'
      : onChain
        ? (update.changed
          ? 'Your saved rules differ from the chain. Update my rules writes them in one approval. The numbers below are what the chain has now.'
          : 'These limits are read back from the chain, not from this page.')
        : (onBoard ? `This opens your row, writes the shop allowlist, and adds your agent key, limited to <code>propose</code>, <code>propose_call</code>, <code>propose_call_as</code> and <code>anchor</code> on the board. Later tries need no wallet. At most ${stake} NEAR is attached. The contract keeps the row's storage and a small spendable balance, and sends the rest back. Closing the row returns both.` : `First the charter is made (${stake} NEAR goes into it, and comes back if the charter is deleted). Then one transaction writes your rule and adds a limited agent key that can only ask the charter to pay.`);
  // The facts panel always says what the board answered. A missing row is a state, not an error.
  // Without an account there is nothing to read, so the panel must not sit on "Reading…".
  const factsHtml = onChain
    ? boardFacts(chainRow)
    : noAccount
      ? '<div class="fact"><small>Row</small><b>Sign in first. The board is read for your account.</b></div>'
      : !chainRead
        ? '<div class="fact"><small>Row</small><b>Reading the board…</b></div>'
        : readError
          ? `<div class="fact"><small>Read</small><b>${esc(chainError)}</b></div><div class="fact"><small>Your row</small><b><button type="button" class="btn link sm" id="read-again" data-testid="setup-read-again">Read the chain again</button></b></div>`
        : `<div class="fact" data-testid="setup-no-row"><small>Row</small><b>No row open on ${esc(MAIN.board.contract)}</b></div>
           <div class="fact" data-testid="setup-key-scope"><small>Agent key will allow</small><b>${SESSION_METHODS.map(m => `<code>${esc(m)}</code>`).join(', ')}</b></div>
           <div class="fact"><small>Next</small><b>Open your row</b></div>`;
  const heading = closedRow || (rowMissing && !chainRead) ? 'Open your row.' : onChain ? (keyStale ? 'Renew your agent key.' : 'Your agent is live.') : (onBoard ? 'One approval in your wallet.' : 'Two approvals in your wallet.');
  // The open button needs the board's answer, unless there is no account to read for.
  const rowReady = noAccount || (chainRead && !readError);
  // The rules that will be written, shown as numbers before the wallet opens. The
  // transaction summary in /sign lists the calls and deposits but not the caps, and a
  // visitor cannot check what they are approving without them.
  const capsHtml = (onChain || rowMissing)
    ? `<div class="preview" data-testid="setup-caps" aria-label="The rules this approval writes">
        <p><b>These rules go on chain with this approval</b></p>
        <ul>
          <li>Each payment at most <b data-testid="cap-per">${fmtN(r.cap)} NEAR</b></li>
          <li>One day in total at most <b data-testid="cap-daily">${fmtN(r.daily)} NEAR</b></li>
          <li>At most <b data-testid="cap-count">${esc(String(r.per))}</b> payments a day</li>
          <li>Only to <b data-testid="cap-receivers">${r.receivers.map(esc).join(', ') || 'nobody yet'}</b></li>
          <li>The session ends <b data-testid="cap-session">${esc(sessionLabel(r.hours))}</b> after it is signed</li>
          <li>Your agent key may call <b data-testid="cap-key-scope">${SESSION_METHODS.map(esc).join(', ')}</b> on the board</li>
          <li data-testid="cap-holds">A held WARN waits for you. Your agent can ask for one but cannot confirm it: only your confirm key signs that, and it is not the agent key. Cancel and expire stay in your wallet.</li>
        </ul>
        <p class="small muted">The contract refuses anything else, even if the agent is tricked.</p>
      </div>`
    : '';
  return head('Sign', heading, lede)
    + `<div class="agent">${portraitHTML(persona(), dyeOf(), st.outfit, st.displayName || persona().name)}<div><b>${esc(st.displayName || persona().name)}</b><br><code class="small">${esc(id)}</code></div></div>`
    + (onChain || rowMissing ? `<div class="facts" id="facts" data-testid="setup-facts">${factsHtml}</div>` : `<div class="preview">${preview(r)}</div>`)
    + '<ul class="steps">' + L.map(([t, k]) => { const s = signLog.find(x => x.k === k); return `<li class="${s?.state || ''}" data-testid="setup-sign-${esc(k)}">${esc(t)}${s?.tx ? txA(s.tx) : ''}</li>`; }).join('') + '</ul>'
    + capsHtml
    + update.html
    + (update.changed ? help : '')
    // Ready when the board answered. Without an account there is nothing to read, so the
    // button stays enabled and the click asks for sign-in instead of waiting forever.
    + (rowMissing ? (onBoard && bal != null && nearOf(bal) < SIGN_MIN
      ? `<p class="small" data-testid="sign-short">This approval can cost up to <b>${fmtN(SIGN_MIN)} NEAR</b>. The account has ${fmtN(nearOf(bal))} NEAR. <a href="#fund" id="tofund">Add ${fmtN(Math.max(0.001, SIGN_MIN - nearOf(bal)))} NEAR first</a>.</p><button class="btn gold big" id="sign" data-testid="setup-sign" disabled>Add ${fmtN(Math.max(0.001, SIGN_MIN - nearOf(bal)))} NEAR first</button>`
      : `${onBoard ? `<p class="small muted" data-testid="sign-cost">Needs ${fmtN(SIGN_MIN)} NEAR in your account (${fmtN(ROW_NEAR)} for the row, ${fmtN(CALLS_NEAR)} for the shop allowlist, plus gas). Of the ${fmtN(ROW_NEAR)}, 0.01 becomes your row's spending balance and about 0.004 pays row storage; the rest is refunded at once. Unused allowlist deposit is refunded the same way. Storage and any unspent balance come back when you close the row; unused gas comes back at once.</p>` : ''}<button class="btn gold big" id="sign" data-testid="setup-sign" ${rowReady ? '' : 'disabled'}>${rowReady ? 'Open your row' : 'Reading the board'}</button>${help}`)
      : '')
    + (onChain && keyReady && !keyStale ? gasPanel() : '')
    + (onChain && keyStale ? `<div class="tabhelp" data-testid="setup-renew-key"><p class="small">This agent key is missing one of <code>propose</code>, <code>propose_call</code>, <code>propose_call_as</code> and <code>anchor</code>. Ferry Load cargo needs <code>propose_call</code>; Toll and Guard call shops through <code>propose_call_as</code>; the Chronicle anchors a statement with <code>anchor</code>. One wallet approval deletes the old board keys and adds a new one with all four (0.25 NEAR gas allowance). It cannot move your NEAR.</p><p class="small" data-testid="setup-renew-status" role="status"${renewStatus ? '' : ' hidden'}>${esc(renewStatus)}</p><button type="button" class="btn gold" id="renew-key" data-testid="setup-renew-key-btn">Renew agent key</button></div>` : '')
    + errP() + nav(onChain && !keyStale, { label: 'Try your agent' });
}
async function charterState(id) { return fetch(API + (globalThis.NEARCARTA_NET?.apiPath || '/api') + '/vault/charter/' + encodeURIComponent(id) + '?fresh=1').then(r => r.json()).catch(() => ({})); }
async function accountOn(id, network) {
  if (network !== 'mainnet') return (await charterState(id)).exists;
  const r = await fetch(MAIN.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: id } }) });
  const j = await r.json();
  return !j.error && !!j.result;
}
function ruleArgs(r, expiresAt = sessionExpiresAt(r.hours)) {
  return { receivers: r.receivers, per_action_cap: toY(r.cap), daily_budget: toY(r.daily), max_actions_per_day: r.per, window_start_min: 0, window_end_min: 0, min_amount: toY(0.0001), expires_at: String(expiresAt) };
}
function boardArgs(r, agent) {
  return { rules: ruleArgs(r), agent, fund: ROW_FUND.toString() };
}
// The call list this row will carry. `callsFitRow` checks it against the row's storage.
// One builder for both the fit check and the transaction, so they cannot disagree.
// The wrap.near trio plus the board stamp (the stamp returns Ask-charter NEAR to the row),
// the House pair (propose_call_as reaches the House shop), and the USDC storage_deposit
// (a Payouts row registers a zero-NEAR issuer inside the visitor's own cap).
// payoutsCalls in shared/board/session.js adds the USDC storage_deposit pair when the row has room,
// and `dropOptionalPairs` there trims the optional pairs before a shop is ever dropped.
// The optional pairs are never a shop's own call, so trimming them never removes a shop.
// House's two session calls are added only when House is in the visitor's own list: adding
// them otherwise charges the row for a shop it cannot reach, and that false weight made a
// legitimate four-shop row look too big (toll+guard+arena+hall: 433 bytes against 414).
function housePairsIfNamed(receivers) {
  const named = new Set((receivers || []).map(a => String(a).toLowerCase()));
  return HOUSE_CALLS.every(c => named.has(String(c.receiver).toLowerCase())) ? HOUSE_CALLS : [];
}
function callsFor(r, contract) {
  const extra = [
    ...FERRY_CALL_TARGETS,
    { receiver: contract, method: 'stamp', cap: String(toY(r.cap)) },
    ...housePairsIfNamed(r.receivers),
  ];
  const full = callPolicy(r.receivers, toY(r.cap), toY(r.daily), 'ft_transfer', payoutsCalls(extra, toY(r.cap)).calls).calls;
  return dropOptionalPairs(full, (r.receivers || []).length).calls;
}

/**
 * The Base effect budgets this row starts with, so a ferry crossing is possible from the first
 * visit. Without one the board refuses `propose_call_as` with ERR_EFFECT before the toll is
 * ever called, and the visitor cannot pass however much NEAR the row holds.
 *
 * Both caps are written at the row's own per-payment cap, so the effect ceiling can never be
 * looser than what the rules already allow. `set_effects` rides in the same approval as
 * `set_calls` (see `openRowTransactions`), paid from the 600-byte side reserve.
 */
function effectsFor(r) {
  const base = 'base';
  const to = String(r.baseTo || '').trim().toLowerCase();
  // One recipient, two assets: native ETH and USDC. A visitor who names a Base address gets
  // both so either asset works; without one, only USDC, which needs no value in the unit a
  // native transfer would.
  const cap = { native: toY(r.cap), usdc: toY(r.cap) };
  const rows = [];
  if (to) rows.push({ chain: base, asset: 'native', to, value: cap.native, fee: cap.native });
  if (to) rows.push({ chain: base, asset: 'usdc', to, value: cap.usdc, fee: cap.usdc });
  return rows;
}
// The agent key is also added to the visitor's own account as a function-call access key.
// It may call propose, propose_call, propose_call_as and anchor on the board, with a gas allowance
// only. It cannot attach NEAR.
// https://docs.near.org/protocol/accounts-contracts/access-keys
// GAS_ALLOWANCE_YOCTO (0.05 NEAR) cannot prepay two Ferry propose_call steps.
// New keys use 0.25 NEAR of gas. The allowance is never spendable as NEAR.
const AGENT_ALLOW = BigInt(GAS_TOPUP_YOCTO);
// open_charter keeps ROW_FUND as the row's own spendable balance (enough for a full day at the default 0.01 budget);
// the rest of the 0.02 deposit after storage (~0.004) is refunded in the same call.
const ROW_FUND = YN / 100n, TOPUP = YN / 200n;
// A row holds 0.02 NEAR of storage, and v2 bills the real trie bytes. The row and its call
// list share that budget, so the list's room shrinks as the rules name more receivers:
// `callsFitRow(calls, receivers)` uses 2000 - 1380 - 22 x receivers.
// The measured numbers are in `contracts/charter_board_sandbox/tests/setup_calls_row_size.rs`
// and `setup_calls_deposit.rs`.
const addKeyAction = pk => ({ type: 'AddKey', params: { publicKey: pk, accessKey: { permission: { receiverId: MAIN.board.contract, methodNames: [...SESSION_METHODS], allowance: AGENT_ALLOW.toString() } } } });

// A held WARN is released only by a key that is NOT the agent key: the contract stores a
// separate confirm key and `confirm_hold` checks that. Without one a hold could never be
// released from the UI, which made Guard one-way. It lives beside the agent key.
const CONFIRM_LS = c => 'nearcarta.vault.confirm.' + c;
const confirmKeyFor = id => {
  const saved = localStorage.getItem(CONFIRM_LS(id));
  if (saved) return keyFrom(saved);
  const k = keyFrom();
  localStorage.setItem(CONFIRM_LS(id), k.secretKey);
  return k;
};
const setConfirmAction = key => ({
  type: 'FunctionCall',
  params: { methodName: 'set_confirm_key', args: { key: pubkeyHex(key) }, gas: '30000000000000', deposit: '0' },
});
// The login plugin stores its key here. Use it as the row agent when this browser has not made one yet.
function adoptPluginKey(id) {
  if (!id || localStorage.getItem(agentLS(id))) return;
  let parsed;
  try { parsed = JSON.parse(localStorage.getItem(pluginKeyName(id)) || ''); } catch { return; }
  if (parsed?.privateKey?.startsWith('ed25519:')) localStorage.setItem(agentLS(id), parsed.privateKey);
}
async function agentAccessKey(sec) {
  if (!sec || !me) return null;
  const ak = await rpcClient([MAIN.rpc])('query', { request_type: 'view_access_key', finality: 'optimistic', account_id: me, public_key: keyFrom(sec).publicKey }).catch(() => null);
  const fc = ak?.permission?.FunctionCall;
  if (!fc || fc.receiver_id !== MAIN.board.contract) return null;
  // Empty method_names means any method. Keys that omit propose_call are stale for Ferry.
  return agentMethodsReady(fc.method_names) ? ak : null;
}
async function listBoardAgentKeys() {
  if (!me) return classifyBoardAgentKeys([], MAIN.board.contract);
  const res = await rpcClient([MAIN.rpc])('query', { request_type: 'view_access_key_list', finality: 'optimistic', account_id: me }).catch(() => null);
  return classifyBoardAgentKeys(res?.keys || [], MAIN.board.contract);
}
/** Stale board keys (missing any SESSION_METHODS entry): one approval replaces them with a key for all three. */
function paintRenewStatus(text) {
  renewStatus = text || '';
  const el = $('[data-testid=setup-renew-status]');
  if (!el) return;
  el.hidden = !renewStatus;
  el.textContent = renewStatus;
}
/** Optional deps.wallet / deps.signAll let tests stub the Privy/NEAR Connect signer without a mainnet tx. */
async function renewAgentKey(deps = {}) {
  const contract = MAIN.board.contract;
  const mark = (k, state, tx) => { const s = signLog.find(x => x.k === k); if (s) Object.assign(s, { state, tx: tx || s.tx }); else signLog.push({ k, state, tx }); };
  paintRenewStatus('Checking your agent key on chain…');
  const classified = await listBoardAgentKeys();
  if (classified.ready.length) {
    // A ready key is already on chain; keep using the matching secret when we have it.
    const sec = localStorage.getItem(agentLS(me));
    if (sec && await agentAccessKey(sec)) {
      keyReady = true; keyStale = false;
      paintRenewStatus('This browser already has a key that can call propose, propose_call, propose_call_as and anchor.');
      return { ok: true, renewed: false };
    }
  }
  const fresh = keyFrom();
  const pk = fresh.publicKey;
  const stalePks = classified.board.map(k => k.publicKey);
  const keyActions = renewAgentKeyActions({
    stalePublicKeys: stalePks,
    newPublicKey: pk,
    boardContract: contract,
    methodNames: SESSION_METHODS,
    allowance: AGENT_ALLOW.toString(),
  });
  const txs = [];
  const row = await viewFn(rpcClient([MAIN.rpc]), contract, 'get_charter', { owner: me }).catch(() => null);
  if (row && String(row.agent || '') !== pubkeyHex(fresh)) {
    txs.push(['agent', { receiverId: contract, actions: [{ type: 'FunctionCall', params: { methodName: 'set_agent', args: { agent: pk }, gas: (GAS.agent * TG).toString(), deposit: '1' } }] }]);
  }
  txs.push(['key', { receiverId: me, actions: keyActions }]);
  for (const [k] of txs) mark(k, 'run');
  paintRenewStatus('Approve the renewal in your wallet…');
  let res;
  try {
    const w = deps.wallet ? await deps.wallet() : await mainnetWallet().wallet();
    if (deps.signAll) res = await deps.signAll(txs.map(t => t[1]), w);
    else if (w.signAndSendTransactions) res = await w.signAndSendTransactions({ transactions: txs.map(t => t[1]) });
    else { res = []; for (const t of txs) res.push(await w.signAndSendTransaction(t[1])); }
  } catch (e) {
    console.error('[setup] renewAgentKey signer', e);
    paintRenewStatus(plainErr(e));
    throw e;
  }
  txs.forEach(([k], i) => mark(k, 'run', txHashOf(res?.[i])));
  localStorage.setItem(agentLS(me), fresh.secretKey);
  syncPluginAgent(me, fresh.secretKey);
  st.charter = me; save();
  // A stubbed wallet (tests / headless) never lands the key on chain — stop after the signer call.
  if (deps.wallet || deps.signAll) {
    mark('key', 'ok');
    if (txs.some(([k]) => k === 'agent')) mark('agent', 'ok');
    keyReady = true; keyStale = false;
    paintRenewStatus('Agent key renewed (signer stub). No mainnet tx was sent.');
    return { ok: true, renewed: true, stub: true, txs: txs.map(t => t[0]), signed: txs.map(t => t[1]) };
  }
  paintRenewStatus('Confirming the new key on chain…');
  let ak = null;
  for (let i = 0; i < 12 && !(ak = await agentAccessKey(fresh.secretKey)); i++) await wait(1200);
  mark('key', ak ? 'ok' : 'run');
  if (txs.some(([k]) => k === 'agent')) mark('agent', ak ? 'ok' : 'run');
  keyReady = !!ak;
  keyStale = !ak;
  await refreshBal();
  if (!ak) {
    paintRenewStatus('The renewed agent key is not on the account yet. Wait a few seconds and press Renew again.');
    throw new Error('The renewed agent key is not on the account yet. Wait a few seconds and press Renew again.');
  }
  paintRenewStatus('Agent key renewed. Ferry can call propose_call.');
  return { ok: true, renewed: true, txs: txs.map(t => t[0]) };
}
/** Same Privy / mainnetWallet path as Update my rules. Returns true when the button was bound. */
function bindRenewKey(wrap = job => job) {
  const rk = $('#renew-key');
  if (!rk) return false;
  rk.onclick = e => act(e.currentTarget, wrap(async () => {
    try { await renewAgentKey(); }
    catch (err) { console.error('[setup] renewAgentKey', err); throw err; }
  }));
  return true;
}
if (typeof globalThis !== 'undefined') globalThis.__ncRenewAgentKey = renewAgentKey;
function paintRefreshStatus(text) {
  refreshStatus = text || '';
  const el = $('[data-testid=setup-refresh-status]');
  if (!el) return;
  el.hidden = !refreshStatus;
  el.textContent = refreshStatus;
}
function gasPanel() {
  const left = gasLeft ? `${fmtN(nearOf(gasLeft))} NEAR` : '—';
  return `<div class="tabhelp" data-testid="setup-refresh-key"><p class="small">Session gas left: <b data-testid="setup-gas-left">${esc(left)}</b>. Each Ferry step buys its gas up front (about 0.043 NEAR). Refresh adds a new key with 0.25 NEAR of gas and deletes the old board key. One wallet approval. It does not change your rules or the NEAR in the row.</p><p class="small" data-testid="setup-refresh-status" role="status"${refreshStatus ? '' : ' hidden'}>${esc(refreshStatus)}</p><button type="button" class="btn gold" id="refresh-key" data-testid="setup-refresh-key-btn">Refresh agent key</button></div>`;
}
/** One wallet approval replaces the board function-call key. Does not call set_rules or fund. */
async function refreshAgentKey(deps = {}) {
  const contract = MAIN.board.contract;
  const mark = (k, state, tx) => { const s = signLog.find(x => x.k === k); if (s) Object.assign(s, { state, tx: tx || s.tx }); else signLog.push({ k, state, tx }); };
  paintRefreshStatus('Checking the session gas on chain…');
  const classified = await listBoardAgentKeys();
  const fresh = keyFrom();
  const pk = fresh.publicKey;
  const keyActions = renewAgentKeyActions({
    stalePublicKeys: classified.board.map(k => k.publicKey),
    newPublicKey: pk,
    boardContract: contract,
    methodNames: SESSION_METHODS,
    allowance: GAS_TOPUP_YOCTO,
  });
  const txs = [];
  const row = await viewFn(rpcClient([MAIN.rpc]), contract, 'get_charter', { owner: me }).catch(() => null);
  const agentHex = pubkeyHex(fresh);
  if (row && String(row.agent || '') !== agentHex) {
    txs.push(['agent', { receiverId: contract, actions: [{ type: 'FunctionCall', params: { methodName: 'set_agent', args: { agent: agentHex }, gas: (GAS.agent * TG).toString(), deposit: '1' } }] }]);
  }
  txs.push(['key', { receiverId: me, actions: keyActions }]);
  for (const [k] of txs) mark(k, 'run');
  paintRefreshStatus('Approve the new agent key in your wallet…');
  let res;
  try {
    const w = deps.wallet ? await deps.wallet() : await mainnetWallet().wallet();
    if (deps.signAll) res = await deps.signAll(txs.map(t => t[1]), w);
    else if (w.signAndSendTransactions) res = await w.signAndSendTransactions({ transactions: txs.map(t => t[1]) });
    else { res = []; for (const t of txs) res.push(await w.signAndSendTransaction(t[1])); }
  } catch (e) {
    console.error('[setup] refreshAgentKey signer', e);
    paintRefreshStatus(plainErr(e));
    throw e;
  }
  txs.forEach(([k], i) => mark(k, 'run', txHashOf(res?.[i])));
  // Save before the read-back. Ferry Load cargo signs whatever is in this slot.
  localStorage.setItem(agentLS(me), fresh.secretKey);
  syncPluginAgent(me, fresh.secretKey);
  st.charter = me; save();
  if (deps.wallet || deps.signAll) {
    mark('key', 'ok');
    if (txs.some(([k]) => k === 'agent')) mark('agent', 'ok');
    keyReady = true; keyStale = false;
    gasLeft = GAS_TOPUP_YOCTO;
    if (row) chainRow = { ...row, agent: agentHex };
    chainLoadedFor = me;
    paintRefreshStatus('Agent key refreshed (signer stub). 0.25 NEAR of gas. Rules and the row balance were not changed. No mainnet tx was sent.');
    return { ok: true, renewed: true, stub: true, txs: txs.map(t => t[0]), signed: txs.map(t => t[1]) };
  }
  paintRefreshStatus('Confirming the new key on chain…');
  let ak = null;
  let rowNow = null;
  for (let i = 0; i < 12; i++) {
    if (!ak) ak = await agentAccessKey(fresh.secretKey);
    rowNow = await viewFn(rpcClient([MAIN.rpc]), contract, 'get_charter', { owner: me }).catch(() => null);
    if (ak && rowNow && String(rowNow.agent || '') === agentHex) break;
    await wait(1200);
  }
  // Write it again after the chain read, so a late paint cannot keep the previous secret.
  localStorage.setItem(agentLS(me), fresh.secretKey);
  syncPluginAgent(me, fresh.secretKey);
  mark('key', ak ? 'ok' : 'run');
  if (txs.some(([k]) => k === 'agent')) mark('agent', ak ? 'ok' : 'run');
  keyReady = !!ak;
  keyStale = !ak;
  gasLeft = ak?.permission?.FunctionCall?.allowance || GAS_TOPUP_YOCTO;
  if (rowNow) { chainRow = rowNow; chainLoadedFor = me; }
  await refreshBal();
  if (!ak || !rowNow || String(rowNow.agent || '') !== agentHex) {
    paintRefreshStatus('The new key is saved in this browser. The row has not caught up yet. Wait a few seconds and press Refresh again.');
    throw new Error('The row still names the previous agent key.');
  }
  paintRefreshStatus('Agent key refreshed. 0.25 NEAR of gas. Rules and the row balance were not changed.');
  return { ok: true, renewed: true, txs: txs.map(t => t[0]) };
}
function bindRefreshKey(wrap = job => job) {
  const rk = $('#refresh-key');
  if (!rk) return false;
  rk.onclick = e => act(e.currentTarget, wrap(async () => {
    try { await refreshAgentKey(); }
    catch (err) { console.error('[setup] refreshAgentKey', err); throw err; }
  }));
  return true;
}
if (typeof globalThis !== 'undefined') globalThis.__ncRefreshAgentKey = refreshAgentKey;
async function refreshKeyReady() {
  const sec = localStorage.getItem(agentLS(me));
  const ak = await agentAccessKey(sec);
  if (ak) {
    keyReady = true; keyStale = false;
    gasLeft = ak.permission?.FunctionCall?.allowance || '';
    return true;
  }
  const classified = await listBoardAgentKeys();
  gasLeft = classified.board[0]?.allowance || '';
  keyStale = classified.needsRenew;
  keyReady = false;
  return false;
}

// Existing row: set_rules and set_calls, plus set_agent only when the key differs.
// One signAndSendTransactions batch. The access-key add stays on the first Approve path.
function ruleUpdateTransactions(row, r, sec, expiresAt = expiresToWrite({ hoursEdited: !!st.hoursEdited, hours: r.hours, chainExpiresAt: row?.expires_at })) {
  const key = keyFrom(sec);
  const contract = MAIN.board.contract;
  const plan = updatePlan({
    rowAgent: row.agent,
    agentHex: pubkeyHex(key),
    rulesDepositYocto: RULES_DEPOSIT_YOCTO,
    callsDepositYocto: CALLS_DEPOSIT_YOCTO,
  });
  // On a row at its 0.02 NEAR cap, an ADDED receiver only fits if the call list is rewritten
  // first: `set_calls` frees the old pairs, `set_rules` then spends the difference. Measured
  // on the live row, the rewrite freed 187 bytes and a receiver costs about 70. Without this
  // order the visitor got ERR_ROW_TOO_BIG for a change the row could actually hold.
  const roomFull = rowHeadroomBytes(chainRow) === 0;
  const knownShops = new Set((chainRow?.receivers || []).map(a => String(a)));
  const addingShop = r.receivers.some(a => !knownShops.has(String(a)));
  const shrinkFirst = roomFull && addingShop;
  const out = plan.map(step => {
    const args = step.method === 'set_agent' ? { agent: key.publicKey }
      : step.method === 'set_rules' ? { rules: ruleArgs(r, expiresAt) }
      : callPolicy(r.receivers, toY(r.cap), toY(r.daily), 'ft_transfer', payoutsCalls([...FERRY_CALL_TARGETS, { receiver: contract, method: 'stamp', cap: String(toY(r.cap)) }, ...housePairsIfNamed(r.receivers)], toY(r.cap)).calls);
    return [step.key, { receiverId: contract, actions: [{ type: 'FunctionCall', params: { methodName: step.method, args, gas: (GAS.agent * TG).toString(), deposit: step.deposit } }] }];
  }).sort((a, b) => {
    if (!shrinkFirst) return 0;
    // set_calls before set_rules; everything else keeps its order.
    const rank = k => (k === 'calls' ? 0 : k === 'rules' ? 1 : 2);
    return rank(a[0]) - rank(b[0]);
  });
  return out;
}
async function signBoard() {
  const r = rules(), contract = MAIN.board.contract;
  // The Rules step refuses an over-full list, but a visitor can reach #sign by URL or by
  // stepping back through the rail, and the open is what actually writes set_calls. Refuse
  // here too, before any wallet opens: the row holds 0.02 NEAR and the board would panic
  // ERR_ROW_TOO_BIG after open_charter had already spent the deposit.
  if (!st.trial && !callsFitRow(callsFor(r, contract), r.receivers.length)) {
    const keep = fittingShops(r.receivers, list => callsFor({ ...r, receivers: list }, contract));
    throw new Error(keep.length
      ? `That shop list is too long for one row. A row holds ${fmtN(ROW_NEAR)} NEAR of storage, and it can hold ${keep.length} of your ${r.receivers.length} shops. Keep ${keep.join(', ')} and drop the rest.`
      : `A row holds ${fmtN(ROW_NEAR)} NEAR of storage and this list does not fit even one shop. Use a shorter account id.`);
  }
  // `__NC_SETUP_WALLET` is the browser-test seam: it stands in for the NEAR Connect
  // wallet so a test can read the batch without a real approval. It never signs.
  const w = globalThis.__NC_SETUP_WALLET ? await globalThis.__NC_SETUP_WALLET() : await mainnetWallet().wallet();
  const mark = (k, state, tx) => { const s = signLog.find(x => x.k === k); if (s) Object.assign(s, { state, tx: tx || s.tx }); else signLog.push({ k, state, tx }); render(); };
  const readRpc = rpcClient([MAIN.rpc]);
  // Read the board again: a row may have been closed or opened since this page loaded.
  // `null` from `get_charter` means "no row", and that is the open-row path.
  let readFailed = false;
  let row = await viewFn(readRpc, contract, 'get_charter', { owner: me }).catch(() => { readFailed = true; return null; });
  if (readFailed) throw new Error('The board did not answer. Refresh the page and try again.');
  adoptPluginKey(me);
  const sec = localStorage.getItem(agentLS(me)) || keyFrom().secretKey;
  localStorage.setItem(agentLS(me), sec);
  const pk = keyFrom(sec).publicKey;
  const txs = [];
  // The key transaction is a separate approval that runs only after the row is on chain.
  // On 2026-11-06 the batch sent the key swap beside an underfunded board call: the board
  // call failed, the key swap succeeded, and the page was left with a valid key, no row,
  // and nothing to press. Splitting them makes the second step depend on the first.
  const keyTx = async () => {
    // Allowance cannot be raised on a key that is already on the account. Add the key
    // again replaces it, so one approval refreshes the gas budget. Stale board keys that
    // omit propose_call_as are deleted in the same batch so Toll and Guard can call shops.
    const existingKey = await agentAccessKey(sec);
    const classified = await listBoardAgentKeys();
    const stalePks = classified.stale.map(k => k.publicKey).filter(p => p !== pk);
    const keyActions = [
      ...stalePks.map(publicKey => ({ type: 'DeleteKey', params: { publicKey } })),
      ...(existingKey || classified.board.some(k => k.publicKey === pk)
        ? [{ type: 'DeleteKey', params: { publicKey: pk } }] : []),
      addKeyAction(pk),
      // One approval also registers the separate confirm key, so a held WARN can be released
      // by the visitor and never by the agent. No deposit: the board charges the row.
      setConfirmAction(confirmKeyFor(me)),
    ];
    return { receiverId: me, actions: keyActions };
  };
  const sendKey = async () => {
    mark('key', 'run');
    const tx = await keyTx();
    const res = w.signAndSendTransactions ? await w.signAndSendTransactions({ transactions: [tx] }) : [await w.signAndSendTransaction(tx)];
    mark('key', 'run', txHashOf(res?.[0]));
    let ak = null; for (let i = 0; i < 10 && !(ak = await agentAccessKey(sec)); i++) await wait(1200);
    mark('key', ak ? 'ok' : 'run');
    if (!ak) throw new Error('The board opened your row, but the agent key is not on your account yet. Wait a few seconds and press Open your row again.');
  };
  if (!row) {
    // open_charter and set_calls go to the board as one transaction. The key goes on the
    // visitor's own account afterwards, and only once the row is really there.
    // The Base effect budget rides in the SAME transaction, but only when the board on chain
    // is a build that pays it from the side reserve. On the older build `set_effects` charged
    // the row's own bytes, so including it would make opening a row fail for everyone. The
    // hash is read from the account, not assumed, and the list is simply left out when the
    // board is not upgraded yet.
    const boardCode = await readRpc('query', { request_type: 'view_account', finality: 'final', account_id: contract })
      .then(a => a && a.code_hash).catch(() => null);
    const effects = boardCode === EFFECTS_CODE_HASH ? effectsFor(r) : undefined;
    st.effectsPending = !!(effects && effects.length) && effects.length > 0 && boardCode !== EFFECTS_CODE_HASH;
    const built = openRowTransactions({
      accountId: me, contract, rules: boardArgs(r, pk).rules, agentPublicKey: pk,
      fundYocto: ROW_FUND, rowDepositYocto: MAIN.board.max_row_yocto, callsDepositYocto: CALLS_DEPOSIT_YOCTO,
      calls: callsFor(r, contract), effects, gasOpen: (GAS.open * TG).toString(), gasAgent: (GAS.agent * TG).toString(),
      allowance: AGENT_ALLOW.toString(),
    });
    // A previous attempt may have landed the key without the row (that is exactly what
    // 2026-11-06 left behind: key swap succeeded, board call failed). The row is what is
    // missing, so open it; the key step below then sees a ready key and skips the swap.
    mark('create', 'run'); mark('key', 'run');
    const out = w.signAndSendTransactions ? await w.signAndSendTransactions({ transactions: [built.open] }) : [await w.signAndSendTransaction(built.open)];
    mark('create', 'run', txHashOf(out?.[0]));
    // A failed board call must not be followed by the key swap. The row is the only proof.
    let opened = null;
    for (let i = 0; i < 20 && !opened; i += 1) {
      if (i) await wait(1500);
      opened = await viewFn(readRpc, contract, 'get_charter', { owner: me }).catch(() => null);
    }
    if (!opened) {
      const failure = out?.find(o => o?.status && !('SuccessValue' in o.status));
      const why = failure ? (refusalOf(JSON.stringify(failure.status)) || 'the call failed') : '';
      throw new Error(failure
        ? `The board did not open the row (${why}). Your agent key was not changed. Open your row tries again.`
        : 'The row did not appear yet. Wait a few seconds and press Open your row again.');
    }
    row = opened;
    mark('create', 'ok'); st.charter = me; save();
    // Only swap the key when it is missing or stale. An already valid key needs no approval.
    if (await agentAccessKey(sec)) { keyReady = true; keyStale = false; mark('key', 'ok'); }
    else await sendKey();
  } else {
    // Update receivers/caps without close_charter (storage charge only; unused deposit refunded).
    // Source: contracts/charter_board/src/lib.rs set_rules + charge.
    // The step key 'create' is the open-row line on a first approval. Update my rules keeps 'agent'.
    for (const [k, tx] of ruleUpdateTransactions(row, r, sec)) txs.push([k === 'agent' ? 'create' : k, tx]);
    txs.push(['key', await keyTx()]);
    for (const [k] of txs) mark(k, 'run');
    const out = w.signAndSendTransactions ? await w.signAndSendTransactions({ transactions: txs.map(t => t[1]) }) : [];
    let res = out; if (!w.signAndSendTransactions) { res = []; for (const t of txs) res.push(await w.signAndSendTransaction(t[1])); }
    txs.forEach(([k], i) => mark(k, 'run', txHashOf(res?.[i])));
  }
  done(5); await refreshBal();
}
function noteSign(k, state, tx) {
  const s = signLog.find(x => x.k === k);
  if (s) Object.assign(s, { state, tx: tx || s.tx });
  else signLog.push({ k, state, tx });
}
function writtenRules(r, row) {
  return { ...r, expiresAt: expiresToWrite({ hoursEdited: !!st.hoursEdited, hours: r.hours, chainExpiresAt: row?.expires_at }) };
}
async function recentMethodTx(method, ok) {
  if (!me) return null;
  const url = `https://api.nearblocks.io/v1/account/${encodeURIComponent(me)}/txns-only?per_page=10`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const j = await res.json();
    return txHashForMethod(j.txns || [], { contract: MAIN.board.contract, method, ok });
  } catch { return null; }
}
async function rememberPartial(txs, error, local) {
  const text = String(error?.message || error || '');
  const hashes = hashesFromError(error);
  const failedCalls = /ERR_RECEIVERS/.test(text);
  let next = null;
  let saved = false;
  const tries = failedCalls ? 4 : 1;
  for (let i = 0; i < tries && !saved; i++) {
    try { next = await viewFn(rpcClient([MAIN.rpc]), MAIN.board.contract, 'get_charter', { owner: me }); } catch { next = null; }
    if (next) { chainRow = next; chainLoadedFor = me; }
    saved = !!(next && !rulesDiff(local, next).length);
    if (!saved && i + 1 < tries) await wait(1000);
  }
  if (saved) { st.hoursEdited = false; save(); }
  let rulesTx = null;
  let callsTx = failedCalls && hashes.length === 1 ? hashes[0] : null;
  if (saved && !rulesTx) rulesTx = await recentMethodTx('set_rules', true);
  if (failedCalls && !callsTx) callsTx = await recentMethodTx('set_calls', false);
  if (saved) noteSign('rules', 'ok', rulesTx);
  if (failedCalls) noteSign('calls', 'bad', callsTx);
  for (const [k] of txs) if (k !== 'rules' && k !== 'calls' && !signLog.some(x => x.k === k)) noteSign(k, 'run');
  const err = new Error(plainRulesError(text, { rulesSaved: saved }));
  err.rulesSaved = saved;
  throw err;
}
async function updateRules() {
  const r = rules();
  const w = await mainnetWallet().wallet();
  const contract = MAIN.board.contract;
  const readRpc = rpcClient([MAIN.rpc]);
  const row = await viewFn(readRpc, contract, 'get_charter', { owner: me }).catch(() => null);
  if (!row) throw new Error('No charter row on chain yet.');
  chainRow = row;
  adoptPluginKey(me);
  const sec = localStorage.getItem(agentLS(me));
  if (!sec) throw new Error('No agent key in this browser.');
  const local = writtenRules(r, row);
  // The update writes the same call list, so it hits the same row limit. Refuse before the
  // wallet opens rather than letting set_calls panic ERR_ROW_TOO_BIG after set_rules lands.
  if (!callsFitRow(callsFor(r, contract), r.receivers.length)) {
    const keep = fittingShops(r.receivers, list => callsFor({ ...r, receivers: list }, contract));
    throw new Error(keep.length
      ? `That shop list is too long for one row. A row can hold ${keep.length} of your ${r.receivers.length} shops. Keep ${keep.join(', ')} and drop the rest. Update my rules would be refused on chain.`
      : `A row holds ${fmtN(ROW_NEAR)} NEAR of storage and this list does not fit even one shop. Update my rules would be refused on chain.`);
  }
  const txs = ruleUpdateTransactions(row, r, sec, local.expiresAt);
  // One wallet approval for set_rules, set_calls, and set_agent when the key differs.
  let res;
  try {
    const out = w.signAndSendTransactions ? await w.signAndSendTransactions({ transactions: txs.map(t => t[1]) }) : [];
    res = out;
    if (!w.signAndSendTransactions) { res = []; for (const t of txs) res.push(await w.signAndSendTransaction(t[1])); }
  } catch (e) {
    await rememberPartial(txs, e, local);
  }
  txs.forEach(([k], i) => noteSign(k, 'ok', txHashOf(res?.[i])));
  let next = null;
  for (let i = 0; i < 20; i++) {
    next = await viewFn(readRpc, contract, 'get_charter', { owner: me }).catch(() => null);
    if (next && !rulesDiff(local, next).length) break;
    await wait(1500);
  }
  if (next) chainRow = next;
  chainLoadedFor = me;
  if (!next || rulesDiff(local, next).length) throw new Error('The row has not caught up yet. Wait a few seconds and press Update my rules again.');
  st.hoursEdited = false;
  save();
  done(5);
  await refreshBal();
}
async function sign() {
  if (boardLive()) return signBoard();
  done(5);
}
function boardFacts(row) {
  const key = me ? localStorage.getItem(agentLS(me)) : '';
  let bound = 'not the key in this browser';
  try { if (key && pubkeyHex(keyFrom(key)) === row?.agent) bound = 'bound to this browser'; } catch { /* unreadable key */ }
  return [['Charter', acA(me)], ['Row balance', fmtN(nearOf(row?.balance)) + ' NEAR'], ['Row storage', fmtN(nearOf(row?.storage_locked)) + ' NEAR'],
    ['Max per payment', fmtN(nearOf(row?.per_action_cap)) + ' NEAR'], ['Daily budget', fmtN(nearOf(row?.daily_budget)) + ' NEAR'],
    ['Allowed shops', esc((row?.receivers || []).join(', '))],
    ['Expires', formatExpiry(row?.expires_at)],
    ['Agent key', bound],
    ['Session gas left', gasLeft ? fmtN(nearOf(gasLeft)) + ' NEAR' : '—']]
    .map(([a, b]) => `<div class="fact"><small>${a}</small><b>${b}</b></div>`).join('');
}
async function ensureChainRow() {
  if (!me || !boardLive() || st.trial) return;
  if (chainLoadedFor === me) return;
  const owner = me;
  readError = false;
  const row = await viewFn(rpcClient([MAIN.rpc]), MAIN.board.contract, 'get_charter', { owner }).catch(() => { readError = true; return null; });
  if (owner !== me) return;
  // Mark it loaded only AFTER the read resolves. Setting this before the await made the
  // next caller return early with chainRow still null, so the rules step saw no row and a
  // storage-full row was never refused.
  chainRow = row;
  chainLoadedFor = owner;
  chainRead = true;
    // `get_charter` returns `null` for an account with no row. That is an answer, not
    // a failed read, and it is the normal state after a close or a force_close.
    chainError = row ? '' : (readError ? 'The chain did not answer. Refresh the page to try again.' : '');
    // A read that failed is not a verdict on the row: let the next paint try again.
    if (readError) chainLoadedFor = '';
    if (STEPS[st.step][0] === 'sign') render();
}
async function facts() {
  const el = $('#facts'); if (!el || !st.charter) return;
  try {
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
  const tf = $('#tofund'); if (tf) tf.onclick = e => { e.preventDefault(); go(1); };
  const watch = (btn, job) => act(btn, async () => {
    const t = setTimeout(() => { if (busy && document.hasFocus()) { const h = $('#signhelp'); if (h) h.hidden = false; } }, 3000);
    try { await job(); } catch (e) { throw new Error(plainErr(e)); } finally { clearTimeout(t); }
  });
  const b = $('#sign'); if (b) b.onclick = () => watch(b, sign);
  const again = $('#read-again'); if (again) again.onclick = () => { chainError = ''; chainLoadedFor = ''; chainRead = false; readError = false; render(); ensureChainRow(); };
  const up = $('[data-testid=setup-update-rules]'); if (up) up.onclick = () => watch(up, updateRules);
  const rs = $('#resign'); if (rs) rs.onclick = () => { busy = false; const h = $('#signhelp'); if (h) h.hidden = true; if (up) watch(up, updateRules); else if (b) watch(b, sign); };
  // Sign is where the renew panel shows for a live stale key. wireTry alone never ran here.
  bindRenewKey(job => async () => { try { await job(); } catch (e) { throw new Error(plainErr(e)); } });
  bindRefreshKey(job => async () => { try { await job(); } catch (e) { throw new Error(plainErr(e)); } });
  wire(() => { done(5); go(6); });
  // Always read the board on this step. The old condition required a stored agent key,
  // so an account whose row was closed (or force_closed) skipped the read and fell into
  // the legacy charter panel, which then showed a read error for a row that simply is
  // not there. `get_charter` returning null is the answer that decides the open-row path.
  if (boardLive() && !st.trial) {
    ensureChainRow();
    if (keyReady === null) refreshKeyReady().then(() => { if (STEPS[st.step][0] === 'sign') render(); });
  } else facts();
}

// ---------- 7. Try ----------
let tries = [], keyReady = null, keyStale = false, renewStatus = '', refreshStatus = '', gasLeft = '', secTimer = null;
const WHY = { over_per_action_cap: 'over your per-payment cap', over_daily_budget: 'over your daily budget', over_daily_action_count: 'over your payments-per-day limit', receiver_not_allowlisted: 'that shop is not on your list', below_min_amount: 'below the smallest payment', clause_expired: 'your rule has expired', frozen: 'the charter is frozen', ERR_BALANCE: 'your charter\'s own balance is too low' };
let pendingTry = null; // { amount, hash } while a try is on its way, so the link shows before the result
const reasonOf = t => Object.keys(WHY).find(k => String(t || '').includes(k)) || refusalOf(t) || '';
async function boardAsk(amt) {
  const contract = MAIN.board.contract, amount = toY(amt), receiver = rules().receivers[0];
  const rpcCall = rpcClient([MAIN.rpc]);
  const row = await viewFn(rpcCall, contract, 'get_charter', { owner: me });
  const key = storedAgentKey(k => localStorage.getItem(k), me);
  const sec = key?.secretKey;
  if (!key || pubkeyHex(key) !== String(row?.agent || '')) {
    return { passed: false, before: true, reason: 'the agent key in this browser does not match the charter', amount, receiver };
  }
  const signature = signMessage(key, proposalMessage({ contract, owner: me, receiver, amount, nonce: String(row.nonce) }));
  const args = { owner: me, receiver, amount, signature, reveal: null };
  const ak = await agentAccessKey(sec);
  if (ak) {
    // No wallet: the agent key signs the transaction itself.
    const signed = signTx({ key, signerId: me, receiverId: contract, nonce: BigInt(ak.nonce) + 1n, blockHash: ak.block_hash, actions: [functionCall('propose', args, GAS.propose * TG)] });
    pendingTry = { amount, hash: signed.hash, t0: Date.now() }; render();
    let r;
    try { r = await rpcCall('send_tx', { signed_tx_base64: signed.base64, wait_until: 'FINAL' }); }
    catch (e) {
      // InvalidTxError means the network did not accept it: nothing is on chain.
      if (e.rpc && /InvalidTx|INVALID_TRANSACTION|NotEnough|Expired|Nonce/i.test(JSON.stringify(e.rpc))) return { passed: false, before: true, reason: 'the network did not accept the transaction (' + (e.rpc.cause?.name || 'invalid') + ')', amount, receiver };
      return { passed: false, reason: 'no answer from the RPC yet; open the link to see the result', tx: signed.hash, amount, receiver };
    } finally { pendingTry = null; }
    const o = outcomeOf(r);
    return o.ok ? { passed: true, reason: 'ok', tx: signed.hash, amount, receiver, decision: 'allowed', signer: 'agent' }
      : { passed: false, reason: reasonOf(o.error) || plainErr(o.error), tx: signed.hash, amount, receiver, decision: 'refused', signer: 'agent', holds: row.balance };
  }
  const w = await mainnetWallet().wallet();
  try {
    const res = await w.signAndSendTransaction({ receiverId: contract, actions: [{ type: 'FunctionCall', params: { methodName: 'propose', args, gas: (GAS.propose * TG).toString(), deposit: '0' } }] });
    return { passed: true, reason: 'ok', tx: txHashOf(res), amount, receiver, decision: 'allowed', signer: 'wallet' };
  } catch (e) {
    const tx = e.tx || txHashOf(e) || null;
    return { passed: false, before: !tx, reason: reasonOf(e) || plainErr(e), tx, amount, receiver, decision: 'refused', signer: 'wallet', holds: row.balance };
  }
}
const whyText = t => t.reason === 'ERR_BALANCE'
  ? `Your charter's own balance is too low for this payment (holds ${fmtN(nearOf(t.holds))}, needs ${fmtN(nearOf(t.amount))} NEAR). Your account balance is not used.`
  : (WHY[t.reason] || t.reason || t.decision);
let rowBal = null, rowView = null, topUpBusy = false, fundDraft = null;
const tryNeed = () => toY(Math.min(+rules().cap, 0.001));
const lowBal = () => boardLive() && !st.trial && rowBal !== null && rowBal < tryNeed();
// Default add: enough to reach max(cap+0.01, 0.01), rounded up to 0.005.
// fund (lib.rs 202–206) puts the deposit on the row. close_charter (208, release 229) sends it back.
function fundChoice() {
  const draft = fundDraft != null && String(fundDraft).trim() !== '';
  const capYocto = toY(rules().cap);
  const rowYocto = rowBal ?? 0n;
  let yocto = 0n;
  let soft = '';
  if (draft) {
    const n = Number(fundDraft);
    if (!Number.isFinite(n) || n <= 0) return { ok: false, yocto: 0n, near: String(fundDraft), why: 'Enter an amount in NEAR.' };
    yocto = BigInt(toY(n));
  } else {
    const open = charterTopUpYocto({ capYocto, rowYocto, accountYocto: null });
    yocto = charterTopUpYocto({ capYocto, rowYocto, accountYocto: bal == null ? null : bal });
    if (bal != null && yocto < open) soft = `The account keeps ${nearStringFromYocto(TOPUP_RESERVE_YOCTO)} NEAR for gas, so this add is ${nearStringFromYocto(yocto)} NEAR.`;
  }
  const near = draft ? String(fundDraft) : nearStringFromYocto(yocto);
  if (bal == null) return { ok: false, yocto, near, why: 'Your account balance is still loading.' };
  const room = topUpRoom(bal);
  if (yocto > room) return { ok: false, yocto, near, why: `Leave ${nearStringFromYocto(TOPUP_RESERVE_YOCTO)} NEAR in the account for gas. You can add at most ${fmtN(nearOf(room.toString()))} NEAR.` };
  if (yocto < TOPUP_MIN_YOCTO) return { ok: false, yocto, near, why: room < TOPUP_MIN_YOCTO ? `Leave ${nearStringFromYocto(TOPUP_RESERVE_YOCTO)} NEAR in the account for gas. This account can add ${fmtN(nearOf(room.toString()))} NEAR, which is under 0.001.` : 'Add at least 0.001 NEAR.' };
  return { ok: true, yocto, near, why: soft };
}
async function topUp() {
  const choice = fundChoice();
  if (!choice.ok) throw new Error(choice.why);
  if (topUpBusy) return;
  topUpBusy = true; render();
  try { await topUpRun(choice.yocto); fundDraft = null; } finally { topUpBusy = false; }
}
async function topUpRun(deposit) {
  const w = await mainnetWallet().wallet(), before = rowBal ?? 0n;
  const res = await w.signAndSendTransaction({ receiverId: MAIN.board.contract, actions: [{ type: 'FunctionCall', params: { methodName: 'fund', args: {}, gas: (GAS.agent * TG).toString(), deposit: deposit.toString() } }] });
  const tx = txHashOf(res); const mark = state => { const s = signLog.find(x => x.k === 'topup'); if (s) Object.assign(s, { state, tx }); else signLog.push({ k: 'topup', state, tx }); render(); };
  mark('run');
  // Re-read the row until the new balance shows (the fund call confirms in a block or two).
  for (let i = 0; i < 15; i++) { await readRowBal(); if (rowBal !== null && rowBal > before) break; await wait(1500); }
  mark(rowBal !== null && rowBal > before ? 'ok' : 'run'); refreshBal();
}
async function readRowBal() { const row = await viewFn(rpcClient([MAIN.rpc]), MAIN.board.contract, 'get_charter', { owner: me }).catch(() => null); rowView = row; rowBal = row ? BigInt(row.balance) : null; }
function sTry() {
  if (PREVIEW && !(boardLive() && st.charter)) {
    const r = rules(), to = r.receivers[0] || 'townhall.nearcarta.near', ok = Math.min(+r.cap, 0.001), over = +(+r.cap * 2).toFixed(4);
    const tiles = tryTiles({ actionsToday: 0, maxPerDay: r.per || 3, lowBalance: false });
    const allowed = MAIN.charter?.txs?.['agent_propose_allowed_0.001'];
    const refused = MAIN.charter?.txs?.['agent_propose_over_cap_0.003'];
    return head('Try it', 'Watch the charter decide.', 'These buttons use your rules. This preview does not sign. The two transactions below are already on mainnet.')
      + `<div class="tiles" style="grid-template-columns:1fr 1fr"><button type="button" class="tile" id="t-ok" data-testid="try-allowed" aria-describedby="try-allow-hint"><i>✓</i><b>Pay ${fmtN(ok)} NEAR to ${esc(short(to))}</b><span id="try-allow-hint">${esc(tiles.allowReason)}</span><em class="go" style="font-style:normal">${esc(tiles.allowAction)}</em></button>
       <button type="button" class="tile" id="t-no" data-testid="try-refused" aria-describedby="try-refuse-hint"><i>✕</i><b>Pay ${fmtN(over)} NEAR to ${esc(short(to))}</b><span id="try-refuse-hint">${esc(tiles.refuseReason)}</span><em class="go" style="font-style:normal">${esc(tiles.refuseAction)}</em></button></div>`
      + (st.previewNote ? `<p data-testid="try-preview-note">${esc(st.previewNote)}</p>` : '')
      + `<div class="verdict good" data-testid="try-verdict"><span class="tag">ALLOWED</span><div><b>0.001 NEAR on ${esc(MAIN.charter.contract)}</b><br><span class="muted small">inside the cap</span> ${txA(allowed)}</div></div>`
      + `<div class="verdict bad" data-testid="try-verdict"><span class="tag">REFUSED</span><div><b>0.003 NEAR on ${esc(MAIN.charter.contract)}</b><br><span class="muted small">over the per-payment cap</span> ${txA(refused)}</div></div>`
      + `<div class="actions"><button class="btn" id="back">Back</button><span class="row"><a class="btn" href="/shops/vault/" data-testid="setup-office">Your House</a><a class="btn gold" href="${esc(next())}" data-testid="setup-finish">Enter the town</a></span></div>`;
  }
  if (!st.trial && !(boardLive() && st.charter)) {
    const allowed = MAIN.charter?.txs?.['agent_propose_allowed_0.001'];
    const refused = MAIN.charter?.txs?.['agent_propose_over_cap_0.003'];
    return head('Try it', 'The town charter already decides on mainnet.', 'These two transactions are on mainnet. One payment inside the cap was allowed. One over the cap was refused. Your NEAR is not spent here.')
      + `<div class="verdict good" data-testid="try-verdict"><span class="tag">ALLOWED</span><div><b>0.001 NEAR on ${esc(MAIN.charter.contract)}</b><br><span class="muted small">inside the cap</span> ${txA(allowed)}</div></div>`
      + `<div class="verdict bad" data-testid="try-verdict"><span class="tag">REFUSED</span><div><b>0.003 NEAR on ${esc(MAIN.charter.contract)}</b><br><span class="muted small">over the per-payment cap</span> ${txA(refused)}</div></div>`
      + `<div class="actions"><button class="btn" id="back">Back</button><span class="row"><a class="btn" href="/shops/vault/" data-testid="setup-office">Your House</a><a class="btn gold" href="${esc(next())}" data-testid="setup-finish">Enter the town</a></span></div>`;
  }
  const r = rules(), to = r.receivers[0], ok = Math.min(+r.cap, 0.001 > +r.cap ? +r.cap : 0.001), over = +(+r.cap * 2).toFixed(4);
  const tiles = tryTiles({ actionsToday: rowView?.actions_today || 0, maxPerDay: rowView?.max_actions_per_day || r.per, lowBalance: !!(lowBal() || topUpBusy) });
  return head('Try it', 'Watch the charter decide.', `Your agent signs each request with its own key. No further wallet for the ask. Freeze and expiry are owner approvals; the ask after them is still the agent key.`)
    + `<div class="tiles" style="grid-template-columns:1fr 1fr"><button type="button" class="tile" id="t-ok" data-testid="try-allowed" aria-describedby="try-allow-hint" ${tiles.allowDisabled ? 'disabled' : ''}><i>✓</i><b>Pay ${fmtN(ok)} NEAR to ${esc(short(to))}</b><span id="try-allow-hint">${esc(tiles.allowReason)}</span><em class="go" style="font-style:normal">${esc(tiles.allowAction)}</em></button>
       <button type="button" class="tile" id="t-no" data-testid="try-refused" aria-describedby="try-refuse-hint" ${tiles.refuseDisabled ? 'disabled' : ''}><i>✕</i><b>Pay ${fmtN(over)} NEAR to ${esc(short(to))}</b><span id="try-refuse-hint">${esc(tiles.refuseReason)}</span><em class="go" style="font-style:normal">${esc(tiles.refuseAction)}</em></button></div>
     ${boardLive() && !st.trial ? `<div class="tiles" style="grid-template-columns:1fr 1fr;margin-top:12px"><button type="button" class="tile" id="t-freeze" data-testid="try-frozen"><i>❄</i><b>Freeze, then ask</b><span>One approval freezes the row. The ask is your agent key and should be refused. A second approval unfreezes it.</span></button>
       <button type="button" class="tile" id="t-expire" data-testid="try-expired"><i>⌛</i><b>Expire, then ask</b><span>One approval sets the session in the past. The ask is your agent key and should be refused. A second approval writes the session again.</span></button></div>` : ''}
     ${boardLive() && !st.trial && keyReady ? gasPanel() : ''}
     ${boardLive() && !st.trial && keyReady === false && keyStale ? `<div class="tabhelp" data-testid="setup-renew-key"><p class="small">This agent key is missing one of <code>propose</code>, <code>propose_call</code>, <code>propose_call_as</code> and <code>anchor</code>. Ferry Load cargo needs <code>propose_call</code>; Toll and Guard call shops through <code>propose_call_as</code>; the Chronicle anchors a statement with <code>anchor</code>. One wallet approval deletes the old board keys and adds a new one with all four (0.25 NEAR gas allowance). It cannot move your NEAR.</p><p class="small" data-testid="setup-renew-status" role="status"${renewStatus ? '' : ' hidden'}>${esc(renewStatus)}</p><button type="button" class="btn gold" id="renew-key" data-testid="setup-renew-key-btn">Renew agent key</button></div>` : boardLive() && !st.trial && keyReady === false ? `<div class="tabhelp" data-testid="try-needkey"><p class="small">Your agent key is not on your account yet, so each try would open your wallet. One approval adds it. It calls <code>propose</code>, <code>propose_call</code>, <code>propose_call_as</code> and <code>anchor</code> on your row. The town charter key calls <code>propose</code> and <code>propose_batch</code>. Neither key can move your NEAR on its own.</p><button type="button" class="btn" id="t-key" data-testid="try-addkey">Let the agent sign by itself</button></div>` : ''}
     ${boardLive() && !st.trial ? charterFundMarkup({ amountNear: fundChoice().near, lowBalance: !!lowBal(), rowNear: rowBal == null ? '?' : fmtN(nearOf(rowBal.toString())), hintNear: fmtN(nearOf(TOPUP.toString())), busy: topUpBusy, disabled: !fundChoice().ok, note: fundChoice().why }) : ''}
     ${signLog.filter(x => x.k === 'key' || x.k === 'topup').map(x => `<p class="small" data-testid="try-${x.k}-tx">${x.k === 'key' ? 'Agent key added' : 'Charter topped up'}: ${x.state === 'ok' ? '✓ confirmed' : 'confirming…'} ${txA(x.tx)}</p>`).join('')}
     ${pendingTry ? `<div class="verdict" data-testid="try-pending"><span class="tag">SENT</span><div><b>${fmtN(nearOf(pendingTry.amount))} NEAR</b><br><span class="muted small">Signed by your agent key. Confirming on NEAR… <span id="try-secs" data-testid="try-secs">${Math.floor((Date.now() - pendingTry.t0) / 1000)}s</span></span> ${txA(pendingTry.hash)}</div></div>` : ''}
     ${tries.map(t => `<div class="verdict ${t.passed ? 'good' : 'bad'}" data-testid="try-verdict"><span class="tag">${t.passed ? 'ALLOWED' : 'REFUSED'}</span><div><b>${fmtN(nearOf(t.amount))} NEAR → ${esc(short(t.receiver))}</b><br><span class="muted small">${esc(t.passed ? 'inside your rule · the charter paid' : whyText(t))}${t.passed ? '' : t.tx ? ' · refused on chain by the contract' : ' · refused before sending, nothing on chain'}${t.signer === 'agent' ? ' · signed by your agent key, no wallet' : ''}</span> ${txA(t.tx)}</div></div>`).join('')}
     ${errP()}<div class="actions"><button class="btn" id="back">Back</button><span class="row"><a class="btn" href="/shops/vault/" data-testid="setup-office">Your House</a><a class="btn gold" href="${esc(next())}" data-testid="setup-finish">${tries.some(t => t.passed) || st.allowedTx ? 'Enter the town' : 'Skip to the town'}</a></span></div>`;
}
function next() { return nextPath(location.search) || '/'; }
async function ownerBoard(method, args, deposit = '0') {
  const w = await mainnetWallet().wallet();
  const res = await w.signAndSendTransaction({ receiverId: MAIN.board.contract, actions: [{ type: 'FunctionCall', params: { methodName: method, args, gas: (GAS.agent * TG).toString(), deposit } }] });
  return txHashOf(res);
}
async function ownerBeat(kind) {
  const r = rules(), amt = Math.min(+r.cap, 0.001);
  if (kind === 'frozen') {
    await ownerBoard('set_frozen', { frozen: true });
    try { tries.push(await boardAsk(amt)); }
    finally { await ownerBoard('set_frozen', { frozen: false }); }
  } else {
    await ownerBoard('set_rules', { rules: ruleArgs(r, '1') }, toY(0.001));
    try { tries.push(await boardAsk(amt)); }
    finally { await ownerBoard('set_rules', { rules: ruleArgs(r) }, toY(0.001)); }
  }
  await readRowBal();
}
function wireTry() {
  if (PREVIEW && !(boardLive() && st.charter)) {
    const okBtn = $('#t-ok'); if (okBtn) okBtn.onclick = () => { st.previewNote = 'Preview. The pass was not sent.'; render(); };
    const noBtn = $('#t-no'); if (noBtn) noBtn.onclick = () => { st.previewNote = 'Preview. The refusal was not sent.'; render(); };
    wire(); return;
  }
  if (!st.trial && !(boardLive() && st.charter)) { wire(); return; }
  const r = rules(), to = r.receivers[0];
  const rpcCall = st.trial ? rpc : rpcClient([MAIN.rpc]);
  const ask = boardLive() && !st.trial
    ? amt => boardAsk(amt)
    : (amt, memo) => runAsk({ charter: st.charter, key: keyFrom(localStorage.getItem(agentLS(st.charter))), receiver: to, amount: toY(amt), memo, viewF: (c, m, a) => viewFn(rpcCall, c, m, a), send: sendPropose, rpcCall });
  const k = $('#t-key'); if (k) k.onclick = e => act(e.currentTarget, async () => { await signBoard(); keyReady = !!(await agentAccessKey(localStorage.getItem(agentLS(me)))); keyStale = false; });
  bindRenewKey();
  bindRefreshKey();
  if (boardLive() && !st.trial && keyReady === null) refreshKeyReady().then(() => { if (STEPS[st.step][0] === 'try' || STEPS[st.step][0] === 'sign') render(); });
  const fundForm = $('#try-fund'); if (fundForm) { const amt = $('#t-fund-amt'); if (amt) amt.oninput = e => { fundDraft = e.target.value; }; fundForm.onsubmit = e => { e.preventDefault(); act($('#t-topup'), topUp); }; }
  if (boardLive() && !st.trial && rowBal === null) readRowBal().then(() => { if (STEPS[st.step][0] === 'try' && rowBal !== null) render(); });
  clearInterval(secTimer); secTimer = setInterval(() => { const el = $('#try-secs'); if (el && pendingTry) el.textContent = Math.floor((Date.now() - pendingTry.t0) / 1000) + 's'; }, 1000);
  const okBtn = $('#t-ok'); if (okBtn && !okBtn.disabled) okBtn.onclick = e => act(e.currentTarget, async () => { const t = await ask(Math.min(+r.cap, 0.001), 'setup: allowed'); tries.push(t); if (t.passed) { st.allowedTx = t.tx || true; save(); } if (boardLive()) await readRowBal(); refreshBal(); });
  const noBtn = $('#t-no'); if (noBtn && !noBtn.disabled) noBtn.onclick = e => act(e.currentTarget, async () => { tries.push(await ask(+(+r.cap * 2).toFixed(4), 'setup: over cap')); refreshBal(); });
  const fr = $('#t-freeze'); if (fr) fr.onclick = e => act(e.currentTarget, () => ownerBeat('frozen'));
  const ex = $('#t-expire'); if (ex) ex.onclick = e => act(e.currentTarget, () => ownerBeat('expired'));
  wire();
}

const VIEWS = { signin: [sSignin, wireSignin], fund: [sFund, wireFund], privacy: [sPrivacy, wirePrivacy], character: [sCharacter, wireCharacter], rules: [sRules, wireRules], sign: [sSign, wireSign], try: [sTry, wireTry] };
function render() {
  if (!PREVIEW && !me && st.step > 0) st.step = 0;
  // Board v2 returns `null` from `get_charter` for an account with no row, and a stored
  // agent key can outlive a closed row. The sign step is where a row is opened, so it
  // must stay reachable. It used to fall back to the rules step whenever no agent key
  // was stored, which hid "Open your row" from exactly the visitor who needs it.
  if (!PREVIEW && !(st.trial || boardLive()) && st.step === 6 && !(st.charter && localStorage.getItem(agentLS(st.charter)))) st.step = 5;
  document.body.classList.toggle('previewing', PREVIEW);
  rail(); top(); const [v, w] = VIEWS[STEPS[st.step][0]]; const c = $('#card');
  c.innerHTML = (PREVIEW ? '<p class="preview-banner" data-testid="preview-banner">Preview. Nothing is signed.</p>' : '') + v();
  c.style.animation = 'none'; void c.offsetWidth; c.style.animation = ''; w();
  c.querySelectorAll('[data-testid=setup-step]').forEach(b => { if (!b.disabled) b.onclick = () => go(+b.dataset.step); });
  if (['character', 'sign', 'try'].includes(STEPS[st.step][0])) remember();
  // The rules step now needs the chain row too: it refuses a new shop on a row whose 0.02
  // NEAR of storage is already used, which only the chain can tell us. Reading it here means
  // the guard has a row to look at instead of skipping itself.
  if (STEPS[st.step][0] === 'rules' && boardLive() && !st.trial && !chainRow) {
    ensureChainRow().then(() => { if (STEPS[st.step][0] === 'rules') render(); }).catch(() => {});
  }
}

function paintShell() {
  migrateSavedShops();
  if (!me) me = st.accountId || readSessionAccount() || null;
  const want = STEPS.findIndex(s => s[0] === location.hash.slice(1));
  if (!PREVIEW && me && (location.hash === '#rules' || location.hash === '#sign') && want >= 0) st.step = want;
  else if (!PREVIEW && !me) st.step = 0;
  try { render(); } catch { /* the HTML shell stays until boot finishes */ }
}

async function boot() {
  paintShell();
  // The API host from config.js, else this origin's /api rewrite.
  try {
    CFG = await fetch(API + (globalThis.NEARCARTA_NET?.apiPath || '/api') + '/vault/config').then(r => r.json()).catch(() => { API = ''; return fetch((globalThis.NEARCARTA_NET?.apiPath || '/api') + '/vault/config').then(r => r.json()); });
  } catch (e) {
    if (!PREVIEW) throw e;
    CFG = { factory: 'preview.near', network: 'mainnet', arena: { merchants: ['cafe.preview.near'] }, rpc: 'https://free.rpc.fastnear.com', rpc_fallbacks: [] };
  }
  rpc = rpcClient([CFG.rpc, ...(CFG.rpc_fallbacks || [])].filter(Boolean).length ? [CFG.rpc, ...(CFG.rpc_fallbacks || [])].filter(Boolean) : ['https://free.rpc.fastnear.com']);
  if (CFG.min_deposit) st.deposit = Math.max(st.deposit, nearOf(CFG.min_deposit));
  // One session for the whole site: if the preferred network has nobody, use whichever wallet the HUD and /console see.
  if (PUBLIC_MAINNET && st.trial) { st.trial = false; save(); }
  const who = async () => {
    if (PUBLIC_MAINNET) return mainnetAccount();
    const a = await (st.trial ? account() : mainnetAccount()); if (a) return a;
    const b = await (st.trial ? mainnetAccount() : account()); if (b) { st.trial = !st.trial; save(); } return b; };
  if (!PREVIEW) onWallet(async () => {
    const a = await who();
    if (!a && (me || st.accountId)) return;
    if (a && a !== me) { me = a; st.accountId = a; save(); writeSession({ accountId: a, displayName: st.displayName || '' }); bal = undefined; await refreshBal(); render(); }
  });
  // Back from Google: finish the Privy login, then connect.
  const q = new URLSearchParams(location.search);
  if (privy && sessionStorage.getItem('nc_setup_google') && q.get('privy_oauth_code')) {
    sessionStorage.removeItem('nc_setup_google');
    try { await privy.auth.oauth.loginWithCode(q.get('privy_oauth_code'), q.get('privy_oauth_state'), 'google'); const back = nextPath(location.search) || nextPath('?next=' + encodeURIComponent(sessionStorage.getItem('nc_setup_next') || '')); sessionStorage.removeItem('nc_setup_next'); history.replaceState(null, '', back ? '/setup/?next=' + encodeURIComponent(back) : '/setup/'); await ensureWallet(); emailStage = 'finish'; }
    catch (e) { msg = 'Google sign-in did not finish: ' + (e?.message || e); }
  } else if (privy && q.get('google') === '1' && RETURN_TO && !(await who())) {
    // Market Day's "Continue with Google": go straight to Google and come back to the city.
    try { const { url } = await privy.auth.oauth.generateURL('google', location.origin + '/setup/'); sessionStorage.setItem('nc_setup_google', '1'); sessionStorage.setItem('nc_setup_next', RETURN_TO); location.assign(url); return; }
    catch (e) { msg = 'Google sign-in did not start: ' + (e?.message || e); }
  }
  if (!PREVIEW) {
    me = (await who()) || st.accountId || readSessionAccount() || null;
    if (me) { st.accountId = me; save(); writeSession({ accountId: me, displayName: st.displayName || '' }); await refreshBal(); }
    const dest = nextPath(location.search);
    if (me && dest) { location.replace(dest); return; }
  }
  const want = STEPS.findIndex(s => s[0] === location.hash.slice(1));
  if (PREVIEW) {
    if (!CFG) CFG = { factory: 'preview.near', network: 'mainnet', arena: { merchants: ['cafe.preview.near'] } };
    if (want > 0) { me = me || 'preview.near'; bal = bal ?? 2n * YN; }
    st.step = want >= 0 ? want : 0;
    if (!st.displayName) st.displayName = persona().name;
    if (!st.agentName) st.agentName = 'preview-agent';
    render(); return;
  }
  const asked = want >= 0 && (location.hash === '#rules' || location.hash === '#sign');
  if (me && asked) st.step = want;
  else if (me && (bal === 0n || bal == null)) st.step = 1;
  else if (want >= 0 && canOpen(want)) st.step = want;
  else if (!me) st.step = 0;
  render();
}
addEventListener('hashchange', () => {
  if (!PREVIEW) return;
  const want = STEPS.findIndex(s => s[0] === location.hash.slice(1));
  if (want < 0) return;
  if (want > 0) { me = me || 'preview.near'; bal = bal ?? 2n * YN; }
  st.step = want; render();
});
boot().catch(e => { $('#card').innerHTML = `<h1>Could not load</h1><p class="err">${esc(e?.message || e)}</p>`; });
