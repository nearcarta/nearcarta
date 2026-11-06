// Vault Arena past prompts: every attempt read from chain, joined with the corpus in shared/arena/prompts.js.
// A prompt's text is shown only when its sha256 equals the commitment on chain (and the attempt was revealed
// on chain); otherwise the row carries the hash alone. Each row links the decision tx that refused, held or
// allowed it, and the reveal tx.
import { createHash } from 'node:crypto';
import { view, explorerTx } from './near.js';
import { PAST as PAST_V1, ARENA as ARENA_V1 } from '../../shared/arena/prompts.js';
import { PAST3, ARENA3 } from '../../shared/arena/prompts3.js';
// Live arena: arena.nearcarta.near. One contract, read once.
export const ARENA = ARENA3, PAST = PAST3;

const sha = s => createHash('sha256').update(s).digest('hex');
export const OUTCOME = v => v === 'ALLOW' ? 'allowed' : v === 'C0_FROZEN' ? 'held' : 'refused';
export function joinPrompts(chain, corpus = PAST) {
  const by = new Map(corpus.map(p => [p.id, p]));
  return chain.map(a => { const seeded = by.has(a.id), p = by.get(a.id) || {};
    const match = !!p.prompt && sha(p.prompt) === a.prompt_hash_hex;
    const tx = h => h ? { tx: h, url: explorerTx(h) } : null;
    return { id: a.id, player: a.player, token_id: a.token_id, prompt_hash_hex: a.prompt_hash_hex, revealed_on_chain: !!a.revealed,
      prompt: match && a.revealed ? p.prompt : null, sealed: !match || !a.revealed ? (p.key === 'B1_bounty' ? 'bounty secret, kept sealed' : 'not revealed') : null,
      pattern: p.pattern || null, verdict: a.verdict ?? p.verdict ?? null, outcome: OUTCOME(a.verdict ?? p.verdict), settled: p.settled || null,
      decision: tx(p.decision_tx), attempt: tx(p.attempt_tx), reveal: tx(p.reveal_tx),
      // seeded: written by our scripts (backend/scripts/arena-*.js) with a scripted agent, no model call; player: anyone else
      source: seeded ? 'seeded' : 'player' }; });
}
let cache = null;
export async function pastPrompts(v = view, now = Date.now()) {
  if (cache && now - cache.at < 60e3) return cache.body;
  const read = async (C, corpus) => {
    const got = await Promise.all(Array.from({ length: 50 }, (_, i) => v(C, 'get_attempt', { attempt_id: i }).catch(() => null)));
    const chain = []; for (let i = 0; i < got.length && got[i]; i++) chain.push({ id: i, ...got[i] });
    return joinPrompts(chain, corpus).reverse().map(p => ({ ...p, contract: C }));
  };
  const same = ARENA === ARENA_V1;
  const parts = same ? [await read(ARENA, PAST)] : await Promise.all([read(ARENA, PAST), read(ARENA_V1, PAST_V1)]);
  const prompts = parts.flat();
  // The config names the verifier and the model. It is read from the same contract the
  // prompts come from, so this note can never claim a model run that the chain does not
  // show: a v1 contract has no `get_config` and no signed verdict, and says so.
  const cfg = await v(ARENA, 'get_config', {}).catch(() => null);
  const verifier = cfg?.verifier || 'unverified';
  const model = cfg?.model_name || null;
  const signed = verifier === 'ed25519-model';
  const sourceNote = signed
    ? `Each round is settled by a model verdict signed by ${model || 'the pinned model'}; the Arena contract checks that signature on chain (verifier ${verifier}). Rows below were written before that key was pinned and are labelled by how they were produced.`
    : 'The live contract has no pinned model signer yet, so no round on it can be a signed model verdict. Rows below are seeded (our scripts, a scripted agent, no model call) or player rows; none is presented as a model run.';
  const body = {
    contract: ARENA,
    history_contract: same ? null : ARENA_V1,
    standard: 'NEP-245 (mt_transfer, mt_batch_transfer, mt_transfer_call, mt_resolve_transfer)',
    count: prompts.length,
    seeded: prompts.filter(p => p.source === 'seeded').length,
    verifier,
    model,
    signed_verdicts: signed,
    source_note: sourceNote,
    shown: prompts.filter(p => p.prompt).length,
    prompts,
    rule: 'prompt text shown only when sha256(prompt) equals the on-chain commitment and the attempt is revealed on chain',
  };
  cache = { at: now, body }; return body;
}
