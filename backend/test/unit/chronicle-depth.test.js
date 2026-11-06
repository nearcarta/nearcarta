import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exportCsv } from '../../../app/src/chronicle-feed.js';
import { parseChronicleCommand, runChronicleCommand } from '../../../app/src/chronicle-commands.js';
import { entryPlan, mergeChronicle, ENTRY_YOCTO } from '../../../app/src/chronicle-loop.js';
import { iconFor } from '../../../app/src/chronicle-icons.js';
import { CHRONICLE_CSS } from '../../../app/src/panels/chronicle-style.js';
import { armChronicleDock, dispatchChronicleDock, installChronicleDock } from '../../../app/src/panels/chronicle-dock.js';

const read = p => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
const CAP = '60000000000000000000000';
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
  const small = entryPlan({ capYocto: '100000000000000000000', balanceYocto: CAP, receivers: ['scribe.near'], receiver: 'scribe.near' });
  assert.equal(small.ok, false);
  assert.match(small.reason, /Nothing was signed/);
  const low = entryPlan({ capYocto: CAP, balanceYocto: '1', receivers: ['scribe.near'], receiver: 'scribe.near' });
  assert.match(low.reason, /does not hold/);
  const off = entryPlan({ capYocto: CAP, balanceYocto: CAP, receivers: ['other.near'], receiver: 'scribe.near' });
  assert.match(off.reason, /not on your board row/);
  const ok = entryPlan({ capYocto: CAP, balanceYocto: CAP, spentYocto: '0', dailyYocto: CAP, receivers: ['scribe.near'], receiver: 'scribe.near' });
  assert.equal(ok.ok, true);
  assert.equal(ok.amountYocto, ENTRY_YOCTO);
  const parsed = parseChronicleCommand('Show refuses today');
  assert.equal(parsed.decision, 'denied');
  assert.equal(parsed.today, true);
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
  const shopui = read('app/design/D8_shops/js/shopui.js');
  assert.match(shopui, /entryPlan\(/);
  assert.match(shopui, /onEntry: \(\) => chronicleEntry\(\)/);
  assert.match(shopui, /Nothing was signed/);
  const deep = read('app/src/panels/deep.js');
  assert.match(deep, /return mountChronicleTray\(root, hooks\)/);
  const view = read('app/src/panels/chronicle-view.js');
  assert.match(view, /armChronicleDock/);
  assert.match(view, /data-testid="chronicle-search"/);
  assert.match(view, /data-testid="chronicle-export"/);
  const room = read('app/design/D8_shops/shops/chronicle.js');
  assert.match(room, /if \(!opts\.success \|\| !opts\.tx\) return/);
  const index = read('app/design/D9_world/index.html');
  assert.match(index, /href="\/\?shop=chronicle"/);
  assert.match(index, /data-city-shop="chronicle"/);
});
