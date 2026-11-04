// One real mainnet 1Click swap, for the owner to run. This process does not send the deposit.
// Without --live it only prints the steps.
//
//   node backend/scripts/ferry-live-swap.js
//   node backend/scripts/ferry-live-swap.js --live --amount 0.2 --from USDC@base --to USDC@near --refund-to 0xYOURADDRESS
//   node backend/scripts/ferry-live-swap.js --status DEPOSIT_ADDRESS
//
// --live reads the town charter on mainnet, refuses unless that charter would allow 0.001 NEAR
// to its listed recipient, then asks 1Click for a deposit address of at most 0.20 USD.
// You send the tokens from your own wallet. Then --status polls the swap.
import { readFileSync, writeFileSync } from 'node:fs';
import { MAX_CHECKOUT_USD } from '../src/ferry-checkout.js';

const argv = process.argv.slice(2);
const flag = n => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : null;
};
const live = argv.includes('--live');
const statusOf = flag('--status');

if (!live && !statusOf) {
  console.log(`A Pay button is /ferry-widget. POST /api/ferry/checkout returns a deposit address only after the charter allows the recipient, and only for at most ${MAX_CHECKOUT_USD} USD.
This script does not send funds. One real swap:
  node backend/scripts/ferry-live-swap.js --live --amount 0.2 --from USDC@base --to USDC@near --refund-to 0xYOURADDRESS
Then send that amount from your wallet to the printed address and run:
  node backend/scripts/ferry-live-swap.js --status DEPOSIT_ADDRESS`);
  process.exit(0);
}

const { startCheckout, fetchOneClickStatus, defaultVerify, checkoutDeps } = await import('../src/ferry-checkout.js');
checkoutDeps.verify = defaultVerify;

if (statusOf) {
  const st = await fetchOneClickStatus(statusOf);
  console.log(JSON.stringify(st, null, 2));
  process.exit(st.status === 'SUCCESS' ? 0 : 0);
}

const amount = flag('--amount') || '0.2';
const from = flag('--from') || 'USDC@base';
const to = flag('--to') || 'USDC@near';
const refundTo = flag('--refund-to');
if (!refundTo) { console.error('Pass --refund-to, the address on the chain you pay from.'); process.exit(1); }
const n = Number(amount);
if (!Number.isFinite(n) || n <= 0 || n > MAX_CHECKOUT_USD) {
  console.error(`Refusing amount ${amount}. The cap is ${MAX_CHECKOUT_USD} USD.`);
  process.exit(1);
}

const mainnet = JSON.parse(readFileSync(new URL('../../shared/deployments/mainnet.json', import.meta.url), 'utf8'));
const charter = mainnet.charter.contract;
const recipient = mainnet.charter.clause_pay.receivers[0];
const out = await startCheckout({
  from, to, amount, recipient, refundTo, charter, clause_id: 'pay',
  amount_yocto: '1000000000000000000000', privacy: 'public',
});
if (!out.ok || !out.depositAddress) {
  console.error(JSON.stringify({ ok: false, reason: out.reason || out.error || 'refused', depositAddress: null }));
  process.exit(1);
}
const record = {
  depositAddress: out.depositAddress, recipient, charter, usd: out.usd, status: out.status, tx: out.depositAddress,
  at: new Date().toISOString(),
};
writeFileSync(new URL('../../judges/proofs/ferry-checkout.json', import.meta.url), JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({
  depositAddress: out.depositAddress, depositMemo: out.depositMemo, usd: out.usd, deadline: out.deadline,
  help: 'Send the tokens from your wallet to depositAddress. This script did not send them. Then run --status ' + out.depositAddress,
}, null, 2));
