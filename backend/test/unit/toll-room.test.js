import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PASS_YOCTO, TOLL_HINT, TOLL_CHRONICLE_KEY,
  yoctoNear, parseTollCommand, tollCapCheck, proofWords, addressWords, splitWords,
  assembleTollLive, rememberTollPass, tollChronicleRows, mergeTollChronicle, tollMarkup,
} from '../../../app/src/panels/toll-room.js';
import { readTollLive, tollLiveError } from '../../src/toll-views.js';
import { armTollDock, installTollDock, dispatchTollDock, lastTollDockSend, DOCK_NOT_READY } from '../../../app/src/panels/toll-dock.js';

const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const ONE = PASS_YOCTO.toString();
const rowOk = {
  receivers: ['toll.nearcarta.near'],
  capYocto: '5000000000000000000000000',
  balanceYocto: '1000000000000000000000000',
  spentYocto: '0',
  dailyYocto: '10000000000000000000000000',
  minYocto: '1',
  expiresAtNs: '9',
  nowNs: '1',
  frozen: false,
};

function mem() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, v); } };
}

test('a toll command pays 0.001 and refuses any other amount', () => {
  assert.equal(parseTollCommand('Pay the toll').action, 'pay');
  assert.equal(parseTollCommand('Pay 0.001 NEAR toll').ok, true);
  const other = parseTollCommand('Pay 0.05 NEAR');
  assert.equal(other.ok, false);
  assert.equal(other.action, 'amount');
  assert.match(other.hint, /0\.001/);
  assert.match(other.hint, /Nothing was signed/);
  assert.equal(parseTollCommand('Check signature').action, 'check');
  assert.equal(parseTollCommand('Show my foreign address').action, 'address');
  assert.equal(parseTollCommand('Explain the Base address').action, 'address');
  const miss = parseTollCommand('hello');
  assert.equal(miss.ok, false);
  assert.equal(miss.hint, TOLL_HINT);
});

test('the 0.001 pass is refused before a signature when the row cannot hold it', () => {
  assert.equal(tollCapCheck(rowOk), null);
  assert.match(tollCapCheck({ ...rowOk, frozen: true }), /frozen/);
  assert.match(tollCapCheck({ ...rowOk, expiresAtNs: '1', nowNs: '9' }), /expired/);
  assert.match(tollCapCheck({ ...rowOk, receivers: ['ferry.nearcarta.near'] }), /toll\.nearcarta\.near/);
  assert.match(tollCapCheck({ ...rowOk, capYocto: '1' }), /cap is smaller/);
  assert.match(tollCapCheck({ ...rowOk, balanceYocto: '1' }), /does not hold 0\.001/);
  assert.match(tollCapCheck({ ...rowOk, spentYocto: ONE, dailyYocto: ONE }), /daily budget/);
  assert.equal(tollCapCheck({ ...rowOk, expiresAtNs: '0', nowNs: '999' }), null);
  assert.match(tollCapCheck({ ...rowOk, capYocto: '' }), /cap could not be read/);
});

test('Paid on Base is only the words when a Base receipt succeeded', () => {
  const none = proofWords(null);
  assert.notEqual(none.claim, 'paid');
  assert.doesNotMatch(none.text, /Paid on Base/);
  const signed = proofWords({ status: 'signed' });
  assert.equal(signed.claim, 'signed');
  assert.match(signed.text, /No Base payment/);
  const confirmed = proofWords({ status: 'confirmed' });
  assert.equal(confirmed.claim, 'proof');
  assert.match(confirmed.text, /has not read a Base success receipt/);
  const paid = proofWords({ status: 'confirmed' }, { baseReceipt: { status: 1 } });
  assert.equal(paid.claim, 'paid');
  assert.match(paid.text, /Paid on Base/);
  const failedReceipt = proofWords({ status: 'confirmed' }, { baseReceipt: { status: 0 } });
  assert.notEqual(failedReceipt.claim, 'paid');
});

test('a live toll view keeps the gate fee and does not call a signature a payment', () => {
  assert.equal(yoctoNear(ONE), '0.001');
  assert.equal(yoctoNear('1000000000000000000000000'), '1');
  const live = assembleTollLive({
    contract: 'toll.nearcarta.near',
    policy: {
      mpc: 'v1.signer', path: 'base-1', chain_id: 8453,
      foreign_address: '0x4c07c97812098f595ff1611d8cb3465e591ee38a',
      next_nonce: '2',
      gate: { fee: ONE, payee: 'payee.near', memo: 'toll', evm_to: '0xabc', evm_value: '0' },
    },
    txs: [{ nonce: '1', status: 'signed', to: '0xabc' }],
  });
  assert.equal(live.gate.fee_near, '0.001');
  assert.equal(live.recent[0].claim, 'signed');
  assert.doesNotMatch(live.recent[0].words, /Paid on Base/);
  assert.match(splitWords(live), /0\.001 NEAR/);
  assert.match(splitWords(live), /does not broadcast/);
  assert.match(splitWords({}), /no revenue split/);
  const addr = addressWords({ recorded: '0xabc', live: '0xABC', path: 'base-1', chainId: 8453, ok: true });
  assert.match(addr.text, /base-1/);
  assert.match(addr.text, /not a Base payment/);
  assert.match(addressWords({ ok: false }).text, /does not hash/);
});

test('a pass is remembered for Chronicle and a second copy of the same hash is dropped', () => {
  const storage = mem();
  rememberTollPass({ h: '4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz', decision: 'allowed', label: '0.001 NEAR pass' }, storage);
  rememberTollPass({ h: '4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz', decision: 'allowed' }, storage);
  const rows = tollChronicleRows(storage);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].shop, 'toll');
  assert.equal(JSON.parse(storage.getItem(TOLL_CHRONICLE_KEY)).length, 1);
  const merged = mergeTollChronicle(
    [{ shop: 'toll', h: '4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz', label: 'recorded' }],
    rows,
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].label, '0.001 NEAR pass');
});

test('the toll card shows both actions, real icons, and no Base payment claim', () => {
  const html = tollMarkup({});
  assert.match(html, /data-testid="toll-pane-proof" hidden/);
  assert.match(html, /data-testid="toll-pane-split" hidden/);
  assert.match(html, /class="primary" id="toll-sig" data-testid="check-signature">Check signature</);
  assert.match(html, /src="\/tokens\/near\.svg"/);
  assert.match(html, /src="\/tokens\/chains\/base\.svg"/);
  assert.match(html, /alt="Base"/);
  assert.doesNotMatch(html, /Paid on Base/);
  assert.doesNotMatch(html, /tokenBadge\('ETH'/);
});

test('the live toll read asks for policy and string nonces, and skips a missing row', async () => {
  const seen = [];
  const out = await readTollLive(async (contract, method, args) => {
    seen.push({ contract, method, args });
    if (method === 'policy') {
      return { next_nonce: '2', path: 'base-1', chain_id: 8453, foreign_address: '0xabc', mpc: 'v1.signer', gate: { fee: ONE, payee: 'p.near' } };
    }
    if (args.nonce === '0') throw new Error('gap');
    return { nonce: args.nonce, status: 'signed' };
  });
  assert.equal(seen[0].method, 'policy');
  assert.equal(seen[0].contract, 'toll.nearcarta.near');
  assert.deepEqual(seen.filter(s => s.method === 'get_tx').map(s => s.args.nonce), ['0', '1']);
  assert.equal(out.recent.length, 1);
  assert.equal(out.recent[0].nonce, '1');
  assert.equal(out.gate.fee_near, '0.001');
});

test('a thrown policy view is an honest miss, not an empty success', async () => {
  await assert.rejects(() => readTollLive(async () => { throw new Error('rpc down'); }));
  const miss = tollLiveError(new Error('rpc down'));
  assert.equal(miss.ok, false);
  assert.match(miss.error, /rpc down/);
  assert.equal(miss.contract, 'toll.nearcarta.near');
  assert.deepEqual(miss.recent, []);
  const app = read('backend/src/app.js');
  assert.match(app, /readTollLive\(view\)/);
  assert.match(app, /tollLiveError\(e\)/);
});

test('Send clears the line only when the agent accepted it', async () => {
  const doc = fakeDoc();
  installTollDock(doc);
  installTollDock(doc);
  assert.equal(doc._listeners.length, 2);
  doc._nodes['t-agent'].value = 'Pay the toll';
  armTollDock(async () => ({ ok: true, hint: '0.001 NEAR is on mainnet. This pass does not pay Base.' }));
  await dispatchTollDock(doc);
  assert.equal(doc._nodes['t-agent'].value, '');
  assert.match(doc._nodes['t-agent-log'].textContent, /does not pay Base/);
  doc._nodes['t-agent'].value = 'nope';
  armTollDock(async () => ({ ok: false, hint: TOLL_HINT }));
  await dispatchTollDock(doc);
  assert.equal(doc._nodes['t-agent'].value, 'nope');
  assert.equal(doc._nodes['t-agent-log'].textContent, TOLL_HINT);
  doc._nodes['t-agent'].value = 'Check signature';
  armTollDock(async () => ({ ok: true, hint: 'checked' }));
  doc._fire('keydown', doc._nodes['t-agent'], { key: 'Enter' });
  await lastTollDockSend();
  assert.equal(doc._nodes['t-agent'].value, '');
  doc._nodes['t-agent'].value = 'Show my foreign address';
  doc._fire('click', doc._nodes['t-agent-go']);
  await lastTollDockSend();
  assert.equal(doc._nodes['t-agent'].value, '');
  let calls = 0;
  let release;
  const gate = new Promise(r => { release = r; });
  armTollDock(() => { calls += 1; return gate.then(() => ({ ok: true, hint: 'ok' })); });
  const a = dispatchTollDock(doc);
  const b = dispatchTollDock(doc);
  assert.equal(a, b);
  release();
  await a;
  assert.equal(calls, 1);
  armTollDock(null);
  const miss = await dispatchTollDock(doc);
  assert.equal(miss.ok, false);
  assert.equal(miss.hint, DOCK_NOT_READY);
});

test('the city toll door stays a link and does not resume an old visit', () => {
  const html = read('app/design/D9_world/index.html');
  const main = read('app/design/D9_world/js/main.js');
  const ui = read('app/design/D8_shops/js/shopui.js');
  const scene = read('app/design/D8_shops/shops/toll.js');
  const tear = read('backend/scripts/toll-teardown.js');
  assert.match(html, /href="\/shops\/toll\/"/);
  assert.match(html, /window\.__enterToll/);
  assert.match(main, /window\.__enterToll = \(\) => goIn\('toll'\)/);
  assert.match(ui, /function tollPay/);
  assert.match(ui, /mergeTollChronicle/);
  assert.doesNotMatch(ui, /tollVisit\(\)/);
  assert.match(scene, /if \(!opts\.success/);
  assert.match(tear, /sends: false/);
  assert.match(tear, /method: 'close'/);
  assert.match(tear, /deposit_yocto: '1'/);
});

function fakeDoc() {
  const nodes = {};
  const listeners = [];
  const input = { value: '', closest(sel) { return sel === '#t-agent' ? input : null; } };
  const go = { closest(sel) { return sel === '#t-agent-go' ? go : null; } };
  const log = { hidden: true, textContent: '' };
  nodes['t-agent'] = input;
  nodes['t-agent-go'] = go;
  nodes['t-agent-log'] = log;
  return {
    _nodes: nodes,
    _listeners: listeners,
    addEventListener(type, fn) { listeners.push({ type, fn }); },
    getElementById(id) { return nodes[id] || null; },
    _fire(type, target, extra = {}) {
      const e = { type, target, key: extra.key, preventDefault() { this.prevented = true; } };
      for (const l of listeners) if (l.type === type) l.fn(e);
    },
  };
}
