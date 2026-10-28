// Writes judges/TESTNET_TXS.md from judges/proofs/proof-check.json (run `npm run verify` first).
import { readFileSync, writeFileSync } from 'node:fs';
const u = p => new URL(`../../${p}`, import.meta.url);
const { at, rows } = JSON.parse(readFileSync(u('judges/proofs/proof-check.json'), 'utf8'));
const cell = r => {
  if (r.shop === 'mistbank' && r.label.startsWith('zcash')) return `mined at height ${r.height}; amount hidden: ${r.hidden}`;
  if (r.shop === 'toll' && r.label === 'base_sepolia_broadcast') return 'status 1 on Base Sepolia, sent from the MPC-derived address';
  const v = r.result?.value ?? r.result?.error ?? r.error ?? '';
  return (v === null || v === '' ? '"ok"' : JSON.stringify(v)).replace(/\|/g, '\\|').slice(0, 110);
};
// Arena scam set (backend/scripts/arena-scams.js): the agent is scripted to be fooled every time.
function scams() {
  let run; try { run = JSON.parse(readFileSync(u('judges/proofs/arena-scams.json'), 'utf8')); } catch { return []; }
  const steps = run.steps.filter(s => s.pattern);
  const pats = [...new Set(steps.map(s => s.pattern))];
  const link = h => `[${h.slice(0, 10)}…](https://testnet.nearblocks.io/txns/${h})`;
  return ['', '## Arena scam set', '',
    `The scam patterns public testers use on money-holding agents, run on ${run.contract} by backend/scripts/arena-scams.js (raw: judges/proofs/arena-scams.json). The agent is scripted to propose exactly what each scam asks for, so it stands in for a model that is fooled every time. Each prompt was committed as sha256 before the agent acted and then revealed on chain. The charter is per-action cap 0.02 NEAR, lifetime budget 0.04 NEAR, allowlist [bob].`, '',
    '| pattern | what the fooled agent proposed | charter | refused agent_act tx | line |', '|---|---|---|---|---|',
    ...pats.map(p => {
      const all = steps.filter(s => s.pattern === p); const ref = all.find(s => s.verdict !== 'ALLOW');
      const pay = ref.act.Pay; const allowed = all.filter(s => s.verdict === 'ALLOW').length;
      const what = `pay ${(Number(BigInt(pay.amount) / 10n ** 18n) / 1e6)} NEAR to ${pay.to}` + (allowed ? ` (after ${allowed} allowed payments within the budget)` : '');
      return `| ${p} | ${what} | \`${ref.verdict}\` | ${link(ref.agent_act_tx)} | ${ref.line} |`;
    })];
}
const short = h => `${h.slice(0, 10)}…`;
const lines = [
  '# Testnet transactions', '',
  `Every row was read back from chain by \`npm run verify\` (backend/scripts/verify-proofs.js) at ${at} (UTC); this file is written from that output by backend/scripts/txs-table.js. Raw output: judges/proofs/proof-check.json.`, '',
  `**${rows.filter(r => r.found).length}/${rows.length} found.**`, '',
  '| shop | what it proves | method | on-chain result | tx |', '|---|---|---|---|---|',
  ...rows.map(r => `| ${r.shop} | ${r.label.replace(/_/g, ' ')} | ${r.method || (r.shop === 'mistbank' ? 'zcash tx' : 'eth tx')} | ${r.found ? cell(r) : 'MISSING'} | [${short(r.hash)}](${r.url}) |`),
  ...scams(),
  '', '## Other recorded runs', '',
  '- Fresh Guardhouse run (backend/scripts/guardhouse-demo.js): allowed [4dxGpv8Y…](https://testnet.nearblocks.io/txns/4dxGpv8YkmTW79vcMDg7bXPmNN3JFrNBFLEKDXDXN6R3), denied receiver_not_allowlisted [AHhGaJCp…](https://testnet.nearblocks.io/txns/AHhGaJCpW5erBFWpWuNkNhPzKiR4BeigJyWvqV1Uzzpf).',
  '- Owner approves a big move (backend/scripts/escalation-demo.js, judges/proofs/escalation-approved.json): 0.100001 NEAR over the 0.1 NEAR cap → `escalated` → owner `resolve_escalation(approve)` → `settle:approved`, `settle:confirmed`.',
  '- Your House (e2e/house.spec.js, judges/proofs/house-wallet.json): the owner signs freeze, unfreeze and `resolve_escalation(approve)` in a real MyNearWallet testnet popup through Wallet Selector. The House charter r11house-31474.testnet has 0 full-access keys.',
  '- Mist Bank (backend/scripts/mistbank-record.js, judges/proofs/mistbank-payout.json): the Zcash testnet faucet tx [17a9a84d…](https://testnet.cipherscan.app/tx/17a9a84d758b4feebea5d8fc2c556a95cd0778506cce791c7de23c4a08e0b497) is the counter-example. It crosses pools, so its amount is public, and `GET /api/mistbank/street/<txid>` flags it.',
  '',
];
writeFileSync(u('judges/TESTNET_TXS.md'), lines.join('\n'));
console.log(`wrote ${rows.length} rows`);
