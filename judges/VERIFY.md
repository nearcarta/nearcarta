# Verify with commands

The town runs on NEAR mainnet. Every command below is read-only.

1. Recorded mainnet txs exist and have the stated outcome: `npm run verify:mainnet` → `205/205 mainnet txs found` (output in `judges/proofs/mainnet-proof-check.json`). Each tx opens on https://nearblocks.io.
2. The agent key on a visitor's row can only call board methods: `near account list-keys <visitor> network-config mainnet now` (NEAR CLI) → a `FunctionCall` key limited to the board. The row's own agent key is `propose`, `propose_call`, `propose_call_as`, `confirm_hold`, `tighten_rules` and `anchor`. The old per-visitor charter account was reaped when this became one shared board (`board.nearcarta.near`); its `propose`/`propose_batch` key no longer exists. `curl -s https://nearcarta-api.onrender.com/api/mainnet` returns the live accounts.
3. API health names mainnet: `curl -s https://nearcarta-api.onrender.com/api/health` → `network.contracts: mainnet`, `near.chain_id: mainnet`.
4. Ferry tokens and a dry quote: `curl -s https://nearcarta.vercel.app/api/ferry/tokens` lists the 1Click tokens; *Get dry quote* on `/ferry-widget` shows 3 PASS rows and creates no deposit address.
5. NEAR AI TEE: open `/tee-public.json` for the recorded attestation summary; the Mist Bank *Verify the TEE now* button calls `GET /api/ai/tee` live.
6. Unit tests: `npm test`. Contracts: `cargo test --lib` in each crate under `contracts/`. Browser: `BASE_URL=https://nearcarta.vercel.app npm run e2e`.
7. Secrets: `gitleaks git --config .gitleaks.toml --redact .` → no leaks.
