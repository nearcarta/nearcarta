// Market Day adopts the Privy session /setup made (Google or email), so the film's "web2" sign-in
// carries straight into the city: same account, no second wallet, no email code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const live = read('app/src/market/live-play.js');

const fnSrc = live.slice(live.indexOf('export const hasPrivySession'), live.indexOf('const onTestnet'));
const hasPrivySession = new Function(`${fnSrc.replace('export const', 'const')}; return hasPrivySession;`)();
const store = o => ({ getItem: k => (k in o ? o[k] : null) });

test('a Privy token in this browser counts as signed in, nothing else does', () => {
  assert.equal(hasPrivySession(store({ 'privy:token': '"t"' })), true);
  assert.equal(hasPrivySession(store({ 'privy:refresh_token': '"r"' })), true);
  assert.equal(hasPrivySession(store({})), false);
  assert.equal(hasPrivySession(store({ 'nearcarta.marketday.live': '{}' })), false);
  assert.equal(hasPrivySession(null), false);
  assert.equal(hasPrivySession({ getItem() { throw new Error('blocked'); } }), false);
});

test('resume adopts the existing session on mainnet and opens it with the relayer', () => {
  const fn = live.slice(live.indexOf('export async function resume'), live.indexOf('export async function sendCode'));
  // No session and no record: the signing bundle is not even loaded.
  assert.match(fn, /if \(!live\.account && \(onTestnet\(\) \|\| !hasPrivySession\(\)\)\) return null;/);
  assert.match(fn, /if \(a && !onTestnet\(\)\) await adopt\(a\);/);
  // adopt keeps the same account and asks the relayer to open it; no login() and no email code.
  const adopt = fn.slice(fn.indexOf('async function adopt'));
  assert.match(adopt, /live\.account = account/);
  assert.match(adopt, /ensureSession\(\)/);
  assert.doesNotMatch(adopt, /sendCode|login\(/);
});

test('the sign-in panel offers Google through /setup and comes back to the city', () => {
  const city = read('app/src/market/city.js');
  assert.match(city, /data-testid="md-google" href="\/setup\/\?google=1&next=\$\{encodeURIComponent\(location\.pathname \+ location\.search\)\}"/);
  // Sign in is outlined, not gold.
  assert.match(city, /class="md-ghost md-google"/);
  const setup = read('app/house/setup.js');
  assert.match(setup, /q\.get\('google'\) === '1' && RETURN_TO/);
  assert.match(setup, /sessionStorage\.setItem\('nc_setup_next', RETURN_TO\)/);
  assert.match(setup, /sessionStorage\.getItem\('nc_setup_next'\)/);
});
