// POST /api/market/guide: the Lamplighter reads one plain-words request and returns ONE intent.
// Same order as the vault agent (docs.near.ai): verify the TEE first with a fresh nonce, then ask the
// model, then fetch the completion's signature and check it against the attested signer.
// The intent is clamped by shared/market/guide.js, so the model cannot name an action, good, shop or
// payee the city does not know. When the model is unavailable the plain-words parser answers and says so.
import { complete, signature, checkSigned, verifyLink } from './ai.js';
import { preflight, budgetLeft, budget, costUsd } from './agent.js';
import { cfg, secret } from './config.js';
import { parseIntent, guideMessages, parseModel } from '../../shared/market/guide.js';

const MAX_TOKENS = 96;

export async function guide(text, { pf = preflight, completeF = complete, signatureF = signature, model = cfg.nearAiModel } = {}) {
  const t = String(text || '').replace(/[\u0000-\u001f]/g, ' ').trim();
  if (!t) throw Object.assign(new Error('Say what you want, e.g. "sell my iron".'), { status: 400 });
  if (t.length > 200) throw Object.assign(new Error('Keep it under 200 characters.'), { status: 400 });
  const fallback = (why) => { budget.fallbacks++; return { intent: parseIntent(t), by: 'fallback', why }; };
  if (!secret.nearAi()) return fallback('NEAR AI key not set on this server');
  const msgs = guideMessages(t);
  const b = budgetLeft(costUsd({ prompt_tokens: Math.ceil(JSON.stringify(msgs).length / 3), completion_tokens: MAX_TOKENS }, model));
  if (!b.ok) return fallback(b.why);
  let p; try { p = await pf(); } catch (e) { return fallback('TEE preflight unavailable'); }
  if (!p?.ok) return fallback('TEE preflight failed; question not sent');
  let c; try { c = await completeF(msgs, { model, maxTokens: MAX_TOKENS, extra: { reasoning_effort: 'low' } }); } catch { return fallback('model unavailable'); }
  budget.calls++; budget.usd += costUsd(c.usage, model);
  let intent; try { intent = parseModel(c.content); } catch { return fallback('model reply unusable'); }
  // The model may not add a payee the player did not type.
  if (intent.payee && !t.toLowerCase().includes(intent.payee.toLowerCase())) intent.payee = null;
  let proof = { verified: false, why: 'signature unavailable' };
  try {
    const sig = await signatureF(c.id, c.reqModel || c.model);
    if (sig.available) {
      const v = checkSigned(c, sig, p);
      proof = { verified: v.verified, checks: { teePreflight: true, ...v.checks }, signing_address: sig.signing_address, signing_algo: sig.signing_algo,
        signature_kind: sig.signature_kind, verify_url: verifyLink({ id: c.id, model: c.model, sig }), nonce: p.nonce || null };
    }
  } catch {}
  return { intent, by: 'model', model: c.model, completion_id: c.id, proof };
}

export function register(app, { limiter, globalCap }) {
  const cap = globalCap('market-guide', Number(process.env.CAP_GUIDE_PER_MIN || 20));
  app.post('/api/market/guide', limiter(8), cap, async (c) => {
    let b; try { b = await c.req.json(); } catch { b = null; }
    if (!b || typeof b !== 'object') return c.json({ error: 'body must be a JSON object' }, 400);
    try { return c.json(await guide(b.text)); } catch (e) { return c.json({ error: e.message }, e.status || 500); }
  });
}
