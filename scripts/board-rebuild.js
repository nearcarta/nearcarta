// Rebuild board.nearcarta.near from main (B1–B5): close the held visitor row, reap, create again from the nep330 build.
// Dry by default. --live --step <close-row|reap|create|smoke> signs one step. Keys come from the environment, never printed.
//   NEAR_MAIN_PRIVATE_KEY      nearcarta.near (board owner)
//   NEAR_IMPLICIT_PRIVATE_KEY  the held visitor wallet (its row is closed first; it is also the stranger in the smoke test)
//   BOARD_WASM                 nep330 build of contracts/charter_board
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import MAIN from '../shared/deployments/mainnet.json' with { type: 'json' };
import { storageBytes, deployGas, BYTE_YOCTO, GAS_PURCHASE_YOCTO } from '../shared/board/cost.js';

const RPC = MAIN.rpc, OWNER = MAIN.root, BOARD = MAIN.board.contract, VISITOR = MAIN.root_funder;
const TG = 10n ** 12n, MILLI = 10n ** 21n;
const SLACK = 20n * MILLI; // free balance kept on the board, the same size as the old build's
const near = y => { const v = BigInt(y); return (v / 10n ** 24n) + '.' + (v % 10n ** 24n).toString().padStart(24, '0').slice(0, 6); };
async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then(x => x.json());
  if (r.error) throw new Error(r.error.cause?.name || r.error.message); return r.result;
}
const account = id => rpc('query', { request_type: 'view_account', finality: 'final', account_id: id }).catch(() => null);
const view = (m, a = {}) => rpc('query', { request_type: 'call_function', finality: 'final', account_id: BOARD, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') }).then(r => JSON.parse(Buffer.from(r.result).toString() || 'null')).catch(() => undefined);
function wasm() { const bytes = readFileSync(process.env.BOARD_WASM || '/workspace/near/build-mainnet/board.wasm'); return { bytes, sha: createHash('sha256').update(bytes).digest('hex') }; }

export async function plan() {
  const w = wasm(); const b = await account(BOARD); const cfg = await view('get_config'); const row = await view('get_charter', { owner: VISITOR });
  const bytes = storageBytes(w.bytes.length, OWNER); const stake = bytes * BYTE_YOCTO + SLACK; const gas = deployGas(w.bytes.length) + 30n * TG;
  return { board: b ? { amount: near(b.amount), storage: b.storage_usage, code: b.code_hash } : null, rows: cfg?.rows, visitor_row: row ? { balance: near(row.balance), storage: near(row.storage_locked) } : null,
    wasm: { bytes: w.bytes.length, sha256: w.sha }, create: { storage_bytes: String(bytes), stake_near: near(stake), gas_prepaid_near: near(gas * GAS_PURCHASE_YOCTO) }, _stake: stake, _gas: gas, _w: w };
}
async function acc(id, k) { const { Account, JsonRpcProvider, KeyPairSigner } = await import('near-api-js'); if (!(k || '').startsWith('ed25519:')) throw new Error('missing key for ' + id); return new Account(id, new JsonRpcProvider({ url: RPC }), KeyPairSigner.fromSecretKey(k)); }
const fail = r => { for (const o of [r.transaction_outcome, ...(r.receipts_outcome || [])]) { const f = o?.outcome?.status?.Failure; if (f) return JSON.stringify(f).slice(0, 220); } return null; };
async function send(who, to, actions) { const r = await who.signAndSendTransaction({ receiverId: to, actions, waitUntil: 'FINAL', throwOnFailure: false }); return { tx: r.transaction?.hash || r.transaction_outcome?.id, failure: fail(r) }; }

async function live(step, p) {
  const { actions: A } = await import('near-api-js');
  if (step === 'close-row') { if (!p.visitor_row) throw new Error('no row'); return send(await acc(VISITOR, process.env.NEAR_IMPLICIT_PRIVATE_KEY), BOARD, [A.functionCall('close_charter', {}, 50n * TG, 0n)]); }
  if (step === 'reap') { if (p.rows !== 0) throw new Error('rows left: ' + p.rows); return send(await acc(OWNER, process.env.NEAR_MAIN_PRIVATE_KEY), BOARD, [A.functionCall('reap', {}, 80n * TG, 1n)]); }
  if (step === 'create') { if (p.board) throw new Error(BOARD + ' still exists');
    return send(await acc(OWNER, process.env.NEAR_MAIN_PRIVATE_KEY), BOARD, [A.createAccount(), A.transfer(p._stake), A.deployContract(new Uint8Array(p._w.bytes)), A.functionCall('new', {}, 30n * TG, 0n)]); }
  if (step === 'smoke') {
    const stranger = await acc(VISITOR, process.env.NEAR_IMPLICIT_PRIVATE_KEY);
    return { stranger_reap: await send(stranger, BOARD, [A.functionCall('reap', {}, 30n * TG, 1n)]), stranger_force_close: await send(stranger, BOARD, [A.functionCall('force_close', { visitor: VISITOR }, 30n * TG, 1n)]), config: await view('get_config') };
  }
  throw new Error('unknown step');
}
if (process.argv[1]?.endsWith('board-rebuild.js')) {
  const p = await plan(); const { _stake, _gas, _w, ...shown } = p; console.log(JSON.stringify(shown, null, 1));
  const i = process.argv.indexOf('--step');
  if (process.argv.includes('--live') && i > 0) { try { console.log(JSON.stringify(await live(process.argv[i + 1], p), null, 1)); } catch (e) { console.error('refused: ' + e.message); process.exit(1); } }
}
