import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl';
import { parseBankAgent, BANK_HINT } from '../../../app/src/panels/bank-agent.js';
import { sealText, revealArgs } from '../../../shared/board/bank-seal.js';
import { verifyResponseSignature, proofFile, bankProve, NO_RETENTION } from '../../../backend/src/bank-proof.js';
import { armBankDock, dispatchBankDock, installBankDock } from '../../../app/src/panels/bank-dock.js';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

test('a private send line picks the note and a miss shows the hint', () => {
  const send = parseBankAgent('Send 0.001 NEAR privately');
  assert.equal(send.ok, true);
  assert.equal(send.action, 'send');
  assert.equal(Number(send.amount), 0.001);
  assert.equal(parseBankAgent('Verify the TEE').action, 'tee');
  assert.equal(parseBankAgent('Verify TEE now').action, 'tee');
  assert.equal(parseBankAgent('Verify the seal').action, 'seal');
  assert.equal(parseBankAgent('Show the attestation file').action, 'file');

  const miss = parseBankAgent('hello');
  assert.equal(miss.ok, false);
  assert.equal(miss.hint, BANK_HINT);

  const notes = [0.001, 0.002, 0.005];
  const off = parseBankAgent('Send 1 NEAR privately', { notes });
  assert.equal(off.ok, false);
  assert.match(off.hint, /0\.001/);
  assert.match(off.hint, /0\.002/);
  assert.match(off.hint, /0\.005/);
  assert.match(off.hint, /Nothing was sent/);

  const over = parseBankAgent('Send 0.005 NEAR privately', { notes, capNear: 0.002 });
  assert.equal(over.ok, false);
  assert.ok(over.hint.includes('over your cap'));
  assert.ok(over.hint.includes('Nothing was sent'));
});

test('the sealed rule text matches the board and stays hidden in the reveal args', () => {
  const rule = { contract: 'board.nearcarta.near', maxYocto: '1000000000000000000000', deny: ['other.near'], salt: 'saltvalue1' };
  const text = sealText(rule);
  assert.equal(text, 'oath-hidden-v1|board.nearcarta.near|pay|1000000000000000000000|other.near|saltvalue1');
  assert.equal(
    sealText({ ...rule, maxYocto: null }),
    'oath-hidden-v1|board.nearcarta.near|pay|none|other.near|saltvalue1',
  );
  assert.throws(() => sealText({ ...rule, salt: 'no' }));
  assert.throws(() => sealText({ ...rule, salt: 'has space!!' }));

  const args = revealArgs(rule);
  assert.ok(args.max_amount === null || typeof args.max_amount === 'string');
  assert.deepEqual(args.deny, ['other.near']);
  assert.equal(args.salt, 'saltvalue1');
  const commitment = createHash('sha256').update(text).digest('hex');
  assert.ok(!('amount' in args));
  assert.ok(!JSON.stringify(args).includes(commitment));
  assert.ok(!JSON.stringify(args).includes(text));
});

test('an envelope signature verifies without sending a completion', async () => {
  const kp = nacl.sign.keyPair();
  const model = 'z-ai/glm-5.3-flash';
  const reqSha = 'ab'.repeat(32);
  const respSha = 'cd'.repeat(32);
  const text = `${model}:${reqSha}:${respSha}`;
  const sig = hex(nacl.sign.detached(new TextEncoder().encode(text), kp.secretKey));
  const signing_address = hex(kp.publicKey);
  const signature = { text, signature: sig, signing_address, signing_algo: 'ed25519', signature_kind: 'provider_tee' };
  const preflightSigner = { signing_algo: 'ed25519', signing_address };

  const good = verifyResponseSignature({ signature, expectedText: text, preflightSigner });
  assert.equal(good.ok, true);

  const flipped = (parseInt(sig.slice(0, 2), 16) ^ 1).toString(16).padStart(2, '0') + sig.slice(2);
  let bad;
  assert.doesNotThrow(() => {
    bad = verifyResponseSignature({ signature: { ...signature, signature: flipped }, expectedText: text, preflightSigner });
  });
  assert.equal(bad.ok, false);

  const secretChat = 'private chat content sentinel';
  const result = await bankProve({
    enabled: false,
    receipt: { model, reqSha, respSha, signature, content: secretChat },
    preflight: async () => ({
      ok: true,
      model,
      nonce: '11'.repeat(32),
      signingAlgo: 'ed25519',
      models: [{ ok: true, signing_algo: 'ed25519', signing_address, model_name: model }],
      gateway: { ok: true },
    }),
    complete: async () => { throw new Error('completion must not be sent'); },
  });
  assert.equal(result.completionSent, false);
  assert.equal(result.verified, true);
  assert.equal(result.checks.ed25519, true);
  const proofJson = JSON.stringify(result.proof);
  assert.doesNotMatch(proofJson, /lamp|prompt|untraceable/i);
  assert.ok(!proofJson.includes(secretChat));
  assert.equal(result.retention, NO_RETENTION);
  assert.match(NO_RETENTION, /bytes are not stored/i);
  assert.equal(typeof proofFile, 'function');
});

test('a hardware attestation is the live proof when completions are off', async () => {
  const result = await bankProve({
    enabled: false,
    preflight: async () => ({
      ok: true,
      model: 'z-ai/glm-5.3-flash',
      nonce: '22'.repeat(32),
      signingAlgo: 'ed25519',
      checkedAt: '2026-11-06T00:00:00.000Z',
      gateway: { ok: true, tcbStatus: 'UpToDate' },
      models: [{ ok: true, signing_address: 'aa'.repeat(32), signing_algo: 'ed25519', tcbStatus: 'UpToDate' }],
    }),
    complete: async () => { throw new Error('no'); },
  });
  assert.equal(result.completionSent, false);
  assert.equal(result.mode, 'attestation');
  assert.equal(result.verified, true);
  assert.ok(result.proof?.retention || result.retention);
  assert.ok(result.proof.nonce);
  assert.ok(result.proof.model);
  assert.ok(!('intel_quote' in result.proof));
});

test('the bank dock clears the input on send and keeps a hint on a miss', async () => {
  const listeners = [];
  const mk = (id) => ({
    id,
    value: '',
    hidden: true,
    textContent: '',
    closest(sel) { return sel === '#' + id ? this : null; },
  });
  const input = mk('bank-agent');
  const go = mk('bank-agent-go');
  const log = mk('bank-agent-log');
  const els = { 'bank-agent': input, 'bank-agent-go': go, 'bank-agent-log': log };
  const doc = {
    getElementById(id) { return els[id] || null; },
    addEventListener(type, fn) { listeners.push({ type, fn }); },
  };
  installBankDock(doc);

  input.value = 'nope';
  armBankDock(async () => ({ ok: false, hint: 'Try: Send 0.001 NEAR privately' }));
  await dispatchBankDock(doc);
  assert.equal(input.value, 'nope');
  assert.equal(log.textContent, 'Try: Send 0.001 NEAR privately');

  armBankDock(async () => ({ ok: true, hint: 'Sending 0.001 NEAR privately under your cap. No wallet.' }));
  input.value = 'Send 0.001 NEAR privately';
  await dispatchBankDock(doc);
  assert.equal(input.value, '');
});

test('city bank copy has no untraceable claim', () => {
  for (const p of ['app/src/panels/bank-tray.js', 'app/design/D8_shops/shops/bank.js', 'README.md']) {
    assert.doesNotMatch(read(p), /untraceable/i, p);
  }
});

test('the billable prove route stays gated and the bank proof route does not', () => {
  const app = read('backend/src/app.js');
  const prove = app.slice(app.indexOf("'/api/ai/prove'"));
  assert.match(prove.slice(0, 700), /AI_PROVE_ENABLED/);
  assert.match(app, /\/api\/bank\/(proof|prove)/);
  const bankRoute = app.slice(app.search(/\/api\/bank\/(proof|prove)/));
  assert.doesNotMatch(bankRoute.slice(0, 400), /AI_PROVE_ENABLED !== '1'/);
});
