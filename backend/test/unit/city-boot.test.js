import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');

// The city loads JS straight from the served tree, so a module the build never
// publishes is a dead shop. These three regressions each took the whole city
// down: a bare package specifier, a ../../../shared path, and a deed route that
// read a config key mainnet.json never had.
test('a browser module has no bare package import or unpublished shared path', () => {
  const boardCallAs = read('app/src/board-call-as.js');
  assert.doesNotMatch(boardCallAs, /from '@noble\//);
  assert.match(boardCallAs, /from '\.\/sha256\.js'/);
  const guardAgent = read('app/src/panels/guard-agent.js');
  assert.doesNotMatch(guardAgent, /from '\.\.\/\.\.\/\.\.\/shared\//);
  assert.match(guardAgent, /from '\.\.\/board-pay\.js'/);
});

test('the guard board call exists where the browser can load it', () => {
  const app = read('app/src/board-pay.js');
  assert.match(app, /export function boardStep/);
  assert.match(app, /from '\.\/board-call-as\.js'/);
  const shared = read('shared/guard/board-pay.js');
  assert.match(shared, /from '\.\.\/\.\.\/app\/src\/board-pay\.js'/);
});

test('the shipped sha256 matches node:crypto on the board call text', async () => {
  const { sha256Hex } = await import('../../../app/src/sha256.js');
  const { callAsMessage, injectRowOwner } = await import('../../../app/src/board-call-as.js');
  const args = '{"token_id":"alice.near"}';
  const injected = injectRowOwner(args, 'alice.near');
  assert.equal(sha256Hex(injected), createHash('sha256').update(injected).digest('hex'));
  const msg = callAsMessage({
    network: 'mainnet', contract: 'board.nearcarta.near', owner: 'alice.near', receiver: 'house.nearcarta.near',
    method: 'house_session_check_in', args, deposit: '1', nonce: '4', expiry: '9', epoch: '0', effects: [], hold: false,
  });
  assert.match(msg, /^board-call-as-v1\|mainnet\|board\.nearcarta\.near\|2\|alice\.near\|house\.nearcarta\.near\|house_session_check_in\|[0-9a-f]{64}\|1\|4\|9\|0\|-\|exec$/);
});

test('a retired oath answers 404, not 500', async () => {
  const { snapshot } = await import('../../../backend/src/guardhouse.js');
  await assert.rejects(() => snapshot('charter.nearcarta.near'), e => e.status === 404 && /retired/.test(e.message));
});
