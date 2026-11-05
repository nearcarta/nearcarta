// A short-lived pass after a mainnet board propose of 0.001 NEAR to toll.nearcarta.near.
// Fail closed without TOLL_PASS_SECRET. One toll tx buys one pass (409 on reuse).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { persist } from './persist.js';
import { BOARD, judgePropose, verifyPropose } from './board-tx.js';

export const TOLL = 'toll.nearcarta.near';
export const ONE_MILLI = 1_000_000_000_000_000_000_000n;
export const PASS_MS = 10 * 60_000;
const USED_KEEP = 30 * 24 * 3600e3;

const used = new Map(); // tx hash -> ms when used
persist('toll-used', () => [...used], v => { if (Array.isArray(v)) for (const [h, t] of v) if (typeof h === 'string' && Number.isFinite(t)) used.set(h, t); });
export const _clearUsed = () => used.clear();

export function passSecret() {
  return (process.env.TOLL_PASS_SECRET || '').trim() || null;
}

export function signPass(body, secret, now = Date.now()) {
  if (!secret) { const e = new Error('toll pass is not configured'); e.status = 503; throw e; }
  const payload = Buffer.from(JSON.stringify({ ...body, exp: body.exp ?? now + PASS_MS })).toString('base64url');
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
  if (!secret) { const e = new Error('toll pass is not configured'); e.status = 503; throw e; }
  const tx = String(hash || '');
  if (used.has(tx)) { const e = new Error('this toll tx already issued a pass; one 0.001 NEAR toll buys one pass'); e.status = 409; throw e; }
  const judged = await verifyPropose(hash, signer, { board: BOARD, expectReceiver: TOLL, maxYocto: ONE_MILLI }, status);
  if (!judged.ok || judged.decision !== 'allowed') {
    const e = new Error(judged.error || judged.reason || 'refused'); e.status = judged.status || 400; throw e;
  }
  if (used.has(tx)) { const e = new Error('this toll tx already issued a pass; one 0.001 NEAR toll buys one pass'); e.status = 409; throw e; }
  used.set(tx, now);
  for (const [h, t] of used) if (now - t > USED_KEEP) used.delete(h);
  return { network: 'mainnet', payee: TOLL, amount: judged.amount, shop: 'toll', pass: signPass({ hash, signer, payee: TOLL, amount: judged.amount }, secret, now) };
}

export function gateView() {
  return {
    network: 'mainnet', contract: TOLL, amount_near: '0.001',
    note: 'One payment of 0.001 NEAR to toll.nearcarta.near. A refusal pays nothing. One tx buys one pass.',
    pass: 'POST /api/toll/mainnet with the propose hash and the signer.',
  };
}

export { judgePropose };
