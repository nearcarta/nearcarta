// One mainnet session on board.nearcarta.near: open a row, add a function-call key,
// one allowed propose signed by that key, then over-cap, frozen and expired refusals,
// then delete the key and close the row. The owner key is NEAR_MAINNET_SIGNER_KEY and is never printed.
// Without --live this prints the plan and does not sign.
// Function-call keys: https://docs.near.org/protocol/accounts-contracts/access-keys
// Login key: https://docs.near.org/web3-apps/tutorials/wallet-login
// Message bytes: contracts/charter_board/src/lib.rs proposal_text. set_calls: the same file.
import { Account, JsonRpcProvider, KeyPairSigner } from 'near-api-js';
import MAIN from '../../shared/deployments/mainnet.json' with { type: 'json' };
import { proposalMessage } from '../../shared/board/message.js';
import { AGENT_METHODS, BOARD_PROPOSE_TGAS, GAS_TOPUP_YOCTO, SESSION_BEATS, SESSION_HOURS, callPolicy, sessionExpiresAt } from '../../shared/board/session.js';
import { functionCall, keyFrom, outcomeOf, rpcClient, signMessage, signTx, viewFn } from '../../shared/vault/tx.js';

const live = process.argv.includes('--live');
if (!live) {
  console.log(JSON.stringify({ plan: SESSION_BEATS, methods: AGENT_METHODS, hours: SESSION_HOURS }));
  process.exit(0);
}

const secret = process.env.NEAR_MAINNET_SIGNER_KEY || '';
if (!secret.startsWith('ed25519:')) { console.error('set NEAR_MAINNET_SIGNER_KEY'); process.exit(1); }

const BOARD = MAIN.board.contract;
const OWNER = MAIN.root;
const SHOP = SESSION_BEATS.shop;
const TG = 10n ** 12n;
const near = s => {
  const [whole, frac = ''] = String(s).split('.');
  return (BigInt(whole || '0') * 1_000_000n + BigInt((frac + '000000').slice(0, 6))) * 10n ** 18n;
};
const rpc = rpcClient([MAIN.rpc]);
const me = new Account(OWNER, new JsonRpcProvider({ url: MAIN.rpc }), KeyPairSigner.fromSecretKey(secret));
const agent = keyFrom();

function failed(r) {
  return r?.status?.Failure || r?.receipts_outcome?.find(x => x.outcome?.status?.Failure)?.outcome.status.Failure;
}
async function call(label, method, args, deposit) {
  const r = await me.signAndSendTransaction({
    receiverId: BOARD, waitUntil: 'FINAL', throwOnFailure: false,
    actions: [(await import('near-api-js')).actions.functionCall(method, args, 80n * TG, BigInt(deposit))],
  });
  const bad = failed(r);
  console.log(JSON.stringify({ label, method, hash: r.transaction?.hash, ok: !bad, error: bad ? JSON.stringify(bad).slice(0, 200) : undefined }));
  if (bad) throw new Error(label);
  return r;
}
async function propose(label, amount, expect) {
  const row = await viewFn(rpc, BOARD, 'get_charter', { owner: OWNER });
  const y = near(amount).toString();
  const signature = signMessage(agent, proposalMessage({ contract: BOARD, owner: OWNER, receiver: SHOP, amount: y, nonce: String(row.nonce) }));
  const args = { owner: OWNER, receiver: SHOP, amount: y, signature, reveal: null };
  const ak = await rpc('query', { request_type: 'view_access_key', finality: 'optimistic', account_id: OWNER, public_key: agent.publicKey });
  const signed = signTx({
    key: agent, signerId: OWNER, receiverId: BOARD, nonce: BigInt(ak.nonce) + 1n, blockHash: ak.block_hash,
    actions: [functionCall('propose', args, BigInt(BOARD_PROPOSE_TGAS) * TG)],
  });
  const r = await rpc('send_tx', { signed_tx_base64: signed.base64, wait_until: 'FINAL' });
  const o = outcomeOf(r);
  const error = o.ok ? '' : String(o.error);
  const ok = expect === 'allowed' ? o.ok : error.includes(expect);
  console.log(JSON.stringify({ label, hash: signed.hash, signer: 'function-call-key', ok, error: error.slice(0, 180) }));
  if (!ok) throw new Error(label + ' ' + error);
}

const rules = {
  receivers: [SHOP],
  per_action_cap: near(SESSION_BEATS.perActionNear).toString(),
  daily_budget: near(SESSION_BEATS.dailyNear).toString(),
  max_actions_per_day: 4,
  window_start_min: 0,
  window_end_min: 0,
  min_amount: near(SESSION_BEATS.minNear).toString(),
  expires_at: sessionExpiresAt(SESSION_BEATS.hours),
};
let opened = false;
let added = false;
try {
  const existing = await viewFn(rpc, BOARD, 'get_charter', { owner: OWNER });
  if (existing) throw new Error('a row is already open; close it before this run');
  await call('open', 'open_charter', { rules, agent: agent.publicKey, fund: near(SESSION_BEATS.fundNear).toString() }, near(SESSION_BEATS.openDepositNear));
  opened = true;
  await call('calls', 'set_calls', callPolicy([SHOP], near(SESSION_BEATS.perActionNear).toString(), near(SESSION_BEATS.dailyNear).toString(), SESSION_BEATS.method), near(SESSION_BEATS.callsDepositNear));
  await me.addFunctionCallAccessKey({ publicKey: agent.publicKey, contractId: BOARD, methodNames: [...AGENT_METHODS], allowance: GAS_TOPUP_YOCTO });
  added = true;
  console.log(JSON.stringify({ label: 'agent_key', publicKey: agent.publicKey, methods: AGENT_METHODS }));
  await propose('allowed', SESSION_BEATS.allowedNear, 'allowed');
  await propose('over_cap', SESSION_BEATS.overNear, 'over_per_action_cap');
  await call('freeze', 'set_frozen', { frozen: true }, 0);
  await propose('frozen', SESSION_BEATS.allowedNear, 'frozen');
  await call('unfreeze', 'set_frozen', { frozen: false }, 0);
  await call('expire', 'set_rules', { rules: { ...rules, expires_at: '1' } }, near('0.001'));
  await propose('expired', SESSION_BEATS.allowedNear, 'clause_expired');
} finally {
  if (added) {
    try { await me.deleteKey(agent.publicKey); console.log(JSON.stringify({ label: 'delete_key', ok: true })); }
    catch (e) { console.log(JSON.stringify({ label: 'delete_key', ok: false, error: String(e?.message || e).slice(0, 160) })); }
  }
  if (opened) {
    try { await call('close', 'close_charter', {}, 0); }
    catch (e) { console.log(JSON.stringify({ label: 'close', ok: false, error: String(e?.message || e).slice(0, 160) })); }
  }
}
console.log(JSON.stringify({ config: await viewFn(rpc, BOARD, 'get_config', {}) }));
