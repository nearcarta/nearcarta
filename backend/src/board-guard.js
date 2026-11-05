// Off-chain payee check for a visitor's board row. A view only: get_charter, then the
// same two refusals the wasm would raise. Nothing is signed and nothing is spent.
import { cfg } from './config.js';
import { view } from './near.js';
import { BOARD } from './board-tx.js';

const ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const err = (status, message) => Object.assign(new Error(message), { status });
let readImpl = view;
export const _setRead = fn => { readImpl = fn || view; };

export function refusalFor(charter, payee, deny = []) {
  if (!charter) return { ok: false, reason: 'no_charter', sealed: false, network: 'mainnet' };
  const allow = charter.receivers || [];
  const sealed = !!charter.sealed;
  if (!allow.includes(payee)) return { ok: false, reason: 'receiver_not_allowlisted', sealed, network: 'mainnet' };
  if (sealed && deny.includes(payee)) return { ok: false, reason: 'hidden_rule_receiver', sealed: true, network: 'mainnet' };
  return { ok: true, reason: null, sealed, network: 'mainnet' };
}

export function parseDeny(raw) {
  if (raw == null || raw === '') return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  return list.map(s => String(s).trim()).filter(Boolean);
}

export async function checkPayee({ visitor, payee, deny = [], board = BOARD, rpc = cfg.mainnetRpc, read = view } = {}) {
  if (!ACCOUNT.test(String(visitor)) || String(visitor).length > 64) throw err(400, 'visitor must be an account id');
  if (!ACCOUNT.test(String(payee)) || String(payee).length > 64) throw err(400, 'payee must be an account id');
  const hidden = parseDeny(deny);
  if (hidden.length > 8 || hidden.some(a => !ACCOUNT.test(a))) throw err(400, 'deny must be up to 8 account ids');
  const charter = await (read === view ? readImpl : read)(board, 'get_charter', { owner: visitor }, rpc);
  return { visitor, payee, board, ...refusalFor(charter, payee, hidden) };
}
