// Smoke the new board after it exists. Dry-run by default. It does not sign.
//
//   node scripts/board-v2-smoke.js
//   NEAR_MAINNET_SIGNER_KEY='ed25519:...' node scripts/board-v2-smoke.js --live
//
// Opens a small row for nearcarta.near, calls wrap.near near_deposit for 0.001 NEAR
// through propose_call_as, asks for a call over the cap, tightens the rules, then
// closes the row. A successful near_deposit leaves wNEAR on the board account.
// close_charter does not move that wNEAR. Read the warning before --live.
import MAIN from '../shared/deployments/mainnet.json' with { type: 'json' };

const live = process.argv.includes('--live');
const ROOT = MAIN.root;
const BOARD = MAIN.board.contract;
const ONE = 10n ** 24n;
const OPEN = ONE / 1000n;
const CALL = ONE / 1000n;
const OVER = (ONE * 3n) / 1000n;
const CAP = ONE / 500n;

const plan = {
  dry_run: !live,
  signer: ROOT,
  board: BOARD,
  warning: 'near_deposit wraps NEAR into wNEAR held by the board account. close_charter refunds the row ledger only. Do not treat a successful wrap as money returned to ' + ROOT + '.',
  steps: [
    { method: 'open_charter', owner: ROOT, fund_yocto: OPEN.toString(), deposit_yocto: MAIN.board.max_row_yocto, receivers: ['wrap.near'], per_action_cap_yocto: CAP.toString() },
    { method: 'set_calls', calls: [{ receiver: 'wrap.near', method: 'near_deposit', cap: (ONE / 100n).toString() }], session_cap_yocto: (ONE / 50n).toString(), note: 'shop cap is above the per-action cap, so the refusal below is over_per_action_cap' },
    { method: 'propose_call_as', receiver: 'wrap.near', call: 'near_deposit', args: '{}', deposit_yocto: CALL.toString(), hold: false, expect: 'the call is sent; wrap.near may reject the injected row_owner and the callback refunds the row' },
    { method: 'propose_call_as', receiver: 'wrap.near', call: 'near_deposit', deposit_yocto: OVER.toString(), expect: 'over_per_action_cap' },
    { method: 'tighten_rules', per_action_cap_yocto: (ONE / 1000n).toString(), note: 'tightens, and drops nothing the new cap still allows' },
    { method: 'close_charter', pays: ROOT },
  ],
};

console.log(JSON.stringify(plan, null, 2));
if (!live) {
  console.log('This command does not sign and does not send NEAR.');
  process.exit(0);
}

const key = process.env.NEAR_MAINNET_SIGNER_KEY || '';
if (!key.startsWith('ed25519:')) {
  console.error('Refusing: set NEAR_MAINNET_SIGNER_KEY. This script does not read a key file.');
  process.exit(1);
}

const { Account, JsonRpcProvider, KeyPairSigner, actions: A } = await import('near-api-js');
const { callAsMessage } = await import('../shared/board/call-as.js');
const { keyFrom, pubkeyHex, signMessage } = await import('../shared/vault/tx.js');
const rpc = new JsonRpcProvider({ url: MAIN.rpc });
const signer = new Account(ROOT, rpc, KeyPairSigner.fromSecretKey(key));
const agent = keyFrom();
const TG = 10n ** 12n;

async function view(method, args) {
  const raw = await rpc.callFunction(BOARD, method, args || {}, { finality: 'final' });
  return JSON.parse(Buffer.from(raw).toString('utf8'));
}
async function send(label, actions) {
  const r = await signer.signAndSendTransaction({ receiverId: BOARD, waitUntil: 'FINAL', throwOnFailure: false, actions });
  const hash = r?.transaction?.hash || '';
  const bad = r?.status?.Failure || r?.receipts_outcome?.find(x => x.outcome?.status?.Failure);
  console.log(JSON.stringify({ label, hash, ok: !bad }));
  return { ok: !bad, hash };
}

const rules = {
  receivers: ['wrap.near'],
  per_action_cap: CAP.toString(),
  daily_budget: (ONE / 100n).toString(),
  max_actions_per_day: 4,
  window_start_min: 0,
  window_end_min: 0,
  min_amount: '1',
  expires_at: '0',
};
await send('open_charter', [A.functionCall('open_charter', { rules, agent: pubkeyHex(agent), fund: OPEN.toString() }, 80n * TG, BigInt(MAIN.board.max_row_yocto))]);
await send('set_calls', [A.functionCall('set_calls', {
  calls: [{ receiver: 'wrap.near', method: 'near_deposit', cap: (ONE / 100n).toString() }],
  session_cap: (ONE / 50n).toString(),
}, 80n * TG, ONE / 100n)]);

async function callAs(label, deposit) {
  const row = await view('get_charter', { owner: ROOT });
  const expiry = (BigInt(Date.now()) * 1_000_000n) + 3_600_000_000_000n;
  const signature = signMessage(agent, callAsMessage({
    network: 'mainnet', contract: BOARD, owner: ROOT, receiver: 'wrap.near', method: 'near_deposit',
    args: '{}', deposit, nonce: row.nonce, expiry, epoch: '1', effects: [], hold: false,
  }));
  return send(label, [A.functionCall('propose_call_as', {
    owner: ROOT, receiver: 'wrap.near', method: 'near_deposit', args: '{}', deposit: deposit.toString(),
    expiry: expiry.toString(), effects: [], hold: false, signature,
  }, 150n * TG, 0n)]);
}
await callAs('near_deposit 0.001', CALL);
const refused = await callAs('over cap', OVER);
if (refused.ok) console.log(JSON.stringify({ label: 'over cap', note: 'the transaction was accepted; the contract refusal is inside the receipt' }));
await send('tighten_rules', [A.functionCall('tighten_rules', { rules: { ...rules, per_action_cap: (ONE / 1000n).toString() }, freeze: false }, 80n * TG, 0n)]);
await send('close_charter', [A.functionCall('close_charter', {}, 80n * TG, 0n)]);
