import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl';
import { parseBankAgent, BANK_HINT } from '../../../app/src/panels/bank-agent.js';
import { SAMPLES, parseStatementCsv, auditStatement, tightenDecision, commitmentText, proofLogEntry, modelEligibility } from '../../../app/src/panels/bank-audit.js';
import { sealText, revealArgs } from '../../../shared/board/bank-seal.js';
import { verifyResponseSignature, proofFile, bankProve, NO_RETENTION } from '../../../backend/src/bank-proof.js';
import { armBankDock, dispatchBankDock, installBankDock } from '../../../app/src/panels/bank-dock.js';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

test('an audit line picks the sample and a miss shows the hint', () => {
  const cafe = parseBankAgent('Audit the cafe sample');
  assert.equal(cafe.ok, true);
  assert.equal(cafe.action, 'audit');
  assert.equal(cafe.sample, 'cafe');
  assert.equal(parseBankAgent('Audit the travel week').sample, 'travel');
  assert.equal(parseBankAgent('Verify the TEE').action, 'tee');
  assert.equal(parseBankAgent('Verify TEE now').action, 'tee');
  assert.equal(parseBankAgent('Show the attestation file').action, 'file');
  assert.equal(parseBankAgent('Show the proof log').action, 'file');
  assert.equal(parseBankAgent('Apply tighter limits').ok, false);
  assert.equal(parseBankAgent('Apply tighter limits', { review: { lines: 3 } }).action, 'apply');

  const miss = parseBankAgent('hello');
  assert.equal(miss.ok, false);
  assert.equal(miss.hint, BANK_HINT);

  const loose = parseBankAgent('Raise the cap');
  assert.equal(loose.ok, false);
  assert.match(loose.hint, /Nothing was signed/);
  assert.match(parseBankAgent('Reset spent').hint, /Nothing was signed/);
  assert.match(parseBankAgent('Unfreeze the row').hint, /Nothing was signed/);
});

test('a local audit drops the statement and a looser cap is refused', () => {
  assert.equal(SAMPLES.length, 3);
  for (const sample of SAMPLES) {
    const report = auditStatement(sample.rows, { capNear: 0.05 });
    const dumped = JSON.stringify(report);
    for (const row of sample.rows) if (row.payee) assert.equal(dumped.includes(row.payee), false);
    assert.ok(report.lines >= 1);
  }
  const travel = auditStatement(SAMPLES[1].rows, { capNear: 0.05 });
  assert.ok(travel.anomalies.some(a => a.kind === 'blank-payee'));
  assert.ok(travel.anomalies.some(a => a.kind === 'over-cap'));
  assert.equal(travel.tighten, false);
  const cafe = auditStatement(SAMPLES[0].rows, { capNear: 0.05 });
  assert.equal(cafe.tighten, true);
  assert.ok(cafe.after < cafe.before);
  const csv = parseStatementCsv('date,payee,near\n2026-11-01,cafe.near,0.01\n');
  assert.equal(csv.ok, true);
  assert.equal(parseStatementCsv('x'.repeat(6001)).ok, false);
  assert.match(parseStatementCsv('nope\n1').error, /header/);
  const loose = tightenDecision({ beforeCap: 0.05, afterCap: 0.2 });
  assert.equal(loose.ok, false);
  assert.match(loose.reason, /Nothing was signed/);
  assert.equal(tightenDecision({ beforeCap: 0.05, afterCap: 0.02, resetSpent: true }).ok, false);
  assert.equal(tightenDecision({ beforeCap: 0.05, afterCap: 0.02, unfreeze: true }).ok, false);
  assert.equal(tightenDecision({ beforeCap: 0.05, afterCap: 0.02, swapKey: true }).ok, false);
  assert.equal(tightenDecision({ beforeCap: 0.05, afterCap: 0.02, widenReceivers: true }).ok, false);
  assert.equal(tightenDecision({ beforeCap: 0.05, afterCap: 0.02, grantCalls: true }).ok, false);
  const held = tightenDecision({ beforeCap: 0.05, afterCap: 0.02 });
  assert.equal(held.ok, true);
  assert.equal(held.live, 'blocked');
  assert.match(held.reason, /Nothing was signed/);
  const text = commitmentText({ nonce: 'abc', afterNear: 0.02, salt: 'saltsalt' });
  assert.equal(text.includes('cafe.near'), false);
  assert.match(text, /^bank-audit-v1\|/);
  const entry = proofLogEntry({ kind: 'cafe', lines: 3, anomalyCount: 1, nonce: 'abcdef1234', eligible: false });
  assert.equal(JSON.stringify(entry).includes('cafe.near'), false);
  assert.equal(entry.nonce, 'abcdef12');
  const proxied = modelEligibility({ model: 'plain-model', teeOk: true, attested: ['z-ai/glm-5.3-flash'] });
  assert.equal(proxied.eligible, false);
  assert.equal(proxied.proxied, true);
  assert.equal(modelEligibility({ model: 'z-ai/glm-5.3-flash', teeOk: false, attested: ['z-ai/glm-5.3-flash'] }).eligible, false);
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
  armBankDock(async () => ({ ok: false, hint: 'Try Audit the cafe sample' }));
  await dispatchBankDock(doc);
  assert.equal(input.value, 'nope');
  assert.equal(log.textContent, 'Try Audit the cafe sample');

  armBankDock(async () => ({ ok: true, hint: '3 lines. Nothing was signed.' }));
  input.value = 'Audit the cafe sample';
  await dispatchBankDock(doc);
  assert.equal(input.value, '');
});

test('city bank copy has no untraceable claim', () => {
  for (const p of ['app/src/panels/bank-tray.js', 'app/design/D8_shops/shops/bank.js', 'README.md', 'app/design/D8_shops/js/shopui.js']) {
    assert.doesNotMatch(read(p), /untraceable/i, p);
    assert.doesNotMatch(read(p), /Send privately/, p);
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
