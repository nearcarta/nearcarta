import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { sha256Hex } from '../../../app/src/sha256.js';
import { callAsMessage, injectRowOwner, setSha256Hex } from '../../../app/src/board-call-as.js';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

// The city loads JS straight from the served tree, so a module the build never
// publishes is a dead shop. Each of these regressions took the whole city down:
// a bare package specifier, and a shared path the build never copies.
test('a browser module has no bare package import or unpublished shared path', () => {
  const boardCallAs = read('app/src/board-call-as.js');
  assert.doesNotMatch(boardCallAs, /from '@noble\//);
  const guardAgent = read('app/src/panels/guard-agent.js');
  assert.doesNotMatch(guardAgent, /from '\.\.\/\.\.\/\.\.\/shared\//);
  // The live executor is served next to the panel that imports it, and the tray and the
  // agent both reach the chain through it (one validated plan, one signature, one send).
  assert.match(guardAgent, /sendPay/);
  assert.ok(read('app/src/panels/guard-live.js').length > 0);
  const live = read('app/src/panels/guard-live.js');
  assert.doesNotMatch(live, /from '\.\.\/\.\.\/\.\.\/shared\//, 'the served executor must not import outside app/');
  assert.match(live, /propose_call_as/);
  assert.match(live, /confirm_hold/);
});

test('the guard board call is served next to the panel that imports it', () => {
  const panel = read('app/src/panels/guard-board-pay.js');
  assert.match(panel, /export function boardStep/);
  const shared = read('shared/guard/board-pay.js');
  assert.match(shared, /from '\.\.\/\.\.\/app\/src\/panels\/guard-board-pay\.js'/);
});

test('the shipped sha256 matches node:crypto on the board call text', () => {
  setSha256Hex(sha256Hex);
  const args = '{"token_id":"alice.near"}';
  const injected = injectRowOwner(args, 'alice.near');
  assert.equal(sha256Hex(injected), createHash('sha256').update(injected).digest('hex'));
  const msg = callAsMessage({
    network: 'mainnet', contract: 'board.nearcarta.near', owner: 'alice.near', receiver: 'house.nearcarta.near',
    method: 'house_session_check_in', args, deposit: '1', nonce: '4', expiry: '9', epoch: '0', effects: [], hold: false,
  });
  assert.match(msg, /^board-call-as-v1\|mainnet\|board\.nearcarta\.near\|2\|alice\.near\|house\.nearcarta\.near\|house_session_check_in\|[0-9a-f]{64}\|1\|4\|9\|0\|-\|exec$/);
});

test('a retired oath answers the retired fact and the live board, never a 404 or a 500', async () => {
  const { snapshot } = await import('../../../backend/src/guardhouse.js');
  const s = await snapshot('charter.nearcarta.near');
  assert.equal(s.oath, null, 'no page may read a deleted contract as the current rules');
  assert.equal(s.retired, true, 'the room reads this flag instead of a 500');
  assert.equal(s.account, 'charter.nearcarta.near');
  assert.match(s.why, /retired/);
  assert.match(s.why, /nearcarta\.near/);
  assert.match(s.error, /retired/);
  assert.match(s.tx, /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  assert.equal(s.board, 'board.nearcarta.near');
  assert.match(s.note, /row on board\.nearcarta\.near/);
  assert.deepEqual(s.clauses, {});
  assert.equal(s.state, null);
});
