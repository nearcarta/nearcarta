import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pastPrompts, ARENA } from '../../src/arena.js';
import { TESTNET_DEP } from '../../src/config.js';
const DEP = TESTNET_DEP;
import { PAST3 } from '../../../shared/arena/prompts3.js';
const sha = s => createHash('sha256').update(s).digest('hex');
test('arena3 (NEP-245) is the served arena; first season stays as history', async () => {
  assert.equal(ARENA, 'arena3-370128340.testnet'); assert.equal(DEP.arena.contract, ARENA);
  assert.equal(DEP.arena_v1.contract, 'arena.r6vamvr9brhx-arena2.testnet');
  const chainOf = C => C === ARENA ? PAST3.map(p => ({ player: 'p', token_id: 'g1', prompt_hash_hex: p.prompt ? sha(p.prompt) : 'x', verdict: p.verdict, revealed: !!p.prompt }))
    : [{ player: 'q', token_id: 'g1', prompt_hash_hex: 'y', verdict: 'C1_CAP', revealed: false }];
  const body = await pastPrompts(async (C, m, { attempt_id }) => chainOf(C)[attempt_id] || null, 1);
  assert.equal(body.contract, ARENA); assert.equal(body.prompts[0].contract, ARENA);
  assert.equal(body.prompts.at(-1).contract, DEP.arena_v1.contract);
  assert.ok(body.prompts.filter(p => p.contract === ARENA && p.prompt).length >= 8);
});
