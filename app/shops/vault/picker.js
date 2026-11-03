// Wallet picker labels: NEAR Connect lists "Ethereum Wallets"; name MetaMask there, mark wallets this browser has
// installed as "Detected", and say plainly which popular NEAR wallets only work on mainnet in this picker.
const NAMES = { 'ethereum-wallets': 'MetaMask & EVM wallets (Rabby, Coinbase, Trust…)', 'meteor-wallet': 'Meteor Wallet', 'intear-wallet': 'Intear Wallet', 'nightly-wallet': 'Nightly Wallet', 'near-cli': 'NEAR CLI (developers)', 'nearcarta-guest': 'Guest testnet account · instant, no install' };
// EIP-6963: installed EVM wallets announce their own names; show them on the MetaMask row.
const EVM = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', e => { const n = e.detail?.info?.name; if (n) EVM.add(String(n).slice(0, 40)); });
  try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch {}
}
const evmSeen = () => [...EVM].length ? [...EVM].join(', ') : window.ethereum ? (window.ethereum.isMetaMask ? 'MetaMask' : 'EVM wallet') : '';
const SEEN = {
  'ethereum-wallets': () => !!evmSeen(),
  'nightly-wallet': () => !!window.nightly?.near,
  'meteor-wallet': () => !!window.meteorCom || !!window.meteorWallet,
  'nearcarta-guest': () => { try { return !!localStorage.getItem('nearcarta.vault.guest'); } catch { return false; } },
};
const CSS = `.connect-item .nc-det{margin-left:auto;font:600 11px/1 Inter,system-ui,sans-serif;padding:5px 8px;border-radius:999px;background:rgba(22,163,74,.16);color:#4ade80;white-space:nowrap}
.nc-more{margin:0;padding:10px 20px 16px;font:400 12px/1.45 Inter,system-ui,sans-serif;color:rgba(255,255,255,.62)}`;
function decorate(root) {
  for (const it of root.querySelectorAll('.connect-item:not([data-nc])')) {
    it.dataset.nc = '1'; const id = it.dataset.type, name = it.querySelector('.connect-item-info span');
    if (name && NAMES[id]) name.textContent = NAMES[id];
    const img = it.querySelector('img'); if (img && name) img.alt = '';
    it.setAttribute('role', 'button'); it.tabIndex = 0; it.setAttribute('aria-label', (name?.textContent || id) + (SEEN[id]?.() ? ', detected' : ''));
    it.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); it.click(); } };
    if (SEEN[id]?.()) { const b = document.createElement('span'); b.className = 'nc-det'; b.textContent = id === 'nearcarta-guest' ? 'Saved here' : id === 'ethereum-wallets' ? 'Detected: ' + evmSeen() : 'Detected'; it.append(b); }
  }
  const list = root.querySelector('.connect-item')?.parentElement;
  if (list && !root.querySelector('.nc-more')) { const p = document.createElement('p'); p.className = 'nc-more'; p.textContent = 'New here? Pick Guest account. HERE (HOT) and MyNearWallet are mainnet-only here, and Bitte is not in this picker; Nearcarta runs on testnet.'; list.after(p); }
}
let on = false;
export function decoratePicker() {
  if (on || typeof document === 'undefined') return; on = true;
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
  new MutationObserver(() => { for (const r of document.querySelectorAll('.hot-connector-popup')) decorate(r); }).observe(document.body, { childList: true, subtree: true });
}
