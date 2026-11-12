// F36: a returning Market Day account whose market storage was used up sent the Ferry gather, the
// market panicked ERR_STORAGE after the relayer paid, and the city painted only 'http 200'. Now the
// storage is topped up before each move, a refusal tops up and tries once more, and the relayer's
// 200 + ok:false answer comes back as the chain's ERR_ code with its hash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { precheck, goodsOf } from '../../../shared/relay/precheck.js';
const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const live = read('app/src/market/live-play.js');
const src = live.slice(live.indexOf('const PRE ='), live.indexOf('// The real move behind'));
const make = () => new Function('precheck', 'goodsOf', 'MILLI', 'live', 'setTimeout', `${src}; return { market, topUp };`)(precheck, goodsOf, 10n ** 21n, { account: 'acc' }, (f) => f());
const M = 10n ** 21n;
const gather = [{ method: 'gather', args: { node: 'ferry-1' }, tgas: 15 }];
function fakeL({ storage = 0n, fails = [] } = {}) {
  const L = { storage, sessions: 0, moves: 0 };
  L.view = async (m) => {
    if (m === 'storage_balance_of') return String(L.storage);
    if (m === 'square') return { purse: '0', rules: {}, stalls: [] };
    return [];
  };
  L.ensureSession = async () => { L.sessions++; if (L.storage < 6n * M) L.storage = 12n * M; return { ok: true }; };
  L.move = async () => { L.moves++; const f = fails.shift(); return f ? { ok: false, hash: 'H' + L.moves, failure: f } : { ok: true, hash: 'OK' + L.moves }; };
  return L;
}

test('F36: an empty market storage is topped up before the gather is sent', async () => {
  const { market } = make(); const L = fakeL({ storage: 0n });
  const r = await market(L, gather);
  assert.equal(r.ok, true); assert.equal(r.hash, 'OK1'); assert.equal(L.sessions, 1); assert.equal(L.moves, 1);
});
test('F36: enough storage sends straight away (no relayer session call)', async () => {
  const { market } = make(); const L = fakeL({ storage: 9n * M });
  assert.equal((await market(L, gather)).hash, 'OK1'); assert.equal(L.sessions, 0);
});
test('F36: a chain ERR_STORAGE refusal tops up and tries once more; a second refusal is a clear error', async () => {
  const { market } = make();
  const L = fakeL({ storage: 9n * M, fails: ['{"ExecutionError":"Smart contract panicked: ERR_STORAGE: deposit storage first"}'] });
  assert.equal((await market(L, gather)).hash, 'OK2'); assert.equal(L.sessions, 1);
  const L2 = fakeL({ storage: 9n * M, fails: ['ERR_STORAGE: x', 'ERR_STORAGE: x'] });
  await assert.rejects(market(L2, gather), (e) => e.code === 'ERR_STORAGE' && /market space/.test(e.message) && e.hash === 'H2');
  const L3 = fakeL({ storage: 9n * M, fails: ['ERR_TOO_SOON'] });
  await assert.rejects(market(L3, gather), (e) => e.code === 'ERR_TOO_SOON' && L3.moves === 1);
});
test('F36: a relayer that cannot open the space says so (no silent http 200)', async () => {
  const { market } = make(); const L = fakeL({ storage: 0n });
  L.ensureSession = async () => { throw Object.assign(new Error('ERR_SESSION_DAILY_CAP'), { code: 'ERR_SESSION_DAILY_CAP' }); };
  await assert.rejects(market(L, gather), (e) => e.code === 'ERR_STORAGE' && e.why === 'ERR_SESSION_DAILY_CAP' && L.moves === 0);
});
test('F36: the relayer precheck stops a gather or a sale with no market storage', () => {
  const s = { purse: 0n, bag: { 'good:salt': 3 }, storage: 0n };
  assert.equal(precheck(gather, s).why, 'ERR_PRECHECK_STORAGE');
  assert.equal(precheck([{ method: 'sell', args: { good: 'good:salt', qty: 3 } }], s).why, 'ERR_PRECHECK_STORAGE');
  assert.equal(precheck(gather, { ...s, storage: M }).ok, true);
  assert.equal(precheck(gather, { purse: 0n, bag: {} }).ok, true); // storage unread: the move goes
});
test('F36: the signing bundle returns a sent-but-refused move instead of throwing http 200', () => {
  const play = read('app/house/play.js');
  assert.match(play, /if \(r\.ok && j\.ok === false && j\.hash\) return j;/);
  assert.match(play, /j\.failure\?\.match\(\/ERR_\[A-Z_\]\+\/\)/);
  for (const m of ['cargo', 'sell', 'invest']) assert.ok(live.includes(`id === '${m}'`));
  assert.equal((live.match(/await market\(L, /g) || []).length, 5);
  assert.equal((live.match(/check\(await send\(/g) || []).length, 2); // only inside market()
});
