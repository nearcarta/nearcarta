// The keepers' brains: each decision is one NEAR AI completion in a TEE, checked the same way as the
// market guide (TEE preflight with a fresh nonce, complete, fetch the signature, check it against the
// attested signer). The completion id goes on chain in the move's `decision` field, so anyone can
// fetch the signed answer that moved a keeper.
//  - restock: the keeper buys stock from a fuller shop through its board row (propose_call_as, signed by
//    the row's agent key), paid from the row. The agent key is a function-call key on the board only.
//  - council: a keeper votes on a market rule change.
// The answer is clamped by shared/market/keeper-ai.js, so the model can only pick a listed move.
import { complete, signature, checkSigned, verifyLink } from './ai.js';
import { budgetLeft, budget, costUsd } from './agent.js';
import { proveTee } from './tee.js';
import { cfg, secret } from './config.js';
import { restockChoices, restockMessages, councilMessages, parseRestock, parseVote } from '../../shared/market/keeper-ai.js';

const MAX_TOKENS = 200;
export const STORAGE_ALLOWANCE = 10n ** 21n; // 0.001 NEAR, about 100 bytes

/** Ask once. Returns { reply, completion_id, proof } or { reply: null, why } when no signed answer is possible. */
// NEAR-hosted models serve a TEE report; the first one that answers is used.
export const MODELS = () => [...new Set([cfg.nearAiModel, ...(process.env.KEEPER_MODELS || 'z-ai/glm-5.3-flash,Qwen/Qwen3.6-35B-A3B-FP8,deepseek-ai/DeepSeek-V4.1-Flash-1017,Qwen/Qwen3.8-27B').split(',')])].filter(Boolean);

export async function ask(msgs, parse, deps = {}) {
  if (!secret.nearAi()) return { reply: null, why: 'NEAR AI key not set' };
  let last = { reply: null, why: 'no model' };
  for (const model of deps.models || MODELS()) {
    last = await askOne(msgs, parse, { ...deps, model });
    if (last.why !== 'model unavailable' && last.why !== 'TEE preflight unavailable' && last.why !== 'TEE preflight failed') return last;
  }
  return last;
}

async function askOne(msgs, parse, { pf = (model) => proveTee({ model, signingAlgo: 'ed25519' }), completeF = complete, signatureF = signature, model } = {}) {
  const b = budgetLeft(costUsd({ prompt_tokens: Math.ceil(JSON.stringify(msgs).length / 3), completion_tokens: MAX_TOKENS }, model));
  if (!b.ok) return { reply: null, why: b.why };
  let p; try { p = await pf(model); } catch { return { reply: null, why: 'TEE preflight unavailable' }; }
  if (!p?.ok) return { reply: null, why: 'TEE preflight failed' };
  let c; try { c = await completeF(msgs, { model, maxTokens: MAX_TOKENS, extra: { reasoning_effort: 'low' } }); } catch { return { reply: null, why: 'model unavailable' }; }
  budget.calls++; budget.usd += costUsd(c.usage, model);
  let reply; try { reply = parse(c.content || c.reasoning_content); } catch { return { reply: null, why: 'model reply unusable', completion_id: c.id }; }
  let proof = { verified: false, why: 'signature unavailable' };
  try {
    const sig = await signatureF(c.id, c.reqModel || c.model);
    if (sig.available) {
      const v = checkSigned(c, sig, p);
      proof = { verified: v.verified, signing_address: sig.signing_address, signing_algo: sig.signing_algo, verify_url: verifyLink({ id: c.id, model: c.model, sig }) };
    }
  } catch {}
  // Only a verified answer may move a keeper.
  if (!proof.verified) return { reply: null, why: 'signature not verified', completion_id: c.id, proof };
  return { reply, completion_id: c.id, model: c.model, proof };
}

export async function decideRestock(shop, board, deps) {
  const choices = restockChoices(board, shop);
  if (!choices.length) return { reply: null, why: 'shelf is full' };
  return ask(restockMessages(shop, board, choices), (s) => parseRestock(s, choices), deps);
}

export async function decideVote(shop, proposal, deps) {
  return ask(councilMessages(shop, proposal.rule, proposal.value, proposal.why || '', { rules: proposal.rules, floor: proposal.floor }), parseVote, deps);
}

/** The args and deposit for a restock the board forwards to the market. */
export function restockCall(shop, r, decision) {
  const total = BigInt(r.price) * BigInt(r.qty);
  const max = total + total / 20n; // 5% slippage
  // The market takes storage for the move from what is left of the deposit, so carry a small allowance;
  // whatever is not used goes back to the keeper.
  const deposit = max + STORAGE_ALLOWANCE;
  return { method: 'restock', args: JSON.stringify({ shop, from_shop: r.from, good: r.good, qty: r.qty, max_total: String(max), decision }), deposit: String(deposit) };
}
