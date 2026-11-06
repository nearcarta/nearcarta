import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl';
import { exportCsv, csvTotals } from '../../../app/src/chronicle-feed.js';
import { parseChronicleCommand, runChronicleCommand } from '../../../app/src/chronicle-commands.js';
import { accountRows, mergeChronicle } from '../../../app/src/chronicle-loop.js';
import { anchorEventsFromReceipts, anchorPlan, anchorProof, bundleDigest, canonicalManifest, rebuildIndex, sha256Hex, teeNowText, verifyBundle, verifyNearAi, writeStatement } from '../../../app/src/chronicle-audit.js';
import { iconFor } from '../../../app/src/chronicle-icons.js';
import { CHRONICLE_CSS } from '../../../app/src/panels/chronicle-style.js';
import { armChronicleDock, dispatchChronicleDock, installChronicleDock } from '../../../app/src/panels/chronicle-dock.js';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const HASH = '8WDqBeaN7tCs8zPoYUPAicWhAF38YXgg5Si1YLpeD1aR';

const dep = {
  ferry_intents: {
    status: 'SUCCESS', amount_out: '0.177937 USDC', updated_at: '2026-11-04T21:06:50Z',
    txs: { wrap_near: 'HzgUr618CQqxECR88QKW93yGbDoFU176vWQfWM3yZaUw' },
  },
  toll: { txs: { owner_toll_pay_allowlisted: '4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz', owner_toll_pay_not_allowlisted: 'B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR' } },
  board: {
    txs: {
      'allowed_0.001': HASH,
      refused_over_per_action_cap: 'CcPMX1DtMJ8UyCm4toUHossrFTrHhVKXrSe6L69s9ceF',
      refused_receiver_not_allowlisted: 'E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ',
    },
    visitor_run: { txs: { 'propose_allowed_0.001': '4jEjzpiYxZYu1UmLhn3C1roYQ95pUQDrFkc6vRfiYbia', 'propose_refused_0.01_over_per_action_cap': 'AsZUd9mZc9uvkvz4RfEjAPiQdWduvYXqgx3wjmqu6EKx' } },
  },
};

test('chronicle merges toll, ferry SUCCESS, payouts and guard refusals', () => {
  const quiet = mergeChronicle({ mainnet: { ...dep, ferry_intents: { status: 'PENDING', txs: { wrap_near: 'nope' } } } });
  assert.equal(quiet.rows.some(r => r.shop === 'ferry'), false);
  const merged = mergeChronicle({ mainnet: dep, local: [{ shop: 'toll', decision: 'allowed', reason: 'again', h: '4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz', amount: '0.001 NEAR' }] });
  const toll = merged.rows.filter(r => r.h === '4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz');
  assert.equal(toll.length, 1);
  assert.equal(merged.rows.find(r => r.shop === 'ferry').amount, '0.177937 USDC');
  assert.ok(merged.rows.some(r => r.shop === 'payouts' && r.decision === 'allowed'));
  assert.ok(merged.rows.some(r => r.shop === 'guard' && r.decision === 'denied'));
  assert.equal(merged.live, true);
});

test('chronicle commands filter, export, verify and refuse an under-cap entry', async () => {
  const rows = mergeChronicle({ mainnet: dep }).rows;
  const state = {};
  const shown = await runChronicleCommand({ text: 'Show refused payments', rows, state });
  assert.equal(state.cd, 'denied');
  assert.equal(shown.clearSeal, true);
  const today = await runChronicleCommand({ text: "Export today's ledger", rows, state, now: new Date('2026-11-06T00:00:00Z') });
  assert.match(today.hint, /No rows are dated today/);
  const emptyCsv = [];
  const emptyExport = await runChronicleCommand({
    text: 'Export CSV', rows: [], state: {}, downloadCsv: (body) => emptyCsv.push(body),
  });
  assert.match(emptyExport.hint, /Nothing to export/);
  assert.equal(emptyCsv.length, 0);
  const dated = [{ shop: 'toll', decision: 'denied', reason: 'receiver_not_allowlisted', amount: '0', h: 'B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR', at: '2026-11-04T21:06:50Z' }];
  const csv = [];
  const exported = await runChronicleCommand({
    text: 'Export CSV', rows: dated, state: {}, now: new Date('2026-11-04T00:00:00Z'),
    downloadCsv: (body) => csv.push(body),
  });
  assert.match(exported.hint, /Exported 1/);
  assert.match(csv[0], /B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR/);
  assert.match(csv[0], /toll/);
  assert.match(exportCsv(dated), /0/);
  const calls = [];
  const verified = await runChronicleCommand({
    text: `Verify ${HASH}`, rows, state: {},
    verify: async (row) => { calls.push(row.h); return { status: { SuccessValue: '' } }; },
  });
  assert.deepEqual(calls, [HASH]);
  assert.match(verified.hint, /succeeded/);
  assert.equal(verified.clearSeal, true);
  const miss = await runChronicleCommand({ text: 'make it rain', rows, state: { seal: 'old' } });
  assert.equal(miss.ok, false);
  assert.equal(miss.clearSeal, true);
  assert.match(miss.hint, /Show refused payments/);
  let signed = false;
  const nospend = await runChronicleCommand({ text: 'add an entry', rows, state: {}, onEntry: () => { signed = true; } });
  assert.equal(signed, false);
  assert.match(nospend.hint, /Nothing was signed/);
  const parsed = parseChronicleCommand('Show refuses today');
  assert.equal(parsed.decision, 'denied');
  assert.equal(parsed.today, true);
  const asked = parseChronicleCommand('show me what aurora.near spent and anything refused');
  assert.equal(asked.action, 'query');
  assert.equal(asked.account, 'aurora.near');
  assert.equal(asked.decision, '');
  // An explicit verb wins over the account, so the AI can anchor the account it is auditing.
  const anchored = parseChronicleCommand('anchor the statement for aurora.near');
  assert.equal(anchored.action, 'anchor');
  assert.equal(parseChronicleCommand('Anchor this statement').action, 'anchor');
  assert.equal(parseChronicleCommand('write the statement for aurora.near').action, 'statement');
  const implicit = parseChronicleCommand('timeline for 8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8 last week ferry');
  assert.equal(implicit.account, '8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8');
  assert.equal(implicit.span, '7d');
  assert.equal(implicit.shop, 'ferry');
  const bag = { auditRows: [] };
  const reads = [];
  const queried = await runChronicleCommand({
    text: 'show me what aurora.near spent and anything refused',
    rows: [],
    state: bag,
    onRead: async (account) => {
      reads.push(account);
      bag.auditRows = [
        { shop: 'ledger', decision: 'allowed', h: HASH, amount: '1 NEAR' },
        { shop: 'guard', decision: 'denied', h: 'CcPMX1DtMJ8UyCm4toUHossrFTrHhVKXrSe6L69s9ceF', amount: '0' },
      ];
    },
    rowsOf: () => bag.auditRows,
  });
  assert.deepEqual(reads, ['aurora.near']);
  assert.equal(bag.account, 'aurora.near');
  assert.equal(bag.cd, '');
  assert.match(queried.hint, /aurora\.near has 2 rows: 1 allowed, 1 refused, 0 failed on chain/);
  const chain = await runChronicleCommand({
    text: 'timeline for aurora.near',
    state: {},
    rowsOf: () => [
      { shop: 'ledger', decision: 'failed', h: HASH },
      { shop: 'ledger', decision: 'failed', h: 'CcPMX1DtMJ8UyCm4toUHossrFTrHhVKXrSe6L69s9ceF' },
      { shop: 'guard', decision: 'denied', h: 'B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR' },
    ],
  });
  assert.match(chain.hint, /aurora\.near has 3 rows: 0 allowed, 1 refused, 2 failed on chain/);
  const plain = accountRows({
    account: 'alice.near',
    live: { rows: [{ hash: 'B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR', signer: 'alice.near', decision: 'failed', shop: 'ledger', note: 'storage_deposit' }], gaps: [] },
    board: { txs: [] },
    ledger: { rows: [] },
    mainnet: {},
  });
  assert.equal(plain.rows.find(r => r.h === 'B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR').decision, 'failed');
  const ruled = accountRows({
    account: 'alice.near',
    live: { rows: [{ hash: HASH, signer: 'alice.near', decision: 'failed', shop: 'ledger', note: 'storage_deposit' }], gaps: [] },
    board: { txs: [{ hash: HASH, signer: 'alice.near', decision: 'denied', shop: 'guard', note: 'over_per_action_cap' }] },
    ledger: { rows: [] },
    mainnet: {},
  });
  assert.equal(ruled.rows.find(r => r.h === HASH).decision, 'denied');
  const totals = csvTotals(dated);
  assert.equal(totals.attempted, 1);
  assert.match(exportCsv(dated), /attempted/);
});

function fakeDock() {
  const listeners = [];
  const mk = (id) => ({ id, value: '', hidden: true, textContent: '', closest(sel) { return sel === '#' + id ? this : null; } });
  const input = mk('c-agent');
  const go = mk('c-agent-go');
  const log = mk('c-agent-log');
  const doc = {
    getElementById(id) { return { 'c-agent': input, 'c-agent-go': go, 'c-agent-log': log }[id] || null; },
    addEventListener(type, fn) { listeners.push({ type, fn }); },
  };
  const fire = (type, target, extra = {}) => {
    const e = { type, target, key: extra.key || '', preventDefault() {} };
    for (const l of listeners) if (l.type === type) l.fn(e);
  };
  installChronicleDock(doc);
  return { input, log, fire };
}

test('chronicle dock sends on Enter and ArrowRight, not while typing, and clears a miss', async () => {
  const { input, log, fire } = fakeDock();
  const seen = [];
  armChronicleDock(async (text) => {
    seen.push(text);
    return text === 'nope' ? { ok: false, hint: 'Try “Show refused payments”.' } : { ok: true, hint: 'Showing 1.' };
  });
  input.value = 'Show refused payments';
  fire('input', input);
  assert.deepEqual(seen, []);
  fire('keydown', input, { key: 'Enter' });
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(seen, ['Show refused payments']);
  assert.equal(input.value, '');
  input.value = 'Export CSV';
  fire('keydown', input, { key: 'ArrowRight' });
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(seen, ['Show refused payments', 'Export CSV']);
  input.value = 'nope';
  await dispatchChronicleDock({ getElementById: (id) => (id === 'c-agent' ? input : id === 'c-agent-log' ? log : null) });
  assert.equal(input.value, '');
  assert.match(log.textContent, /Show refused payments/);
});

test('chronicle icons, brass and city wiring stay on the ledger path', () => {
  const mark = iconFor('not-a-shop', 'denied');
  assert.equal(mark.includes('?'), false);
  assert.match(mark, /M7 4h9/);
  assert.match(CHRONICLE_CSS, /gap:16px/);
  assert.match(CHRONICLE_CSS, /rgb\(245, 208, 138\)/);
  assert.match(CHRONICLE_CSS, /border:0/);
  assert.match(CHRONICLE_CSS, /\.c-scroll\{/);
  assert.doesNotMatch(CHRONICLE_CSS, /max-height:96px/);
  const shopui = read('app/design/D8_shops/js/shopui.js');
  assert.doesNotMatch(shopui, /chronicleEntry/);
  assert.doesNotMatch(shopui, /Add today/);
  assert.match(shopui, /Nothing was signed/);
  const view = read('app/src/panels/chronicle-view.js');
  assert.match(view, /Timeline/);
  assert.match(view, /Write statement/);
  assert.match(view, /Show timeline/);
  assert.match(view, /Check this bundle/);
  assert.match(view, /Failed on chain/);
  assert.match(view, /Show more/);
  assert.match(view, /Sources/);
  assert.match(view, /Verify TEE now/);
  assert.match(view, /data-pane="timeline"/);
  assert.doesNotMatch(view, /Add today/);
  const deep = read('app/src/panels/deep.js');
  assert.match(deep, /return mountChronicleTray\(root, hooks\)/);
  assert.match(view, /armChronicleDock/);
  assert.match(view, /data-testid="chronicle-search"/);
  assert.match(view, /data-testid="chronicle-export"/);
  assert.match(view, /aria-label="Account to ledger"/);
  assert.match(view, /\/api\/chronicle\/live/);
  assert.doesNotMatch(view, /usdc\.svg/);
  assert.doesNotMatch(view, /tokens\/near\.svg/);
  const room = read('app/design/D8_shops/shops/chronicle.js');
  assert.match(room, /if \(!opts\.success \|\| !opts\.tx\) return/);
  const index = read('app/design/D9_world/index.html');
  assert.match(index, /href="\/\?shop=chronicle"/);
  assert.match(index, /data-city-shop="chronicle"/);
});

test('an unrelated account is not given the recorded owner feed', () => {
  const empty = accountRows({});
  assert.equal(empty.rows.length, 0);
  assert.match(empty.coverage.label, /Type an account/);
  const mainnet = { toll: { owner: 'nearcarta.near', txs: dep.toll.txs }, ferry_intents: { status: 'SUCCESS', from: 'other.near', amount_out: '0.1 USDC', txs: { wrap_near: 'HzgUr618CQqxECR88QKW93yGbDoFU176vWQfWM3yZaUw' } } };
  const other = accountRows({
    account: 'alice.near',
    board: { txs: [{ hash: HASH, signer: 'nearcarta.near', decision: 'allowed', shop: 'board', note: 'allowed' }] },
    mainnet,
    index: { skipped: 'Not a town charter, so the live index was not queried.' },
  });
  assert.equal(other.rows.length, 0);
  assert.match(other.coverage.label, /No rows/);
  assert.match(other.coverage.gaps.join(' '), /Historic rules version: missing/);
  const owner = accountRows({ account: 'nearcarta.near', mainnet, index: { txs: [] } });
  assert.ok(owner.rows.some(r => r.shop === 'toll' && r.h.startsWith('4LKGpA5v')));
  assert.equal(owner.rows.some(r => r.shop === 'ferry'), false);
  assert.match(owner.coverage.label, /Recorded proofs, not a live index/);
  const ferry = accountRows({ account: 'other.near', mainnet: { ferry_intents: { ...mainnet.ferry_intents, status: 'SUCCESS' } }, index: { txs: [] } });
  assert.equal(ferry.rows.filter(r => r.shop === 'ferry').length, 1);
  const pending = accountRows({ account: 'other.near', mainnet: { ferry_intents: { ...mainnet.ferry_intents, status: 'PENDING' } }, index: { txs: [] } });
  assert.equal(pending.rows.some(r => r.shop === 'ferry'), false);
});

test('an unrelated account keeps its own live rows and does not borrow the owner feed', async () => {
  const hash = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const mainnet = { toll: { owner: 'nearcarta.near', txs: dep.toll.txs } };
  const live = {
    rows: [{ hash, signer: 'alice.near', decision: 'allowed', shop: 'ledger', note: 'TRANSFER', amount: '1 NEAR', url: `https://nearblocks.io/txns/${hash}`, source: 'live' }],
    gaps: ['No board row for this account.', 'No 1Click deposit matched.', 'Historic rules version: missing.'],
    label: 'Live timeline. 1 rows. board none, rules missing. tx 1. rpc 1. ft none. wrap none. 1click none.',
  };
  const got = accountRows({
    account: 'alice.near',
    board: { txs: [{ hash: HASH, signer: 'nearcarta.near', decision: 'allowed', shop: 'board', note: 'allowed' }] },
    mainnet,
    live,
  });
  assert.equal(got.rows.length, 1);
  assert.equal(got.rows[0].h, hash);
  assert.match(got.rows[0].url, /nearblocks\.io\/txns\//);
  assert.match(got.coverage.label, /Live timeline/);
  assert.equal(got.rows.some(r => r.h === HASH), false);
  assert.match(got.coverage.gaps.join(' '), /No 1Click deposit matched/);
  const empty = accountRows({
    account: 'nobody.near', mainnet,
    live: { rows: [], gaps: ['nearblocks.io returned no transactions for this account.'], label: 'No rows for this account. board: none, rules missing. transactions: none.' },
  });
  assert.equal(empty.rows.length, 0);
  assert.match(empty.coverage.label, /No rows/);
  const rows = [{ h: hash }];
  const bound = bundleDigest({ account: 'alice.near', period: {}, rows });
  const requestBody = JSON.stringify({ messages: [{ role: 'user', content: `Canonical bundle digest: ${bound}` }] });
  const reqSha = sha256Hex(requestBody);
  const respSha = sha256Hex('response-bytes');
  const model = 'test-model';
  const signedText = `${model}:${reqSha}:${respSha}`;
  const kp = nacl.sign.keyPair();
  const signature = Buffer.from(nacl.sign.detached(new TextEncoder().encode(signedText), kp.secretKey)).toString('hex');
  const statement = `Delivered 1. Canonical digest ${bound}. Historic rules: missing.`;
  const manifest = canonicalManifest({ account: 'alice.near', rows, statement, model });
  const proof = {
    mode: 'near-ai', model, signature, signing_address: Buffer.from(kp.publicKey).toString('hex'),
    signature_kind: 'provider_tee', signed_text: signedText, reqSha, respSha, requestBody, digest: bound, serverVerified: false,
  };
  const ok = await verifyNearAi({ manifestText: manifest.text, statement, digest: manifest.digest, proof });
  assert.equal(ok.ok, true);
  assert.match(ok.why, /Ed25519 signature over the request and response hashes: verified/);
  assert.match(ok.why, /Canonical digest inside that request: verified/);
  assert.match(ok.why, /TEE quote \(Intel DCAP, TCB, RTMR3\): not verified in this browser/);
  assert.match(ok.why, /server-side/);
  const tee = teeNowText(proof, {
    ok: true,
    models: [{ signing_address: proof.signing_address, checks: { quote: true, debugOff: true, nonceBound: true, echoedNonce: true, signerBound: true, configBound: true, composeEvent: true, rtmr3: true }, tcbStatus: 'UpToDate' }],
    gateway: { checks: { quote: true, debugOff: true, nonceBound: true, echoedNonce: true, signerBound: true, configBound: true, composeEvent: true, rtmr3: true }, tcbStatus: 'UpToDate' },
    nonce: 'abc',
  });
  assert.match(tee, /Intel TDX quote: verified/);
  assert.match(tee, /Signer matches the live attestation/);
  const flipped = { ...proof, digest: 'b'.repeat(64) };
  const bad = await verifyNearAi({ manifestText: manifest.text, statement, digest: manifest.digest, proof: flipped });
  assert.equal(bad.ok, false);
  const local = await verifyNearAi({ manifestText: manifest.text, statement, digest: manifest.digest, proof: { mode: 'local-fallback', digest: bound } });
  assert.equal(local.ok, true);
  assert.match(local.why, /Local fallback\. Not a NEAR AI signature/);
  assert.match(local.why, /TEE quote \(Intel DCAP, TCB, RTMR3\): not verified/);
});

test('a statement digest rejects tampering and a private note stays salted', async () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const rows = [{ shop: 'toll', decision: 'allowed', h: HASH, amount: '0.001 NEAR' }, { shop: 'toll', decision: 'denied', reason: 'refunded', h: 'B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR', amount: '0' }];
  const totals = csvTotals(rows);
  assert.equal(totals.delivered, 1);
  assert.equal(totals.refunded, 1);
  const written = writeStatement({ account: 'alice.near', period: { from: '', to: '' }, rows, totals });
  assert.match(written.text, /Historic rules: missing/);
  assert.match(written.status, /Nothing was signed/);
  const manifest = canonicalManifest({ account: 'alice.near', rows, statement: written.text, rules: null });
  const intact = await verifyBundle({ manifestText: manifest.text, statement: written.text, digest: manifest.digest });
  assert.equal(intact.ok, true);
  assert.match(intact.why, /unverified|missing/i);
  const tampered = await verifyBundle({ manifestText: manifest.text, statement: written.text + ' extra', digest: manifest.digest });
  assert.equal(tampered.ok, false);
  const flipped = manifest.text.replace(HASH, HASH.replace('8', '9'));
  const badDigest = await verifyBundle({ manifestText: flipped, statement: written.text, digest: manifest.digest });
  assert.equal(badDigest.ok, false);
  const kp = nacl.sign.keyPair();
  const sig = Buffer.from(nacl.sign.detached(new TextEncoder().encode(written.text), kp.secretKey)).toString('hex');
  const pub = Buffer.from(kp.publicKey).toString('hex');
  const signed = await verifyBundle({ manifestText: manifest.text, statement: written.text, digest: manifest.digest, signature: sig, publicKey: pub });
  assert.equal(signed.ok, true);
  assert.match(signed.why, /TEE binding is unverified/);
  const badSig = await verifyBundle({ manifestText: manifest.text, statement: written.text + 'x', digest: manifest.digest, signature: sig, publicKey: pub });
  assert.equal(badSig.ok, false);
  const blocked = anchorPlan({ manifest, consent: false, privateNote: 'secret note', salt: 'salt' });
  assert.equal(blocked.event, null);
  assert.match(blocked.reason, /raw hash was not published/i);
  const held = anchorPlan({ manifest, consent: true, privateNote: 'secret note', salt: 'salt1234' });
  assert.equal(held.ok, true);
  assert.equal(held.signed, false, 'the plan never claims a signature it did not send');
  assert.equal(held.method, 'anchor');
  assert.equal(held.args.digest, manifest.digest);
  assert.equal(held.args.salt, 'salt1234');
  // The board accepts 8..=64 ASCII alphanumerics, so a short or symbolic salt never reaches it.
  assert.match(anchorPlan({ manifest, salt: 'short' }).reason, /8 to 64/);
  assert.match(anchorPlan({ manifest, salt: 'salt-1234' }).reason, /8 to 64/);
  assert.match(anchorPlan({ manifest: { digest: 'nope' } }).reason, /Write the statement first/);
  assert.notEqual(held.commitment, sha256Hex('secret note'));
  assert.notEqual(held.commitment, manifest.digest, 'the raw digest is never the published commitment');
});

test('a real board anchor event rebuilds the index and proves the commitment', () => {
  const manifest = canonicalManifest({ account: 'alice.near', period: { from: '', to: '' }, rows: [{ h: HASH }], statement: 'Statement text.', model: 'near-ai' });
  const plan = anchorPlan({ manifest, salt: 'saltsalt' });
  assert.equal(plan.ok, true);
  // The event shape `anchor` logs, byte for byte from contracts/charter_board/src/v2.rs.
  const line = 'EVENT_JSON:' + JSON.stringify({
    standard: 'nearcarta-board', version: '2', event: 'anchor', owner: 'alice.near',
    kind: 'statement', commitment: plan.commitment, nonce: '3', time: '1700000000000000000',
  });
  const events = anchorEventsFromReceipts([{ id: 'TX1', executor_id: 'alice.near', outcome: { logs: [line] } }]);
  assert.equal(events.length, 1);
  assert.equal(events[0].commitment, plan.commitment);
  assert.equal(events[0].nonce, '3');
  assert.equal(events[0].tx, 'TX1');
  assert.equal(events[0].digest, undefined, 'the raw digest is not in the event');
  const index = rebuildIndex(events);
  assert.equal(index.byCommitment[plan.commitment].owner, 'alice.near');
  assert.equal(index.byCommitment[plan.commitment].commitment, plan.commitment);
  const proof = anchorProof({ commitment: plan.commitment, owner: 'alice.near', events });
  assert.equal(proof.ok, true);
  assert.match(proof.why, /alice\.near/);
  assert.match(proof.why, /nonce 3/);
  // Another visitor's event never proves this one, and a stranger's commitment never matches.
  assert.equal(anchorProof({ commitment: plan.commitment, owner: 'bob.near', events }).ok, false);
  assert.equal(anchorProof({ commitment: 'ab'.repeat(32), owner: 'alice.near', events }).ok, false);
  assert.match(anchorProof({ commitment: plan.commitment, events: [] }).why, /has not logged this commitment/);
  // A non-anchor log, a malformed line and the migrate event are all ignored.
  const noise = anchorEventsFromReceipts([{ id: 'TX2', outcome: { logs: [
    'EVENT_JSON:{"standard":"nearcarta-board","version":"2","event":"migrate","rows":"2"}',
    'EVENT_JSON:{not json',
    'plain log line',
  ] } }]);
  assert.deepEqual(noise, []);
  // Two anchors of the same commitment keep chain order: the later event wins.
  const second = line.replace('"nonce":"3"', '"nonce":"9"');
  const both = rebuildIndex(anchorEventsFromReceipts([
    { id: 'TX1', outcome: { logs: [line] } },
    { id: 'TX3', outcome: { logs: [second] } },
  ]));
  assert.equal(both.byCommitment[plan.commitment].nonce, '9');
  assert.equal(both.byCommitment[plan.commitment].tx, 'TX3');
});
