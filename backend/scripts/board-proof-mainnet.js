// One real mainnet run against board.nearcarta.near from nearcarta.near:
// open_charter, one allowed payment, two refusals, close_charter.
// The signer key comes from NEAR_MAINNET_SIGNER_KEY and is never printed.
// The agent key is made fresh in memory for this run; only its public half is sent.
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from 'near-api-js';
import { proposalMessage } from '../../shared/board/message.js';
import MAIN from '../../shared/deployments/mainnet.json' with { type: 'json' };

const key = process.env.NEAR_MAINNET_SIGNER_KEY || '';
if (!key.startsWith('ed25519:')) { console.error('set NEAR_MAINNET_SIGNER_KEY'); process.exit(1); }
const BOARD = MAIN.board.contract, OWNER = MAIN.root, SHOP = 'townhall.nearcarta.near';
const mN = n => (BigInt(Math.round(n * 1e6)) * 10n ** 18n).toString();
const TG = 10n ** 12n;
const me = new Account(OWNER, new JsonRpcProvider({ url: MAIN.rpc }), KeyPairSigner.fromSecretKey(key));
const agent = KeyPair.fromRandom('ed25519');
const hex = b => Buffer.from(b).toString('hex');

async function call(label, method, args, deposit) {
  const r = await me.signAndSendTransaction({ receiverId: BOARD, waitUntil: 'FINAL', throwOnFailure: false,
    actions: [(await import('near-api-js')).actions.functionCall(method, args, 100n * TG, BigInt(deposit))] });
  const bad = r.status?.Failure || r.receipts_outcome?.find(x => x.outcome.status.Failure)?.outcome.status.Failure;
  console.log(JSON.stringify({ label, method, hash: r.transaction.hash, ok: !bad, error: bad ? JSON.stringify(bad).slice(0, 200) : undefined }));
  return r;
}
const view = (method, args) => me.provider.callFunction({ contractId: BOARD, method, args, blockQuery: { finality: 'final' } });
async function nonce() {
  return (await view('get_charter', { owner: OWNER })).nonce;
}
async function propose(label, receiver, amount) {
  const n = await nonce();
  const msg = proposalMessage({ contract: BOARD, owner: OWNER, receiver, amount, nonce: n });
  const sig = agent.sign(new TextEncoder().encode(msg)).signature;
  return call(label, 'propose', { owner: OWNER, receiver, amount, signature: hex(sig) }, 0);
}

const rules = { receivers: [SHOP], per_action_cap: mN(0.002), daily_budget: mN(0.005), max_actions_per_day: 4,
  window_start_min: 0, window_end_min: 0, min_amount: mN(0.0001), expires_at: '0' };
// If a previous run opened the row, bind this run's fresh agent key with set_agent instead.
if (await view('get_charter', { owner: OWNER })) await call('rebind_agent', 'set_agent', { agent: agent.getPublicKey().toString() }, mN(0.001));
else await call('open', 'open_charter', { rules, agent: agent.getPublicKey().toString(), fund: mN(0.01) }, mN(0.03));
console.log(JSON.stringify({ row: await view('get_charter', { owner: OWNER }) }));
await propose('allowed', SHOP, mN(0.001));
await propose('refused_over_cap', SHOP, mN(0.003));
await propose('refused_stranger', 'stranger.near', mN(0.001));
console.log(JSON.stringify({ row: await view('get_charter', { owner: OWNER }) }));
await call('close', 'close_charter', {}, 0);
console.log(JSON.stringify({ config: await view('get_config', {}) }));
