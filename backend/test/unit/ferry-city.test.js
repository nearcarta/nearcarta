import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sha256 } from '@noble/hashes/sha2.js';
import { callMessage } from '../../../shared/board/message.js';
import { agentCargoPlan, parseAgentFerry, receiveConfirm } from '../../../app/src/panels/ferry-pair.js';
import { ferryMarkup } from '../../../app/src/panels/deep.js';
import { runFerryAgent } from '../../../app/src/panels/deep.js';
import {
  agentDeliveredNote, boardCallText, cityCheckoutBody, depositPlan, destExplorer, explainQuoteMiss, ferryStatusHtml, ferryStatusView, mayCheckout, nearAmount, newestReceipt, nextFerryBeat, pickWrapSpend, PROPOSE_CALL_BYTES, proposeCallPrepaidYocto, proposeCallTgas, quoteRecipient, SESSION_SWAP, stepsAllowanceYocto, validateDestAddress, WRAP, WRAP_STORAGE_YOCTO, wrapDepositYocto, wrapProgressNote,
} from '../../../app/src/panels/ferry-settle.js';
import { functionCallAllowanceCost } from '../../../shared/board/cost.js';
import { GAS_TOPUP_YOCTO } from '../../../shared/board/session.js';
import { armFerryDock, dispatchFerryDock, installFerryDock, lastFerryDockSend } from '../../../app/src/panels/ferry-dock.js';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

const choices = [
  { id: 'USDC|base', symbol: 'USDC', chain: 'base', label: 'USDC on base' },
  { id: 'ZEC|zec', symbol: 'ZEC', chain: 'zec', label: 'ZEC on zec' },
  { id: 'NEAR|near', symbol: 'NEAR', chain: 'near', label: 'NEAR on near' },
  { id: 'ETH|eth', symbol: 'ETH', chain: 'eth', label: 'ETH on eth' },
];

const ZEC_UA = 'u1naczqa5m5nefpyqnhs8h3dw8un8z8us45xwgfh4ees95mayyru9snc33dkfk2dc27r5syu4uveyyd5dt8wwad89kpc3f8cah055lm0ex';

test('get a quote for 3 USDC on base to ZEC fills the pair and does not spend', async () => {
  const phrase = `get a quote for 3 USDC on base to ZEC to ${ZEC_UA}`;
  const parsed = parseAgentFerry(phrase);
  assert.equal(parsed.from, 'USDC@base');
  assert.equal(parsed.to, 'ZEC@zec');
  assert.equal(parsed.amt, '3');
  assert.equal(parsed.receiveAt, ZEC_UA);
  assert.equal(agentCargoPlan(phrase, { charterReady: true }).mode, 'quote');
  const missing = agentCargoPlan('get a quote for 3 USDC on base to ZEC', { charterReady: true });
  assert.equal(missing.ok, false);
  assert.match(missing.hint, /Where should the tokens arrive on zec/);
  const calls = [];
  const loads = [];
  const state = {};
  const out = await runFerryAgent({
    text: phrase,
    state,
    charterReady: true,
    quotePair: async (from, to, amt) => {
      calls.push({ from, to, amt });
      return { ok: true, dry: true, from: { symbol: 'USDC', amount: amt, usd: '3' }, to: { symbol: 'ZEC', amount: '0.01' } };
    },
    onLoadCargo: async (opts) => { loads.push(opts); },
  });
  assert.equal(out.ok, true);
  assert.equal(out.loaded, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].from, 'USDC@base');
  assert.equal(calls[0].to, 'ZEC@zec');
  assert.equal(loads.length, 0);
  assert.equal(state.q.dry, true);
  assert.equal(state.q.tx, undefined);
});

test('a charter-ready swap calls Load cargo after the quote and invents no tx', async () => {
  const loads = [];
  const notes = [];
  const state = {};
  const bare = await runFerryAgent({
    text: 'Swap 3 USDC on Base to ZEC',
    state: {},
    charterReady: true,
    quotePair: async () => { throw new Error('should not quote without an address'); },
    onLoadCargo: async () => { throw new Error('should not load'); },
  });
  assert.equal(bare.ok, false);
  assert.match(bare.hint, /Where should the tokens arrive on zec/);
  const out = await runFerryAgent({
    text: `Swap 3 USDC on Base to ZEC to ${ZEC_UA}`,
    state,
    charterReady: true,
    quotePair: async () => ({ ok: true, dry: true, from: { amount: '3', usd: '3' }, to: { amount: '0.01' } }),
    onLoadCargo: async (opts) => { loads.push(opts); },
    onNote: (text) => { notes.push(text); },
  });
  assert.equal(out.ok, true);
  assert.equal(out.loaded, true);
  assert.deepEqual(loads, [{ charter: false }]);
  assert.equal(state.q.tx, undefined);
  assert.equal(notes[0], receiveConfirm('zec', ZEC_UA));
  assert.match(out.hint, /Receiving on zec at/);
  assert.match(out.hint, /propose_call/);
  assert.doesNotMatch(out.hint, /Asking the charter/);
});

test('ask charter without a session points at setup and does not load cargo', async () => {
  const loads = [];
  const out = await runFerryAgent({
    text: 'ask charter',
    state: { q: { from: { usd: '0.2' } } },
    charterReady: false,
    quotePair: async () => { throw new Error('should not quote'); },
    onLoadCargo: async (opts) => { loads.push(opts); },
  });
  assert.equal(out.mode, 'setup');
  assert.match(out.hint, /\/setup/);
  assert.equal(loads.length, 0);
});

test('load cargo with a session is the deposit path, not a demo', async () => {
  const loads = [];
  const out = await runFerryAgent({
    text: 'load cargo',
    state: { q: { from: { usd: '0.2' }, to: { amount: '1' } } },
    charterReady: true,
    onLoadCargo: async (opts) => { loads.push(opts); },
  });
  assert.deepEqual(loads, [{ charter: false }]);
  assert.match(out.hint, /deposit address/);
  assert.doesNotMatch(out.hint, /Demo crossing/);
});

function fakeDock() {
  const listeners = [];
  const mk = (id) => ({
    id,
    value: '',
    hidden: true,
    textContent: '',
    closest(sel) { return sel === '#' + id ? this : null; },
  });
  const input = mk('f-agent');
  const go = mk('f-agent-go');
  const log = mk('f-agent-log');
  const doc = {
    getElementById(id) { return { 'f-agent': input, 'f-agent-go': go, 'f-agent-log': log }[id] || null; },
    addEventListener(type, fn) { listeners.push({ type, fn }); },
  };
  const fire = (type, target, extra = {}) => {
    const e = { type, target, key: extra.key || '', preventDefault() {} };
    for (const l of listeners) if (l.type === type) l.fn(e);
  };
  installFerryDock(doc);
  return { doc, input, go, log, fire };
}

test('dock send quotes 0.05 wNEAR on NEAR to USDC and typing does not', async () => {
  const phrase = 'get a quote for 0.05 wNEAR on near to USDC';
  const parsed = parseAgentFerry(phrase);
  assert.equal(parsed.from, 'wNEAR@near');
  assert.equal(parsed.to, 'USDC@near');
  assert.equal(parsed.amt, '0.05');
  assert.equal(agentCargoPlan(phrase, { charterReady: true }).mode, 'quote');
  const { doc, input, go, log, fire } = fakeDock();
  const calls = [];
  armFerryDock((text) => runFerryAgent({
    text,
    state: {},
    charterReady: true,
    quotePair: async (from, to, amt) => {
      calls.push({ from, to, amt });
      return { ok: true, dry: true, from: { symbol: 'wNEAR', amount: amt, usd: '0.185' }, to: { symbol: 'USDC', amount: '0.18' } };
    },
  }));
  input.value = phrase;
  fire('input', input);
  fire('click', input);
  assert.equal(calls.length, 0);
  fire('click', go);
  const out = await lastFerryDockSend();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].from, SESSION_SWAP.from);
  assert.equal(calls[0].to, SESSION_SWAP.to);
  assert.equal(calls[0].amt, SESSION_SWAP.amt);
  assert.equal(out.loaded, false);
  assert.equal(input.value, '');
  assert.match(log.textContent, /Quote ready/);
  input.value = phrase;
  fire('keydown', input, { key: 'Enter' });
  await lastFerryDockSend();
  assert.equal(calls.length, 2);
  const form = { id: 'f-agent-form', closest(sel) { return sel === '#f-agent-form' ? this : null; } };
  input.value = phrase;
  fire('submit', form);
  await lastFerryDockSend();
  assert.equal(calls.length, 3);
  armFerryDock(async () => ({ ok: false, hint: explainQuoteMiss('1Click answered HTTP 400: Amount is too low for bridge, try at least 1671417') }));
  input.value = 'swap 0.2 USDC on base to ZEC';
  fire('click', go);
  await dispatchFerryDock(doc);
  assert.equal(input.value, 'swap 0.2 USDC on base to ZEC');
  assert.match(log.textContent, /bridge minimum/);
  assert.match(log.textContent, /1671417/);
  assert.match(log.textContent, /has not delivered/);
});

test('the city send button is re-armed after every bind and cannot no-op', () => {
  const ui = read('app/design/D8_shops/js/shopui.js');
  assert.match(ui, /id="f-agent-go"/);
  assert.match(ui, /id="f-agent-log"/);
  assert.match(ui, /wireFerryDock\(hooks\)/);
  assert.match(ui, /installFerryDock\(document\)/);
  assert.match(ui, /armFerryDock/);
  assert.match(ui, /go\.onclick = send/);
  assert.match(ui, /e\.key === 'Enter'/);
  assert.match(ui, /id="f-agent-form"/);
  assert.match(ui, /type="submit"/);
  assert.match(ui, /form\.onsubmit = send/);
  assert.match(ui, /dispatchFerryDock\(document\)/);
  const deep = read('app/src/panels/deep.js');
  assert.match(deep, /armFerryDock\(\(text\) => runAgent\(text\)\)/);
  assert.match(deep, /installFerryDock\(dockDoc\)/);
  assert.match(deep, /hooks\.runAgent = \(text\) => runAgent\(text\)/);
  assert.match(deep, /agentLog\(result\?\.hint/);
  const dock = read('app/src/panels/ferry-dock.js');
  assert.match(dock, /if \(result\?\.ok && input\) input\.value = ''/);
  assert.match(dock, /addEventListener\('click', onEvent, true\)/);
  assert.match(dock, /addEventListener\('submit', onEvent, true\)/);
  assert.match(dock, /e\.key === 'Enter'/);
});

test('typing ZEC or USDC filters both lists and keeps the chain filter', () => {
  const html = ferryMarkup({ tq: 'zec', choices, fromId: 'USDC|base', toId: 'ZEC|zec' });
  assert.match(html, /data-testid="ferry-token-search"/);
  assert.match(html, /value="zec"/);
  assert.match(html, /data-testid="ferry-chain-filter"/);
  assert.match(html, /4 live tokens/);
  assert.match(html, /ZEC on zec/);
  assert.doesNotMatch(html, /USDC on base/);
  const usdc = ferryMarkup({ tq: 'usdc', choices, fromId: 'USDC|base', toId: 'ZEC|zec' });
  assert.match(usdc, /USDC on base/);
  assert.doesNotMatch(usdc, /ZEC on zec/);
});

test('a successful seal hides Downgrade refused, and a new quote hides it again', () => {
  const src = read('app/design/D8_shops/shops/ferry.js');
  const ok = src.indexOf('seal.material = sealOk');
  assert.ok(ok > 0);
  assert.match(src.slice(Math.max(0, ok - 180), ok + 40), /hideRefuseTag\(\)/);
  assert.match(src, /el\.classList\.add\('hide'\)/);
  assert.match(src, /setAttribute\('hidden'/);
  assert.match(src, /const hideRefuse = \(\)/);
  const apply = src.indexOf('const applyPair');
  assert.match(src.slice(apply, apply + 80), /hideRefuse\(\)/);
  const ui = read('app/design/D8_shops/js/shopui.js');
  assert.match(ui, /clearFerryDeposit\(\)/);
  assert.match(ui, /sh\?\.hideRefuse\?\.\(\)/);
});

test('a session load plans a deposit and a guest load stays a demo', () => {
  const ui = read('app/design/D8_shops/js/shopui.js');
  const fn = ui.slice(ui.indexOf('async function settleFerry'), ui.indexOf('async function loadFerryCargo'));
  assert.match(fn, /Demo crossing only/);
  assert.match(fn, /A\.openFerryCheckout/);
  assert.match(fn, /A\.ferryProposeCalls/);
  assert.match(fn, /A\.wrapBoardState/);
  assert.match(fn, /pickWrapSpend/);
  assert.match(fn, /wrapRegistered/);
  assert.match(fn, /watchFerryDeposit/);
  assert.match(fn, /setOrder\?\.\('deposit'\)/);
  assert.match(fn, /hideRefuse/);
  assert.doesNotMatch(fn, /paintOrder\('delivered'\)/);
  assert.match(fn, /The boat does not say delivered/);
  assert.match(fn, /You are not asked to send USDC on Base/);
  assert.match(fn, /explainQuoteMiss/);
  assert.doesNotMatch(fn, /sh\.act\(\{ refused: false/);
  assert.match(ui, /sh\.act\(\{ refused: false, delivered: true \}\)/);
  const watch = ui.slice(ui.indexOf('function watchFerryDeposit'), ui.indexOf('async function settleFerry'));
  assert.match(watch, /beat\.play\) playFerryDelivered\(\)/);
  assert.match(watch, /showAgentDelivered/);
  assert.match(watch, /SUCCESS/);
  const play = ui.slice(ui.indexOf('function playFerryDelivered'), ui.indexOf('function showAgentDelivered'));
  assert.match(play, /sh\.act\(\{ refused: false, delivered: true \}\)/);
  assert.match(play, /sh\?\.deliver\?\.\(\)/);
});

test('a cross-chain SUCCESS is one line, the boat arrives, and the shop url is the city tray', async () => {
  const near = '5vUC4zn1CQqxECR88QKW93yGbDoFU176vWQfWM3yZaUw';
  const base = '0xe23f332d4ce42bc918eaf20db48b4645373df527db2e66671f56bb246592f1ea';
  const view = ferryStatusView({
    status: 'SUCCESS', amount: '0.179713', symbol: 'USDC',
    txs: [near, 'A6pqkcd3onJcAbJ2gCBNByejDkThARRkVshoXFB8zGkz'],
    destTx: base, destChain: 'base',
  });
  assert.equal(view.order, 'SUCCESS');
  assert.equal(view.text, 'Delivered 0.179713 USDC.');
  assert.equal(view.links.at(-1).url, 'https://basescan.org/tx/' + base);
  const html = ferryStatusHtml(view);
  assert.match(html, /Delivered 0\.179713 USDC\./);
  assert.match(html, new RegExp('nearblocks\\.io/txns/' + near));
  assert.match(html, /basescan\.org\/tx\/0xe23f332d/);
  assert.match(html, /order · SUCCESS/);
  assert.doesNotMatch(html, /Charter sent the NEAR deposit|Done: the output was delivered|Waiting on 1Click/);
  const card = ferryMarkup({
    depositAddress: '27bab72c47cbcb4036c4e86ec197131ae886c66b927049073c19e49c6bc072b.near',
    depositMode: 'propose_call', depositTxs: [near], destChain: 'base',
    outAmt: '0.179713', outSym: 'USDC', fromId: 'wNEAR|near', toId: 'USDC|base',
    ferryStatus: view,
  });
  assert.match(card, /data-testid="ferry-status"/);
  assert.match(card, /class="ferry-tab/);
  assert.match(card, /class="primary ferry-cta/);
  assert.match(card, /order · SUCCESS/);
  assert.doesNotMatch(card, /Charter sent the NEAR deposit/);
  assert.doesNotMatch(card, /data-testid="ferry-deposit-address"/);
  const page = read('app/design/D8_shops/index.html');
  assert.match(page, /location\.replace\('\/\?shop=' \+ encodeURIComponent\(shop\)/);
  assert.match(page, /q\.has\('2d'\)/);
  assert.match(page, /q\.has\('scripted'\)/);
  assert.match(page, /q\.has\('capture'\)/);
  const city = read('app/design/D9_world/index.html');
  assert.match(city, /href="\/panels\/panels\.css"/);
  assert.match(city, /id="shopUI"/);
  assert.match(city, /id="tray"/);
  const scene = read('app/design/D8_shops/shops/ferry.js');
  assert.match(scene, /const FAR_X = 1\.55/);
  assert.match(scene, /opts\.delivered/);
  assert.match(scene, /seal\.material = sealOk/);
  assert.match(scene, /paintOrder\('delivered'\)/);
  const addr = '0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034';
  const loads = [];
  const state = {};
  const out = await runFerryAgent({
    text: `swap 0.05 wNEAR to USDC on base to ${addr}`,
    state,
    charterReady: true,
    quotePair: async (_from, _to, amt) => ({ ok: true, dry: true, from: { symbol: 'wNEAR', amount: amt, usd: '0.18' }, to: { symbol: 'USDC', amount: '0.179713' } }),
    onLoadCargo: async (opts) => { loads.push(opts); return { say: 'Waiting on 1Click.' }; },
  });
  assert.equal(out.ok, true);
  assert.equal(out.loaded, true);
  assert.deepEqual(loads, [{ charter: false }]);
  assert.equal(state.amt, '0.05');
  assert.equal(state.fromId, 'wNEAR|near');
  assert.equal(state.toId, 'USDC|base');
  assert.equal(String(state.receiveAt).toLowerCase(), addr.toLowerCase());
  assert.match(out.hint, /propose_call/);
  assert.doesNotMatch(out.hint, /Asking the charter/);
});

test('a successful swap does not show Downgrade refused, and the AI popup names the USDC and the txs', () => {
  const src = read('app/design/D8_shops/shops/ferry.js');
  const act = src.slice(src.indexOf('*act(opts'), src.indexOf('update(dt)'));
  const refused = act.indexOf('if (refused)');
  const shown = act.indexOf('showRefuseTag()');
  const sailed = act.indexOf('seal.material = sealOk', shown);
  assert.ok(refused >= 0 && shown > refused && sailed > shown);
  assert.doesNotMatch(act.slice(act.indexOf('return;', refused), sailed), /showRefuseTag/);
  const ui = read('app/design/D8_shops/js/shopui.js');
  assert.match(ui, /extra\.depositTxs = Array\.isArray\(sent\.txs\)/);
  assert.match(ui, /extra\.destChain = pair\.toChain/);
  assert.match(ui, /destTx: st\?\.destinationTx/);
  assert.match(ui, /playFerryDelivered\(\)/);
  const note = agentDeliveredNote({
    amount: '0.184831', symbol: 'USDC',
    txs: ['5vUC4zn1CQqxECR88QKW93yGbDoFU176vWQfWM3yZaUw', 'A6pqkcd3onJcAbJ2gCBNByejDkThARRkVshoXFB8zGkz'],
  });
  assert.equal(note.text, 'Delivered 0.184831 USDC.');
  assert.equal(note.links.length, 2);
  assert.equal(note.links[0].url, 'https://nearblocks.io/txns/5vUC4zn1CQqxECR88QKW93yGbDoFU176vWQfWM3yZaUw');
  assert.match(note.links[1].label, /^tx A6pqkcd3/);
});

test('USDC on Base is you-send, and NEAR under the cap is propose_call with no wallet', () => {
  const base = depositPlan({ from: 'USDC@base', amount: '3', depositAddress: 'abc', capYocto: '5000000000000000000000' });
  assert.equal(base.kind, 'you-send');
  assert.equal(base.wallet, false);
  assert.equal(base.steps.length, 0);
  const near = depositPlan({
    from: 'NEAR@near', amount: '0.002', depositAddress: 'intents.near',
    capYocto: '5000000000000000000000', balanceYocto: '10000000000000000000000000',
    keyMethods: ['propose', 'propose_call'],
  });
  assert.equal(near.kind, 'propose_call');
  assert.equal(near.wallet, false);
  assert.deepEqual(near.steps.map(s => s.method), ['near_deposit', 'storage_deposit', 'ft_transfer']);
  assert.equal(near.steps[0].receiver, WRAP);
  const over = depositPlan({
    from: 'NEAR@near', amount: '0.2', depositAddress: 'intents.near', capYocto: '5000000000000000000000',
  });
  assert.equal(over.kind, 'you-send');
  const locked = depositPlan({
    from: 'NEAR@near', amount: '0.002', depositAddress: 'intents.near',
    capYocto: '5000000000000000000000', keyMethods: ['propose'],
  });
  assert.equal(locked.kind, 'you-send');
  assert.equal(locked.wallet, false);
  // No product USD cap in the panel either: any positive quote is usable, and the row
  // is what decides whether the deposit fits.
  assert.equal(mayCheckout({ from: { usd: '0.21' } }).ok, true);
  assert.equal(mayCheckout({ from: { usd: '5' } }).ok, true);
  assert.equal(mayCheckout({ from: { usd: '0' } }).ok, false);
  assert.equal(mayCheckout({ from: { usd: '0' } }).reason, 'bad_usd');
  const session = depositPlan({
    from: SESSION_SWAP.from, amount: SESSION_SWAP.amt, depositAddress: 'intents.near',
    capYocto: '60000000000000000000000', balanceYocto: '200000000000000000000000',
    keyMethods: ['propose', 'propose_call'],
  });
  assert.equal(session.kind, 'propose_call');
  assert.equal(session.wallet, false);
  assert.equal(session.steps[0].receiver, WRAP);
  assert.equal(session.steps[0].deposit, '50000000000000000000000');
  const tight = depositPlan({
    from: SESSION_SWAP.from, amount: SESSION_SWAP.amt, depositAddress: 'intents.near',
    capYocto: '5000000000000000000000', balanceYocto: '200000000000000000000000',
  });
  assert.equal(tight.kind, 'you-send');
  const bridge = explainQuoteMiss('1Click answered HTTP 400: Amount is too low for bridge, try at least 1671417 (correlation abc)');
  assert.match(bridge, /bridge minimum/);
  assert.match(bridge, /1671417/);
  assert.match(bridge, /No deposit address/);
  assert.match(bridge, /has not delivered/);
  assert.match(explainQuoteMiss('over_per_action_cap'), /row allows/);
  assert.match(explainQuoteMiss('over_checkout_cap'), /limit your row allows/);
});

test('a failed quote and Get another quote both hide the refuse seal', () => {
  const deep = read('app/src/panels/deep.js');
  const runOne = deep.slice(deep.indexOf('async function runOne'), deep.indexOf('async function runQuotes'));
  assert.match(runOne, /hideRefuse/);
  assert.match(runOne, /explainQuoteMiss/);
  const ui = read('app/design/D8_shops/js/shopui.js');
  const ferryRun = ui.slice(ui.indexOf('ferry: {'), ui.indexOf('bank: {'));
  assert.match(ferryRun, /hideRefuse/);
  assert.match(ferryRun, /explainQuoteMiss/);
  assert.match(ferryRun, /onAgain: \(\) => \{ sh\?\.hideRefuse/);
  const fail = ui.slice(ui.indexOf('function fail'), ui.indexOf('function openRules'));
  assert.match(fail, /hideRefuse/);
  const idle = ferryMarkup({});
  assert.match(idle, /wNEAR on near/);
  assert.match(idle, /value="0.05"/);
  assert.match(idle, /USDC on near/);
});

test('0.05 wNEAR within a 0.06 cap is propose_call on wrap.near', () => {
  const cap = '60000000000000000000000';
  const plan = depositPlan({
    from: 'wNEAR@near', amount: '0.05', depositAddress: 'ab'.repeat(32), memo: null,
    capYocto: cap, balanceYocto: '65000000000000000000000',
  });
  assert.equal(plan.kind, 'propose_call');
  assert.equal(plan.wallet, false);
  assert.deepEqual(plan.steps.map(s => [s.receiver, s.method]), [
    [WRAP, 'near_deposit'], [WRAP, 'storage_deposit'], [WRAP, 'ft_transfer'],
  ]);
  for (const s of plan.steps) assert.ok(BigInt(s.deposit) <= BigInt(cap));
  const sum = plan.steps.reduce((n, s) => n + BigInt(s.deposit), 0n);
  assert.ok(sum <= 65000000000000000000000n);
});

test('unregistered board near_deposit attaches transfer plus wrap storage', () => {
  const transfer = '50000000000000000000000';
  assert.equal(wrapDepositYocto(transfer, false), (BigInt(transfer) + BigInt(WRAP_STORAGE_YOCTO)).toString());
  assert.equal(wrapDepositYocto(transfer, true), transfer);
  const plan = depositPlan({
    from: 'wNEAR@near', amount: '0.05', depositAddress: 'ab'.repeat(32),
    capYocto: '60000000000000000000000', balanceYocto: '70000000000000000000000',
    wrapRegistered: false, wrapBalanceYocto: '0',
  });
  assert.equal(plan.kind, 'propose_call');
  assert.equal(plan.recover, false);
  assert.equal(plan.steps[0].method, 'near_deposit');
  assert.equal(plan.steps[0].deposit, '51250000000000000000000');
  const ft = JSON.parse(plan.steps[2].args);
  assert.equal(ft.amount, transfer);
});

test('stranded board wNEAR skips near_deposit and transfers the exact balance', () => {
  const stranded = '48750000000000000000000';
  assert.equal(nearAmount(stranded), '0.04875');
  const pick = pickWrapSpend({ wantAmount: '0.05', wrapBalanceYocto: stranded });
  assert.equal(pick.recover, true);
  assert.equal(pick.amount, '0.04875');
  assert.equal(pick.amountYocto, stranded);
  const plan = depositPlan({
    from: 'wNEAR@near', amount: pick.amount, depositAddress: 'cd'.repeat(32),
    capYocto: '60000000000000000000000', balanceYocto: '13750000000000000000000',
    wrapRegistered: true, wrapBalanceYocto: stranded,
  });
  assert.equal(plan.kind, 'propose_call');
  assert.equal(plan.recover, true);
  assert.deepEqual(plan.steps.map(s => s.method), ['storage_deposit', 'ft_transfer']);
  assert.equal(JSON.parse(plan.steps[1].args).amount, stranded);
  const sum = plan.steps.reduce((n, s) => n + BigInt(s.deposit), 0n);
  assert.ok(sum <= 13750000000000000000000n);
  const registeredDeposit = depositPlan({
    from: 'wNEAR@near', amount: pick.amount, depositAddress: 'cd'.repeat(32),
    capYocto: '60000000000000000000000', balanceYocto: '13750000000000000000000',
    wrapRegistered: true, wrapBalanceYocto: stranded, depositAccountRegistered: true,
  });
  assert.deepEqual(registeredDeposit.steps.map(s => s.method), ['ft_transfer']);
  assert.equal(registeredDeposit.steps[0].deposit, '1');
});

test('apps.js maps the wrap.near balance panic to stranded wNEAR copy', () => {
  const apps = read('app/design/D8_shops/js/apps.js');
  assert.match(apps, /wrapBoardState/);
  assert.match(apps, /wrapStorageOf/);
  assert.match(apps, /does not hold enough wNEAR/);
  assert.match(apps, /stranded wNEAR/);
  const ui = read('app/design/D8_shops/js/shopui.js');
  assert.match(ui, /pickWrapSpend/);
  assert.match(ui, /stranded wNEAR/);
});

test('status SUCCESS sails once, and a refund does not', () => {
  const pending = nextFerryBeat('PENDING_DEPOSIT');
  assert.equal(pending.play, false);
  assert.equal(pending.order, 'deposit');
  assert.equal(pending.terminal, false);
  const ok = nextFerryBeat('SUCCESS');
  assert.equal(ok.play, true);
  assert.equal(ok.order, 'delivered');
  assert.equal(ok.terminal, true);
  const again = nextFerryBeat('SUCCESS', { sailed: true });
  assert.equal(again.play, false);
  const back = nextFerryBeat('REFUNDED');
  assert.equal(back.play, false);
  assert.equal(back.order, 'refunded');
});

test('a destination address is checked per chain and never invented', () => {
  const addr = '0xf76e6b0920e9332ff4410f6dd53f01722abc71a3';
  const mixed = '0xF76E6b0920e9332ff4410f6dd53f01722abc71A3';
  assert.equal(validateDestAddress('base', addr).ok, true);
  assert.equal(validateDestAddress('arb', mixed).address, mixed);
  assert.equal(validateDestAddress('pol', addr).ok, true);
  assert.equal(validateDestAddress('base', '').ok, false);
  assert.equal(validateDestAddress('base', '0x1234').ok, false);
  assert.equal(validateDestAddress('base', addr.slice(2)).ok, false);
  assert.equal(validateDestAddress('sol', '11111111111111111111111111111111').ok, true);
  assert.equal(validateDestAddress('sol', '0OIl' + '1'.repeat(28)).ok, false);
  assert.equal(validateDestAddress('btc', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4').ok, true);
  assert.equal(validateDestAddress('zec', ZEC_UA).ok, true);
  assert.equal(validateDestAddress('zec', addr).ok, false);
  assert.equal(validateDestAddress('near', '8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8').ok, true);
  const phrase = `Swap 0.05 wNEAR on NEAR to USDC on Base to ${addr}`;
  const parsed = parseAgentFerry(phrase);
  assert.equal(parsed.from, 'wNEAR@near');
  assert.equal(parsed.to, 'USDC@base');
  assert.equal(parsed.amt, '0.05');
  assert.equal(parsed.receiveAt, addr);
  assert.equal(parseAgentFerry('Swap 0.05 wNEAR on NEAR to USDC on Base at ' + addr).receiveAt, addr);
  const asked = agentCargoPlan('Swap 0.05 wNEAR on NEAR to USDC on Base', { charterReady: true });
  assert.equal(asked.ok, false);
  assert.match(asked.hint, /on base/);
  const nearHtml = ferryMarkup({ fromId: 'wNEAR|near', toId: 'USDC|near', amt: '0.05' });
  assert.doesNotMatch(nearHtml, /data-testid="ferry-receive"/);
  assert.doesNotMatch(nearHtml, /data-testid="ferry-quote"[^>]*disabled/);
  const empty = ferryMarkup({ fromId: 'wNEAR|near', toId: 'USDC|base', amt: '0.05' });
  assert.match(empty, /Receive at/);
  assert.match(empty, /data-testid="ferry-receive" [^>]*value=""/);
  assert.doesNotMatch(empty, /0xf76e6b0920e9332ff4410f6dd53f01722abc71a3/);
  assert.match(empty, /data-testid="ferry-quote"[^>]*disabled/);
  const ready = ferryMarkup({ fromId: 'wNEAR|near', toId: 'USDC|base', amt: '0.05', receiveAt: addr, q: { from: { symbol: 'wNEAR', amount: '0.05' }, to: { symbol: 'USDC', amount: '0.181' } }, charterReady: true });
  assert.match(ready, new RegExp(`value="${addr}"`));
  assert.doesNotMatch(ready, /data-testid="ferry-quote"[^>]*disabled/);
  assert.doesNotMatch(ready, /data-testid="ferry-load-cargo"[^>]*disabled/);
  const hash = '0x' + 'ab'.repeat(32);
  const link = destExplorer('base', hash);
  assert.equal(link.url, 'https://basescan.org/tx/' + hash);
  assert.equal(destExplorer('arb', hash).url, 'https://arbiscan.io/tx/' + hash);
  assert.equal(destExplorer('pol', hash).url, 'https://polygonscan.com/tx/' + hash);
  assert.equal(destExplorer('sol', '5'.repeat(44)).url, 'https://solscan.io/tx/' + '5'.repeat(44));
  const note = agentDeliveredNote({
    amount: '0.181', symbol: 'USDC',
    txs: ['5vUC4zn1CQqxECR88QKW93yGbDoFU176vWQfWM3yZaUw'],
    destTx: hash, destChain: 'base',
  });
  assert.equal(note.links.length, 2);
  assert.match(note.links[0].url, /nearblocks\.io/);
  assert.equal(note.links[1].url, link.url);
});

test('a NEAR destination quotes the visitor account, and a typed ZEC address is kept', () => {
  const scholar = '8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8';
  const ua = 'u1naczqa5m5nefpyqnhs8h3dw8un8z8us45xwgfh4ees95mayyru9snc33dkfk2dc27r5syu4uveyyd5dt8wwad89kpc3f8cah055lm0ex';
  assert.equal(quoteRecipient('USDC@near', scholar, ua), scholar);
  assert.equal(quoteRecipient({ chain: 'near' }, scholar, ua), scholar);
  assert.equal(quoteRecipient('ZEC@zec', scholar, ua), ua);
  assert.equal(quoteRecipient('USDC@base', scholar, ''), '');
  assert.equal(quoteRecipient('USDC@base', scholar, ua), '');
  assert.equal(quoteRecipient('USDC@base', scholar, '0xf76e6b0920e9332ff4410f6dd53f01722abc71a3'), '0xf76e6b0920e9332ff4410f6dd53f01722abc71a3');
  assert.equal(quoteRecipient('USDC@near', '', ua), '');
  const body = cityCheckoutBody({
    pair: { from: 'wNEAR@near', to: 'USDC@near', amt: '0.05' },
    recipient: 'charter.nearcarta.near',
    charter: scholar,
    amountYocto: '1',
    refundTo: 'nearcarta.near',
    visitor: scholar,
  });
  assert.equal(body.recipient, 'charter.nearcarta.near');
  assert.equal(body.swap_recipient, scholar);
  assert.equal(body.clause_id, 'pay');
  assert.equal(body.board, undefined);
  const boardBody = cityCheckoutBody({
    pair: { from: 'wNEAR@near', to: 'USDC@near', amt: '0.05' },
    recipient: 'charter.nearcarta.near',
    charter: scholar,
    amountYocto: '1',
    refundTo: 'nearcarta.near',
    visitor: scholar,
    session: 'board',
  });
  assert.equal(boardBody.board, true);
  assert.equal(boardBody.charter, scholar);
  const zec = cityCheckoutBody({
    pair: { from: 'USDC@base', to: 'ZEC@zec', amt: '0.2' },
    recipient: 'charter.nearcarta.near',
    charter: scholar,
    amountYocto: '1',
    refundTo: '0x552ad18e18a49ddad1e7d96b7ddf813b04a9cfb5',
    visitor: scholar,
  });
  assert.equal(zec.swap_recipient, undefined);
  const baseBody = cityCheckoutBody({
    pair: { from: 'wNEAR@near', to: 'USDC@base', amt: '0.05', receiveAt: '0xf76e6b0920e9332ff4410f6dd53f01722abc71a3' },
    recipient: 'charter.nearcarta.near',
    charter: scholar,
    amountYocto: '1',
    refundTo: scholar,
    visitor: scholar,
    session: 'board',
  });
  assert.equal(baseBody.to.chain, 'base');
  assert.equal(baseBody.recipient, 'charter.nearcarta.near');
  assert.equal(baseBody.swap_recipient, '0xf76e6b0920e9332ff4410f6dd53f01722abc71a3');
  assert.equal(baseBody.refundTo, scholar);
  assert.equal(baseBody.board, true);
  const baseMissing = cityCheckoutBody({
    pair: { from: 'wNEAR@near', to: 'USDC@base', amt: '0.05' },
    recipient: 'charter.nearcarta.near', charter: scholar, amountYocto: '1', refundTo: scholar, visitor: scholar,
  });
  assert.equal(baseMissing.swap_recipient, undefined);
  // Display labels like "NEAR" must still yield swap_recipient for the visitor.
  const labeled = cityCheckoutBody({
    pair: { from: 'wNEAR@near', to: 'USDC@near', amt: '0.05', fromSym: 'wNEAR', fromChain: 'near', toSym: 'USDC', toChain: 'NEAR' },
    recipient: 'charter.nearcarta.near', charter: scholar, amountYocto: '1', refundTo: 'nearcarta.near', visitor: scholar, session: 'board',
  });
  assert.equal(labeled.to.chain, 'near');
  assert.equal(labeled.swap_recipient, scholar);
  const apps = read('app/design/D8_shops/js/apps.js');
  const quote = apps.slice(apps.indexOf('export async function quotePair'), apps.indexOf('export const ferryNear'));
  assert.match(quote, /quoteRecipient\(dest, S\.me, receiveAt\)/);
  assert.doesNotMatch(quote, /u1naczq/);
  assert.doesNotMatch(apps, /const UA =/);
  const checkout = apps.slice(apps.indexOf('export async function openFerryCheckout'), apps.indexOf('export async function ferryStatus'));
  assert.match(checkout, /visitor: S\.me/);
  assert.match(checkout, /session: S\.board \? 'board' : undefined/);
  assert.match(checkout, /receiveAt: pair\?\.receiveAt/);
  assert.match(checkout, /NEAR destination needs a NEAR account/);
  const ui = read('app/design/D8_shops/js/shopui.js');
  assert.match(ui, /data-testid', 'ferry-agent-dock'/);
  assert.match(ui, />AI Agent</);
  const room = ui.slice(ui.indexOf('ferry: {'), ui.indexOf('bank: {'));
  assert.match(room, /ensureFerryDock\(\)/);
});

test('the city checkout body uses the pay clause, and propose_call signs the board string', () => {
  const body = cityCheckoutBody({
    pair: { from: 'USDC@base', to: 'ZEC@zec', amt: '0.2', fromSym: 'USDC', fromChain: 'base', toSym: 'ZEC', toChain: 'zec' },
    recipient: 'charter.nearcarta.near', charter: '8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8',
    amountYocto: '100000000000000000000', refundTo: '0x552ad18e18a49ddad1e7d96b7ddf813b04a9cfb5',
  });
  assert.equal(body.clause_id, 'pay');
  assert.equal(body.amount, '0.2');
  assert.equal(body.privacy, 'public');
  const args = '{}';
  const argsHash = hex(sha256(new TextEncoder().encode(args)));
  const fields = { contract: 'board.nearcarta.near', owner: 'alice.near', receiver: 'wrap.near', method: 'near_deposit', deposit: '1', nonce: '4' };
  assert.equal(boardCallText({ ...fields, argsHash }), callMessage({ ...fields, args }));
  const apps = read('app/design/D8_shops/js/apps.js');
  const fn = apps.slice(apps.indexOf('export async function ferryProposeCalls'), apps.indexOf('export const routesReady'));
  assert.match(fn, /propose_call/);
  assert.doesNotMatch(fn, /(?<![.\w])sign\(/);
  assert.match(fn, /wallet: false/);
  assert.match(fn, /stepsAllowanceYocto/);
  assert.match(fn, /proposeCallTgas/);
  assert.doesNotMatch(fn, /300n \* TG/);
});

test('a landed 0.05 wrap is reused and the next plan is only ft_transfer', () => {
  const held = '50000000000000000000000';
  const pick = pickWrapSpend({ wantAmount: '0.05', wrapBalanceYocto: held });
  assert.equal(pick.recover, true);
  assert.equal(pick.amount, '0.05');
  assert.equal(pick.amountYocto, held);
  const plan = depositPlan({
    from: 'wNEAR@near', amount: pick.amount, depositAddress: 'ab'.repeat(32),
    capYocto: '60000000000000000000000', balanceYocto: '10000000000000000000000',
    wrapRegistered: true, wrapBalanceYocto: held, depositAccountRegistered: true,
  });
  assert.equal(plan.kind, 'propose_call');
  assert.equal(plan.recover, true);
  assert.deepEqual(plan.steps.map(s => s.method), ['ft_transfer']);
  assert.equal(JSON.parse(plan.steps[0].args).amount, held);
  assert.equal(plan.steps[0].gasTgas, proposeCallTgas('ft_transfer'));
  assert.notEqual(plan.steps[0].gasTgas, 300);
});

test('propose_call prepays 54 Tgas so the 20 Tgas callback fits, and 0.04188 cannot buy a step', () => {
  assert.equal(proposeCallTgas('near_deposit'), 54);
  assert.equal(proposeCallTgas('ft_transfer'), 54);
  assert.equal(proposeCallTgas('storage_deposit'), 54);
  assert.ok(proposeCallTgas('ft_transfer') < 300);
  const one = proposeCallPrepaidYocto(54);
  assert.equal(one, functionCallAllowanceCost({ tgas: 54, numBytes: PROPOSE_CALL_BYTES }));
  const left = 4188n * 10n ** 19n;
  assert.equal(nearAmount(left), '0.04188');
  assert.ok(left < one);
  const three = stepsAllowanceYocto([
    { method: 'near_deposit' }, { method: 'storage_deposit' }, { method: 'ft_transfer' },
  ]);
  assert.ok(BigInt(GAS_TOPUP_YOCTO) >= three);
  assert.ok(BigInt('50000000000000000000000') < stepsAllowanceYocto([{ method: 'near_deposit' }, { method: 'ft_transfer' }]));
});

test('a landed wrap and a failed send name the tx and do not say nothing was sent', () => {
  const hash = '6srGqpyujq1qfKvhTsWacj3rGqLJUZh1VcL71MtZ4W5U';
  const note = wrapProgressNote({
    amount: '0.05',
    landed: [{ method: 'near_deposit', tx: hash }],
    failedReason: 'NotEnoughAllowance',
  });
  assert.match(note.text, /Wrapped 0\.05 NEAR \(tx 6srG…\)/);
  assert.match(note.text, /The send to 1Click did not go: session gas allowance is low/);
  assert.match(note.text, /Your wNEAR is safe in your row and will be used on the next try/);
  assert.doesNotMatch(note.text, /No wrap was sent/);
  assert.equal(note.links[0].url, `https://nearblocks.io/txns/${hash}`);
  assert.equal(note.lowGas, true);
  const blocked = wrapProgressNote({ failedReason: 'not_enough_allowance' });
  assert.match(blocked.text, /Session gas is low/);
  assert.match(blocked.text, /The wrap was not started/);
  assert.doesNotMatch(blocked.text, /Wrapped /);
  const stranded = wrapProgressNote({ failedReason: 'not_enough_allowance', stranded: true });
  assert.match(stranded.text, /wNEAR is safe in your row/);
  const ui = read('app/design/D8_shops/js/shopui.js');
  assert.match(ui, /wrapProgressNote/);
  assert.match(ui, /Refresh agent key/);
  const deep = read('app/src/panels/deep.js');
  assert.match(deep, /ferry-refresh-key/);
  assert.match(deep, /data-testid="ferry-gas"/);
});

test('the agent repeats the honest wrap note and its nearblocks link', async () => {
  const hash = '6srGqpyujq1qfKvhTsWacj3rGqLJUZh1VcL71MtZ4W5U';
  const hint = 'Wrapped 0.05 NEAR (tx 6srG…). The send to 1Click did not go: session gas allowance is low. Your wNEAR is safe in your row and will be used on the next try.';
  const out = await runFerryAgent({
    text: 'load cargo',
    state: { q: { from: { usd: '0.18' } }, toId: 'USDC|base', receiveAt: '0xf76e6b0920e9332ff4410f6dd53f01722abc71a3' },
    charterReady: true,
    onLoadCargo: async () => ({
      agentHint: hint,
      agentLinks: [{ url: `https://nearblocks.io/txns/${hash}`, label: 'near_deposit 6srG…' }],
      lowGas: true,
    }),
  });
  assert.match(out.hint, /Wrapped 0\.05 NEAR/);
  assert.match(out.hint, /Receiving on base/);
  assert.equal(out.links.length, 1);
  assert.equal(out.links[0].url, `https://nearblocks.io/txns/${hash}`);
  assert.equal(out.lowGas, true);
});

test('Ferry rules show the session gas that is left', () => {
  const html = ferryMarkup({
    tab: 'rules', gasNear: '0.04188', gasLow: true, toId: 'USDC|near', fromId: 'wNEAR|near', amt: '0.05',
  });
  assert.match(html, /data-testid="ferry-gas"/);
  assert.match(html, /Session gas left: 0\.04188 NEAR/);
  assert.match(html, /Session gas is low/);
  assert.match(html, /data-testid="ferry-refresh-key"/);
  assert.match(html, /href="\/setup"/);
});

test('the latest ferry result is the newest receipt, not an older denial', () => {
  const old = { h: '8HeBdwjXAVaokGoRKjYHhf7sUVLmXReqkn1yysyDddxP', shop: 'ferry', decision: 'denied', reason: 'ERR_BAD_SIG', amt: '2000000000000000000000', to: 'charter.nearcarta.near', at: 1 };
  const next = { h: '6L29V63Hnewest', shop: 'ferry', decision: 'allowed', reason: 'delivered', amt: '50000000000000000000000', to: '0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034', at: 2 };
  assert.equal(newestReceipt([old, next]).h, next.h);
  assert.equal(newestReceipt([next, old]).h, next.h);
  assert.equal(newestReceipt([old]).h, old.h);
  const ui = read('app/design/D8_shops/js/shopui.js');
  assert.match(ui, /newestReceipt\(mine\)/);
  assert.match(ui, /rememberReceipt\(h, 'ferry', 'allowed', 'delivered'/);
  const apps = read('app/design/D8_shops/js/apps.js');
  assert.match(apps, /export function rememberReceipt/);
  assert.match(apps, /r\.h === h && r\.shop === shop/);
});

test('a refused stamp stays at the jetty and does not freeze the boat', () => {
  const ui = read('app/design/D8_shops/js/shopui.js');
  const fn = ui.slice(ui.indexOf('async function settleFerry'), ui.indexOf('async function loadFerryCargo'));
  const branch = fn.slice(fn.indexOf('if (refused)'));
  assert.doesNotMatch(branch, /refused:\s*true/);
  assert.match(branch, /hideRefuse/);
  assert.match(branch, /setOrder\?\.\('jetty'\)/);
  assert.match(branch, /order · jetty/);
  assert.match(ui, /ERR_BAD_SIG\|agent_key_mismatch/);
  assert.match(ui, /does not match the agent key stored in this browser/);
  const scene = read('app/design/D8_shops/shops/ferry.js');
  const delivered = scene.slice(scene.indexOf('if (opts.delivered'), scene.indexOf('const refused = !!opts.refused'));
  assert.match(delivered, /seal\.material = sealOk/);
  const deliver = scene.slice(scene.indexOf('const deliver = ()'), scene.indexOf('const panel ='));
  assert.match(deliver, /seal\.material = sealOk/);
  assert.match(deliver, /hideRefuseTag\(\)/);
});
