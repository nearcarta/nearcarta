import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl';
import { keyFrom, pubkeyHex, AGENT_LS, storedAgentKey, signMessage } from '../../../shared/vault/tx.js';
import { proposalMessage } from '../../../shared/board/message.js';
import {
  AGENT_METHODS,
  SESSION_METHODS,
  GAS_ALLOWANCE_YOCTO,
  GAS_TOPUP_YOCTO,
  agentMethodsReady,
  classifyBoardAgentKeys,
  renewAgentKeyActions,
} from '../../../shared/board/session.js';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const BOARD = 'board.nearcarta.near';

test('agentMethodsReady needs every session method entry, or an empty list', () => {
  assert.equal(agentMethodsReady([]), true);
  assert.equal(agentMethodsReady(undefined), true);
  assert.equal(agentMethodsReady(['propose']), false);
  assert.equal(agentMethodsReady(['propose_call']), false);
  assert.equal(agentMethodsReady(['propose', 'propose_call']), false);
  // The three agent methods alone are stale now: the hold path needs confirm_hold.
  assert.equal(agentMethodsReady(['propose', 'propose_call', 'propose_call_as']), false);
  assert.equal(agentMethodsReady(['propose', 'propose_call', 'propose_call_as', 'confirm_hold']), true);
  assert.equal(agentMethodsReady(['propose_call', 'propose', 'propose_call_as', 'confirm_hold', 'extra']), true);
  assert.deepEqual(AGENT_METHODS, ['propose', 'propose_call', 'propose_call_as']);
  assert.deepEqual(SESSION_METHODS, ['propose', 'propose_call', 'propose_call_as', 'confirm_hold']);
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
      access_key: { permission: { FunctionCall: { receiver_id: BOARD, method_names: ['propose', 'propose_call', 'propose_call_as'], allowance: '1' } } },
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
  assert.deepEqual(actions[2].params.accessKey.permission.methodNames, ['propose', 'propose_call', 'propose_call_as']);
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


test('refresh replaces a ready board key with 0.25 NEAR of gas and does not touch rules', () => {
  assert.equal(GAS_TOPUP_YOCTO, (10n ** 24n / 4n).toString());
  const actions = renewAgentKeyActions({
    stalePublicKeys: ['ed25519:BzdHuEoDReady'],
    newPublicKey: 'ed25519:Fresh',
    boardContract: BOARD,
    methodNames: AGENT_METHODS,
    allowance: GAS_TOPUP_YOCTO,
  });
  assert.equal(actions[0].type, 'DeleteKey');
  assert.equal(actions[0].params.publicKey, 'ed25519:BzdHuEoDReady');
  assert.equal(actions[1].type, 'AddKey');
  assert.equal(actions[1].params.accessKey.permission.allowance, GAS_TOPUP_YOCTO);
  assert.deepEqual(actions[1].params.accessKey.permission.methodNames, ['propose', 'propose_call', 'propose_call_as']);
  const src = read('app/house/setup.js');
  const fn = src.slice(src.indexOf('async function refreshAgentKey'), src.indexOf('function bindRefreshKey'));
  assert.match(fn, /GAS_TOPUP_YOCTO/);
  assert.match(fn, /set_agent/);
  assert.match(fn, /agent: agentHex/);
  assert.match(fn, /localStorage\.setItem\(agentLS\(me\), fresh\.secretKey\)/);
  assert.ok(fn.indexOf('localStorage.setItem(agentLS(me), fresh.secretKey)') < fn.indexOf('agentAccessKey(fresh.secretKey)'));
  assert.match(fn, /chainRow = rowNow/);
  assert.match(fn, /String\(rowNow\.agent \|\| ''\) === agentHex/);
  assert.doesNotMatch(fn, /set_rules/);
  assert.doesNotMatch(fn, /methodName: 'fund'/);
  assert.match(src, /setup-refresh-key/);
  assert.match(src, /Refresh agent key/);
  assert.match(src, /setup-gas-left/);
  assert.match(src, /Session gas left/);
  assert.match(src, /bindRefreshKey/);
  const sign = src.slice(src.indexOf('function wireSign'), src.indexOf('function wireTry'));
  assert.match(sign, /bindRefreshKey/);
});

test('wireSign binds Renew agent key on the Sign step (not only wireTry)', () => {
  const src = read('app/house/setup.js');
  const sign = src.slice(src.indexOf('function wireSign'), src.indexOf('function wireTry'));
  assert.match(sign, /bindRenewKey/);
  assert.match(sign, /setup-renew-key-btn|renew-key/);
  const bind = src.slice(src.indexOf('function bindRenewKey'), src.indexOf('globalThis.__ncRenewAgentKey'));
  assert.match(bind, /act\(e\.currentTarget/);
  assert.match(bind, /renewAgentKey/);
  assert.match(src, /setup-renew-status/);
  assert.match(src, /console\.error\('\[setup\] renewAgentKey/);
});

test('after renew, propose signatures verify against the new key', () => {
  const oldK = keyFrom();
  const fresh = keyFrom();
  const account = 'scholar.test.near';
  const box = new Map([[AGENT_LS(account), oldK.secretKey]]);
  const getItem = k => box.get(k) ?? null;
  // Refresh and Renew write the new secret into the one vault slot. The next propose reads that slot.
  box.set(AGENT_LS(account), fresh.secretKey);
  const key = storedAgentKey(getItem, account);
  assert.equal(pubkeyHex(key), pubkeyHex(fresh));
  const message = proposalMessage({
    contract: 'board.nearcarta.near', owner: account, receiver: 'charter.nearcarta.near',
    amount: '2000000000000000000000', nonce: '9',
  });
  const signature = signMessage(key, message);
  const msg = new TextEncoder().encode(message);
  const sig = Uint8Array.from(signature.match(/../g), h => parseInt(h, 16));
  assert.equal(nacl.sign.detached.verify(msg, sig, fresh._pk), true);
  assert.equal(nacl.sign.detached.verify(msg, sig, oldK._pk), false);
  const apps = read('app/design/D8_shops/js/apps.js');
  assert.match(apps, /const agent = \(\) => W\.storedAgentKey/);
  const pay = apps.slice(apps.indexOf('async function boardPay'), apps.indexOf('export async function ask'));
  assert.match(pay, /await view\(S\.board, 'get_charter'/);
  assert.doesNotMatch(pay, /S\.boardRow \|\|/);
  assert.ok(pay.indexOf('await view(S.board, \'get_charter\'') < pay.indexOf('const key = agent()'));
  assert.ok(pay.indexOf('const key = agent()') < pay.indexOf('W.signMessage(key'));
  assert.match(pay, /pubkeyHex\(key\) !== String\(row\.agent/);
  const calls = apps.slice(apps.indexOf('export async function ferryProposeCalls'), apps.indexOf('export async function sessionAllowance'));
  const loop = calls.slice(calls.indexOf('for (let i = 0'));
  assert.ok(loop.indexOf('const key = agent()') >= 0 && loop.indexOf('const key = agent()') < loop.indexOf('W.signMessage(key'));
  const setup = read('app/house/setup.js');
  const ask = setup.slice(setup.indexOf('async function boardAsk'), setup.indexOf('function wireTry'));
  assert.ok(ask.indexOf("viewFn(rpcCall, contract, 'get_charter'") < ask.indexOf('storedAgentKey'));
  assert.ok(ask.indexOf('storedAgentKey') < ask.indexOf('signMessage(key'));
  const refresh = setup.slice(setup.indexOf('async function refreshAgentKey'), setup.indexOf('function bindRefreshKey'));
  assert.match(refresh, /syncPluginAgent\(me, fresh\.secretKey\)/);
  const plugin = read('app/house/board-key.js');
  assert.match(plugin, /AGENT_LS\(accountId\)/);
  assert.match(plugin, /keyFrom\(vault \|\| stored\.privateKey\)/);
});
