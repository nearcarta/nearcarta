// The gas /setup attaches to its board calls.
// Board v2 runs open_charter and set_calls as separate receipts, and each action's
// attached gas is the budget for its whole receipt. On 2026-11-06 the page attached
// 10 Tgas, the board call failed with "Exceeded the prepaid gas", and the row was
// never opened. This fails on 10 and passes on the current value.
// The burns are measured in contracts/charter_board_sandbox/tests/setup_open_gas.rs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openRowTransactions } from '../../../shared/setup/open-row.js';
import { callPolicy, stampCalls } from '../../../shared/board/session.js';
import { HOUSE_CALLS } from '../../../shared/house/shop.js';

const src = readFileSync(new URL('../../../app/house/setup.js', import.meta.url), 'utf8');
const TG = 10n ** 12n;

/** The page's GAS block, read from source so the test follows the real value. */
function pageGas(name) {
  const m = src.match(/const GAS = \{([^}]*)\};/);
  assert.ok(m, 'setup.js declares a GAS object');
  const field = m[1].match(new RegExp(`${name}:\\s*(\\d+)n`));
  assert.ok(field, `GAS.${name} is a BigInt literal`);
  return BigInt(field[1]);
}

// Measured on the committed wasm (setup_open_gas.rs), in Tgas.
const BURN = {
  openSixReceivers: 4.01,
  setCallsWidest: 5.09,
  bothActions: 8.53,
};

test('the attached gas clears the measured burn of each board receipt', () => {
  for (const name of ['open', 'agent']) {
    const tgas = pageGas(name);
    assert.ok(tgas >= 40n, `GAS.${name} is ${tgas} Tgas; the sandbox burns up to ${BURN.setCallsWidest} and mainnet burnt 3.36 on the call that failed at 10`);
    // The old 10 Tgas is the value that broke /setup. It must never come back.
    assert.notEqual(tgas, 10n, `GAS.${name} is 10 Tgas again`);
    assert.ok(tgas >= BigInt(Math.ceil(BURN.openSixReceivers * 3)), `GAS.${name} needs 3x the ${BURN.openSixReceivers} Tgas sandbox burn`);
  }
});

test('the whole first transaction stays inside 300 Tgas', () => {
  const YN = 10n ** 24n;
  const cap = (YN * 5n / 1000n).toString(), daily = (YN * 10n / 1000n).toString();
  const calls = callPolicy(['toll.nearcarta.near'], cap, daily, 'ft_transfer', [...stampCalls('board.nearcarta.near', cap), ...HOUSE_CALLS]).calls;
  const { open } = openRowTransactions({
    accountId: 'visitor.near', contract: 'board.nearcarta.near',
    rules: { receivers: ['toll.nearcarta.near'], daily_budget: daily }, agentPublicKey: 'ed25519:K',
    fundYocto: (YN / 100n).toString(), rowDepositYocto: '20000000000000000000000',
    callsDepositYocto: '15000000000000000000000', calls,
    gasOpen: (pageGas('open') * TG).toString(), gasAgent: (pageGas('agent') * TG).toString(),
    allowance: '250000000000000000000000',
  });
  const totalTgas = open.actions.reduce((n, a) => n + BigInt(a.params.gas), 0n) / TG;
  assert.ok(totalTgas <= 300n, `the transaction attaches ${totalTgas} Tgas; the user's ceiling is 300`);
  assert.ok(totalTgas > BigInt(Math.ceil(BURN.bothActions)) * 2n, `attached ${totalTgas} Tgas is only about the sandbox burn`);
});

test('the gas the page attaches is on both board actions', () => {
  const YN = 10n ** 24n;
  const { open } = openRowTransactions({
    accountId: 'visitor.near', contract: 'board.nearcarta.near',
    rules: { receivers: ['toll.nearcarta.near'], daily_budget: (YN * 10n / 1000n).toString() }, agentPublicKey: 'ed25519:K',
    fundYocto: '1', rowDepositYocto: '2', callsDepositYocto: '3',
    calls: [{ receiver: 'toll.nearcarta.near', method: 'ft_transfer', cap: '1' }],
    gasOpen: (pageGas('open') * TG).toString(), gasAgent: (pageGas('agent') * TG).toString(), allowance: '1',
  });
  for (const a of open.actions) {
    assert.ok(BigInt(a.params.gas) >= 40n * TG, `${a.params.methodName} carries ${a.params.gas}`);
  }
});

test('the agent key is a second approval, after the row opens', () => {
  const fn = src.slice(src.indexOf('async function signBoard()'), src.indexOf('function noteSign'));
  // The board transaction goes first and alone.
  const boardSend = fn.indexOf('signAndSendTransactions({ transactions: [built.open] })');
  const rowProof = fn.indexOf("get_charter', { owner: me }", boardSend);
  const keyCall = fn.indexOf('await sendKey()');
  assert.ok(boardSend > 0, 'the board transaction is sent');
  assert.ok(rowProof > boardSend, 'the row is read back after the board transaction');
  assert.ok(keyCall > rowProof, 'the key step runs after the row is read back');
  // No batch that carries both. The old code sent [open, key] in one call.
  assert.doesNotMatch(fn, /\[built\.open, built\.key\]/);
  // A failed board call must stop before the key swap.
  assert.match(fn, /if \(!opened\) \{/);
  assert.match(fn, /Your agent key was not changed/);
  // The throw is inside that block, so nothing after it runs when the row is missing.
  const throwAt = fn.indexOf('The board did not open the row');
  const keyAt = fn.indexOf('await sendKey()');
  assert.ok(throwAt > 0 && throwAt < keyAt, 'the failure throws before the key step');
  // A key that is already valid skips the swap, so a stranded key recovers.
  assert.match(fn, /if \(await agentAccessKey\(sec\)\) \{ keyReady = true; keyStale = false; mark\('key', 'ok'\); \}/);
});

test('the caps are on the page before the wallet opens', () => {
  const fn = src.slice(src.indexOf('function sSign()'), src.indexOf('async function charterState'));
  assert.match(fn, /data-testid="setup-caps"/);
  for (const id of ['cap-per', 'cap-daily', 'cap-count', 'cap-receivers', 'cap-session']) {
    assert.match(fn, new RegExp(`data-testid="${id}"`), `${id} is shown`);
  }
  // Per payment, daily total, count and receivers come from the rules being written.
  assert.match(fn, /fmtN\(r\.cap\)/);
  assert.match(fn, /fmtN\(r\.daily\)/);
  assert.match(fn, /r\.receivers\.map\(esc\)/);
});
