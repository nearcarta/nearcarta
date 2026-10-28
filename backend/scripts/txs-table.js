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
const short = h => `${h.slice(0, 10)}…`;
const lines = [
  '# Testnet transactions', '',
  `Every row was read back from chain by \`npm run verify\` (backend/scripts/verify-proofs.js) at ${at} (UTC); this file is written from that output by backend/scripts/txs-table.js. Raw output: judges/proofs/proof-check.json.`, '',
  `**${rows.filter(r => r.found).length}/${rows.length} found.**`, '',
  '| shop | what it proves | method | on-chain result | tx |', '|---|---|---|---|---|',
  ...rows.map(r => `| ${r.shop} | ${r.label.replace(/_/g, ' ')} | ${r.method || (r.shop === 'mistbank' ? 'zcash tx' : 'eth tx')} | ${r.found ? cell(r) : 'MISSING'} | [${short(r.hash)}](${r.url}) |`),
  '', '## Other recorded runs', '',
  '- Fresh Guardhouse run (backend/scripts/guardhouse-demo.js): allowed [4dxGpv8Y…](https://testnet.nearblocks.io/txns/4dxGpv8YkmTW79vcMDg7bXPmNN3JFrNBFLEKDXDXN6R3), denied receiver_not_allowlisted [AHhGaJCp…](https://testnet.nearblocks.io/txns/AHhGaJCpW5erBFWpWuNkNhPzKiR4BeigJyWvqV1Uzzpf).',
  '- Owner approves a big move (backend/scripts/escalation-demo.js, judges/proofs/escalation-approved.json): 0.100001 NEAR over the 0.1 NEAR cap → `escalated` → owner `resolve_escalation(approve)` → `settle:approved`, `settle:confirmed`.',
  '- Mist Bank (backend/scripts/mistbank-record.js, judges/proofs/mistbank-payout.json): the Zcash testnet faucet tx [17a9a84d…](https://testnet.cipherscan.app/tx/17a9a84d758b4feebea5d8fc2c556a95cd0778506cce791c7de23c4a08e0b497) is the counter-example. It crosses pools, so its amount is public, and `GET /api/mistbank/street/<txid>` flags it.',
  '',
];
writeFileSync(u('judges/TESTNET_TXS.md'), lines.join('\n'));
console.log(`wrote ${rows.length} rows`);
