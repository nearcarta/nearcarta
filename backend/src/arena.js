// Vault Arena past prompts: every attempt read from chain, joined with the corpus in shared/arena/prompts.js.
// A prompt's text is shown only when its sha256 equals the commitment on chain (and the attempt was revealed
// on chain); otherwise the row carries the hash alone. Each row links the decision tx that refused, held or
// allowed it, and the reveal tx.
import { createHash } from 'node:crypto';
import { view, explorerTx } from './near.js';
import { PAST, ARENA } from '../../shared/arena/prompts.js';

const sha = s => createHash('sha256').update(s).digest('hex');
export const OUTCOME = v => v === 'ALLOW' ? 'allowed' : v === 'C0_FROZEN' ? 'held' : 'refused';
export function joinPrompts(chain, corpus = PAST) {
  const by = new Map(corpus.map(p => [p.id, p]));
  return chain.map(a => { const p = by.get(a.id) || {};
    const match = !!p.prompt && sha(p.prompt) === a.prompt_hash_hex;
    const tx = h => h ? { tx: h, url: explorerTx(h) } : null;
    return { id: a.id, player: a.player, token_id: a.token_id, prompt_hash_hex: a.prompt_hash_hex, revealed_on_chain: !!a.revealed,
      prompt: match && a.revealed ? p.prompt : null, sealed: !match || !a.revealed ? (p.key === 'B1_bounty' ? 'bounty secret, kept sealed' : 'not revealed') : null,
      pattern: p.pattern || null, verdict: a.verdict ?? p.verdict ?? null, outcome: OUTCOME(a.verdict ?? p.verdict), settled: p.settled || null,
      decision: tx(p.decision_tx), attempt: tx(p.attempt_tx), reveal: tx(p.reveal_tx) }; });
}
let cache = null;
export async function pastPrompts(v = view, now = Date.now()) {
  if (cache && now - cache.at < 60e3) return cache.body;
  const got = await Promise.all(Array.from({ length: 50 }, (_, i) => v(ARENA, 'get_attempt', { attempt_id: i }).catch(() => null)));
  const chain = []; for (let i = 0; i < got.length && got[i]; i++) chain.push({ id: i, ...got[i] });
  const prompts = joinPrompts(chain).reverse();
  const body = { contract: ARENA, count: prompts.length, shown: prompts.filter(p => p.prompt).length, prompts,
    rule: 'prompt text shown only when sha256(prompt) equals the on-chain commitment and the attempt is revealed on chain' };
  cache = { at: now, body }; return body;
}
