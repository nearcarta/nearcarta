import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { minDepositYocto, factoryFundYocto, STATE_SLACK_BYTES, BYTE_YOCTO, REGISTRY_FEE_YOCTO } from '../../../shared/factory/lock.js';
import MAIN from '../../../shared/deployments/mainnet.json' with { type: 'json' };

test('visitor deposit is the wasm stake plus slack plus the registry fee', () => {
  const len = 425406;
  const y = minDepositYocto(len);
  assert.equal(y, (BigInt(len) + BigInt(STATE_SLACK_BYTES)) * BYTE_YOCTO + REGISTRY_FEE_YOCTO);
  assert.ok(y < 10n * 10n ** 24n);
  const fund = factoryFundYocto(1000, len);
  assert.ok(fund > BigInt(len) * BYTE_YOCTO);
});

test('mainnet.json names the lock factory and does not mark it deployed', () => {
  assert.equal(MAIN.factory.status, 'not_deployed');
  assert.equal(MAIN.factory.contract, 'factory.nearcarta.near');
  assert.equal(MAIN.factory.owner, MAIN.root);
  assert.match(readFileSync(new URL('../../../contracts/charter_factory_lock/src/lib.rs', import.meta.url), 'utf8'), /deploy_contract/);
  assert.match(readFileSync(new URL('../../../docs/MAINNET_FACTORY.md', import.meta.url), 'utf8'), /reap/);
});

test('the factory deploy script prints the plan and refuses to sign without a key', () => {
  const script = fileURLToPath(new URL('../../../backend/scripts/deploy-mainnet-factory.js', import.meta.url));
  const dry = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(dry.status, 0);
  assert.match(dry.stdout, /factory\.nearcarta\.near/);
  assert.match(dry.stdout, /does not sign/);
  assert.doesNotMatch(dry.stdout + dry.stderr, /ed25519:[1-9A-HJ-NP-Za-km-z]{20}/);
  const live = spawnSync(process.execPath, [script, '--live'], { encoding: 'utf8', env: { ...process.env, NEAR_MAINNET_SIGNER_KEY: '' } });
  assert.notEqual(live.status, 0);
  assert.match(live.stderr, /NEAR_MAINNET_SIGNER_KEY/);
  assert.doesNotMatch(live.stdout + live.stderr, /ed25519:[1-9A-HJ-NP-Za-km-z]{20}/);
});
