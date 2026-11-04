// /sign: the window the "Email or Google" wallet opens. It logs the visitor in to Privy (email code, or Google
// when the Privy app enables it), makes sure they have a NEAR wallet, then hands over to the signing plugin.
import { Buffer } from 'buffer';
globalThis.Buffer = globalThis.Buffer || Buffer;
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Privy, { LocalStorage, create as createWallet } from '@privy-io/js-sdk-core';
import { SignPagePlugin } from '@peerfolio/privy-near-connect/sign-page-plugin';

const privy = new Privy({ appId: __PRIVY_APP_ID__, ...(__PRIVY_CLIENT_ID__ ? { clientId: __PRIVY_CLIENT_ID__ } : {}), storage: new LocalStorage() });
const hasNear = u => (u?.linked_accounts || []).some(a => a.type === 'wallet' && a.chain_type === 'near');
async function ensureNear(user) {
  if (!user || hasNear(user)) return user;
  await createWallet({ fetchPrivyRoute: privy.fetchPrivyRoute.bind(privy), getCompiledPath: privy.getCompiledPath.bind(privy), app: { appId: privy.app.appId } }, { request: { chain_type: 'near' } });
  const { user: u } = await privy.user.get();
  return hasNear(u) ? u : null;
}
const GOOGLE_BACK = location.origin + '/sign';

function Login({ onUser }) {
  const [step, setStep] = useState('email'); const [email, setEmail] = useState(''); const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const run = f => async e => { e?.preventDefault(); setBusy(true); setErr(''); try { await f(); } catch (x) { setErr(x?.message || String(x)); } finally { setBusy(false); } };
  const send = run(async () => { await privy.auth.email.sendCode(email.trim()); setStep('code'); });
  const verify = run(async () => { const r = await privy.auth.email.loginWithCode(email.trim(), code.trim()); onUser(await ensureNear(r.user)); });
  const google = run(async () => { const { url } = await privy.auth.oauth.generateURL('google', GOOGLE_BACK); sessionStorage.setItem('nc_google', '1'); location.assign(url); });
  return <form className="box" onSubmit={step === 'email' ? send : verify}>
    <h1>Sign in to Nearcarta</h1>
    <p>Use your email or Google. A NEAR wallet is made for you; nothing is sent until you approve it here.</p>
    {step === 'email'
      ? <><label>Email<input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} data-testid="privy-email" /></label>
          <button disabled={busy} data-testid="privy-send">Send code</button>
          <button type="button" disabled={busy} onClick={google} data-testid="privy-google">Continue with Google</button></>
      : <><label>Code sent to {email}<input inputMode="numeric" required autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} data-testid="privy-code" /></label>
          <button disabled={busy} data-testid="privy-verify">Log in</button>
          <button type="button" onClick={() => { setStep('email'); setCode(''); }}>Back</button></>}
    {err && <p role="alert" className="err">{err}</p>}
  </form>;
}

function App() {
  const [user, setUser] = useState(undefined);
  useEffect(() => { (async () => {
    // Back from Google: finish the OAuth login with the code in the URL.
    const q = new URLSearchParams(location.search);
    if (sessionStorage.getItem('nc_google') && q.get('privy_oauth_code')) {
      sessionStorage.removeItem('nc_google');
      const r = await privy.auth.oauth.loginWithCode(q.get('privy_oauth_code'), q.get('privy_oauth_state'), 'google');
      history.replaceState(null, '', '/sign'); return setUser(await ensureNear(r.user));
    }
    const { user } = await privy.user.get().catch(() => ({ user: null }));
    setUser(await ensureNear(user).catch(() => null));
  })().catch(() => setUser(null)); }, []);
  // The plugin mounts at once: NEAR Connect waits only 30 s for it to say READY. Its approval stays hidden
  // until the visitor is logged in, so nothing can be signed before that.
  return <>
    {user === undefined && <p className="box" role="status">Preparing your approval…</p>}
    {user === null && <Login onUser={setUser} />}
    <div hidden={!user}><SignPagePlugin privy={privy} options={{ allowedOrigins: [location.origin] }} theme={{ appearance: 'dark', accentColor: 'amber', grayColor: 'sand', radius: 'large', className: 'nc-sign' }} /></div>
  </>;
}
// Plain words on the connect screen, and bring this window to the front when it opens.
const retitle = () => {
  document.querySelectorAll('.pnc-approval__title').forEach(t => { if (t.textContent.trim() === 'Connect to') t.textContent = 'Sign in to Nearcarta'; });
  document.querySelectorAll('#root p, #root span, #root div').forEach(n => { if (n.childElementCount === 0 && /only connect to apps you trust/i.test(n.textContent)) n.textContent = "This is Nearcarta's own sign-in."; });
};
new MutationObserver(retitle).observe(document.getElementById('root'), { childList: true, subtree: true });
document.title = 'Nearcarta · approve';
try { window.focus(); } catch {}
createRoot(document.getElementById('root')).render(<App />);
