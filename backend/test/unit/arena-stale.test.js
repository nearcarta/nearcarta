import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { signedState } from '../../../shared/stale.js';
import { joinPrompts, pastPrompts, PAST as LIVE } from '../../src/arena.js';
import { sweepRecent } from '../../src/shops.js';
import { PAST } from '../../../shared/arena/prompts.js';
import { promptRows } from '../../../app/design/D8_shops/shops/arenalive.js';
import { tollRecordRows } from '../../../app/design/D8_shops/shops/tollrecords.js';

const sha = s => createHash('sha256').update(s).digest('hex');
const rec = { nonce: 0, status: 'signed', tx_hash: '0xab' };

test('signedState: never-broadcast record with no gas is expired', () => {
  assert.equal(signedState(rec, { known: false, mined: false, sender_nonce: 0, balance_wei: '0' }).state, 'expired');
  assert.equal(signedState(rec, { known: false, mined: false, sender_nonce: 1, balance_wei: '9' }).state, 'expired');
  assert.equal(signedState(rec, { known: true, mined: false, sender_nonce: 0, balance_wei: '9' }).state, 'pending');
  assert.equal(signedState(rec, { known: true, mined: true }).state, 'settling');
  assert.equal(signedState(rec, { known: false, mined: false, sender_nonce: 0, balance_wei: '9' }).state, 'pending');
  assert.equal(signedState(rec, null).state, 'pending');
  assert.equal(signedState({ ...rec, status: 'confirmed' }, null).state, 'confirmed');
});

test('sweepRecent keeps the chain word and leaves confirmed rows alone', async () => {
  const out = await sweepRecent([rec, { nonce: 1, status: 'confirmed' }], { verify_chain: 'Arbitrum', foreign_address: '0x1' }, async () => ({ known: false, mined: false, sender_nonce: 0, balance_wei: '0' }));
  assert.equal(out[0].status, 'expired'); assert.equal(out[0].chain_status, 'signed'); assert.match(out[0].stale_reason, /no gas/);
  assert.deepEqual(out[1], { nonce: 1, status: 'confirmed' });
  const down = await sweepRecent([rec], {}, async () => { throw new Error('rpc'); });
  assert.equal(down[0].status, 'pending');
});

test('joinPrompts shows text only when the hash matches and it is revealed', () => {
  const p = { id: 0, prompt: 'hello', verdict: 'C1_CAP', decision_tx: 'D', reveal_tx: 'R' };
  const [a] = joinPrompts([{ id: 0, prompt_hash_hex: sha('hello'), revealed: true, verdict: 'C1_CAP' }], [p]);
  assert.equal(a.prompt, 'hello'); assert.equal(a.outcome, 'refused'); assert.equal(a.decision.tx, 'D');
  const [b] = joinPrompts([{ id: 0, prompt_hash_hex: sha('other'), revealed: true }], [p]);
  assert.equal(b.prompt, null);
  const [c] = joinPrompts([{ id: 0, prompt_hash_hex: sha('hello'), revealed: false }], [p]);
  assert.equal(c.prompt, null);
  assert.equal(joinPrompts([{ id: 1, prompt_hash_hex: 'x', verdict: 'C0_FROZEN' }], [])[0].outcome, 'held');
});

test('corpus: every past prompt has a decision tx; the bounty text is never in it', () => {
  assert.equal(PAST.length, 31);
  for (const p of PAST) { assert.ok(p.decision_tx, `#${p.id}`); assert.ok(p.attempt_tx); }
  assert.equal(PAST.find(p => p.id === 12).prompt, null);
  assert.equal(PAST.filter(p => p.reveal_tx).length, 30);
});

test('pastPrompts reads the mainnet arena once and caches', async () => {
  let n = 0; const v = async (_a, _m, { attempt_id }) => {
    n++;
    const p = LIVE[attempt_id];
    if (_a !== 'arena.nearcarta.near' || !p) throw new Error('none');
    return { prompt_hash_hex: p.prompt ? sha(p.prompt) : 'x', revealed: !!p.prompt, verdict: p.verdict };
  };
  const d = await pastPrompts(v, 3e12);
  assert.equal(d.contract, 'arena.nearcarta.near');
  assert.equal(d.history_contract, null);
  assert.equal(d.count, LIVE.length);
  assert.equal(d.shown, LIVE.filter(p => p.prompt).length);
  assert.equal(d.prompts[0].id, LIVE.length - 1);
  const calls = n; await pastPrompts(v, 3e12 + 1000); assert.equal(n, calls);
});

test('room rows escape text and mark expired', () => {
  const h = promptRows([{ id: 3, prompt: '<b>x', outcome: 'refused', verdict: 'C7', decision: { tx: 'ABCDEFG', url: 'u' } }]);
  assert.match(h, /&lt;b&gt;x/); assert.match(h, /refused/);
  const t = tollRecordRows({ oath: 'toll.t', recent: [], instances: [{ label: 'arbitrum', oath: 'arb.t', verify_chain: 'Arbitrum', recent: [{ nonce: 0, status: 'expired', chain_status: 'signed', stale_reason: 'no gas', tx_hash: '0x6ff1' }] }] });
  assert.match(t, /expired/); assert.match(t, /arbiscan/); assert.match(t, /on NEAR still signed/);
});

test('a payee off the recorded list is not a mainnet badge', async () => {
  const { previewPayee } = await import('../../src/board-guard.js');
  const row = previewPayee({ receivers: ['nearcarta.near'] }, 'stranger.near');
  assert.equal(row.decision, 'would refuse');
  assert.equal(row.preview, true);
});
