// The Try free entry, the network badge, and the welcome card.
//
// One gold action and one outlined action, per the Gold rule: the gold button starts a free testnet
// account, the outlined one opens the existing mainnet sign-in. The badge in the top bar always says
// which network the page is on, so a judge can never mistake a testnet receipt for a mainnet one.
//
// Nothing here signs anything. The key is made and kept by app/src/guest/key.js; this module only
// asks for the account and shows what came back.
//
// Docs: https://docs.near.org/protocol/accounts-contracts/account-id · https://docs.near.org/tools/near-api
//       https://docs.near.org/protocol/accounts-contracts/access-keys
import { NET, cfg, txUrl, addrUrl, networkLabel, switchUrl } from '../../../shared/net/net.js';
import {
  guestRecord, startGuest, welcomeCrate, forgetGuest, whyText, hasGuest, guestSigner,
} from '../guest/key.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const near = (y) => { try { return (Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(3); } catch { return ''; } };

/** The badge's hint. It is drawn by CSS under the badge, right-aligned, so it never runs off the right edge
 * the way the native `title` tooltip did at the top-right corner. */
export const badgeTip = (test) => (test ? 'You are playing on the NEAR test network. Nothing here is real money.' : 'You are on NEAR mainnet, where payments are real.');
/** The badge: one teal TESTNET pill or one gold MAINNET pill, in the top bar. */
export function badgeMarkup() {
  const test = NET === 'testnet';
  return `<button id="netBadge" class="net-badge ${test ? 'test' : 'main'}" type="button" data-testid="net-badge"
    aria-haspopup="dialog" data-tip="${badgeTip(test)}" aria-description="${badgeTip(test)}">
    <span class="dot" aria-hidden="true"></span>${networkLabel()}</button>`;
}

/** What the badge sheet shows for a guest. */
function sheetBody(rec, account) {
  const rows = [];
  rows.push(`<p class="nb-net">${NET === 'testnet' ? 'NEAR test network. Every move is a real testnet transaction; test NEAR has no value.' : 'NEAR mainnet. Every payment is real.'}</p>`);
  if (account) {
    rows.push(`<p class="nb-acct"><b>${esc(account)}</b><br><a href="${addrUrl(account)}" target="_blank" rel="noopener">View on the explorer ↗</a></p>`);
    rows.push('<p class="nb-bal" data-testid="net-badge-balance">Reading the balance…</p>');
    rows.push('<p><button type="button" class="nb-link" data-testid="save-test-key">Save my test key</button></p>');
  }
  if (rec && rec.account) {
    rows.push('<p><button type="button" class="nb-link" data-testid="start-over">Start over with a new account</button></p>');
  }
  rows.push(`<p><a class="nb-link" data-testid="switch-network" href="${switchUrl(NET === 'testnet' ? 'mainnet' : 'testnet')}">${NET === 'testnet' ? 'Play for real money (mainnet)' : 'Try free on testnet'}</a></p>`);
  return rows.join('');
}

/** The sheet itself: one dialog, opened from the badge. */
export function openSheet({ doc = document, rec = guestRecord(), account = rec?.account } = {}) {
  const old = doc.getElementById('netSheet');
  if (old) old.remove();
  const wrap = doc.createElement('div');
  wrap.id = 'netSheet';
  wrap.className = 'net-sheet';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'false');
  wrap.setAttribute('aria-label', 'Network');
  wrap.setAttribute('data-testid', 'net-sheet');
  wrap.innerHTML = `<div class="nb-card">${sheetBody(rec, account)}<p><button type="button" class="nb-close" data-testid="net-sheet-close">Close</button></p></div>`;
  doc.body.append(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('.nb-close').addEventListener('click', close);
  wrap.querySelector('[data-testid="save-test-key"]')?.addEventListener('click', async () => {
    // The key is written to a file by the browser itself. The page says in words that it is worth
    // nothing, so nobody mistakes a testnet key for a wallet.
    const s = await guestSigner();
    if (!s) return;
    const blob = new Blob([JSON.stringify(s.exportKey(), null, 2)], { type: 'application/json' });
    const a = doc.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${account || 'guest'}-testnet-key.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
  wrap.querySelector('[data-testid="start-over"]')?.addEventListener('click', () => {
    forgetGuest();
    close();
    showWelcomeCard({ doc, fresh: true });
  });
  // Show the balance when there is an account to read.
  if (account) {
    guestSigner().then(async (s) => {
      const bal = s ? await s.balance() : null;
      const out = wrap.querySelector('[data-testid="net-badge-balance"]');
      if (out) out.textContent = bal ? `${near(bal)} test NEAR` : 'Balance not readable just now.';
    }).catch(() => {});
  }
  return wrap;
}

/** The welcome crate: every item with its own transaction link, plus the one-tap deed. */
export function welcomeMarkup({ account, start, crate } = {}) {
  const item = (label, tx, note) => `<li data-testid="crate-item"><b>${esc(label)}</b>${note ? ` <span class="crate-note">${esc(note)}</span>` : ''}${tx ? ` <a class="crate-tx" href="${txUrl(tx)}" target="_blank" rel="noopener">View ↗</a>` : ''}</li>`;
  const items = [
    item(`${start?.fund || '0.25'} test NEAR`, start?.txs?.[0], 'in your new account'),
    ...(crate?.items || []).map((x) => item(x.item === 'tusdc' ? '100 test dollars (tUSDC)' : 'Market space', x.tx, x.item === 'tusdc' ? 'to trade with' : 'so your goods have a home')),
    item('3 salt', null, 'minted by the Ferry on your first step'),
  ];
  return `<div class="welcome" data-testid="welcome-card" role="region" aria-label="Your free test account">
    <button type="button" class="w-close" data-testid="welcome-close" aria-label="Close">×</button>
    <p class="w-title">Your test account is ready</p>
    <p class="w-acct"><b>${esc(account || '')}</b> · <a href="${addrUrl(account || '')}" target="_blank" rel="noopener">open on the explorer ↗</a></p>
    <ul class="w-items">${items.join('')}</ul>
    <p class="w-line">Real testnet transactions. No money, no sign-up. The key stays in this browser.</p>
    <button type="button" class="btn-gold" data-testid="mint-deed">Mint your House deed</button>
    <p class="w-note" data-testid="mint-deed-note"></p>
  </div>`;
}

/** Mint the guest's own House deed with the guest key. 0.03 test NEAR, signed in this browser. */
export async function mintDeed({ doc = document } = {}) {
  const s = await guestSigner();
  const note = doc.querySelector('[data-testid="mint-deed-note"]');
  if (!s) { if (note) note.textContent = 'No test account in this browser yet.'; return null; }
  const house = cfg.shops.house || (NET === 'testnet' ? 'house.nearcarta.testnet' : 'house.nearcarta.near');
  if (note) note.textContent = 'Signing…';
  const r = await s.call(house, 'mint_deed', {}, { deposit: 3n * 10n ** 22n, gas: 60n * 10n ** 12n }).catch((e) => ({ hash: null, failure: String(e?.message || e) }));
  const ok = !r.failure && r.hash;
  if (note) {
    note.innerHTML = ok
      ? `Your deed is minted on testnet. <a href="${txUrl(r.hash)}" target="_blank" rel="noopener">View ↗</a>`
      : `The deed was not minted this time (${esc(String(r.failure || 'no receipt').replace(/^.*panicked: /, '').slice(0, 80))}). The rest of the city still works.`;
  }
  return r;
}

/** The same page on testnet, asking it to start Try free on arrival. */
export function tryFreeUrl() {
  const u = new URL(switchUrl('testnet'), 'https://x.invalid');
  u.searchParams.set('try', '1');
  return u.pathname + u.search + u.hash;
}
const wantsTryFree = () => { try { return new URLSearchParams(globalThis.location?.search || '').get('try') === '1'; } catch { return false; } };
const dropTryParam = () => {
  try { const u = new URL(globalThis.location.href); u.searchParams.delete('try'); globalThis.history?.replaceState(null, '', u.pathname + u.search + u.hash); } catch { /* not a browser */ }
};

/** Start the whole guest path: key, account, crate, card. */
export async function startTryFree({ doc = document, onDone } = {}) {
  const btn = doc.querySelector('[data-testid="try-free"]');
  const say = (text) => { const el = doc.querySelector('[data-testid="try-free-note"]'); if (el) el.textContent = text; };
  if (btn) btn.disabled = true;
  say('Making your test account…');
  try {
    const s = await startGuest();
    if (!s.ok) {
      say(whyText(s.why));
      // Practice mode is the floor, always.
      say(`${whyText(s.why)} You can still play the whole story in practice mode.`);
      return null;
    }
    const crate = await welcomeCrate(s.account).catch(() => null);
    s.account && say('');
    showWelcomeCard({ doc, start: s, crate });
    onDone?.(s);
    return s;
  } catch (e) {
    say(whyText('ERR_START'));
    return null;
  } finally {
    if (btn) btn.disabled = false;
  }
}

/** Put the welcome card on the page. It replaces any previous one. */
export function showWelcomeCard({ doc = document, start, crate, fresh = false } = {}) {
  const old = doc.getElementById('welcomeCard');
  if (old) old.remove();
  const wrap = doc.createElement('div');
  wrap.id = 'welcomeCard';
  wrap.className = 'welcome-wrap';
  const rec = guestRecord();
  wrap.innerHTML = welcomeMarkup({ account: start?.account || rec?.account, start, crate });
  doc.body.append(wrap);
  wrap.querySelector('[data-testid="mint-deed"]')?.addEventListener('click', () => mintDeed({ doc }));
  // The card is a greeting, not a wall: it closes, and the badge reopens the account sheet.
  wrap.querySelector('[data-testid="welcome-close"]')?.addEventListener('click', () => wrap.remove());
  if (fresh) startTryFree({ doc });
  return wrap;
}

/**
 * Wire the badge and the two entry buttons on a town page.
 *
 * The row is moved INTO the town's existing top bar (`#acct`, the row that already holds the wallet and
 * the judge links) instead of being a second fixed strip. Two fixed strips at the top is what overlapped
 * at 390px; one row that wraps cannot. If that row is absent, the row stays where the HTML put it.
 */
export function installNetChrome({ doc = document } = {}) {
  const bar = doc.getElementById('netChrome');
  if (!bar) return null;
  const host = doc.getElementById('acct');
  if (host && bar.parentElement !== host) {
    const dev = host.querySelector('.devmenu');
    if (dev) host.insertBefore(bar, dev); else host.prepend(bar);
    bar.classList.add('in-topbar');
  }
  const rec = guestRecord();
  bar.innerHTML = `<a id="tryFree" class="btn-gold" data-testid="try-free" href="#" role="button">
      <span class="k" aria-hidden="true">✦</span><span class="lab">Try free</span>
    </a>
    <a id="signIn" class="btn-outline" data-testid="sign-in" href="/setup/?net=mainnet" title="Sign in with email and set the rules your agent cannot break">Play for real</a>
    <a class="btn-quiet" data-testid="watch-story" href="/?story=1" title="Watch the thirty-second opening story">Watch the story</a>
    ${badgeMarkup()}
    <p id="tryFreeNote" class="try-note" data-testid="try-free-note" aria-live="polite"></p>`;
  const badge = doc.getElementById('netBadge');
  badge?.addEventListener('click', (e) => { e.preventDefault(); openSheet({ doc, rec: guestRecord() }); });
  doc.getElementById('tryFree')?.addEventListener('click', (e) => {
    e.preventDefault();
    // Try free is a testnet account. From a mainnet page it moves to the same page on testnet and starts
    // there, instead of offering practice mode: the free account is the point of the button.
    if (NET !== 'testnet') { globalThis.location?.assign(tryFreeUrl()); return; }
    startTryFree({ doc });
  });
  // A returning guest lands straight back in their own account, with the card already open.
  if (NET === 'testnet' && hasGuest() && rec?.account) showWelcomeCard({ doc });
  else if (NET === 'testnet' && wantsTryFree()) { dropTryParam(); startTryFree({ doc }); }
  return bar;
}
