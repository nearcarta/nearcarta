// On load, a wallet that is still connected writes the session back.
// If only the saved account remains, one button reconnects that wallet.

import { readSession, restorePlan, savedWalletId, writeSession, visitor } from '../../design/D8_shops/js/session.js';

async function liveAccount() {
  if (typeof globalThis.__NC_ACCOUNT === 'function') return globalThis.__NC_ACCOUNT();
  try {
    const m = await import('/house.bundle.js');
    return await m.peekAccount(1500);
  } catch { return null; }
}

async function clickConnect() {
  if (typeof globalThis.__NC_CONNECT === 'function') return globalThis.__NC_CONNECT();
  try {
    const m = await import('/house.bundle.js');
    return await m.restoreWallet();
  } catch { return null; }
}

/** Read the wallet, then decide whether the saved account needs a click. */
export async function resolveAccount() {
  const saved = visitor();
  let live = '';
  try { live = (await liveAccount()) || ''; } catch { live = ''; }
  const plan = restorePlan(undefined, live);
  if (live && (!saved.signedIn || saved.accountId === live)) {
    const cur = readSession();
    writeSession({ accountId: live, displayName: cur.displayName || '', walletId: savedWalletId(cur) });
  }
  return plan;
}

/** Pages whose control asks the visitor wallet to sign. A check or a quote does not. */
const SIGNING_PAGES = new Set(['hall', 'townhall', 'house', 'vault']);

export function pageSigns(shop) {
  return SIGNING_PAGES.has(String(shop || ''));
}

export function restoreBar(plan) {
  if (!plan?.needsClick) return '';
  return `<p data-testid="session-restore"><button type="button" class="primary" data-testid="restore-session">Restore session</button> <span data-testid="restore-note">${plan.note || 'The wallet is not connected in this tab.'}</span></p>`;
}

export function mountSessionRestore(host, plan) {
  if (!host) return;
  let slot = host.querySelector('[data-testid=session-restore]');
  const html = restoreBar(plan);
  if (!html) { slot?.remove(); return; }
  if (!slot) {
    slot = document.createElement('div');
    host.prepend(slot);
  }
  slot.innerHTML = html;
  const btn = slot.querySelector('[data-testid=restore-session]');
  const note = slot.querySelector('[data-testid=restore-note]');
  if (!btn) return;
  btn.onclick = async () => {
    btn.disabled = true;
    btn.dataset.reason = 'Opening the saved wallet.';
    if (note) note.textContent = 'Opening the saved wallet.';
    try {
      const id = await clickConnect();
      if (id) {
        writeSession({ accountId: id, displayName: readSession().displayName || '', walletId: savedWalletId(readSession()) });
        if (note) note.textContent = 'Wallet restored.';
        btn.hidden = true;
      } else if (note) note.textContent = 'The wallet did not connect. The saved account is still here.';
    } catch {
      if (note) note.textContent = 'The wallet did not connect. The saved account is still here.';
    } finally {
      btn.disabled = false;
    }
  };
}
