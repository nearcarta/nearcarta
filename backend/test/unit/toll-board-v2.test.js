import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  CALL_AS_VERSION, BOARD_V2, injectRowOwner, effectsCanon, callAsMessage, refundActionArgs, settleArgs, unitsOf, crossArgs,
} from '../../../shared/board/call-as.js';

const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

test('board v2 injects the top-level row_owner and the signed text matches the contract', () => {
  const nested = '{"amount":"1","note":{"row_owner":"mallory.near"}}';
  const injected = injectRowOwner(nested, 'visitor.near');
  assert.equal(injected, '{"amount":"1","note":{"row_owner":"mallory.near"},"row_owner":"visitor.near"}');
  assert.throws(() => injectRowOwner('[]', 'visitor.near'), /ERR_ARGS/);
  const args = crossArgs({
    actionId: '4', chain: 'base', asset: 'native', to: '0x2222222222222222222222222222222222222222',
    amount: '10000000000000', rowBudget: '10000000000000',
  });
  const effects = [{ chain: 'base', asset: 'native', to: '0x2222222222222222222222222222222222222222', value: '10000000000000', fee: '0' }];
  const msg = callAsMessage({
    network: 'mainnet', contract: 'board.nearcarta.near', owner: 'visitor.near', receiver: 'toll.nearcarta.near',
    method: 'cross', args, deposit: '5', nonce: '4', expiry: '9', epoch: '0', effects, hold: false,
  });
  const hashed = hex(sha256(new TextEncoder().encode(injectRowOwner(args, 'visitor.near'))));
  assert.equal(CALL_AS_VERSION, '2');
  assert.equal(effectsCanon(effects), 'base|native|0x2222222222222222222222222222222222222222|10000000000000|0');
  assert.equal(effectsCanon([]), '-');
  assert.equal(msg, [
    'board-call-as-v1', 'mainnet', 'board.nearcarta.near', '2', 'visitor.near', 'toll.nearcarta.near', 'cross', hashed,
    '5', '4', '9', '0', 'base|native|0x2222222222222222222222222222222222222222|10000000000000|0', 'exec',
  ].join('|'));
  assert.deepEqual(BOARD_V2, {
    open: 'propose_call_as', confirm: 'confirm_hold', cancel: 'cancel_hold', expire: 'expire_sent', refund: 'refund_action', settle: 'settle',
  });
  assert.deepEqual(refundActionArgs('visitor.near', 4), { owner: 'visitor.near', action_id: '4' });
  assert.deepEqual(settleArgs('visitor.near', 4), { owner: 'visitor.near', action_id: '4' });
  assert.equal(unitsOf('0.00001', 18), '10000000000000');
  assert.equal(unitsOf('1', 6), '1000000');
  assert.throws(() => unitsOf('1.0000001', 6));
});

test('the toll refund promise uses refund_action and not a visitor allow list', () => {
  const src = readFileSync(new URL('../../../contracts/toll/src/lib.rs', import.meta.url), 'utf8');
  const refund = src.slice(src.indexOf('pub fn refund_order'), src.indexOf('pub fn withdraw_surplus'));
  assert.match(refund, /refund_action/);
  assert.match(refund, /"owner"/);
  assert.match(refund, /"action_id"/);
  assert.doesNotMatch(refund, /credit_row/);
  assert.match(src, /confirm_hold/);
  assert.match(src, /cancel_hold/);
  assert.match(src, /expire_sent/);
  const cross = src.slice(src.indexOf('pub fn cross'), src.indexOf('pub fn sign_cross'));
  assert.match(cross, /only the board can open a crossing/);
  assert.doesNotMatch(cross, /allow_to/);
});

test('toll-deploy is a dry-run and does not print a signer key', () => {
  const script = fileURLToPath(new URL('../../../scripts/toll-deploy.js', import.meta.url));
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  const secret = 'ed25519:this-is-not-a-real-key-and-must-not-appear';
  const dry = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    cwd: root,
    env: { ...process.env, TOLL_SIGNER_KEY: secret },
    timeout: 120000,
  });
  assert.equal(dry.status, 0, dry.stderr);
  assert.doesNotMatch(dry.stdout + dry.stderr, /this-is-not-a-real-key/);
  assert.doesNotMatch(dry.stdout, /ed25519:/);
  const report = JSON.parse(dry.stdout.slice(0, dry.stdout.lastIndexOf('}') + 1).replace(/^[^{]*/, ''));
  assert.equal(report.dry_run, true);
  assert.equal(report.account, 'toll.nearcarta.near');
  assert.equal(report.owner, 'nearcarta.near');
  assert.ok(report.wasm.bytes > 0);
  assert.match(report.wasm.sha256, /^[0-9a-f]{64}$/);
  assert.ok(report.balance.shop_before_near || report.balance.recorded_locked_near);
  for (const t of report.transfers) {
    assert.ok(t.payee === 'nearcarta.near' || t.payee === 'toll.nearcarta.near');
  }
  assert.equal(report.smoke.sends, false);
  assert.equal(report.smoke.to, null);
  assert.ok(report.wasm.bytes < 240000);
  assert.equal(report.balance.shortfall_near, '0');
  // Once the live code is this wasm the script has nothing to deploy, so it
  // reports the account and stops. The dry-run guarantees below hold either way.
  assert.ok(['view', 'close_then_create', 'create_only', 'upgrade_then_migrate'].includes(report.path));
  if (report.path === 'view') {
    assert.equal(report.init, null);
    assert.deepEqual(report.transfers, []);
  } else {
    assert.deepEqual(report.init.allow_to, []);
    const stake = report.prechecks.find(p => p.check === 'balance covers the new stake');
    assert.equal(stake && stake.ok, true);
    const slackCheck = report.prechecks.find(p => p.check === 'slack');
    assert.equal(slackCheck && slackCheck.ok, true);
    const ONE = 10n ** 24n;
    const slack = BigInt(report.storage.slack_yocto);
    assert.equal(slack, 2n * ONE / 100n);
    assert.ok(slack <= 5n * ONE / 100n);
    const create = report.transfers.find(t => t.step === 'create_account');
    const close = report.transfers.find(t => t.step === 'close');
    assert.equal(create.payee, 'toll.nearcarta.near');
    assert.equal(close.payee, 'nearcarta.near');
    assert.equal(BigInt(create.amount_yocto), BigInt(report.storage.stake_after_yocto) + slack);
    assert.equal(close.amount_yocto, report.balance.shop_before_yocto);
    assert.ok(BigInt(close.amount_yocto) > BigInt(create.amount_yocto));
    assert.equal(report.balance.shop_after_liquid_near, '0.02');
    assert.equal(create.slack_near, '0.02');
  }
  const refused = spawnSync(process.execPath, [script, '--live'], {
    encoding: 'utf8',
    cwd: root,
    env: { ...process.env, TOLL_SIGNER_KEY: '' },
    timeout: 120000,
  });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /TOLL_SIGNER_KEY/);
  assert.doesNotMatch(refused.stdout + refused.stderr, /this-is-not-a-real-key/);
});
