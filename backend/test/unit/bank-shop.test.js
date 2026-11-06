import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl';
import { parseBankAgent, BANK_HINT } from '../../../app/src/panels/bank-agent.js';
import { SAMPLES, parseStatementCsv, auditStatement, tightenDecision, commitmentText, proofLogEntry, modelEligibility, biggestWaste, wasteSentence, plural, attestFields, statementFindings, agentReply, capFromSetup, verifyBrowserSignature, rowsInMessage, messageAuditReply, preferModelSentence, attestForNonce, browserSignatureLine, CHECK_SPLIT, checkSplitFor, signerIdentity } from '../../../app/src/panels/bank-audit.js';
import { nearRate, _clearRateCache } from '../../../backend/src/bank-rate.js';
import { runModelAudit } from '../../../backend/src/bank-model.js';
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
  const spending = parseBankAgent('audit my spending and tell me the biggest waste');
  assert.equal(spending.ok, false);
  assert.match(spending.hint, /will not use a sample/);
  const loaded = parseBankAgent('audit my spending and tell me the biggest waste', { hasStatement: true });
  assert.equal(loaded.source, 'loaded');
  assert.equal(loaded.sample, undefined);
  assert.equal(loaded.question, 'waste');

  const free = parseBankAgent('which charges look like waste in my list?');
  assert.equal(free.ok, false);
  assert.equal(free.sample, undefined);
  assert.match(free.hint, /will not use a sample/);
  const freeLoaded = parseBankAgent('which charges look like waste in my list?', { hasStatement: true });
  assert.equal(freeLoaded.ok, true);
  assert.equal(freeLoaded.source, 'loaded');
  assert.equal(freeLoaded.question, 'waste');
  assert.equal(parseBankAgent('any duplicates in this list?', { hasStatement: true }).question, 'duplicate');
  assert.equal(parseBankAgent('which subscriptions do I pay?', { hasStatement: true }).question, 'subscription');
  assert.equal(parseBankAgent('what is my cap?', { hasStatement: true }).question, 'limit');

  const loose = parseBankAgent('Raise the cap');
  assert.equal(loose.ok, false);
  assert.match(loose.hint, /Nothing was signed/);
  assert.match(parseBankAgent('Reset spent').hint, /Nothing was signed/);
  assert.match(parseBankAgent('Unfreeze the row').hint, /Nothing was signed/);
});

test('a message that names rows is audited on those rows', () => {
  const phrasings = [
    'Check my spending: Spotify 9.99 twice on Oct 3 and Amazon 40',
    'spotify $9.99 twice on october 3 and amazon 40',
    'Please audit Spotify 9.99 2 times on Oct 3, and Amazon for 40',
  ];
  for (const line of phrasings) {
    const parsed = parseBankAgent(line, { hasStatement: true, review: { lines: 5 } });
    assert.equal(parsed.ok, true, line);
    assert.equal(parsed.source, 'message', line);
    assert.equal(parsed.rows.length, 3, line);
    const names = parsed.rows.map(r => r.payee.toLowerCase());
    assert.deepEqual(names, ['spotify', 'spotify', 'amazon'], line);
    const reply = messageAuditReply(parsed.rows);
    assert.match(reply, /Spotify|spotify/i, line);
    assert.match(reply, /9\.99/, line);
    assert.match(reply, /twice/, line);
    assert.match(reply, /October 3/, line);
    assert.match(reply, /double charge/, line);
    assert.match(reply, /Amazon|amazon/i, line);
    assert.match(reply, /single charge/, line);
    assert.doesNotMatch(reply, /Starbucks|Netflix/);
  }

  const dated = parseBankAgent('Netflix 15.99 on 2026-10-03 and Netflix 15.99 on 2026-10-12', { hasStatement: true });
  assert.equal(dated.source, 'message');
  assert.equal(dated.rows.length, 2);
  assert.match(messageAuditReply(dated.rows), /twice in October/);

  const sameDay = parseBankAgent('Starbucks $6.45 on October 2 and Starbucks $6.45 on October 2');
  assert.equal(sameDay.rows.length, 2);
  assert.match(messageAuditReply(sameDay.rows), /double charge/);
  assert.match(messageAuditReply(sameDay.rows), /October 2/);

  const one = parseBankAgent('Please look at Uber 12.30 on 10/8');
  assert.equal(one.source, 'message');
  assert.equal(one.rows.length, 1);
  assert.match(messageAuditReply(one.rows), /Uber, 12\.30 as written\. It is a single charge/);

  const loaded = parseBankAgent('which charges look like waste in my list?', { hasStatement: true });
  assert.equal(loaded.source, 'loaded');
  assert.equal(loaded.rows, undefined);
  assert.equal(rowsInMessage('which charges look like waste in my list?').length, 0);
  assert.equal(parseBankAgent('Audit the cafe sample').source, 'sample');

  const fallback = preferModelSentence('Starbucks was charged twice.', one.rows, 'Uber, 12.30 as written. It is a single charge.');
  assert.equal(fallback.source, 'parser');
  assert.match(fallback.text, /Uber/);
  const kept = preferModelSentence('Spotify appears twice and Amazon is a single charge.', phrasings.map(() => null) && parseBankAgent(phrasings[0]).rows, 'parser sentence');
  assert.equal(kept.source, 'model');
  assert.match(kept.text, /Spotify/);
  assert.match(kept.text, /Amazon/);
  const vague = preferModelSentence('Spotify and Amazon are in the note.', parseBankAgent(phrasings[0]).rows, 'parser sentence');
  assert.equal(vague.source, 'parser');

  const stale = attestForNonce({ nonce: 'bb'.repeat(32), checkedNonce: 'aa'.repeat(32), label: 'attested', live: 'Live check passed.', fields: [{ id: 'nonce' }] });
  assert.equal(stale.checked, false);
  assert.equal(stale.live, 'Not checked yet.');
  assert.equal(stale.label, '');
  assert.equal(stale.fields.length, 0);
  const same = attestForNonce({ nonce: 'aa'.repeat(32), checkedNonce: 'aa'.repeat(32), label: 'attested', live: 'Live check passed.', fields: [{ id: 'model' }] });
  assert.equal(same.checked, true);
  assert.equal(same.live, 'Live check passed.');
  assert.equal(same.fields.length, 1);
  const asking = attestForNonce({ nonce: 'cc'.repeat(32), checkedNonce: '', pending: true, label: 'attested', live: 'Live check passed.' });
  assert.equal(asking.live, 'Asking NEAR AI');
  assert.equal(asking.label, '');

  assert.equal(browserSignatureLine(true, 'ed25519'), 'ed25519 signature checked in your browser with the attested public key: valid');
  assert.equal(browserSignatureLine(true, 'ecdsa'), 'ECDSA signature recovered in your browser matches the attested signing address');
  assert.match(browserSignatureLine(false, 'ed25519'), /not valid/);
  assert.match(browserSignatureLine(false, 'ecdsa'), /did not recover/);
  assert.match(browserSignatureLine(true), /^signature checked in your browser: valid$/, 'no algorithm named: no algorithm claimed');
  assert.equal(browserSignatureLine(false, 'ecdsa', { checked: false }), 'No response signature was checked (ECDSA was named in the report).');
  assert.match(CHECK_SPLIT, /Checked in this browser/);
  assert.match(CHECK_SPLIT, /Checked on the server/);
  assert.match(checkSplitFor('ecdsa'), /ECDSA signature, recovered/);
  assert.match(checkSplitFor('ed25519'), /ed25519 signature over the signed text/);
  assert.match(checkSplitFor(''), /did not check a response signature/);
  const tray = read('app/src/panels/bank-tray.js');
  assert.match(tray, /browserSignatureLine\([^)]*algo/);
  assert.match(tray, /data-testid="tee-copy-signer"/);
  assert.match(tray, /data-testid="tee-signer"/);
  assert.match(tray, /checkSplitFor/);
  assert.match(tray, /attestForNonce/);
  assert.match(tray, /source === 'message'/);
  assert.doesNotMatch(tray, /f\.id === 'nonce' \|\| f\.id === 'signer'/);
  assert.doesNotMatch(tray, /provider_tee/);
  // A private audit never routes to /setup, and the gold button never moves under the pointer.
  assert.doesNotMatch(tray, /location\.assign|location\.href/);
  const css = read('app/src/panels/bank.css');
  assert.match(css, /\.bank-scroll\{/);
  assert.match(css, /height:min\(640px,calc\(100dvh - 120px\)\)/);
  assert.match(css, /\.bank-foot\{/);
  assert.match(css, /\.bank-cta:active/);
  assert.doesNotMatch(css, /height:fit-content/);
  const fields = attestFields(
    { ok: true, model: 'z-ai/glm-5.3-flash', nonce: 'ab'.repeat(32), models: [{ ok: true, signing_address: 'cd'.repeat(32), checks: { signerBound: true, quote: true, nonceBound: true }, tcbStatus: 'UpToDate', gpu: { ok: true, gpus: 1 } }], gateway: { checks: { quote: true, nonceBound: true }, tcbStatus: 'UpToDate' } },
    { ok: true, kind: 'provider_tee' },
  );
  const signature = fields.find(f => f.id === 'signature');
  assert.equal(signature.where, 'browser');
  assert.equal(signature.value, 'valid');
  assert.notEqual(signature.value, 'provider_tee');
  const signer = fields.find(f => f.id === 'signer');
  assert.equal(signer.value, 'cd'.repeat(32));
  assert.equal(signer.where, 'server');
});

test('an ecdsa receipt is recovered in the browser, and a wrong algorithm is never claimed as a pass', async () => {
  const { recoverEcdsaSigner } = await import('../../../app/src/panels/signature-check.js');
  // A fixed secp256k1 receipt over an EIP-191 message. The address is keccak256(x||y)[12:] of the key,
  // and the signature is v||r||s (the layout @noble/curves emits), the way NEAR AI's ecdsa replies arrive.
  const address = '0x4d958b39872d523f795c021be6c148a49e662899';
  const text = 'z-ai/glm-5.3-flash:req:resp';
  const sig = '01ff5b7ff6a9f97b7407749253a0ddb1d7028d32d76101351d4af53e3e7867dd434c70054cc5ed277099fe3e0bb32eba9f2d10fdcd8e9fd1935dfc349b0cb555ba';

  const good = await verifyBrowserSignature({ text, signature: sig, signingAddress: address, algo: 'ecdsa' });
  assert.equal(good.ok, true);
  assert.equal(good.recovered.toLowerCase(), address.toLowerCase());
  assert.equal(browserSignatureLine(good.ok, 'ecdsa'), 'ECDSA signature recovered in your browser matches the attested signing address');

  const tampered = await verifyBrowserSignature({ text: `${text}x`, signature: sig, signingAddress: address, algo: 'ecdsa' });
  assert.equal(tampered.ok, false, 'a different message must not recover the attested address');
  assert.match(browserSignatureLine(tampered.ok, 'ecdsa'), /did not recover/);

  const other = '0x' + '11'.repeat(20);
  assert.equal((await verifyBrowserSignature({ text, signature: sig, signingAddress: other, algo: 'ecdsa' })).ok, false);
  // The same 20-byte address labelled as an ed25519 key is a size mismatch, not a pass.
  const mislabelled = await verifyBrowserSignature({ text, signature: sig, signingAddress: address, algo: 'ed25519' });
  assert.equal(mislabelled.ok, false);
  assert.match(mislabelled.why, /32-byte ed25519 key/);
  // An unnamed algorithm is not guessed from the address length.
  const unnamed = await verifyBrowserSignature({ text, signature: sig, signingAddress: address });
  assert.equal(unnamed.ok, false);
  assert.match(unnamed.why, /did not name ed25519 or ecdsa/);

  // r||s||v (the Ethereum tooling order) recovers the same address.
  const rsv = sig.slice(2, 130) + '01';
  assert.equal((await verifyBrowserSignature({ text, signature: rsv, signingAddress: address, algo: 'ecdsa' })).ok, true);

  const sync = recoverEcdsaSigner({ text, signature: sig, signingAddress: address });
  assert.equal(sync.ok, true);

  const who = signerIdentity({ signingAddress: address, algo: 'ecdsa' });
  assert.equal(who.label, 'ECDSA signing address');
  assert.equal(who.bytes, 20);
  assert.equal(who.ok, true);
  const wrongSize = signerIdentity({ signingAddress: address, algo: 'ed25519' });
  assert.equal(wrongSize.ok, false, 'a 40-hex address is not an ed25519 public key');
  assert.match(wrongSize.why, /20 bytes/);
});

test('the proof log links a real artifact and says so plainly when there is none', () => {
  const plain = proofLogEntry({ kind: 'upload', lines: 5, anomalyCount: 1, nonce: 'aa'.repeat(32) });
  assert.deepEqual(plain.evidence, []);
  assert.equal(plain.nonce.length, 8, 'the log keeps a nonce prefix, not the whole statement');
  const withArt = proofLogEntry({ kind: 'tee', nonce: 'bb'.repeat(32), eligible: true, evidence: [{ label: 'report', url: 'https://nearcarta.example/api/ai/tee?nonce=bb' }] });
  assert.equal(withArt.evidence.length, 1);
  assert.match(withArt.evidence[0].url, /^https:\/\//);
  const junk = proofLogEntry({ kind: 'tee', nonce: 'cc'.repeat(32), evidence: [{ label: 'x', url: 'javascript:alert(1)' }, { label: 'y', url: '' }] });
  assert.deepEqual(junk.evidence, [], 'only an absolute http(s) artifact becomes a link');
  const traySource = read('app/src/panels/bank-tray.js');
  assert.match(traySource, /data-testid="bank-log-link"/);
  assert.match(traySource, /no public artifact/);
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
  // A lower cap is a real board write now; the send itself is in bank-tray.js.
  const held = tightenDecision({ beforeCap: 0.05, afterCap: 0.02 });
  assert.equal(held.ok, true);
  assert.equal(held.live, 'ready');
  assert.match(held.reason, /Ready to tighten/);
  assert.match(held.reason, /board row/);
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

test('a card csv keeps its currency and names the biggest waste', async () => {
  const csv = `date,merchant,amount,category
2026-11-01,Cafe,4.50,food
2026-11-02,Cloud Host,29.00,software
2026-11-03,Cloud Host,29.00,software
2026-11-04,Books,12.00,shopping
`;
  const parsed = parseStatementCsv(csv);
  assert.equal(parsed.ok, true);
  assert.match(parsed.detectedText, /Detected date, merchant, amount, category/);
  assert.match(parsed.detectedText, /No currency column/);
  const report = auditStatement(parsed.rows, { capNear: 0.1 });
  assert.equal(JSON.stringify(report).includes('Cloud Host'), false);
  assert.match(report.rateSource, /not converted/);
  const waste = biggestWaste(parsed.rows);
  assert.equal(waste.payee, 'Cloud Host');
  assert.equal(waste.amount, 29);
  assert.match(waste.why, /twice in November/);
  assert.match(waste.why, /largest line/);
  assert.match(wasteSentence(waste), /Cloud Host, 29 as written/);
  const priced = auditStatement(parsed.rows.map(r => ({ ...r, currency: 'USD' })), {
    capNear: 20,
    nearPerUnit: 0.5,
    rateSource: 'CoinGecko near/usd at test: 1 NEAR = 2 USD.',
  });
  assert.equal(priced.currency, 'USD');
  assert.equal(priced.tighten, true);
  assert.ok(priced.after < priced.before);
  assert.match(priced.rateSource, /CoinGecko/);
  assert.equal(plural(1, 'anomaly', 'anomalies'), '1 anomaly');
  assert.equal(plural(3, 'anomaly', 'anomalies'), '3 anomalies');
  assert.doesNotMatch(read('app/src/panels/bank-tray.js'), /\$\{review\.anomalies\.length\} anomalies/);
  assert.match(read('app/src/panels/bank-tray.js'), /Accepted format/);
  assert.match(read('app/src/panels/bank-tray.js'), /data-testid="bank-paste"/);
  const bankCss = read('app/src/panels/bank.css');
  assert.match(bankCss, /#shopUI #t-form button\.bank-tab\.on/);
  assert.match(bankCss, /linear-gradient\(180deg,#f5d08a,#e2b35b\)/);
  assert.match(bankCss, /grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  assert.match(bankCss, /button\.bank-tab\[aria-selected="true"\]/);
  assert.match(bankCss, /inset 0 -4px 0 #8b5e2b/);
  const tray = read('app/src/panels/bank-tray.js');
  assert.match(tray, /Audit another statement/);
  assert.doesNotMatch(tray, /Audit another sample/);
  assert.match(tray, /APPLY_NOTE/);
  assert.match(tray, /bank-apply-note/);
  assert.match(tray, /No per-payment cap is saved on your board row/);
  assert.match(read('app/src/panels/bank-audit.js'), /Apply tighter limits lowers the per-payment cap on your own board row/);
  assert.match(read('app/design/D8_shops/js/shopui.js'), /cur === 'bank' && app\.guest && app\.form/);
  // The gold button for the bank never falls through to the /setup redirect, whatever stage the page reads.
  const shopui = read('app/design/D8_shops/js/shopui.js');
  const primaryFn = shopui.slice(shopui.indexOf('async function primary('));
  const bankBranch = primaryFn.indexOf("if (cur === 'bank')");
  const setupRedirect = primaryFn.indexOf("st === 'load' || st === 'connect' || st === 'build'");
  assert.ok(bankBranch > 0 && bankBranch < setupRedirect, 'the bank branch must come before the /setup redirect');

  _clearRateCache();
  const rate = await nearRate('usd', {
    now: () => Date.parse('2026-11-06T00:00:00.000Z'),
    fetchImpl: async () => ({ ok: true, json: async () => ({ near: { usd: 2 } }) }),
  });
  assert.equal(rate.ok, true);
  assert.equal(rate.nearPerUnit, 0.5);
  assert.match(rate.source, /CoinGecko near\/usd/);
  assert.match(rate.source, /1 NEAR = 2 USD/);

  let sent = 0;
  const held = await runModelAudit({
    rows: [{ payee: 'SECRET_PAYEE', amount: 29, currency: 'USD' }],
    preflight: async () => ({ ok: false, failure: 'model: quote', model: 'z-ai/glm-5.3-flash', models: [], gateway: {} }),
    complete: async () => { sent += 1; return {}; },
  });
  assert.equal(sent, 0);
  assert.match(held.step, /not sent/);
  assert.equal(JSON.stringify(held).includes('SECRET_PAYEE'), false);

  const pre = {
    ok: true, model: 'z-ai/glm-5.3-flash', nonce: 'ab'.repeat(32),
    gateway: { ok: true, tcbStatus: 'UpToDate', checks: { quote: true, nonceBound: true }, signing_address: '11'.repeat(20) },
    models: [{ ok: true, tcbStatus: 'UpToDate', checks: { quote: true, nonceBound: true, signerBound: true }, signing_address: '22'.repeat(20), signing_algo: 'ed25519', gpu: { ok: true, gpus: 8 }, model_name: 'z-ai/glm-5.3-flash' }],
  };
  const done = await runModelAudit({
    rows: [{ payee: 'SECRET_PAYEE', amount: 29, currency: 'USD' }],
    preflight: async () => pre,
    complete: async () => ({ id: 'chat', model: 'z-ai/glm-5.3-flash', reqModel: 'z-ai/glm-5.3-flash', content: 'Cloud Host, 29 USD. It appears twice.', usage: { prompt_tokens: 1, completion_tokens: 1 }, reqSha: 'aa', respSha: 'bb' }),
    sign: async () => ({ available: true, text: 'nope', signature: '00', signing_address: '22'.repeat(20), signing_algo: 'ed25519', signature_kind: 'provider_tee' }),
    check: () => ({ verified: false, checks: {} }),
    allow: () => ({ ok: true }),
  });
  assert.equal(done.verified, false);
  assert.match(done.step, /Response signature/);
  assert.equal(JSON.stringify(done.fields).includes('SECRET_PAYEE'), false);
  assert.equal(done.answer.includes('SECRET_PAYEE'), false);
  const view = attestFields(pre, { ok: true, kind: 'provider_tee' });
  assert.equal(view.find(f => f.id === 'gpu').ok, true);
  assert.equal(view.find(f => f.id === 'tdx').value, 'UpToDate');
  assert.equal(view.find(f => f.id === 'signature').ok, true);
});

test('an empty model sentence is not verified and the browser checks the signature', async () => {
  const csv = `date,merchant,amount
2026-10-03,Starbucks,5.40
2026-10-03,Starbucks,5.40
2026-10-03,Netflix,15.99
2026-10-12,Netflix,15.99
2026-10-08,Uber,12.30
2026-10-15,Spotify,10.99
`;
  const parsed = parseStatementCsv(csv);
  assert.equal(parsed.ok, true);
  const findings = statementFindings(parsed.rows);
  const pairs = findings.filter(f => f.kind !== 'subscription');
  const subs = findings.filter(f => f.kind === 'subscription');
  assert.equal(pairs.length, 2);
  assert.match(pairs.find(f => f.kind === 'same-day').text, /Starbucks, 5\.40 as written/);
  assert.match(pairs.find(f => f.kind === 'same-day').text, /double charge/);
  assert.match(pairs.find(f => f.kind === 'month').text, /Netflix, 15\.99 as written/);
  assert.match(pairs.find(f => f.kind === 'month').text, /October/);
  assert.match(subs[0].text, /Netflix/);
  assert.match(subs[0].text, /Spotify/);
  assert.match(subs[0].text, /subscriptions/);
  const report = auditStatement(parsed.rows);
  assert.equal(report.anomalies.length, pairs.length);
  assert.equal(JSON.stringify(report).includes('Starbucks'), false);
  assert.equal(JSON.stringify(report).includes('Netflix'), false);
  const reply = agentReply(parsed.rows, 'waste');
  assert.match(reply, /Starbucks/);
  assert.match(reply, /Netflix/);
  assert.match(reply, /Spotify/);
  assert.match(reply, /double charge/);
  assert.match(agentReply(parsed.rows, 'duplicate'), /Starbucks/);
  assert.match(agentReply(parsed.rows, 'subscription'), /Spotify/);
  assert.match(agentReply(parsed.rows, 'limit'), /no limit to tighten/);
  assert.match(agentReply(parsed.rows, 'limit', { capNear: 0.2 }), /0\.2 NEAR/);
  assert.equal(capFromSetup(null, 0.2), 0.2);
  assert.equal(capFromSetup(0.5, 0.2), 0.5);
  assert.equal(capFromSetup(null, 0), null);

  const pre = {
    ok: true, model: 'z-ai/glm-5.3-flash', nonce: 'ab'.repeat(32),
    gateway: { ok: true, tcbStatus: 'UpToDate', checks: { quote: true, nonceBound: true }, signing_address: '11'.repeat(20) },
    models: [{ ok: true, tcbStatus: 'UpToDate', checks: { quote: true, nonceBound: true, signerBound: true }, signing_address: '22'.repeat(20), signing_algo: 'ed25519', gpu: { ok: true, gpus: 8 } }],
  };
  let opts;
  const empty = await runModelAudit({
    rows: parsed.rows,
    preflight: async () => pre,
    complete: async (_msgs, o) => { opts = o; return { id: 'chat', model: 'z-ai/glm-5.3-flash', reqModel: 'z-ai/glm-5.3-flash', content: '   ', reasoning_content: '', usage: {}, reqSha: 'aa', respSha: 'bb' }; },
    sign: async () => ({ available: true, text: 'signed-body', signature: 'ab'.repeat(64), signing_address: '22'.repeat(32), signing_algo: 'ed25519', signature_kind: 'provider_tee' }),
    check: () => ({ verified: true, checks: {} }),
    allow: () => ({ ok: true }),
  });
  assert.equal(opts.maxTokens, 512);
  assert.equal(opts.extra.reasoning_effort, 'low');
  assert.equal(empty.answer, '');
  assert.equal(empty.verified, false);
  assert.match(empty.step, /empty/);
  // The reply has a signature, so NEAR AI's verify page is the artifact even when the sentence was empty.
  assert.match(empty.verify_url, /^https:\/\/cloud\.near\.ai\/verify\?model=/);
  assert.equal(empty.signed_text, 'signed-body');
  assert.equal(empty.signature, 'ab'.repeat(64));
  assert.equal(empty.signing_address, '22'.repeat(32));
  assert.equal(JSON.stringify(empty).includes('Starbucks'), false);

  const reasoned = await runModelAudit({
    rows: [{ payee: 'Netflix', amount: 15.99, currency: 'USD' }],
    preflight: async () => pre,
    complete: async () => ({ id: 'chat', model: 'z-ai/glm-5.3-flash', reqModel: 'z-ai/glm-5.3-flash', content: '', reasoning_content: 'Netflix is the waste.', usage: {}, reqSha: 'aa', respSha: 'bb' }),
    sign: async () => ({ available: true, text: 'signed-body', signature: 'cd'.repeat(64), signing_address: '22'.repeat(32), signing_algo: 'ed25519', signature_kind: 'provider_tee' }),
    check: () => ({ verified: true, checks: {} }),
    allow: () => ({ ok: true }),
  });
  assert.equal(reasoned.answer, 'Netflix is the waste.');
  assert.equal(reasoned.verified, true);
  // A signed reply names NEAR AI's own verify page; an unsigned one names no artifact at all.
  assert.match(reasoned.verify_url, /^https:\/\/cloud\.near\.ai\/verify\?model=/);
  // With no signature at all there is no artifact, so nothing may be linked.
  const unsignedAudit = await runModelAudit({
    rows: [{ payee: 'Netflix', amount: 15.99, currency: 'USD' }],
    preflight: async () => pre,
    complete: async () => ({ id: 'chat', model: 'z-ai/glm-5.3-flash', reqModel: 'z-ai/glm-5.3-flash', content: 'Netflix is the waste.', usage: {}, reqSha: 'aa', respSha: 'bb' }),
    sign: async () => ({ available: false, http: 404 }),
    check: () => ({ verified: false, checks: {} }),
    allow: () => ({ ok: true }),
  });
  assert.equal(unsignedAudit.verify_url, '');
  assert.equal(unsignedAudit.signature, '');

  const unsigned = await runModelAudit({
    rows: [{ payee: 'Netflix', amount: 15.99, currency: 'USD' }],
    preflight: async () => pre,
    complete: async () => ({ id: 'chat', content: '', reasoning_content: 'Netflix is the waste.', reqModel: 'z-ai/glm-5.3-flash', reqSha: 'aa', respSha: 'bb' }),
    sign: async () => ({ available: true, text: 'signed-body', signature: 'cd'.repeat(64), signing_address: '22'.repeat(32), signing_algo: 'ed25519', signature_kind: 'provider_tee' }),
    check: () => ({ verified: false, checks: {} }),
    allow: () => ({ ok: true }),
  });
  assert.equal(unsigned.answer, '');
  assert.equal(unsigned.verified, false);

  const kp = nacl.sign.keyPair();
  const text = 'model:req:resp';
  const sig = hex(nacl.sign.detached(new TextEncoder().encode(text), kp.secretKey));
  const good = await verifyBrowserSignature({ text, signature: sig, signingAddress: hex(kp.publicKey), algo: 'ed25519' });
  assert.equal(good.ok, true);
  const flipped = (parseInt(sig.slice(0, 2), 16) ^ 1).toString(16).padStart(2, '0') + sig.slice(2);
  const bad = await verifyBrowserSignature({ text, signature: flipped, signingAddress: hex(kp.publicKey), algo: 'ed25519' });
  assert.equal(bad.ok, false);
  const wrongAlgo = await verifyBrowserSignature({ text, signature: sig, signingAddress: hex(kp.publicKey) });
  assert.equal(wrongAlgo.ok, false, 'an unnamed algorithm is not checked, and never claimed as a pass');
  assert.match(wrongAlgo.why, /did not name ed25519 or ecdsa/);
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
  assert.equal(result.checks.signatureOk, true);
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

test('the tighten the CTA sends is a real, shrink-only board call', async () => {
  const { tightenCall, rulesInFromRow, anchorCall, boardRefusal } = await import('../../../app/src/panels/bank-board.js');
  const row = {
    owner: 'visitor.near', receivers: ['cafe.near'], per_action_cap: '50000000000000000000000',
    daily_budget: '200000000000000000000000', max_actions_per_day: 4, window_start_min: 0, window_end_min: 0,
    min_amount: '1', expires_at: '0', nonce: '7', frozen: false,
  };
  const call = tightenCall({ row, afterNear: 0.02 });
  assert.equal(call.ok, true);
  assert.equal(call.method, 'tighten_rules');
  assert.equal(call.args.freeze, false);
  // Every other field is sent back exactly as the row has it: the contract compares each one.
  const sent = call.args.rules;
  assert.equal(sent.per_action_cap, '20000000000000000000000');
  assert.equal(sent.daily_budget, row.daily_budget);
  assert.deepEqual(sent.receivers, row.receivers);
  assert.equal(sent.max_actions_per_day, row.max_actions_per_day);
  assert.equal(sent.min_amount, row.min_amount);
  assert.equal(sent.expires_at, row.expires_at);
  assert.equal(call.before, 0.05);
  assert.equal(call.after, 0.02);

  // Anything that is not strictly lower is refused before a signature exists.
  assert.equal(tightenCall({ row, afterNear: 0.05 }).ok, false);
  assert.match(tightenCall({ row, afterNear: 0.05 }).why, /matches your current cap/);
  assert.equal(tightenCall({ row, afterNear: 0.2 }).ok, false);
  assert.match(tightenCall({ row, afterNear: 0.2 }).why, /higher than your current cap/);
  assert.equal(tightenCall({ row, afterNear: 0 }).ok, false);
  assert.equal(tightenCall({ row: null, afterNear: 0.02 }).ok, false);
  // A row without a numeric cap is not a row to tighten.
  assert.equal(tightenCall({ row: { ...row, per_action_cap: 'nope' }, afterNear: 0.02 }).ok, false);
  assert.equal(rulesInFromRow({ ...row, per_action_cap: '0' }), null);

  // The anchor carries a digest and a salt, and nothing else. The board hashes them.
  const digest = 'ab'.repeat(32);
  const anchor = anchorCall({ kind: 'bank_cap', digest, salt: 'saltsalt' });
  assert.equal(anchor.ok, true);
  assert.equal(anchor.method, 'anchor');
  assert.deepEqual(anchor.args, { kind: 'bank_cap', digest, salt: 'saltsalt' });
  assert.equal(anchorCall({ digest: 'ab', salt: 'saltsalt' }).ok, false);
  assert.equal(anchorCall({ digest, salt: 'short' }).ok, false);
  assert.equal(anchorCall({ digest, salt: 'has space here' }).ok, false);
  assert.equal(anchorCall({ kind: 'bad kind', digest, salt: 'saltsalt' }).ok, false);

  assert.match(boardRefusal({ message: 'Smart contract panicked: ERR_LOOSEN' }), /looser rule/);
  assert.match(boardRefusal({ message: 'ERR_NO_CHARTER' }), /no row/);
  assert.match(boardRefusal({ message: 'NotEnoughAllowance' }), /session key/);
  assert.match(boardRefusal({ message: 'http 503' }), /town is busy/);
});

test('the CTA and the AI dock send the same board write, through one sender', () => {
  const tray = read('app/src/panels/bank-tray.js');
  const apps = read('app/design/D8_shops/js/apps.js');
  const shopui = read('app/design/D8_shops/js/shopui.js');
  // One send path: the tray calls the shared executor, and the page passes it in.
  assert.match(tray, /hooks\.boardWrite\(\{ method: call\.method, args: call\.args/);
  assert.match(shopui, /boardWrite: \(call\) => A\.boardWriteOnRow\(call\)/);
  assert.match(shopui, /boardRow: \(\) => A\.boardRowNow\(\)/);
  // The executor reads the live row, signs with the key from this browser, and sends.
  assert.match(apps, /export async function boardWriteOnRow/);
  assert.match(apps, /export async function boardRowNow/);
  assert.match(apps, /const ak = await proposeAccessKey\(key\)/);
  assert.match(apps, /W\.functionCall\(method, args \|\| \{\}, gas\)/);
  assert.match(apps, /wait_until: 'FINAL'/);
  // No wallet on this path.
  assert.doesNotMatch(apps.slice(apps.indexOf('export async function boardWriteOnRow'), apps.indexOf('export async function readRules')), /await sign\(/);
  // The session key must be allowed to call both methods, or the send says why.
  assert.match(apps, /cannot call \$\{method\}/);
  const session = read('shared/board/session.js');
  assert.match(session, /SESSION_METHODS = \[\.\.\.AGENT_METHODS, 'confirm_hold', 'tighten_rules', 'anchor'\]/);
});

test('the anchor runs only after the cap it commits to is on chain', () => {
  const tray = read('app/src/panels/bank-tray.js');
  const apply = tray.slice(tray.indexOf('async function runApply'), tray.indexOf('async function runTee'));
  // The tighten is sent first, and only a chain-allowed result reaches the anchor.
  const tightenAt = apply.indexOf("method: call.method, args: call.args");
  const anchorAt = apply.indexOf('await hooks.boardWrite({ method: anchor.method');
  assert.ok(tightenAt > 0 && anchorAt > tightenAt, 'tighten is sent before the anchor');
  assert.match(apply, /if \(okChain && state\.consent\)/);
  // The commitment is over the salt and the cap, never the statement.
  assert.match(apply, /commitmentText\(\{ nonce: state\.nonce, afterNear: call\.after, salt \}\)/);
  assert.match(apply, /anchorCall\(\{ kind: 'bank_cap', digest, salt \}\)/);
  assert.match(apply, /evidence: sent\.tx \? \[\{ label: 'tighten_rules', url: txUrl\(sent\.tx\) \}\] : \[\]/);
});

test('the audit response never echoes the statement, and an outage says so', async () => {
  const { runModelAudit } = await import('../../../backend/src/bank-model.js');
  const kp = nacl.sign.keyPair();
  const hx = u => Buffer.from(u).toString('hex');
  const pre = async () => ({ ok: true, nonce: 'ab'.repeat(32), checkedAt: 't', gateway: { ok: true, checks: { quote: true, nonceBound: true }, tcbStatus: 'UpToDate' },
    models: [{ ok: true, signing_algo: 'ed25519', signing_address: hx(kp.publicKey), checks: { quote: true, nonceBound: true, signerBound: true }, tcbStatus: 'UpToDate', gpu: { ok: true, gpus: 8 } }] });
  const rows = [{ payee: 'STATEMENT-SENTINEL', amount: 12.5, currency: 'NEAR', date: '2026-10-02' }];
  const prompt = (await import('../../../backend/src/bank-model.js')).auditPrompt([{ payee: 'STATEMENT-SENTINEL', amount: 12.5, currency: 'NEAR', date: '2026-10-02' }]);
  // The model sees the lines. That is the whole point of the call.
  assert.match(prompt, /STATEMENT-SENTINEL/);

  // A signed audit returns no prompt text and no payee list: the reply names the payee, the payload does not.
  const done = await runModelAudit({
    rows, preflight: pre,
    complete: async () => ({ id: 'c1', model: 'z-ai/glm-5.3-flash', reqModel: 'z-ai/glm-5.3-flash', content: 'It is a single charge.', usage: {}, reqSha: 'aa', respSha: 'bb' }),
    sign: async () => ({ available: true, text: 'x', signature: 'cd'.repeat(64), signing_address: hx(kp.publicKey), signing_algo: 'ed25519', signature_kind: 'provider_tee' }),
    check: () => ({ verified: true, checks: {} }), allow: () => ({ ok: true }),
  });
  const payload = JSON.stringify(done);
  assert.equal(payload.includes('2026-10-02'), false, 'no statement row is echoed back');
  assert.equal(payload.includes('12.5'), false, 'no statement amount is echoed back');
  assert.equal(done.answer, 'It is a single charge.');

  // A provider that never answered is an outage, and the parser's sentence is the answer.
  const tray = read('app/src/panels/bank-tray.js');
  assert.match(tray, /outage: true, step: `NEAR AI did not answer/);
  assert.match(tray, /state\.status = model\?\.outage/);
  assert.match(tray, /NEAR AI did not answer\. These rows were named in this browser\./);
  // Outage text must never claim a verified sentence: no signature, no signer, no model answer.
  const outageBranch = tray.slice(tray.indexOf('if (model?.outage)'), tray.indexOf('if (model?.signed_text'));
  assert.match(outageBranch, /state\.browserSig = null/);
  assert.match(outageBranch, /state\.signingAddress = ''/);
  assert.match(outageBranch, /state\.modelAnswer = ''/);
  // The user-facing sentence says nothing is attested, rather than implying a check ran.
  assert.match(outageBranch, /nothing here is attested/);
});

test('the bank audit route logs nothing that carries a statement line', () => {
  const model = read('backend/src/bank-model.js');
  // No console write in the bank model path at all: counts and cost only live in agent.js.
  assert.doesNotMatch(model, /console\.(log|error|warn|info)/);
  const proof = read('backend/src/bank-proof.js');
  assert.doesNotMatch(proof, /console\.(log|error|warn|info)/);
  // The one retention sentence, and it says what is kept rather than claiming blindness.
  assert.match(NO_RETENTION, /request and response bytes are not stored/i);
  assert.match(NO_RETENTION, /hashed for the signature check/);
  assert.match(NO_RETENTION, /keeps the hashes, the signer, and the attestation summary/);
  // The route itself is rate limited and does not persist the body anywhere.
  const app = read('backend/src/app.js');
  const route = app.slice(app.indexOf("'/api/bank/audit'"), app.indexOf("'/api/bank/audit'") + 700);
  assert.match(route, /limiter\(4\)/);
  assert.doesNotMatch(route, /writeFile|localStorage|sessionStorage/);
});
