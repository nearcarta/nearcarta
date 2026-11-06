import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PASS_YOCTO, TOLL_HINT, TOLL_CHRONICLE_KEY,
  yoctoNear, parseTollCommand, tollCapCheck, proofWords, addressWords, splitWords,
  assembleTollLive, rememberTollPass, tollChronicleRows, mergeTollChronicle, tollMarkup,
  passPaidCopy, nextRowBalance, policyWords, latestVisitorPass, describeVisitorPass, tollChronicleStore,
  policyQuote, relayDecision, formatWei,
} from '../../../app/src/panels/toll-room.js';
import { broadcastLatest } from '../../src/toll-relay.js';
import { readTollLive, tollLiveError } from '../../src/toll-views.js';
import { armTollDock, installTollDock, dispatchTollDock, lastTollDockSend, DOCK_NOT_READY, tollPendingLine, tollDockLog } from '../../../app/src/panels/toll-dock.js';

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

test('a toll command pays the address the visitor names', () => {
  const quote = { payable: true, feeNear: '0.002', feeYocto: '2000000000000000000000', foreignEth: '0.00001' };
  const to = '0x0000000000000000000000000000000000000001';
  const pay = parseTollCommand(`pay 0.00001 ETH to ${to} on Base`, quote);
  assert.equal(pay.action, 'pay');
  assert.equal(pay.to, to);
  assert.equal(pay.asset, 'native');
  assert.equal(pay.amount, '0.00001');
  assert.equal(pay.feeYocto, quote.feeYocto);
  const usdc = parseTollCommand(`pay 1 USDC to ${to} on Base`, quote);
  assert.equal(usdc.action, 'pay');
  assert.equal(usdc.asset, 'usdc');
  assert.equal(usdc.amount, '1');
  assert.equal(parseTollCommand('Pay the toll', quote).action, 'asset');
  assert.match(parseTollCommand('Pay the toll on Base', quote).hint, /ETH or USDC/);
  assert.match(parseTollCommand(`pay ETH to ${to} on Base`, quote).hint, /Name the amount/);
  const other = parseTollCommand('pay 0.001 NEAR', quote);
  assert.equal(other.action, 'amount');
  assert.match(other.hint, /0\.002/);
  const over = parseTollCommand(`pay 1 ETH to ${to} on Base`, quote);
  assert.equal(over.action, 'cap');
  const arb = parseTollCommand('cross to Arbitrum', quote);
  assert.equal(arb.action, 'route');
  assert.match(arb.hint, /own instance/);
  assert.equal(parseTollCommand('pay the toll to 0x123', quote).action, 'asset');
  assert.equal(parseTollCommand('Pay the toll').action, 'fee');
  assert.equal(parseTollCommand('Check signature').action, 'check');
  assert.equal(parseTollCommand('Show policy').action, 'policy');
  assert.equal(parseTollCommand('Show my foreign address').action, 'address');
  assert.equal(parseTollCommand('Show the ledger').action, 'ledger');
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
  assert.match(splitWords(live), /not a Base payment/);
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
  assert.equal(merged[0].label, 'NEAR pass');
});

test('the toll card shows both actions, real icons, and no Base payment claim', () => {
  const html = tollMarkup({});
  assert.match(html, /data-testid="toll-pane-proof" hidden/);
  assert.match(html, /data-testid="toll-pane-split" hidden/);
  assert.match(html, /type="button"[^>]*data-testid="toll-tab-proof"/);
  assert.match(html, /data-testid="toll-pay"/);
  assert.equal(html.slice(0, html.indexOf('data-testid="toll-pane-proof"')).includes('check-signature'), false);
  const proof = tollMarkup({ tab: 'proof' });
  const proofHtml = proof.slice(proof.indexOf('data-testid="toll-pane-proof"'), proof.indexOf('data-testid="toll-pane-split"'));
  assert.match(proofHtml, /id="toll-sig" data-testid="check-signature"/);
  assert.doesNotMatch(proofHtml, /class="[^"]*primary[^"]*" id="toll-sig"|class="ferry-cta" id="toll-sig"/);
  assert.match(proofHtml, /Check signature/);
  assert.match(proofHtml, /No address yet/);
  assert.doesNotMatch(proofHtml, /0x4c07/i);
  assert.doesNotMatch(proofHtml, /data-testid="toll-pay"/);
  const split = tollMarkup({ tab: 'split' });
  assert.doesNotMatch(split.slice(split.indexOf('data-testid="toll-pane-split"')), /data-testid="toll-pay"|data-testid="check-signature"/);
  assert.doesNotMatch(html, /0\.001/);
  assert.match(html, /Live policy has no visitor fee/);
  assert.match(html, /data-testid="toll-to"/);
  assert.match(html, /Destination/);
  assert.match(html, />Pay</);
  assert.match(html, />Wallet</);
  assert.match(html, />Ledger</);
  assert.equal((html.match(/class="ferry-cta"/g) || []).length, 1);
  assert.doesNotMatch(html, /0xBDfC|0x1cdb/i);
  assert.match(html, /data-testid="toll-route-base"/);
  assert.match(html, /data-testid="toll-route-arb"/);
  assert.match(html, /src="\/tokens\/near\.svg"/);
  assert.match(proof, /src="\/tokens\/chains\/base\.svg"/);
  assert.match(proof, /alt="ETH"/);
  assert.match(proof, /\/tokens\/chains\/base\.svg/);
  assert.doesNotMatch(html, /Paid on Base/);
  assert.doesNotMatch(html, /tokenBadge\('ETH'/);
  const busy = tollMarkup({ pending: 'Asking the charter under your cap…' });
  assert.match(busy, /disabled/);
  assert.match(busy, /Asking the charter under your cap/);
});

test('the live toll read asks for policy and numeric nonces, and skips a missing row', async () => {
  const seen = [];
  const out = await readTollLive(async (contract, method, args) => {
    seen.push({ contract, method, args });
    if (method === 'policy') {
      return { next_nonce: '2', path: 'base-1', chain_id: 8453, foreign_address: '0xabc', mpc: 'v1.signer', gate: { fee: ONE, payee: 'p.near' } };
    }
    if (args.nonce === 0) throw new Error('gap');
    return { nonce: args.nonce, status: 'signed' };
  });
  assert.equal(seen[0].method, 'policy');
  assert.equal(seen[0].contract, 'toll.nearcarta.near');
  assert.deepEqual(seen.filter(s => s.method === 'get_tx').map(s => s.args.nonce), [0, 1]);
  assert.equal(out.recent.length, 1);
  assert.equal(out.recent[0].nonce, 1);
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
  assert.match(ui, /data-toll-chip="Pay the toll"/);
  assert.match(ui, /data-toll-chip="Pay the toll on Base"/);
  assert.match(ui, /data-toll-chip="Check signature"/);
  assert.match(ui, /data-toll-chip="Show policy"/);
  assert.doesNotMatch(ui, /tollVisit\(\)/);
  assert.match(scene, /if \(!opts\.success/);
  assert.doesNotMatch(scene, /if \(!opts\.success \|\| opened\)/);
  assert.match(scene, /actGen/);
  const tollFn = read('app/design/D8_shops/js/apps.js');
  const body = tollFn.slice(tollFn.indexOf('export async function toll'), tollFn.indexOf('// Older gate calls'));
  assert.match(body, /Set up your agent in \/setup/);
  assert.match(body, /propose_call_as/);
  assert.match(body, /Nothing was signed/);
  assert.doesNotMatch(body, /boardPay/);
  assert.doesNotMatch(body, /propose_batch|\bask\(/);
  assert.doesNotMatch(body, /0\.001/);
  assert.doesNotMatch(body, /sign\(/);
  // The recipient and the amount come from the visitor's words, never a constant.
  assert.doesNotMatch(body, /0x[0-9a-fA-F]{40}/);
  assert.match(body, /quote\.to/);
  assert.match(body, /quote\.amount/);
  // A visitor with no row is told to open one, not handed a generic setup error.
  assert.match(ui, /Open your row in \/setup first/);
  assert.match(ui, /Finish the helper key in \/setup/);
  const plan = read('backend/scripts/toll-redeploy.js');
  assert.match(plan, /sends: false/);
  assert.match(plan, /method: 'close'/);
  assert.match(plan, /set_price/);
  assert.match(plan, /sign_cross/);
  assert.match(plan, /allow_to: \[\]/);
  assert.match(plan, /method: 'upgrade'/);
  assert.match(plan, /migrate/);
  assert.match(plan, /base-1/);
  assert.match(plan, /8453/);
  assert.match(plan, /row:/);
  assert.doesNotMatch(plan, /0xBDfC|0x1cdb/i);
  assert.match(plan, /nearcarta\.near/);
  const oath = read('contracts/toll/src/lib.rs');
  assert.match(oath, /fn cross\(/);
  assert.match(oath, /fn sign_cross/);
  assert.match(oath, /fn address_of/);
  assert.match(oath, /fn refund_order/);
  assert.match(oath, /fn migrate/);
  assert.doesNotMatch(oath, /fn set_policy/);
  assert.match(read('app/design/D9_world/world.css'), /min\(640px/);
  assert.match(read('app/src/panels/panels.css'), /pointer-events:auto/);
  assert.match(tear, /sends: false/);
  assert.match(tear, /method: 'close'/);
  assert.match(tear, /deposit_yocto: '1'/);
});

test('a paid pass names the payment, the new balance, and the visitor receipt', () => {
  const hash = '3frACAL1EU4APBcAME8gNg1xw4uKSnXc81hj2c56Jdon';
  assert.equal(nextRowBalance('359249000000000000000000'), '0.358249');
  const copy = passPaidCopy({ balanceNear: '0.358249', feeNear: '0.002' });
  assert.match(copy, /Pass paid/);
  assert.match(copy, /0\.002 NEAR went to toll\.nearcarta\.near/);
  assert.match(copy, /Row balance 0\.358249 NEAR/);
  assert.match(copy, /not a Base payment/);
  const words = describeVisitorPass({ ok: true, decision: 'allowed', receiver: 'toll.nearcarta.near', amount: ONE }, { hash });
  assert.match(words.text, /Your latest pass/);
  assert.match(words.text, /not a Base payment/);
  assert.match(words.text, new RegExp(hash));
  assert.equal(describeVisitorPass({ ok: true, decision: 'allowed', receiver: 'other.near', amount: ONE }, { hash }).ok, false);
  assert.equal(latestVisitorPass({ rows: [{ h: hash, decision: 'denied' }, { h: 'CwcBGcw9FUt7FmpaVdgSPVKK1d9krWt4TE1z46WUfHez', decision: 'allowed' }] }).h, 'CwcBGcw9FUt7FmpaVdgSPVKK1d9krWt4TE1z46WUfHez');
  assert.match(policyWords({ ok: true, contract: 'toll.nearcarta.near', path: 'base-1', chain_id: 8453 }), /base-1/);
  assert.match(policyWords({ ok: false }), /did not answer/);
  assert.equal(tollPendingLine('Pay the toll'), 'Asking the charter under your cap…');
  assert.equal(tollPendingLine('cross'), 'Asking the charter under your cap…');
  assert.equal(tollPendingLine('Show policy'), 'Reading…');
});

test('a toll pass stays in localStorage across a reload', () => {
  const box = mem();
  const prev = globalThis.localStorage;
  globalThis.localStorage = box;
  try {
    assert.equal(tollChronicleStore(), box);
    const hash = '3frACAL1EU4APBcAME8gNg1xw4uKSnXc81hj2c56Jdon';
    rememberTollPass({ h: hash, decision: 'allowed', label: '0.001 NEAR pass' });
    assert.equal(tollChronicleRows().length, 1);
    assert.equal(JSON.parse(box.getItem(TOLL_CHRONICLE_KEY))[0].h, hash);
  } finally {
    if (prev === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prev;
  }
});

test('the live policy prices the pass and a receipt is the only Base payment', async () => {
  const live = assembleTollLive({
    contract: 'toll.nearcarta.near',
    policy: {
      mpc: 'v1.signer', path: 'base-1', chain_id: 8453, verify_chain: 'Base',
      foreign_address: '0x4c07c97812098f595ff1611d8cb3465e591ee38a',
      allow_to: ['0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034'],
      max_per_tx: '10000000000000', budget: '30000000000000', spent: '1000000000000',
      cross: { board: 'board.nearcarta.near', pass_fee: '2000000000000000000000', foreign_value: '1000000000000' },
    },
    txs: [{ nonce: 0, status: 'signed', to: '0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034', tx_hash: '0x' + 'ab'.repeat(32), raw_signed: '0x02aa', value: '1000000000000' }],
  });
  assert.equal(live.quote.payable, true);
  assert.equal(live.quote.feeNear, '0.002');
  assert.equal(live.quote.foreignTo, '');
  assert.equal(formatWei('1000000000000'), '0.000001');
  assert.match(policyWords(live), /0\.002/);
  assert.match(splitWords(live), /no revenue split/);
  const judged = { ok: true, decision: 'allowed', receiver: 'toll.nearcarta.near', amount: '2000000000000000000000' };
  const waiting = relayDecision({ judged, quote: live.quote, record: { status: 'signing' } });
  assert.notEqual(waiting.claim, 'paid');
  const signed = relayDecision({ judged, quote: live.quote, record: live.recent[0] });
  assert.equal(signed.step, 'broadcast');
  assert.doesNotMatch(signed.text, /Paid on Base/);
  const paid = relayDecision({ judged, quote: live.quote, record: live.recent[0], receipt: { status: 1 } });
  assert.equal(paid.claim, 'paid');
  assert.match(paid.text, /basescan\.org\/tx\//);
  const svg = readFileSync(new URL('../../../app/src/tokens/chains/base.svg', import.meta.url), 'utf8');
  assert.ok((svg.match(/<path/g) || []).length > 1);
  assert.match(svg, /fill="#fff"/i);
  const calls = [];
  const out = await broadcastLatest({
    policy: live,
    txs: live.recent,
    fetchImpl: async (_url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push(body.method);
      if (body.method === 'eth_getTransactionReceipt') return { json: async () => ({ result: null }) };
      return { json: async () => ({ result: '0x' + 'cd'.repeat(32) }) };
    },
  });
  assert.deepEqual(calls, ['eth_getTransactionReceipt', 'eth_sendRawTransaction']);
  assert.equal(out.claim, 'signed');
  assert.doesNotMatch(out.text, /Paid on Base/);
  const unread = policyQuote({ ok: false });
  assert.equal(unread.payable, false);
  assert.match(tollMarkup({}).replace(/\s+/g, ' '), /no visitor fee/);
});

test('the agent log keeps the nearblocks link when a pass is paid', () => {
  const doc = fakeDoc();
  const hash = '3frACAL1EU4APBcAME8gNg1xw4uKSnXc81hj2c56Jdon';
  tollDockLog(doc, passPaidCopy({ balanceNear: '0.358249' }), { tx: hash });
  assert.match(doc._nodes['t-agent-log'].textContent, /Pass paid/);
  assert.match(doc._nodes['t-agent-log'].textContent, new RegExp(hash));
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
