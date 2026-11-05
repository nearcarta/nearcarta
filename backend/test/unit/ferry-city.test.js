import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sha256 } from '@noble/hashes/sha2.js';
import { callMessage } from '../../../shared/board/message.js';
import { agentCargoPlan, parseAgentFerry } from '../../../app/src/panels/ferry-pair.js';
import { ferryMarkup } from '../../../app/src/panels/deep.js';
import { runFerryAgent } from '../../../app/src/panels/deep.js';
import {
  boardCallText, cityCheckoutBody, depositPlan, mayCheckout, nextFerryBeat, WRAP,
} from '../../../app/src/panels/ferry-settle.js';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

const choices = [
  { id: 'USDC|base', symbol: 'USDC', chain: 'base', label: 'USDC on base' },
  { id: 'ZEC|zec', symbol: 'ZEC', chain: 'zec', label: 'ZEC on zec' },
  { id: 'NEAR|near', symbol: 'NEAR', chain: 'near', label: 'NEAR on near' },
  { id: 'ETH|eth', symbol: 'ETH', chain: 'eth', label: 'ETH on eth' },
];

test('get a quote for 3 USDC on base to ZEC fills the pair and does not spend', async () => {
  const phrase = 'get a quote for 3 USDC on base to ZEC';
  const parsed = parseAgentFerry(phrase);
  assert.equal(parsed.from, 'USDC@base');
  assert.equal(parsed.to, 'ZEC@zec');
  assert.equal(parsed.amt, '3');
  assert.equal(agentCargoPlan(phrase, { charterReady: true }).mode, 'quote');
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

test('a charter-ready swap asks the charter after the quote and invents no tx', async () => {
  const loads = [];
  const state = {};
  const out = await runFerryAgent({
    text: 'Swap 3 USDC on Base to ZEC',
    state,
    charterReady: true,
    quotePair: async () => ({ ok: true, dry: true, from: { amount: '3', usd: '3' }, to: { amount: '0.01' } }),
    onLoadCargo: async (opts) => { loads.push(opts); },
  });
  assert.equal(out.ok, true);
  assert.equal(out.loaded, true);
  assert.deepEqual(loads, [{ charter: true }]);
  assert.equal(state.q.tx, undefined);
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

test('the city send button is wired to runAgent, and a quote clears the box', () => {
  const ui = read('app/design/D8_shops/js/shopui.js');
  assert.match(ui, /id="f-agent-go"/);
  assert.match(ui, /id="f-agent-log"/);
  assert.match(ui, /wireFerryDock\(hooks\)/);
  assert.match(ui, /go\.onclick = send/);
  assert.match(ui, /e\.key === 'Enter'/);
  assert.match(ui, /hooks\?\.runAgent/);
  const deep = read('app/src/panels/deep.js');
  assert.match(deep, /hooks\.runAgent = \(btn\) => runAgent\(btn\)/);
  assert.match(deep, /if \(result\.ok && input\) \{ input\.value = ''; state\.agentText = ''; \}/);
  assert.match(deep, /agentLog\(result\.hint \|\| ''\)/);
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
  assert.match(src.slice(ok, ok + 120), /classList\.add\('hide'\)/);
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
  assert.match(fn, /watchFerryDeposit/);
  assert.match(fn, /setOrder\?\.\('deposit'\)/);
  assert.match(fn, /hideRefuse/);
  assert.doesNotMatch(fn, /paintOrder\('delivered'\)/);
  assert.match(fn, /0\.20/);
  assert.match(ui, /sh\.act\(\{ refused: false \}\)/);
  const watch = ui.slice(ui.indexOf('function watchFerryDeposit'), ui.indexOf('async function settleFerry'));
  assert.match(watch, /beat\.play && sh\?\.act/);
  assert.match(watch, /SUCCESS/);
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
  assert.equal(mayCheckout({ from: { usd: '0.21' } }).ok, false);
  assert.equal(mayCheckout({ from: { usd: '0.2' } }).ok, true);
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
});
