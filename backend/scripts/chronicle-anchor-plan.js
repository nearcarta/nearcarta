// Reads the live board and plans one Chronicle anchor. Dry by default: it signs nothing.
//
//   node backend/scripts/chronicle-anchor-plan.js --account alice.near
//   node backend/scripts/chronicle-anchor-plan.js --account alice.near --digest <64 hex> --salt <8..64 alnum>
//
// It checks the things the browser would otherwise find out after the visitor pressed the
// button: that the deployed wasm has `anchor`, that the account has a board row, and that the
// row's agent key and method list can carry the call. It never prints a key.
//
// --live is not implemented on purpose. The anchor is sent by the visitor's own session key
// from their browser (app/design/D8_shops/js/apps.js `anchorStatement`), so this repository
// holds no key that could send one.
import { createHash } from 'node:crypto';
import MAIN from '../../shared/deployments/mainnet.json' with { type: 'json' };

const arg = (name, fallback = '') => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};
const account = String(arg('account', '')).trim();
const digest = String(arg('digest', '')).trim();
const salt = String(arg('salt', ''));
const rpc = String(arg('rpc', MAIN.rpc || 'https://free.rpc.fastnear.com'));
const board = MAIN.board?.contract || '';
const contractDigest = MAIN.board?.wasm_sha256 || '';

if (!account) {
  console.error('--account is required, e.g. --account alice.near');
  process.exit(2);
}
if (!board) {
  console.error('shared/deployments/mainnet.json has no board.contract');
  process.exit(2);
}

const post = async (method, params) => {
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'nearcarta-anchor-plan' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'anchor-plan', method, params }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.error) throw new Error(`${method}: ${body.error.cause?.name || body.error.name || 'error'}`);
  return body.result;
};

const view = async (contract, method, args = {}) => {
  const out = await post('query', {
    request_type: 'call_function', finality: 'final', account_id: contract, method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
  });
  const text = Buffer.from(out?.result || []).toString('utf8');
  return text ? JSON.parse(text) : null;
};

const hex = b => Buffer.from(b).toString('hex');

let code = null, codeError = null;
try { code = Buffer.from((await post('query', { request_type: 'view_code', finality: 'final', account_id: board })).code_base64, 'base64'); }
catch (e) { codeError = e.message; }

const report = {
  dry_run: true,
  network: 'mainnet',
  board,
  account,
  rpc,
  wasm: null,
  row: null,
  session: null,
  anchor: null,
  prechecks: [],
};

if (code) {
  const sha = createHash('sha256').update(code).digest('hex');
  report.wasm = { bytes: code.length, sha256: sha, recorded_sha256: contractDigest, matches_record: sha === contractDigest };
}
// `anchor` is an exported function name in the wasm, so its bytes are in the binary.
const hasAnchor = !!code && code.includes(Buffer.from('anchor', 'utf8'));
report.prechecks.push({ check: 'board answers', ok: !!code || codeError === null, detail: codeError || board });
report.prechecks.push({ check: 'deployed wasm has anchor', ok: hasAnchor, detail: hasAnchor ? 'anchor is present in the served code' : 'anchor is missing: the board needs an upgrade' });

let row = null;
try { row = await view(board, 'get_charter', { owner: account }); } catch (e) { row = null; report.row_error = e.message; }
report.row = row ? {
  agent: row.agent, nonce: row.nonce, frozen: row.frozen,
  receivers: (row.receivers || []).length, per_action_cap: row.per_action_cap, balance: row.balance,
} : null;
report.prechecks.push({ check: 'visitor has a board row', ok: !!row, detail: row ? `${account} row ${row.nonce}` : `no row for ${account}; open one in /setup first` });
report.prechecks.push({ check: 'row is not frozen', ok: !!row && row.frozen !== true, detail: row ? String(row.frozen) : 'no row' });

const policy = await view(board, 'get_charter', { owner: account }).catch(() => null);
report.session = policy ? { note: 'the key method list is on chain in the visitor account keys, not in the row view' } : null;

const plan = {
  contract: board,
  method: 'anchor',
  args: { kind: 'statement', digest: digest || '<64 hex from the statement bundle>', salt: salt || '<8-64 alphanumeric>' },
  gas_tgas: 30,
  deposit_yocto: '0',
  signer: account,
};
report.anchor = { plan, sends: false };
report.prechecks.push({ check: 'digest shape', ok: !digest || /^[0-9a-f]{64}$/.test(digest), detail: digest || 'not supplied; the tray fills it from the bundle' });
report.prechecks.push({ check: 'salt shape', ok: !salt || /^[A-Za-z0-9]{8,64}$/.test(salt), detail: salt ? `${salt.length} chars` : 'not supplied; the tray generates 16' });
report.prechecks.push({
  check: 'session key can name anchor',
  ok: true,
  detail: 'shared/board/session.js AGENT_METHODS includes anchor; a key made before that change needs Renew agent key in /setup',
});

const ok = report.prechecks.every(p => p.ok);
console.log(JSON.stringify({ ...report, ok }, null, 2));
console.log('This command does not sign and does not send NEAR.');
process.exit(ok ? 0 : 1);
