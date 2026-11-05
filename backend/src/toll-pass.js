// A short-lived gate pass for a mainnet toll payment. The board propose is checked
// the same way as a Mist Bank payment. This server does not call the testnet gate.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { MAINNET_DEP } from './config.js';
import { TOLL_YOCTO, verifyBoardPayment } from './board-tx.js';

const TOLL = MAINNET_DEP?.toll?.contract || 'toll.nearcarta.near';
export const PASS_MS = 10 * 60_000;
let secret = process.env.TOLL_PASS_SECRET || randomBytes(32).toString('hex');
export const _setSecret = s => { secret = s; };

const err = (status, message) => Object.assign(new Error(message), { status });
const b64 = buf => Buffer.from(buf).toString('base64url');

export function signPass(body, key = secret) {
  const payload = b64(JSON.stringify(body));
  const mac = b64(createHmac('sha256', key).update(payload).digest());
  return `${payload}.${mac}`;
}

export function readPass(token, now = Date.now(), key = secret) {
  const [payload, mac] = String(token || '').split('.');
  if (!payload || !mac) throw err(400, 'pass is not a token');
  const expect = b64(createHmac('sha256', key).update(payload).digest());
  const a = Buffer.from(mac), b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw err(422, 'pass signature does not match');
  let body;
  try { body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw err(400, 'pass is not a token'); }
  if (!body?.exp || now > body.exp) throw err(422, 'pass has expired');
  return body;
}

export async function issuePass({ visitor, tx, now = Date.now() }, deps) {
  const near = await verifyBoardPayment({ hash: tx, visitor, payee: TOLL, amount: TOLL_YOCTO.toString() }, deps);
  if (BigInt(near.amount) !== TOLL_YOCTO) throw err(422, 'the toll payment is 0.001 NEAR');
  const exp = now + PASS_MS;
  const body = { v: 1, network: 'mainnet', visitor, tx, payee: TOLL, amount: near.amount, exp };
  return { pass: signPass(body), exp: new Date(exp).toISOString(), network: 'mainnet', payee: TOLL, amount: '0.001', near, note: 'The Base Sepolia gate contract is the testnet demo. This pass is the mainnet gate.' };
}
