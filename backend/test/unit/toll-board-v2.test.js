import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  // The live account now runs the recorded wasm, so a plain run takes the read-only view path.
  // A one-byte copy of the wasm plans the recreate without asking the chain which build is deployed.
  const wasm = join(mkdtempSync(join(tmpdir(), 'toll-plan-')), 'toll.wasm');
  const bytes = readFileSync(new URL('../../../contracts/artifacts/toll.v7.wasm', import.meta.url));
  bytes[bytes.length - 1] ^= 0x01;
  writeFileSync(wasm, bytes);
  const dry = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    cwd: root,
    env: { ...process.env, TOLL_SIGNER_KEY: secret, TOLL_WASM: wasm },
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
  assert.equal(report.path, 'close_then_create');
  for (const t of report.transfers) {
    assert.ok(t.payee === 'nearcarta.near' || t.payee === 'toll.nearcarta.near');
  }
  // A view carries no init args; a create does, and they must name no allow list.
  if (report.init) assert.deepEqual(report.init.allow_to, []);
  else assert.equal(report.path, 'view');
  assert.equal(report.smoke.sends, false);
  assert.equal(report.smoke.to, null);
  assert.ok(report.wasm.bytes < 240000);
  const ONE = 10n ** 24n;
  const slack = BigInt(report.storage.slack_yocto);
  const stake = BigInt(report.storage.stake_after_yocto);
  assert.equal(slack, 2n * ONE / 100n);
  assert.ok(slack <= 5n * ONE / 100n);
  assert.ok(stake > 0n);
  assert.ok(['view', 'close_then_create', 'create_only', 'upgrade_then_migrate'].includes(report.path));
  const stakeCheck = report.prechecks.find(p => p.check === 'stake from the wasm');
  assert.equal(stakeCheck && stakeCheck.ok, true);
  const slackCheck = report.prechecks.find(p => p.check === 'slack');
  assert.equal(slackCheck && slackCheck.ok, true);
  // A view moves nothing. A create or a replace names its stake and its slack.
  const create = report.transfers.find(t => t.step === 'create_account');
  const close = report.transfers.find(t => t.step === 'close');
  if (report.path === 'view') {
    assert.deepEqual(report.transfers, []);
  } else {
    assert.equal(report.balance.shortfall_near, '0');
    const funded = report.prechecks.find(p => p.check === 'balance covers the stake and slack');
    assert.equal(funded && funded.ok, true);
  }
  if (create) {
    assert.equal(create.payee, 'toll.nearcarta.near');
    assert.equal(create.slack_near, '0.02');
    assert.equal(BigInt(create.amount_yocto), stake + slack);
  }
  if (close) {
    assert.equal(close.payee, 'nearcarta.near');
    assert.equal(close.amount_yocto, report.balance.shop_before_yocto);
    assert.ok(BigInt(close.amount_yocto) > BigInt(create.amount_yocto));
    assert.equal(report.balance.shop_after_liquid_near, '0.02');
  }
  const refused = spawnSync(process.execPath, [script, '--live'], {
    encoding: 'utf8',
    cwd: root,
    env: { ...process.env, TOLL_SIGNER_KEY: '', TOLL_WASM: wasm },
    timeout: 120000,
  });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /TOLL_SIGNER_KEY/);
  assert.doesNotMatch(refused.stdout + refused.stderr, /this-is-not-a-real-key/);
});
