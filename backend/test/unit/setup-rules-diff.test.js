import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import MAIN from '../../../shared/deployments/mainnet.json' with { type: 'json' };
import { CALLS_DEPOSIT_YOCTO, sessionExpiresAt } from '../../../shared/board/session.js';
import { expiresToWrite, formatExpiry, formatNear, hashesFromError, nearToYocto, plainRulesError, rulesDiff, rulesLiveHint, signRulesUpdate, txHashForMethod, updateCostLine, updatePlan, RULES_DEPOSIT_YOCTO } from '../../../shared/setup/rules-diff.js';

// Scholar row recorded in mainnet.json: cap 0.005, daily 0.01, charter + toll.
const saved = MAIN.board.visitor_run.rules;
const chain = {
  per_action_cap: nearToYocto(saved.per_action_cap_near),
  daily_budget: nearToYocto(saved.daily_budget_near),
  max_actions_per_day: saved.max_actions_per_day,
  receivers: [...saved.receivers],
  expires_at: '1',
};
const edited = {
  cap: 0.06,
  daily: 0.07,
  per: 5,
  receivers: [...saved.receivers, 'wrap.near'],
};

test('a live row with different rules shows On chain → New and Update my rules', () => {
  assert.equal(saved.per_action_cap_near, 0.005);
  assert.equal(saved.daily_budget_near, 0.01);
  assert.equal(saved.max_actions_per_day, 3);
  assert.deepEqual(saved.receivers, ['charter.nearcarta.near', 'toll.nearcarta.near']);
  assert.equal(chain.per_action_cap, '5000000000000000000000');
  assert.equal(RULES_DEPOSIT_YOCTO, nearToYocto(0.001));
  assert.equal(formatNear(CALLS_DEPOSIT_YOCTO), '0.005 NEAR');
  const { changed, html } = signRulesUpdate({ live: true, local: edited, row: chain });
  assert.equal(changed, true);
  assert.match(html, /<b>On chain → New<\/b>/);
  assert.match(html, /class="btn gold big" data-testid="setup-update-rules">Update my rules</);
  assert.equal((html.match(/setup-update-rules/g) || []).length, 1);
  assert.match(html, /data-testid="diff-cap">Max per payment: 0\.005 NEAR → 0\.06 NEAR</);
  assert.match(html, /data-testid="diff-daily">Daily budget: 0\.01 NEAR → 0\.07 NEAR</);
  assert.match(html, /data-testid="diff-per">Payments per day: 3 → 5</);
  assert.match(html, /data-testid="diff-receivers">Allowed shops: charter\.nearcarta\.near, toll\.nearcarta\.near → charter\.nearcarta\.near, toll\.nearcarta\.near, wrap\.near</);
  const calls = formatNear(CALLS_DEPOSIT_YOCTO).replace(/ NEAR$/, '');
  assert.equal(updateCostLine(), `Attaches 0.001 NEAR to set_rules and ${calls} NEAR to set_calls. Unused deposit is refunded.`);
  assert.match(html, /data-testid="sign-update-cost">Attaches 0\.001 NEAR to set_rules and 0\.005 NEAR to set_calls\. Unused deposit is refunded\.</);
  assert.doesNotMatch(html, /0\.02/);
  const capOnly = signRulesUpdate({
    live: true,
    local: { cap: 0.02, daily: saved.daily_budget_near, per: saved.max_actions_per_day, receivers: saved.receivers },
    row: chain,
  });
  assert.match(capOnly.html, /diff-cap/);
  assert.doesNotMatch(capOnly.html, /diff-daily|diff-per|diff-receivers/);
});

test('a live row with the same rules shows no update button', () => {
  const local = {
    cap: saved.per_action_cap_near,
    daily: saved.daily_budget_near,
    per: saved.max_actions_per_day,
    receivers: [...saved.receivers].reverse(),
  };
  const { changed, html } = signRulesUpdate({ live: true, local, row: { ...chain, expires_at: '999' } });
  assert.equal(changed, false);
  assert.equal(html, '');
  assert.equal(rulesDiff(local, chain).length, 0);
  assert.equal(signRulesUpdate({ live: true, local: edited, row: null }).html, '');
});

test('a row that is not live shows no update button', () => {
  const { changed, html } = signRulesUpdate({ live: false, local: edited, row: chain });
  assert.equal(changed, false);
  assert.equal(html, '');
  assert.doesNotMatch(html, /setup-update-rules/);
  assert.equal(rulesLiveHint(false), '');
  const hint = rulesLiveHint(true);
  assert.match(hint, /data-testid="rules-live-hint"/);
  assert.match(hint, /Edits on a live row apply when you press Update my rules on the Sign step/);
});

test('the update plan is set_rules and set_calls, and set_agent only when the key differs', () => {
  const same = updatePlan({ rowAgent: 'aa', agentHex: 'aa', rulesDepositYocto: RULES_DEPOSIT_YOCTO, callsDepositYocto: CALLS_DEPOSIT_YOCTO });
  assert.deepEqual(same.map(t => t.method), ['set_rules', 'set_calls']);
  assert.equal(same[0].deposit, '1000000000000000000000');
  assert.equal(same[1].deposit, CALLS_DEPOSIT_YOCTO);
  const differ = updatePlan({ rowAgent: 'aa', agentHex: 'bb', rulesDepositYocto: RULES_DEPOSIT_YOCTO, callsDepositYocto: CALLS_DEPOSIT_YOCTO });
  assert.deepEqual(differ.map(t => [t.key, t.method, t.deposit]), [
    ['agent', 'set_agent', '1'],
    ['rules', 'set_rules', RULES_DEPOSIT_YOCTO],
    ['calls', 'set_calls', CALLS_DEPOSIT_YOCTO],
  ]);
});

test('an update keeps the chain expiry unless the visitor changed the session', () => {
  const chainExp = (BigInt(Date.UTC(2026, 10, 12)) * 1_000_000n).toString();
  const now = Date.UTC(2026, 10, 5, 18);
  const kept = expiresToWrite({ hoursEdited: false, hours: 1, chainExpiresAt: chainExp, nowMs: now });
  assert.equal(kept, chainExp);
  const moved = expiresToWrite({ hoursEdited: true, hours: 24, chainExpiresAt: chainExp, nowMs: now });
  assert.equal(moved, sessionExpiresAt(24, now));
  assert.notEqual(moved, chainExp);
  const day = formatExpiry(chainExp);
  const sameDate = signRulesUpdate({ live: true, local: { ...edited, expiresAt: chainExp }, row: { ...chain, expires_at: chainExp } });
  assert.match(sameDate.html, new RegExp(`data-testid="diff-expires">Expires: ${day} → ${day}`));
  assert.match(sameDate.html, /diff-cap/);
  const hoursOnly = signRulesUpdate({
    live: true,
    local: { cap: saved.per_action_cap_near, daily: saved.daily_budget_near, per: saved.max_actions_per_day, receivers: [...saved.receivers], expiresAt: moved },
    row: { ...chain, expires_at: chainExp },
  });
  assert.equal(hoursOnly.changed, true);
  assert.match(hoursOnly.html, new RegExp(`Expires: ${day} → ${formatExpiry(moved)}`));
  assert.doesNotMatch(hoursOnly.html, /diff-cap|diff-daily|diff-per|diff-receivers/);
});

test('a partial batch says which part failed and keeps the set_rules hash', () => {
  const panic = Object.assign(new Error('Smart contract panicked: ERR_RECEIVERS'), { txHash: 'EETg1qxxwtatHj8fwSQTxoRQJ18DTFc3mJmF5icFnVvp' });
  assert.equal(plainRulesError(panic, { rulesSaved: true }), 'set_rules was saved. set_calls was refused: the shop list repeats an account and a method, or it names more than 8.');
  assert.equal(plainRulesError(panic, { rulesSaved: false }), 'set_calls was refused: the shop list repeats an account and a method, or it names more than 8.');
  assert.deepEqual(hashesFromError(panic), ['EETg1qxxwtatHj8fwSQTxoRQJ18DTFc3mJmF5icFnVvp']);
  const rows = [
    { receiver_account_id: 'board.nearcarta.near', transaction_hash: 'EETg1qxxwtatHj8fwSQTxoRQJ18DTFc3mJmF5icFnVvp', actions: [{ method: 'set_calls' }], outcomes: { status: false } },
    { receiver_account_id: 'board.nearcarta.near', transaction_hash: 'DZjXkP1DwkXmYerQwyH2SAggjcxSCdqUREcujxnucysF', actions: [{ method: 'set_rules' }], outcomes: { status: true } },
  ];
  assert.equal(txHashForMethod(rows, { contract: 'board.nearcarta.near', method: 'set_rules', ok: true }), 'DZjXkP1DwkXmYerQwyH2SAggjcxSCdqUREcujxnucysF');
  assert.equal(txHashForMethod(rows, { contract: 'board.nearcarta.near', method: 'set_calls', ok: false }), 'EETg1qxxwtatHj8fwSQTxoRQJ18DTFc3mJmF5icFnVvp');
  const src = readFileSync(new URL('../../../app/house/setup.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('async function updateRules'), src.indexOf('async function sign('));
  assert.match(fn, /rememberPartial/);
  assert.match(src, /plainRulesError/);
  assert.match(src, /hoursEdited/);
  assert.match(src, /callsFailedPanel/);
});

test('setup paints the update panel and signs that plan in one wallet batch', () => {
  const src = readFileSync(new URL('../../../app/house/setup.js', import.meta.url), 'utf8');
  assert.match(src, /signRulesUpdate\(\{/);
  assert.match(src, /rulesLiveHint\(boardLive\(\) && !st\.trial && rowLive\(\)\)/);
  assert.match(src, /data-testid="setup-sign-\$\{esc\(k\)\}"/);
  const fn = src.slice(src.indexOf('async function updateRules'), src.indexOf('async function sign('));
  assert.ok(fn.startsWith('async function updateRules'));
  assert.match(fn, /ruleUpdateTransactions\(row, r, sec, local\.expiresAt\)/);
  assert.match(fn, /signAndSendTransactions\(\{ transactions: txs\.map/);
  assert.match(fn, /get_charter/);
  assert.doesNotMatch(fn, /addKeyAction|DeleteKey|open_charter/);
});
