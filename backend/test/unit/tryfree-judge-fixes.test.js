// Two prod take bugs (2026-11-12): the first-visit tour covered Try free, and the one-click judge run
// stalled on ERR_PRECHECK_BAG when a top-up gather minted nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import TESTNET from '../../../shared/deployments/testnet.json' with { type: 'json' };
const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

test('the first-visit tour never covers the town front door', () => {
  const ob = read('app/design/D8_shops/js/onboard.js');
  const fn = ob.slice(ob.indexOf('export function maybeOnboard'));
  const gate = fn.indexOf(`document.querySelector('[data-testid="try-free"], #netChrome')`);
  assert.ok(gate > 0, 'it checks for the Try free chrome');
  assert.ok(gate < fn.indexOf('document.createElement'), 'before any dialog is made');
  // The town page carries the chrome in its static HTML, so the check holds before chrome.js mounts.
  assert.match(read('app/design/D9_world/index.html'), /id="netChrome"/);
});

test('the guest top-up sells only what the bag holds', () => {
  const g = read('app/src/market/live-guest.js');
  const top = g.slice(g.indexOf('async function topUpPurse'), g.indexOf('const saltInBag'));
  assert.match(top, /let salt = await saltInBag\(\)/);
  assert.match(top, /const qty = Math\.min\(3, salt\)/);
  assert.match(top, /if \(salt < 1\) continue;/);
  assert.doesNotMatch(top, /qty: 3,/, 'never a fixed 3');
  assert.match(g, /async function waitForSalt\(want, ms = 9000\)/);
  const sell = g.slice(g.indexOf("if (id === 'sell')"), g.indexOf("if (id === 'invest')"));
  assert.match(sell, /await waitForSalt\(3\)/);
});

test('a guest can be made 20 times a day from one address', () => {
  assert.equal(TESTNET.guest.caps.per_ip_day, 20);
  assert.match(read('render.yaml'), /key: GUEST_PER_IP_DAY\n\s+value: "20"/);
  assert.match(read('backend/src/guest.js'), /per_ip_day \|\| 20\)/);
});
