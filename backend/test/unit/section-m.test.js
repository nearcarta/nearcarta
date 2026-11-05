import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveTee, teeResult, teeSteps, teeView } from '../../../app/src/tee-view.js';
import { attackAt, advanceAttack, ATTACKS } from '../../../app/design/D8_shops/shops/arenalive.js';
import { prepareRows, receiptsFor } from '../../../app/design/D8_shops/js/payouts.js';
import { visitor } from '../../../app/design/D8_shops/js/session.js';
import { explainCheck } from '../../../app/src/guard-score.js';
import { corridorCards, ferryMarkup, DEFAULT_ROUTES } from '../../../app/src/panels/deep.js';
import { hallMarkup } from '../../../app/src/panels/hall-ui.js';

const read = p => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('a failed TEE names the step, and a quote error is the cert-chain reason', () => {
  const quote = teeView({
    ok: false,
    failure: 'gateway: quote: certificate chain',
    gateway: { ok: false, error: 'quote: certificate chain', checks: { quote: false }, tcbStatus: '' },
    models: [{ ok: false, error: 'quote: certificate chain', checks: { quote: false }, tcbStatus: '' }],
  });
  assert.equal(quote.ok, false);
  assert.match(quote.failed, /Intel TDX quote: quote: certificate chain/);
  assert.equal(teeSteps({ ok: false, error: 'nonce must be 32 bytes as 64 hex chars' })[0].label, 'NEAR AI attestation');
  const pass = teeView({ ok: true, model: 'm' });
  assert.equal(pass.label, 'attested');
  assert.equal(teeResult({ ok: false, err: 'No live check on this page.' }).text.includes('NEAR AI attestation'), true);
  const src = read('backend/src/tee.js');
  assert.match(src, /export function teeFailure/);
  assert.match(src, /quote: \$\{e\.message\}/);
  assert.match(src, /failure/);
});

test('the live TEE helper reports the HTTP step when the attestation route fails', async () => {
  const out = await liveTee({
    nonce: 'ab'.repeat(32),
    fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: 'too many tee checks' }) }),
  });
  assert.equal(out.ok, false);
  assert.match(out.failure, /too many tee checks/);
  assert.equal(out.steps[0].id, 'request');
});

test('another attack is a different prompt and does not call the vault', () => {
  const first = attackAt();
  const next = advanceAttack();
  assert.notEqual(next, first);
  assert.equal(attackAt(), next);
  assert.equal(ATTACKS.includes(next), true);
  assert.equal(read('app/src/panels/deep.js').includes('data-testid="arena-attack"'), true);
});

test('a blank payee is dropped and prepares nothing', () => {
  const blank = prepareRows([{ to: '', amt: '0.001' }, { to: '  ', amt: '0.001' }]);
  assert.equal(blank.blocked, true);
  assert.equal(blank.rows.length, 0);
  assert.match(blank.note, /payee/);
  assert.equal(receiptsFor(blank.rows).length, 0);
  const mixed = prepareRows([{ to: '', amt: '0.001' }, { to: 'cafe.near', amt: '0.001' }]);
  assert.equal(mixed.blocked, false);
  assert.equal(mixed.dropped, 1);
  assert.equal(receiptsFor(mixed.rows)[0].to, 'cafe.near');
});

test('one visitor reads the session for the chip, the hall and the bank', () => {
  const store = new Map();
  const storage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };
  storage.setItem('nearcarta.hero.v1', JSON.stringify({ name: 'Scholar', img: 'mage' }));
  assert.equal(visitor(storage).signedIn, false);
  storage.setItem('nearcarta.setup.v1', JSON.stringify({ accountId: 'visitor.near', displayName: 'Scholar', balanceNear: 1 }));
  const who = visitor(storage);
  assert.equal(who.signedIn, true);
  assert.equal(who.displayName, 'Scholar');
  assert.equal(who.accountId, 'visitor.near');
  assert.match(hallMarkup(null, who), /Signed in as Scholar/);
  assert.doesNotMatch(hallMarkup(null, who), /Sign in, then open/);
  assert.match(read('app/design/D9_world/js/hero-town.js'), /visitor\(\)/);
  assert.match(read('app/src/panels/deep.js'), /bank-session/);
});

test('ferry idle copy does not claim a quote or a deposit', () => {
  const cards = corridorCards(DEFAULT_ROUTES, []);
  assert.match(cards, /No quote yet/);
  assert.doesNotMatch(cards, /USD not quoted/);
  // Swap pane drops idle microcopy (airy sketch); corridors still say no quote yet.
  const idle = ferryMarkup({}, DEFAULT_ROUTES);
  assert.doesNotMatch(idle, /Waiting for the deposit/);
  assert.doesNotMatch(idle, /No deposit has been requested/);
  assert.match(idle, /You pay/);
  assert.match(idle, /value="3"/); // city default USDC corridor
  const quoted = ferryMarkup({ quoted: true, lines: [{ id: DEFAULT_ROUTES[0].id, usdText: '', text: 'ETH' }] }, DEFAULT_ROUTES);
  assert.match(quoted, /USD not quoted/);
  assert.doesNotMatch(quoted, /Waiting for the deposit/);
});

test('an empty code hash and a missing first-seen are both said in plain words', () => {
  const view = explainCheck({
    account: 'nearcarta.near',
    verdict: 'warn',
    reasons: [
      { code: 'age_unknown', level: 'warn', text: 'account age was not returned' },
      { code: 'unconfirmed', level: 'warn', text: 'empty code hash and no account age' },
    ],
    signals: { code_hash: '11111111111111111111111111111111', age_ms: null, exists: true },
  });
  assert.equal(view.verdict, 'warn');
  assert.match(view.lines.find(l => l.id === 'code').text, /no contract/);
  assert.match(view.lines.find(l => l.id === 'age').text, /first-seen time is not available/);
});

test('the loading card is in the first paint and the console does not claim a DAO oath', () => {
  const town = read('app/design/D9_world/index.html');
  assert.match(town, /#loading\{position:fixed/);
  assert.match(town, /id="loading"/);
  assert.doesNotMatch(town, /setTimeout\(hide, 1200\)/);
  const setup = read('app/house/setup.js');
  assert.match(setup, /data-testid="setup-steps"/);
  assert.match(setup, /data-testid="setup-step"/);
  const consoleJs = read('app/src/console.js');
  const consoleHtml = read('app/src/console.html');
  assert.doesNotMatch(consoleJs, /DAO-governed oath/);
  assert.doesNotMatch(consoleHtml, /DAO-governed oath/);
  assert.doesNotMatch(consoleJs, /Town Hall DAO/);
  assert.doesNotMatch(consoleJs, /shared DAO/);
  assert.match(consoleJs, /A rule change is set_rules on your own row/);
});

test('live scripts, the ignore file and the vercel report do not name deleted files', () => {
  const gone = [
    'guard-live.spec.js',
    'house.spec.js',
    'vault-ai.spec.js',
    'vault-create.spec.js',
    'vault-early-click.spec.js',
    'vault-feed.spec.js',
    'vault.spec.js',
    'oath-r16.json',
    'board-restart-live/before.json',
  ];
  const files = [
    'e2e/townhall-expiry-live.mjs',
    'e2e/arena-prompts-live.mjs',
    'e2e/board-restart-live.mjs',
    '.gitleaksignore',
    'judges/proofs/e2e-vercel.json',
  ];
  for (const f of files) {
    const text = read(f);
    for (const name of gone) assert.equal(text.includes(name), false, `${f} still names ${name}`);
  }
});
