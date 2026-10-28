// Mist Bank recorder: one real private payout on public TESTNETS, end to end.
//  1. Commit to the amount: c = sha256("mistbank:v1:<amount>:<salt>").
//  2. NEAR testnet: the oath approves the payout. Its memo carries only c, never the amount.
//  3. Zcash testnet: the bank wallet pays the payee inside one shielded pool, memo = oath tx + salt.
//  4. Street view: a public explorer shows the tx; the checker proves no amount is visible.
//  5. Ledger (auditor only): a VIEW-ONLY wallet built from the payee's viewing key decrypts the
//     amount and memo. The key and the opening go to AUDITOR_OUT (outside the repo), never to the
//     public proof: the public record holds the commitment and the tx links only.
//  Timing: the Zcash send waits a random delay after the NEAR approval (MIST_DELAY_MIN_S..MAX_S,
//  default 15..45 min) so the approval and the payout cannot be paired by time.
// Usage: AGENT_KEY_FILE=… MIST_DIR=… ZCASH_DEVTOOL=… AUDITOR_OUT=… node backend/scripts/mistbank-record.js
// The payee wallet is MIST_PAYEE_WALLET (default "payee-r2"): the first payee wallet's viewing key
// was public until 2026-10-28, so it is retired.
// Testnet only (the devtool wallets are created with -n test). Never reads or prints a mnemonic.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentFromFile, proposal, propose } from '../src/guardhouse.js';
import { DEP } from '../src/config.js';
import { commitment, oathMemo, fetchStreet, streetCheck, parseLedger } from '../src/mistbank.js';

const { AGENT_KEY_FILE, MIST_DIR, ZCASH_DEVTOOL, AUDITOR_OUT } = process.env;
if (!AGENT_KEY_FILE || !MIST_DIR || !ZCASH_DEVTOOL || !AUDITOR_OUT) { console.error('set AGENT_KEY_FILE, MIST_DIR, ZCASH_DEVTOOL, AUDITOR_OUT'); process.exit(2); }
const REPO = fileURLToPath(new URL('../../', import.meta.url));
if (resolve(AUDITOR_OUT).startsWith(REPO)) { console.error('AUDITOR_OUT must be outside the repo'); process.exit(2); }
const PAYEE = process.env.MIST_PAYEE_WALLET || 'payee-r2';
if (PAYEE === 'payee') { console.error('the "payee" wallet is retired (its viewing key was public)'); process.exit(2); }
const dMin = Number(process.env.MIST_DELAY_MIN_S ?? 900), dMax = Number(process.env.MIST_DELAY_MAX_S ?? 2700);
const delayS = dMin + (randomBytes(4).readUInt32BE() % (Math.max(dMax - dMin, 0) + 1));
const zats = Number(process.env.MIST_ZATS); // required: no default, the amount is private
if (!Number.isInteger(zats) || zats <= 0) { console.error('set MIST_ZATS (integer zatoshi)'); process.exit(2); }
const z = (...a) => execFileSync(ZCASH_DEVTOOL, a, { cwd: MIST_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 900e3 });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Resume mode (after a crash past the send): RESUME_OATH=<near tx> RESUME_TXID=<zcash txid> RESUME_ACCOUNT=<payee account name>.
// The salt is then recovered from the encrypted memo by the view-only wallet below.
let salt, c, o, txid, payeeUa, decision;
// One payee account per payout, so its viewing key discloses this payout and nothing else
// (ZIP 32 account keys are hardened: one account's UFVK says nothing about another's).
let payeeName = process.env.RESUME_ACCOUNT || 'mist-payee';
const accountBlock = name => z('wallet', '-w', join(MIST_DIR, PAYEE), 'list-accounts').split(/\n(?=Account )/).find(b => new RegExp(`Name: ${name}\\s`).test(b + '\n'));
const agent = agentFromFile(AGENT_KEY_FILE);
if (process.env.RESUME_TXID) {
  txid = process.env.RESUME_TXID;
  o = { hash: process.env.RESUME_OATH, url: `https://testnet.nearblocks.io/txns/${process.env.RESUME_OATH}` };
  decision = 'allowed';
} else {
  salt = randomBytes(16).toString('hex');
  c = commitment(zats, salt);
  // 2. oath approval on NEAR testnet (0.001 NEAR to the allowlisted receiver; memo = commitment only)
  const p = await proposal({ shop: 'payout', clause_id: 'tip2', receiver: DEP.guardhouse.allowed_receiver, amount: '1000000000000000000000', memo: oathMemo(c) });
  o = await propose(agent, p);
  decision = o.result.value?.decision ?? o.events.find(e => e.event === 'action')?.data?.[0]?.decision;
  console.log('oath', o.hash, decision);
  if (decision !== 'allowed') { console.error('oath did not allow the payout; stopping before any Zcash send'); process.exit(1); }
  // decorrelate: the Zcash send does not follow the approval at a fixed, pairable interval
  console.log(`waiting ${delayS}s before the Zcash send`);
  await sleep(delayS * 1000);
  // 3. shielded payout to an address with an Orchard-protocol receiver only (lands in the bank's pool)
  payeeName = `mb-${salt.slice(0, 8)}`;
  z('wallet', '-w', join(MIST_DIR, PAYEE), 'generate-account', '-i', join(MIST_DIR, 'age-identity.txt'), '--name', payeeName);
  const uuid = accountBlock(payeeName).match(/Account ([0-9a-f-]{36})/)[1];
  payeeUa = z('wallet', '-w', join(MIST_DIR, PAYEE), 'generate-address', uuid, '-p', 'orchard').match(/utest1[0-9a-z]+/)[0];
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

// 5. ledger: view-only wallet from the payee's UFVK (auditor only; written to AUDITOR_OUT)
const ufvk = accountBlock(payeeName).match(/uviewtest1[0-9a-z]+/)[0];
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
  commitment: { scheme: 'sha256("mistbank:v1:<amount>:<salt>")', value: c },
  oath: { tx: o.hash, url: o.url, decision, sender: agent.accountId, memo: oathMemo(c) },
  payout: { txid, height: Number(street.blockHeight), explorer: `https://testnet.cipherscan.app/tx/${txid}`, explorer_api: `https://api.testnet.cipherscan.app/api/tx/${txid}` },
  street: check,
  delay_s: process.env.RESUME_TXID ? null : delayS,
  auditor: { held_by: 'the owner, given to an auditor out of band; never served by the API or committed',
    how: 'the auditor imports the UFVK into their own zcash-devtool view-only wallet (init-fvk, sync, enhance, list-tx), reads the amount and the salt from the encrypted memo, then checks the opening against the commitment on chain with POST /api/mistbank/verify or by hashing it locally' },
};
const binds = ledger?.memo?.includes(o.hash) && commitment(ledger.zats, (ledger.memo.match(/salt=([0-9a-f]{32})/) || [])[1]) === c;
writeFileSync(AUDITOR_OUT, JSON.stringify({ oath_tx: o.hash, zcash_txid: txid, disclosure: { ufvk, payee_address: payeeUa, birthday: Number(street.blockHeight) - 5 }, ledger, binds }, null, 1), { mode: 0o600 });
writeFileSync(new URL('../../judges/proofs/mistbank-payout.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ txid, oath: o.hash, hidden: check.amount_hidden, binds, auditor_file: AUDITOR_OUT }));
