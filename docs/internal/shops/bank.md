# Mist Bank (`bank`) — Privacy & Private AI

**Track:** Privacy (track 3).
**Judges score:** attested TEE completion + verifiable response signature; sealed rules; no “untraceable” wording; honest confidential Intents limits.
**Read first:** `docs/internal/shops-blueprint.md`.

## What exists today

| Piece | Cite | Gap |
|---|---|---|
| Tray | `deep.js` `mountBank` L828–901 — notes, send privately, verify seal, TEE line | Needs Ferry-pattern dock + clearer attestation UX |
| Backend | `mistbank.js`, `tee.js`, `ai.js`, `zcash.js` | `/api/ai/tee` checks exist; **full `/api/ai/prove` behind `AI_PROVE_ENABLED`** (often off) |
| Board | `set_seal` / propose with reveal | Sealed rule “hidden until used” |
| Proof | tee-check.json / charter txs in README | Need one **signature-verified** completion in-browser |
| Confidential Intents | docs exist; partner JWT required | Keep behind flag; keys rotate |

## Target experience

- Tabs **Send / Seal / Attestation**. Mist-window teller; seals stamp one by one; “Open envelope” verifies signature.
- AI dock: “Send 0.001 NEAR privately”, “Verify the TEE”, “Show attestation file”.
- Downloadable proof file; no-retention statement in README + code.

## AI commands

- Private send of an allowed note size under cap.
- “Verify the seal” / “Verify TEE now”.
- Refuse non-attested models in copy and in code path.

## Live data

- NEAR AI Cloud verification: https://docs.near.ai/cloud/verification (200).
- Verifier: https://github.com/nearai/nearai-cloud-verifier (200).
- Agent API confidential (flag): https://docs.agentsonintents.com/integration/agent-api/overview (200).
- Confidential swaps docs: https://docs.near-intents.org/…/confidential-swaps (200).

## Contract changes

- Prefer existing `set_seal` / propose. No new wasm unless owner OK.
- Teardown: board close refunds.

## Competitors

Kept in private notes on the box, not in this repo.

## Sources

1. Response signatures + TLS binding — docs.near.ai/cloud/verification.
2. depth-plan-v2 §2; Privacy track prompt.
3. Illia private trading / viewing keys — optional deepen **only** with partner JWT; else hidden.
4. Ferry pattern + lessons (AI executes; no fake SUCCESS).
5. https://docs.near.ai/ · https://docs.near.org/llms.txt

## Acceptance

- [ ] One completion whose signature verifies with documented verifier steps.
- [ ] README no-retention section; zero “untraceable” copy.
- [ ] Seal match demo on mainnet or recorded proof.
- [ ] City browser + tests.
