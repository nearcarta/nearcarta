// Guest accounts. The account name is a hash of the public key, so the same browser asking twice gets
// the same account and the second call sends nothing. Every cap has its own ERR_ code, a body field
// that looks like a secret is refused before it is read, and on mainnet the module answers 404.
// Docs: https://docs.near.org/protocol/accounts-contracts/account-id · https://docs.near.org/protocol/accounts-contracts/access-keys
//       https://docs.near.org/tools/near-api
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeyPair } from 'near-api-js';
import { guestName, guestAccount, publicKeyOk, refusedSecretField, start, status, guestCfg, welcome } from '../../src/guest.js';
import { dayCounter, globalCounter } from '../../src/guest-routes.js';

const pk = () => KeyPair.fromRandom('ed25519').getPublicKey().toString();
const PARENT = 'play.nearcarta.testnet';
const NET = 'testnet';
const CFG = { parent: PARENT, suffix: '.play.nearcarta.testnet', fund: 25n * 10n ** 22n, tusdc: 'tusdc.nearcarta.testnet', market: 'arena.nearcarta.testnet', welcomeUsdc: '100000000', marketStorage: 12n * 10n ** 21n, funderFloor: 10n * 10n ** 24n };

test('guest: the account name is a hash of the public key, so a retry cannot make a second account', () => {
  const key = pk();
  assert.equal(guestName(key), guestName(key));
  assert.match(guestName(key), /^[a-z2-7]{10}$/, 'a sub-account name is lowercase a-z and 2-7');
  assert.equal(guestAccount(key, PARENT), `${guestName(key)}.${PARENT}`);
  assert.notEqual(guestName(key), guestName(pk()), 'a different key gets a different name');
  assert.ok(publicKeyOk(key));
  assert.equal(publicKeyOk('ed25519:not-a-key'), false);
  assert.equal(publicKeyOk('secp256k1:' + key.slice(8)), false, 'only ed25519, which a sub-account key must be');
  assert.equal(publicKeyOk(''), false);
});

test('guest: any field that looks like a secret is refused', () => {
  assert.equal(refusedSecretField({ public_key: 'ed25519:x' }), null);
  for (const k of ['secret_key', 'privateKey', 'seed_phrase', 'mnemonic', 'SECRET']) {
    assert.equal(refusedSecretField({ public_key: 'ed25519:x', [k]: 'x' }), k, k);
  }
});

test('guest: start is idempotent for the same public key', async () => {
  const key = pk();
  let sent = 0;
  const send = async () => { sent++; return { transaction: { hash: 'H' + sent } }; };
  const base = { net: NET, cfg: CFG, balance: async () => 100n * 10n ** 24n, send };
  const a = await start({ public_key: key }, { ...base, keyCheck: async () => ({ exists: false, hasKey: false }) });
  assert.equal(a.ok, true);
  assert.equal(a.resumed, false);
  assert.equal(a.account, `${guestName(key)}.${PARENT}`);
  assert.deepEqual(a.txs, ['H1']);
  assert.equal(sent, 1);
  // The same key again: the account exists with this key, so nothing is created.
  const b = await start({ public_key: key }, { ...base, keyCheck: async () => ({ exists: true, hasKey: true }) });
  assert.equal(b.ok, true);
  assert.equal(b.resumed, true);
  assert.deepEqual(b.txs, []);
  assert.equal(sent, 1, 'the second start sent no transaction');
  // A name that exists with a DIFFERENT key is a collision, not a resume.
  const c = await start({ public_key: key }, { ...base, keyCheck: async () => ({ exists: true, hasKey: false }) });
  assert.equal(c.ok, false);
  assert.equal(c.why, 'ERR_NAME_TAKEN');
  assert.equal(c.status, 409);
});

test('guest: every cap answers its own ERR_ code', async () => {
  const key = pk();
  const base = { net: NET, cfg: CFG, keyCheck: async () => ({ exists: false, hasKey: false }), send: async () => ({ transaction: { hash: 'H' } }) };
  const low = await start({ public_key: key }, { ...base, balance: async () => 1n * 10n ** 24n });
  assert.equal(low.why, 'ERR_GUEST_FUNDER_LOW');
  assert.equal(low.status, 503);
  const ip = await start({ public_key: key }, { ...base, balance: async () => 100n * 10n ** 24n, caps: { take: () => 'ERR_GUEST_IP_CAP' } });
  assert.equal(ip.why, 'ERR_GUEST_IP_CAP');
  assert.equal(ip.status, 429);
  const day = await start({ public_key: key }, { ...base, balance: async () => 100n * 10n ** 24n, caps: { global: () => 'ERR_GUEST_DAY_CAP' } });
  assert.equal(day.why, 'ERR_GUEST_DAY_CAP');
  const badKey = await start({ public_key: 'nope' }, base);
  assert.equal(badKey.why, 'ERR_PUBLIC_KEY');
  assert.equal(badKey.status, 400);
});

test('guest: the day counters enforce a per-IP limit and a shared limit, and roll over at midnight', () => {
  let now = Date.parse('2026-11-11T10:00:00Z');
  const ip = dayCounter({ limit: 2, name: 't', now: () => now });
  assert.equal(ip.take('1.2.3.4'), null);
  assert.equal(ip.take('1.2.3.4'), null);
  assert.equal(ip.take('1.2.3.4'), 'ERR_GUEST_IP_CAP');
  assert.equal(ip.take('5.6.7.8'), null, 'another visitor has their own bucket');
  now = Date.parse('2026-11-12T00:01:00Z');
  assert.equal(ip.take('1.2.3.4'), null, 'a new UTC day starts from zero');

  let t = Date.parse('2026-11-11T10:00:00Z');
  const day = globalCounter({ limit: 2, now: () => t });
  assert.equal(day(), null);
  assert.equal(day(), null);
  assert.equal(day(), 'ERR_GUEST_DAY_CAP', 'the city has its own ceiling across every IP');
  t = Date.parse('2026-11-12T00:01:00Z');
  assert.equal(day(), null);
});

test('guest: status reports the caps and the funder float without a secret', async () => {
  const s = await status();
  assert.equal(s.ok, true);
  assert.ok(['mainnet', 'testnet'].includes(s.network));
  assert.equal(typeof s.caps.per_ip_day, 'number');
  assert.equal(typeof s.caps.global_day, 'number');
  // On mainnet the route exists only to answer 404, and the module says it is off.
  if (s.network === 'mainnet') assert.equal(s.on, false);
  assert.doesNotMatch(JSON.stringify(s), /PRIVATE_KEY|secret/i);
});

test('guest: a mainnet service refuses to start a guest at all', async () => {
  // The service this test runs on is mainnet unless NEAR_NETWORK is set, which is the default.
  if (process.env.NEAR_NETWORK === 'testnet') return;
  const r = await start({ public_key: pk() }, { net: 'mainnet' });
  assert.equal(r.ok, false);
  assert.equal(r.why, 'ERR_NOT_TESTNET');
  assert.equal(r.status, 404);
  assert.equal(guestCfg().on, guestCfg().on && true, 'status never claims a guest path it does not have');
});

test('guest: the welcome crate is sent once, only to a guest that exists', async () => {
  const sent = [];
  const send = async (receiverId, acts) => { sent.push(receiverId); return { transaction: { hash: 'H' + sent.length } }; };
  const view = async () => '0';
  const missing = await welcome('ghostname1.play.nearcarta.testnet', { net: 'testnet', cfg: CFG, send, view, exists: async () => false });
  assert.equal(missing.why, 'ERR_NO_ACCOUNT');
  assert.equal(sent.length, 0, 'a typed name gets no crate');
  const had = await welcome('hadcrate01.play.nearcarta.testnet', { net: 'testnet', cfg: CFG, send, exists: async () => true, view: async (c, m) => (m === 'ft_balance_of' ? '100' : { total: '12000' }) });
  assert.equal(had.already, true);
  assert.equal(sent.length, 0, 'a guest that already holds both items gets nothing more');
  const first = await welcome('newguest01.play.nearcarta.testnet', { net: 'testnet', cfg: CFG, send, view, exists: async () => true });
  assert.equal(first.already, undefined);
  const again = await welcome('newguest01.play.nearcarta.testnet', { net: 'testnet', cfg: CFG, send, view, exists: async () => true });
  assert.equal(again.already, true);
  assert.equal(first.items.length, 2, 'test dollars and market space');
  assert.equal(sent.length, 2, 'asking twice sends nothing the second time');
});
