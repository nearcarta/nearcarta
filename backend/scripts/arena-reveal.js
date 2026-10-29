// Reveal the plaintext of past Vault Arena attempts on chain (testnet only). reveal_prompt checks
// sha256(prompt) against the attempt's commitment, so a wrong text is refused by the contract.
// Signs with a player function-call key (methods attempt, reveal_prompt only). Skips any attempt
// already revealed, any hash that does not match, and the bounty attempt (its text is the secret).
// Usage: FC_KEYS=.secrets/arena-fresh/fc-keys.json OUT=judges/proofs/arena-reveal.json node backend/scripts/arena-reveal.js
import { readFileSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { Account, JsonRpcProvider, KeyPairSigner, actions as A } from 'near-api-js';
import { cfg } from '../src/config.js';
import { PAST, ARENA } from '../../shared/arena/prompts.js';

if (!/testnet|:\/\/test\./.test(String(cfg.rpc))) { console.error('testnet only'); process.exit(2); }
const FC = JSON.parse(readFileSync(process.env.FC_KEYS, 'utf8')).mallory;
const provider = new JsonRpcProvider({ url: cfg.rpc });
const signer = new Account(FC.account_id, provider, KeyPairSigner.fromSecretKey(FC.private_key));
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const view = async (m, a) => { const r = await provider.query({ request_type: 'call_function', finality: 'final', account_id: ARENA, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') }); return JSON.parse(Buffer.from(r.result).toString()); };
const out = { contract: ARENA, signer: FC.account_id, key: 'function-call (attempt, reveal_prompt)', started_utc: new Date().toISOString(), reveals: [] };
for (const p of PAST) {
  if (!p.prompt) continue;
  const at = await view('get_attempt', { attempt_id: p.id });
  const rec = { id: p.id, prompt_sha256: sha(p.prompt), chain_hash: at.prompt_hash_hex, was_revealed: at.revealed };
  if (at.revealed || rec.prompt_sha256 !== at.prompt_hash_hex) { rec.skipped = at.revealed ? 'already revealed' : 'hash mismatch'; out.reveals.push(rec); continue; }
  const r = await signer.signAndSendTransaction({ receiverId: ARENA, actions: [A.functionCall('reveal_prompt', { attempt_id: p.id, prompt: p.prompt }, 30n * 10n ** 12n, 0n)], waitUntil: 'FINAL', throwOnFailure: false });
  rec.tx = r.transaction.hash; rec.ok = !r.status.Failure && !r.receipts_outcome.some(o => o.outcome.status.Failure);
  rec.revealed_after = (await view('get_attempt', { attempt_id: p.id })).revealed;
  console.log(JSON.stringify(rec)); out.reveals.push(rec);
}
out.finished_utc = new Date().toISOString();
writeFileSync(process.env.OUT, JSON.stringify(out, null, 1) + '\n');
