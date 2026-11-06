import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AGENT_METHODS,
  GAS_ALLOWANCE_YOCTO,
  agentMethodsReady,
  classifyBoardAgentKeys,
  renewAgentKeyActions,
} from '../../../shared/board/session.js';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const BOARD = 'board.nearcarta.near';

test('agentMethodsReady needs every AGENT_METHODS entry, or an empty list', () => {
  assert.equal(agentMethodsReady([]), true);
  assert.equal(agentMethodsReady(undefined), true);
  assert.equal(agentMethodsReady(['propose']), false);
  assert.equal(agentMethodsReady(['propose_call']), false);
  assert.equal(agentMethodsReady(['propose', 'propose_call']), true);
  assert.equal(agentMethodsReady(['propose_call', 'propose', 'extra']), true);
  assert.deepEqual(AGENT_METHODS, ['propose', 'propose_call']);
});

test('classifyBoardAgentKeys marks propose-only keys stale and flags renew', () => {
  const keys = [
    {
      public_key: 'ed25519:BZa3jcShStale',
      access_key: { permission: { FunctionCall: { receiver_id: BOARD, method_names: ['propose'], allowance: '1' } } },
    },
    {
      public_key: 'ed25519:GoFAZP3cStale',
      access_key: { permission: { FunctionCall: { receiver_id: BOARD, method_names: ['propose'], allowance: '1' } } },
    },
    {
      public_key: 'ed25519:OtherContract',
      access_key: { permission: { FunctionCall: { receiver_id: 'wrap.near', method_names: ['ft_transfer'], allowance: '1' } } },
    },
    {
      public_key: 'ed25519:FullAccessIgnored',
      access_key: { permission: 'FullAccess' },
    },
  ];
  const c = classifyBoardAgentKeys(keys, BOARD);
  assert.equal(c.board.length, 2);
  assert.equal(c.stale.length, 2);
  assert.equal(c.ready.length, 0);
  assert.equal(c.needsRenew, true);
  const readyKeys = [
    {
      public_key: 'ed25519:Ready',
      access_key: { permission: { FunctionCall: { receiver_id: BOARD, method_names: ['propose', 'propose_call'], allowance: '1' } } },
    },
  ];
  const ok = classifyBoardAgentKeys(readyKeys, BOARD);
  assert.equal(ok.needsRenew, false);
  assert.equal(ok.ready.length, 1);
});

test('renewAgentKeyActions deletes stale keys then adds propose+propose_call', () => {
  const actions = renewAgentKeyActions({
    stalePublicKeys: ['ed25519:BZa3jcShStale', 'ed25519:GoFAZP3cStale', 'ed25519:BZa3jcShStale'],
    newPublicKey: 'ed25519:NewAgent',
    boardContract: BOARD,
    methodNames: AGENT_METHODS,
    allowance: GAS_ALLOWANCE_YOCTO,
  });
  assert.equal(actions.length, 3);
  assert.deepEqual(actions[0], { type: 'DeleteKey', params: { publicKey: 'ed25519:BZa3jcShStale' } });
  assert.deepEqual(actions[1], { type: 'DeleteKey', params: { publicKey: 'ed25519:GoFAZP3cStale' } });
  assert.equal(actions[2].type, 'AddKey');
  assert.equal(actions[2].params.publicKey, 'ed25519:NewAgent');
  assert.deepEqual(actions[2].params.accessKey.permission.methodNames, ['propose', 'propose_call']);
  assert.equal(actions[2].params.accessKey.permission.receiverId, BOARD);
  assert.equal(actions[2].params.accessKey.permission.allowance, GAS_ALLOWANCE_YOCTO);
});

test('setup treats a key as ready only when every AGENT_METHODS entry is present', () => {
  const src = read('app/house/setup.js');
  assert.match(src, /agentMethodsReady\(fc\.method_names\)/);
  assert.doesNotMatch(src, /method_names\.includes\('propose'\) \? ak/);
  assert.match(src, /setup-renew-key/);
  assert.match(src, /Renew agent key/);
  assert.match(src, /renewAgentKeyActions/);
  assert.match(src, /view_access_key_list/);
});

test('Ferry shows a Setup renew link for key_cannot_propose_call, not the raw code alone', () => {
  const ui = read('app/design/D8_shops/js/shopui.js');
  assert.match(ui, /key_cannot_propose_call/);
  assert.match(ui, /your agent key cannot call propose_call yet/);
  assert.match(ui, /ferry-renew-setup/);
  const deep = read('app/src/panels/deep.js');
  assert.match(deep, /ferry-renew-setup/);
  assert.match(deep, /Renew agent key once in Setup/);
  const markup = deep.slice(deep.indexOf('ferry-charter-note'), deep.indexOf('ferry-charter-note') + 280);
  assert.match(markup, /renewSetup/);
});
