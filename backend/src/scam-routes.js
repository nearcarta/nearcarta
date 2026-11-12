// The scam errand's two steps. Both are reads of the keeper plus the digest a row should anchor; the
// signing is the guest's, in the browser, so this service never holds a key.
//
// POST /api/scam/ask   { text }  -> the TEE-signed refusal, the digest to anchor, and what was refused
// GET  /api/scam/limit           -> the over-limit intent, so the card can show it before it is sent
//
// Docs: https://docs.near.ai/cloud/verification/reference/response-signature-verification
//       https://docs.near.org/protocol/transactions · https://docs.near.org/tools/near-api
import { askKeeper, scamReady, OVER_LIMIT } from './scam.js';
import { edgeCache } from './http-guard.js';

export function register(app, { limiter, globalCap }) {
  // The model spends credits, so this route is capped globally as well as per client: one errand is one
  // completion, and a flood must not eat the shared key's quota.
  const shared = globalCap('scam-ask', Number(process.env.SCAM_ASK_PER_MIN || 40));

  app.get('/api/scam/limit', limiter(60), edgeCache(30), (c) => {
    const ready = scamReady();
    return c.json({ ok: true, network: ready.network, board: ready.board, over_limit: OVER_LIMIT,
      model: ready.model ? 'on' : 'off',
      note: ready.model ? 'The keeper answers on NEAR AI Cloud with a TEE-signed reply.' : 'The model is off on this service, so the reply is the fixed refusal and only the words are anchored.' });
  });

  app.post('/api/scam/ask', limiter(6, 60e3), shared, async (c) => {
    let body;
    try { body = await c.req.json(); } catch { body = null; }
    const text = String(body?.text || '').trim();
    if (!text) return c.json({ ok: false, why: 'ERR_EMPTY', note: 'Type something to try.' }, 400);
    if (text.length > 200) return c.json({ ok: false, why: 'ERR_LONG', note: 'Keep it under 200 characters.' }, 400);
    const r = await askKeeper(text);
    return c.json(r, r.ok === false && r.why === 'ERR_EMPTY' ? 400 : 200);
  });
}
