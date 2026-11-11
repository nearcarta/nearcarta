// Mist Bank seal for a visitor, with no board row of their own: the Bank keeper's row anchors the visitor's
// fingerprint. The browser sends only digest = sha256("<account>:<amount>:<salt>"); the salt and the amount
// never leave the browser, so the visitor can reveal them later and anyone can recompute the commitment the
// board logged: sha256(board_salt || digest). The keeper key is a function-call key that can call only
// board.anchor, with its own allowance, and comes only from the server env. It is never logged.
import { createHash, randomBytes } from 'node:crypto';
import { Account, JsonRpcProvider, KeyPairSigner, actions } from 'near-api-js';
import { cfg } from './config.js';
import { viewAccount } from './near.js';

const NEAR = 10n ** 24n, TG = 10n ** 12n;
const toYocto = (s) => { const [a, b = ''] = String(s).split('.'); return BigInt(a || 0) * NEAR + BigInt((b + '0'.repeat(24)).slice(0, 24)); };
const near = (y) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toString();
export const conf = () => ({
  account: process.env.BANK_SEAL_ACCOUNT || 'keeper-bank.nearcarta.near',
  board: process.env.BOARD_ACCOUNT || 'board.nearcarta.near',
  perDay: Number(process.env.BANK_SEALS_PER_DAY || 60),
  // The keeper stops sealing below this balance, so the Bank's own row keeps working.
  minNear: toYocto(process.env.BANK_SEAL_MIN_NEAR || '0.005'),
});
const hasKey = () => !!(process.env.BANK_SEAL_PRIVATE_KEY || '').trim();
const day = () => new Date().toISOString().slice(0, 10);
export const book = { day: day(), count: 0, by: new Set(), refused: {} };
const roll = () => { if (book.day !== day()) Object.assign(book, { day: day(), count: 0, by: new Set(), refused: {} }); };
const refuse = (why, status = 400) => { book.refused[why] = (book.refused[why] || 0) + 1; return { ok: false, why, status }; };
export const commitmentOf = (boardSalt, digest) => createHash('sha256').update(Buffer.concat([Buffer.from(boardSalt), Buffer.from(digest, 'hex')])).digest('hex');
export const status = () => { roll(); const c = conf(); return { on: hasKey(), keeper: c.account, day: book.day, sealed: book.count, per_day: c.perDay, min_near: near(c.minNear), refused: book.refused }; };

let acct = null;
const keeper = () => (acct ||= new Account(conf().account, new JsonRpcProvider({ url: cfg.rpc }), KeyPairSigner.fromSecretKey(process.env.BANK_SEAL_PRIVATE_KEY.trim())));

/** Anchor one visitor's fingerprint. deps are injectable for tests. */
export async function seal(body, { send, balanceOf, exists } = {}) {
  roll(); const c = conf();
  if (!hasKey() && !send) return refuse('ERR_SEAL_OFF', 503);
  const id = String(body?.account_id || '').trim().toLowerCase();
  const digest = String(body?.digest || '').toLowerCase();
  if (!/^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(id)) return refuse('ERR_ACCOUNT');
  if (!/^[0-9a-f]{64}$/.test(digest)) return refuse('ERR_DIGEST');
  if (book.by.has(id)) return refuse('ERR_SEAL_TODAY', 429); // one seal per visitor per UTC day
  if (book.count >= c.perDay) return refuse('ERR_SEAL_DAILY', 429);
  // Only an account that exists on chain (a signed-in visitor) can be sealed for.
  try { await (exists || viewAccount)(id); } catch { return refuse('ERR_NO_ACCOUNT'); }
  const bal = BigInt(balanceOf ? await balanceOf(c.account) : (await viewAccount(c.account)).amount);
  if (bal < c.minNear) return refuse('ERR_BANK_LOW', 503);
  book.by.add(id); book.count++; // count before the send, so two racing calls cannot both pass
  const boardSalt = randomBytes(12).toString('hex');
  let r;
  try {
    r = await (send || ((a) => keeper().signAndSendTransaction(a)))({ receiverId: c.board, actions: [actions.functionCall('anchor', { kind: 'visitor_seal', digest, salt: boardSalt }, 10n * TG, 0n)], waitUntil: 'FINAL', throwOnFailure: false });
  } catch (e) { book.by.delete(id); book.count--; return refuse('ERR_SEND: ' + String(e.message || e).slice(0, 120), 502); }
  const outs = [r?.transaction_outcome, ...(r?.receipts_outcome || [])];
  const burnt = outs.reduce((s, o) => s + BigInt(o?.outcome?.tokens_burnt || 0), 0n);
  const fail = outs.map((o) => o?.outcome?.status?.Failure).find(Boolean);
  const hash = r?.transaction_outcome?.id || r?.transaction?.hash || null;
  if (fail) return { ok: false, why: 'ERR_ANCHOR', hash, burnt_near: near(burnt), status: 502 };
  return { ok: true, hash, by: c.account, kind: 'visitor_seal', board_salt: boardSalt, commitment: commitmentOf(boardSalt, digest), burnt_near: near(burnt) };
}

export function register(app, { limiter, globalCap }) {
  app.get('/api/bank/seal/status', limiter(30), (c) => c.json(status()));
  app.post('/api/bank/seal', limiter(3), globalCap('bank-seal', 6), async (c) => {
    let b; try { b = await c.req.json(); } catch { b = null; }
    const r = await seal(b);
    return c.json(r, r.ok === false && r.status ? r.status : 200);
  });
}
