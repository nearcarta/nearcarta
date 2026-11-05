// A short-lived pass after a mainnet board propose of 0.001 NEAR to toll.nearcarta.near.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { BOARD, judgePropose, verifyPropose } from './board-tx.js';

export const TOLL = 'toll.nearcarta.near';
export const ONE_MILLI = 1_000_000_000_000_000_000_000n;

export function passSecret() {
  return (process.env.TOLL_PASS_SECRET || '').trim() || null;
}

export function signPass(body, secret, now = Date.now()) {
  if (!secret) { const e = new Error('toll pass is not configured'); e.status = 503; throw e; }
  const payload = Buffer.from(JSON.stringify({ ...body, exp: now + 600_000 })).toString('base64url');
  const mac = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

export function checkPass(token, secret, now = Date.now()) {
  if (!secret || typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, mac] = token.split('.');
  const expect = createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).exp > now; } catch { return false; }
}

export async function issuePass({ hash, signer, secret = passSecret(), status, now = Date.now() }) {
  const judged = await verifyPropose(hash, signer, { board: BOARD, expectReceiver: TOLL, maxYocto: ONE_MILLI }, status);
  if (!judged.ok || judged.decision !== 'allowed') {
    const e = new Error(judged.error || judged.reason || 'refused'); e.status = judged.status || 400; throw e;
  }
  return { network: 'mainnet', payee: TOLL, amount: judged.amount, shop: 'toll', pass: signPass({ hash, signer, payee: TOLL, amount: judged.amount }, secret, now) };
}

export function gateView() {
  return {
    network: 'mainnet', contract: TOLL, amount_near: '0.001',
    note: 'One payment of 0.001 NEAR to toll.nearcarta.near. A refusal pays nothing.',
    pass: 'POST /api/toll/mainnet with the propose hash and the signer.',
  };
}

export { judgePropose };
