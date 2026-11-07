// Payouts live steps, in order, with every dry step separated from every step that would move money.
// Default run: reads only. It prints the 1Click prices, the visitor row gate, the exact session calls
// the board would receive, and the invoice flow. It signs nothing and sends nothing.
//   node backend/scripts/payouts-live-dryrun.js --owner <your.near>
//   node backend/scripts/payouts-live-dryrun.js --owner <your.near> --amount 0.15 --to 0xYourBaseAddress
//   node backend/scripts/payouts-live-dryrun.js --owner <your.near> --invoice-only --amount 0.2 --receive <payee.near>
// `--deposit` asks 1Click for a real deposit address for one row (still no chain tx and no deposit sent).
// The script never signs a NEAR transaction: the deposit is the visitor's session propose_call, which
// only the browser key can make. docs/PAYOUTS_LIVE.md is the owner's checklist.
// Sources: backend/src/payouts-payroll.js payrollRowGate, shared/board/session.js payoutsCalls,
// backend/src/payouts-invoice.js createInvoice/quoteStored, 1Click EXACT_OUTPUT.
import { readFileSync } from 'node:fs';
import { tokens, findToken } from '../src/ferry.js';
import { quotePayrollRow, createInvoice, quoteStored, sponsorshipPlan, indicativeRefund } from '../src/payouts-invoice.js';
import { payrollRowGate, payrollCheckoutInput, openPayrollCheckout } from '../src/payouts-payroll.js';
import { FERRY_CALL_TARGETS, callPolicy, callsFitRow, payoutsCalls } from '../../shared/board/session.js';
import { view } from '../src/near.js';
import { cfg } from '../src/config.js';

const args = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const flag = name => args.includes(`--${name}`);

const owner = arg('owner');
const amount = Number(arg('amount', '0.15'));
const receive = arg('receive', 'nearcarta.near');
const to = arg('to', '0x561E8eF0FEcB621469dA30250dC6CdCD1E47A66e');
const CHAINS = (arg('chains', 'base,arb,eth')).split(',').map(s => s.trim()).filter(Boolean);
const out = (label, value) => console.log(`${label.padEnd(28)} ${typeof value === 'string' ? value : JSON.stringify(value)}`);

async function readRow(who) {
  const D = JSON.parse(readFileSync(new URL('../../shared/deployments/mainnet.json', import.meta.url), 'utf8'));
  const board = D.board?.contract;
  if (!board || !who) return null;
  try { return await view(board, 'get_charter', { owner: who }); } catch { return null; }
}

async function main() {
  console.log(`# Payouts live dry run. Network ${cfg.rpc}. No transaction is signed by this script.\n`);
  const list = await tokens();
  const near = findToken(list, 'wNEAR@near');
  out('wNEAR on NEAR', near ? near.assetId : 'MISSING');

  console.log('\n## 1. One foreign row per chain: the 1Click price the cap will check');
  for (const chain of CHAINS) {
    const price = await quotePayrollRow({ chain, asset: 'USDC', to, amt: amount });
    if (!price.ok) { out(`  USDC on ${chain}`, `${price.reason} ${price.error || ''}`); continue; }
    out(`  USDC on ${chain}`, `pay ${amount} USDC, costs ${price.quote.near} wNEAR (${price.quote.nearUsd} USD), about ${price.quote.minutes}s`);
    out('    deposit address', price.depositAddress === null ? 'none (dry quote)' : price.depositAddress);
  }

  if (flag('invoice-only')) return invoiceFlow();

  console.log('\n## 2. The visitor row is the gate (read from the board)');
  if (!owner) {
    out('row', 'no --owner given, so the gate cannot be read. Pass --owner your.near.');
  } else {
    const row = await readRow(owner);
    if (!row) {
      out('row', `${owner} has no board row yet. Open one in /setup first.`);
    } else {
      out('per_action_cap', `${row.per_action_cap} yocto`);
      out('daily_budget', `${row.daily_budget} yocto`);
      out('actions_today', `${row.actions_today} of ${row.max_actions_per_day}`);
      out('spent_today', `${row.spent_today} yocto`);
      out('balance', `${row.balance} yocto`);
      const cap = Number(BigInt(String(row.per_action_cap)) / 10n ** 18n) / 1e6;
      out('cap in NEAR', cap);
      for (const chain of CHAINS) {
        const price = await quotePayrollRow({ chain, asset: 'USDC', to, amt: amount });
        if (!price.ok) continue;
        const gate = payrollRowGate({ row, amtNear: price.quote.near });
        out(`  gate USDC@${chain}`, gate.ok ? `allowed (${price.quote.near} NEAR of ${cap})` : `refused: ${gate.reason}`);
      }
      const input = payrollCheckoutInput({ chain: CHAINS[0], asset: 'USDC', to, amt: amount, near: 0.05, refundTo: owner });
      out('checkout body', input.ok ? input.value : input.error);
      const calls = payoutsCalls([...FERRY_CALL_TARGETS, { receiver: 'board.nearcarta.near', method: 'stamp', cap: String(row.per_action_cap) }], String(row.per_action_cap));
      out('row call list fits', `${calls.fits} (${calls.calls.length} pairs)`);
      out('USDC storage pair', calls.calls.some(c => c.method === 'storage_deposit') ? 'present' : 'not in the list (row too small; no sponsorship)');
      const policy = callPolicy(row.receivers || [], String(row.per_action_cap), String(row.daily_budget), 'ft_transfer', calls.calls);
      out('set_calls pairs', policy.calls.length);
      out('set_calls fits row', callsFitRow(policy.calls));
      const plan = sponsorshipPlan({ enabled: true, account: receive, minNear: 0.00125, capNear: cap, registered: false });
      out('sponsor plan', plan.ok ? `${plan.depositNear} NEAR storage_deposit for ${receive}` : `not offered: ${plan.reason}`);
      // --deposit asks 1Click for a real deposit address. It is not a chain tx and it sends no USDC,
      // but it does mean the row is quoted live: the owner should run it deliberately, once.
      if (flag('deposit')) {
        const chain = CHAINS[0];
        const price = await quotePayrollRow({ chain, asset: 'USDC', to, amt: amount });
        if (!price.ok) out('  live deposit address', `not asked: ${price.reason}`);
        else {
          const live = await openPayrollCheckout(
            { chain, asset: 'USDC', to, amt: amount, near: price.quote.near, refundTo: owner, slippage: price.quote.slippage },
            { row },
          );
          out('  live deposit address', live.ok ? live.depositAddress : `refused: ${live.reason}`);
          if (live.ok) {
            out('  send this much wNEAR', `${live.near} NEAR, through your session (propose_call)`);
            out('  then watch', `/api/payouts/payroll/status?depositAddress=${live.depositAddress}`);
            out('  sends USDC?', 'no. Nothing is deposited by this script.');
          }
        }
      }
    }
  }

  console.log('\n## 3. What the session would send for one foreign row (propose_call steps)');
  console.log('   1. wrap.near near_deposit   deposit <wNEAR the quote named>');
  console.log('   2. wrap.near storage_deposit deposit 0.00125 NEAR for the 1Click deposit address');
  console.log('   3. wrap.near ft_transfer     deposit 1 yocto, args {receiver_id: <deposit address>, amount, memo}');
  console.log('   The fee is the route spread above. The payee gets exactly the USDC amount, or the swap refunds.');
  console.log('   The row is paid on 1Click SUCCESS, never before: GET /api/payouts/payroll/status?depositAddress=...');

  return invoiceFlow();
}

async function invoiceFlow() {
  console.log('\n## 4. The stranger-paid EXACT_OUTPUT invoice');
  const made = createInvoice({ usd: amount, receive, memo: 'live proof', visitor: owner || 'dry-run' });
  out('invoice', made.ok ? `${made.invoice.id} ${made.invoice.usd} USDC -> ${made.invoice.receive}` : made.reason);
  if (!made.ok) return;
  out('pay link', made.invoice.href);
  // Indicative: the 1Click stand-in refund address, the same one the payer page uses before the payer types theirs.
  const indicative = await quoteStored(made.invoice.id, { from: `USDC@${CHAINS[0]}`, chain: CHAINS[0], indicative: true, refundTo: indicativeRefund(CHAINS[0]) }, {});
  out('indicative quote', indicative.ok ? `${indicative.send} USDC in, ${indicative.receive} out, fee ${indicative.feeUsd}, ${indicative.seconds}s` : indicative.reason);
  out('deposit address', 'only after the payer types their own refund address and presses Pay');
  console.log('   The payer is a stranger: they open the link, pick a chain, type their refund address,');
  console.log('   and press Pay. The receive account and the amount cannot be changed by the link.');
}

main().catch(e => { console.error(e); process.exit(1); });
