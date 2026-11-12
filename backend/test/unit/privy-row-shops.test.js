// F26-F28 (film 2026-11-12): a Google/Privy row in the town shops. Anchors worked; Toll, Guard and
// House sent nothing and said nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { currentAccount, WALLET_ANSWER_MS } from '../../../app/shops/vault/wallet.js';
import { parseTollCommand } from '../../../app/src/panels/toll-room.js';
import { lineMissing, lineForm } from '../../../app/src/panels/house-room.js';
import { runGuardAction } from '../../../app/src/panels/guard-agent.js';

const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

test('F26: a wallet connector that never answers is no wallet, so the saved session account is used', async () => {
  assert.equal(WALLET_ANSWER_MS, 2500);
  const t0 = Date.now();
  const got = await currentAccount({ getConnectedWallet: () => new Promise(() => {}) }, 50);
  assert.equal(got, null);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(await currentAccount({ getConnectedWallet: async () => ({ accounts: [{ accountId: 'a.near' }] }) }, 50), 'a.near');
  assert.equal(await currentAccount({ getConnectedWallet: async () => { throw new Error('none'); } }, 50), null);
});

test('F26: Pay on Base with blank fields says what is missing instead of doing nothing', () => {
  const q = { payable: true, feeNear: '0.001', feeYocto: '1000000000000000000000' };
  assert.match(parseTollCommand('pay ETH on Base', q).hint, /Base address/);
  assert.match(parseTollCommand('pay ETH to 0x' + '1'.repeat(40) + ' on Base', q).hint, /amount/);
  assert.equal(parseTollCommand('pay 0.0001 ETH to 0x' + '1'.repeat(40) + ' on Base', q).ok, true);
  const src = read('app/src/panels/toll-room.js');
  assert.match(src, /if \(!plan\.ok\) \{ state\.seal = plan\.hint \|\| TOLL_HINT; state\.tab = 'pass'; paint\(\); return plan; \}/);
});

test('F27: the guard shows what the live send did, not the offline book hint', async () => {
  const state = { acct: 'nearcarta.near', amount: '0.001', chain: 'near', asset: 'NEAR' };
  const check = async () => ({ account: 'nearcarta.near', verdict: 'allow', reasons: [], signals: { exists: true, age_days: 900 } });
  const why = 'The agent key in this browser is not on your account. Open /setup and renew the agent key. Nothing was signed.';
  const r = await runGuardAction({ ok: true, action: 'pay' }, { state, check, capYocto: '5000000000000000000000', sendPay: async () => ({ ok: false, tx: null, reason: 'no_session_key', why }) });
  if (r.live) { assert.equal(r.hint, why); assert.equal(r.ok, false); }
  const tray = read('app/src/panels/guard-tray.js');
  assert.match(tray, /if \(!\(plan\.action === 'pay' && result\?\.live\)\) state\.notice = result\?\.hint \|\| ''/);
  const apps = read('app/design/D8_shops/js/apps.js');
  assert.match(apps, /reason: 'no_session_key', why:/);
});

test('F28: a deed with no inheritance line offers Set my heirs (holder key, 1 yocto) before I am alive', () => {
  assert.equal(lineMissing({ live: true, line: null }), true);
  assert.equal(lineMissing(null), false);
  assert.equal(lineMissing({ live: false, why: 'read failed' }), false);
  assert.equal(lineMissing({ live: true, line: { heirs: ['a.near'] } }), false);
  assert.deepEqual(lineForm({ heir: 'friend.near', guardian: 'nearcarta.near', owner: 'me.near' }), { ok: true, heirs: ['friend.near'], guardians: ['nearcarta.near'], threshold: 1 });
  assert.equal(lineForm({ heir: 'a.near', guardian: 'a.near' }).ok, false);
  assert.equal(lineForm({ heir: 'me.near', guardian: 'b.near', owner: 'me.near' }).ok, false);
  const apps = read('app/design/D8_shops/js/apps.js');
  assert.match(apps, /fc\('house_set_line', \{ token_id: S\.me, heirs, guardians, threshold: Number\(threshold\) \|\| 1, period_ns: String\(periodNs\), wait_ns: String\(waitNs\) \}, 30, '1'\)/);
  assert.match(read('app/design/D8_shops/js/shopui.js'), /setLine: \(line\) => A\.houseSetLine\(line\)/);
});
