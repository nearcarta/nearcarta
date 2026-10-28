// Mist Bank recorder: one real private payout on public TESTNETS, end to end.
//  1. Commit to the amount: c = sha256("mistbank:v1:<zats>:<salt>").
//  2. NEAR testnet: the oath approves the payout. Its memo carries only c, never the amount.
//  3. Zcash testnet: the bank wallet pays the payee inside one shielded pool, memo = oath tx + salt.
//  4. Street view: a public explorer shows the tx; the checker proves no amount is visible.
//  5. Ledger: a VIEW-ONLY wallet built from the payee's published testnet viewing key decrypts
//     the amount and memo, so anyone can recompute c and see it matches the oath memo.
// Usage: AGENT_KEY_FILE=… MIST_DIR=… ZCASH_DEVTOOL=… node backend/scripts/mistbank-record.js
// Testnet only (the devtool wallets are created with -n test). Never reads or prints a mnemonic.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentFromFile, proposal, propose } from '../src/guardhouse.js';
import { DEP } from '../src/config.js';
import { commitment, oathMemo, fetchStreet, streetCheck, parseLedger } from '../src/mistbank.js';

const { AGENT_KEY_FILE, MIST_DIR, ZCASH_DEVTOOL } = process.env;
if (!AGENT_KEY_FILE || !MIST_DIR || !ZCASH_DEVTOOL) { console.error('set AGENT_KEY_FILE, MIST_DIR, ZCASH_DEVTOOL'); process.exit(2); }
const zats = Number(process.env.MIST_ZATS || 1370000);
const z = (...a) => execFileSync(ZCASH_DEVTOOL, a, { cwd: MIST_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 900e3 });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Resume mode (after a crash past the send): RESUME_OATH=<near tx> RESUME_TXID=<zcash txid>.
// The salt is then recovered from the encrypted memo by the view-only wallet below.
let salt, c, o, txid, payeeUa, decision;
const agent = agentFromFile(AGENT_KEY_FILE);
if (process.env.RESUME_TXID) {
  txid = process.env.RESUME_TXID;
  o = { hash: process.env.RESUME_OATH, url: `https://testnet.nearblocks.io/txns/${process.env.RESUME_OATH}` };
  decision = 'allowed';
} else {
  salt = randomBytes(16).toString('hex');
  c = commitment(zats, salt);
  // 2. oath approval on NEAR testnet (0.001 NEAR to the allowlisted receiver; memo = commitment only)
  const p = await proposal({ shop: 'mistbank', clause_id: 'tip2', receiver: DEP.guardhouse.allowed_receiver, amount: '1000000000000000000000', memo: oathMemo(c) });
  o = await propose(agent, p);
  decision = o.result.value?.decision ?? o.events.find(e => e.event === 'action')?.data?.[0]?.decision;
  console.log('oath', o.hash, decision);
  if (decision !== 'allowed') { console.error('oath did not allow the payout; stopping before any Zcash send'); process.exit(1); }
  // 3. shielded payout to an address with an Orchard-protocol receiver only (lands in the bank's pool)
  payeeUa = z('wallet', '-w', join(MIST_DIR, 'payee'), 'generate-address', '-p', 'orchard').match(/utest1[0-9a-z]+/)[0];
  const memo = `nearcarta mistbank v1 oath=${o.hash} salt=${salt}`;
  z('wallet', '-w', join(MIST_DIR, 'bank'), 'sync');
  const sent = z('wallet', '-w', join(MIST_DIR, 'bank'), 'send', '-i', join(MIST_DIR, 'age-identity.txt'), '--address', payeeUa, '--value', String(zats), '--memo', memo);
  txid = (sent.match(/\b[0-9a-f]{64}\b/g) || []).at(-1);
  if (!txid) { console.error('no txid in send output'); process.exit(1); }
  console.log('zcash tx', txid);
}

// 4. street view from the public explorer, once mined
let street = null;
for (let i = 0; i < 40 && !(street?.blockHeight); i++) { await sleep(15e3); street = await fetchStreet(txid).catch(() => null); }
if (!street?.blockHeight) { console.error('tx not mined yet; rerun the ledger step later'); process.exit(1); }
const check = streetCheck(street);

// 5. ledger: view-only wallet from the payee's UFVK (testnet viewing key, safe to publish)
const accounts = z('wallet', '-w', join(MIST_DIR, 'payee'), 'list-accounts');
const ufvk = accounts.match(/uviewtest1[0-9a-z]+/)[0];
const view = mkdtempSync(join(tmpdir(), 'mist-view-'));
z('wallet', '-w', view, 'init-fvk', '--name', 'judge-view', '--fvk', ufvk, '--birthday', String(Number(street.blockHeight) - 5));
z('wallet', '-w', view, 'sync');
z('wallet', '-w', view, 'enhance'); // compact blocks carry no memos; enhance fetches the full tx
const ledger = parseLedger(z('wallet', '-w', view, 'list-tx'), txid);
if (!salt) { salt = (ledger?.memo?.match(/salt=([0-9a-f]{32})/) || [])[1]; c = commitment(ledger.zats, salt); }
if (!payeeUa) payeeUa = (z('wallet', '-w', join(MIST_DIR, 'bank'), 'list-tx').split(txid)[1] || '').match(/To: (utest1[0-9a-z]+)/)?.[1] || null;

const out = {
  at: new Date().toISOString(),
  network: { near: 'testnet', zcash: 'testnet' },
  commitment: { scheme: 'sha256("mistbank:v1:<zats>:<salt>")', value: c },
  oath: { tx: o.hash, url: o.url, decision, sender: agent.accountId, memo: oathMemo(c) },
  payout: { txid, height: Number(street.blockHeight), explorer: `https://testnet.cipherscan.app/tx/${txid}`, explorer_api: `https://api.testnet.cipherscan.app/api/tx/${txid}` },
  street: check,
  disclosure: { ufvk, payee_address: payeeUa, how: 'zcash-devtool wallet -w <dir> init-fvk --name view --fvk <ufvk> --birthday <height-5>; wallet sync; wallet enhance; wallet list-tx' },
  ledger,
  binds: ledger?.memo?.includes(o.hash) && commitment(ledger.zats, (ledger.memo.match(/salt=([0-9a-f]{32})/) || [])[1]) === c,
};
writeFileSync(new URL('../../judges/proofs/mistbank-payout.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ txid, oath: o.hash, hidden: check.amount_hidden, ledger_zats: ledger?.zats, binds: out.binds }));
