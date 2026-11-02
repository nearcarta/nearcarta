// Guest fallback: when the public testnet faucet refuses a visitor (it rate-limits per IP, so a judging room
// sharing one network hits it fast), the backend creates the same kind of ncguest-*.testnet account itself,
// paid from a small testnet-only sponsor account. Testnet only; one per IP per hour; a daily cap for the town.
import { DEP } from './config.js';
import { rpc as nearRpc } from './near.js';
import { keyFrom, signTx, functionCall } from '../../shared/vault/tx.js';

const NAME = /^ncguest-[a-z0-9]{6,12}\.testnet$/, PK = /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const yocto = n => BigInt(Math.round(n * 1e6)) * 10n ** 18n;
export const SPONSOR = () => {
  const a = (process.env.GUEST_SPONSOR_ACCOUNT || '').trim(), s = (process.env.GUEST_SPONSOR_KEY || '').trim();
  return a && s ? { account: a, key: keyFrom(s) } : null;
};
export const FUND = () => Number(process.env.GUEST_FUND_NEAR || 1.25);
const DAY_CAP = () => Number(process.env.GUEST_DAY_CAP || 40);
let day = '', made = 0, chain = Promise.resolve();
export function _reset() { day = ''; made = 0; }
export function guestInfo() { const s = SPONSOR(); return { enabled: !!s && DEP.network === 'testnet', sponsor: s?.account || null, fund_near: FUND(), today: made, day_cap: DAY_CAP() }; }

export async function createGuest(body, { rpc = nearRpc, sponsor = SPONSOR(), network = DEP.network, today = new Date().toISOString().slice(0, 10) } = {}) {
  const e = (status, error) => Object.assign(new Error(error), { status });
  if (network !== 'testnet') throw e(404, 'guest accounts are testnet only');
  if (!sponsor) throw e(503, 'guest sponsor not configured');
  const id = String(body?.account_id || ''), pk = String(body?.public_key || '');
  if (!NAME.test(id) || !PK.test(pk)) throw e(400, 'account_id must be ncguest-<6-12 a-z0-9>.testnet and public_key ed25519:<base58>');
  if (day !== today) { day = today; made = 0; }
  if (made >= DAY_CAP()) throw e(429, 'the town made its guest accounts for today; connect a wallet instead');
  const exists = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: id }).then(() => true, () => false);
  if (exists) throw e(409, 'that account already exists');
  const run = chain.then(async () => {
    const ak = await rpc('query', { request_type: 'view_access_key', finality: 'optimistic', account_id: sponsor.account, public_key: sponsor.key.publicKey });
    const tx = signTx({ key: sponsor.key, signerId: sponsor.account, receiverId: 'testnet', nonce: BigInt(ak.nonce) + 1n, blockHash: ak.block_hash,
      actions: [functionCall('create_account', { new_account_id: id, new_public_key: pk }, 50n * 10n ** 12n, yocto(FUND()))] });
    const r = await rpc('send_tx', { signed_tx_base64: tx.base64, wait_until: 'EXECUTED_OPTIMISTIC' });
    if (r?.status?.Failure) throw e(502, 'create_account failed on NEAR');
    return tx.hash;
  });
  chain = run.catch(() => {});
  const tx = await run; made++;
  return { account_id: id, tx, funded_near: FUND() };
}
