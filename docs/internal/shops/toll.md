# Toll Bridge (`toll`) — Autonomous Business (with Chronicle)

**Tracks:** Autonomous Business (primary). Supports DeFi story via chain-sig addresses.
**Judges score:** sale → proof → public ledger loop; MPC / chain-signature honesty; tiny mainnet pass.
**Read first:** `docs/internal/shops-blueprint.md`.

## What exists today

| Piece | Cite | Gap |
|---|---|---|
| City tray | `deep.js` `mountToll` L603–621 — derive text + Check signature | Thin; not Ferry mix tray |
| Derive | `app/src/toll-derive.js` (`TOLL_ADDRESS`, `TOLL_KEY`) | Tests assert Base address hash |
| Contract | `contracts/toll` → `toll.nearcarta.near` (`mainnet.json` toll) | `check_visit`, pay, MPC sign path; fix “error after success” if still present |
| APPS.toll | `shopui.js` — pay 0.001 NEAR pass | Session path under board receivers |
| API | `backend/src/tollgate.js`, `toll-pass.js` | Gate status / settle |
| Proof txs | allow `4LKGpA5v…`, refuse not-allowlisted `B9FFjcSA…` | Keep |

## Target experience

- Tabs e.g. **Pass / Proof / Split**. AI dock: “Pay the toll”, “Check signature”, “Show my foreign address”.
- After pass: show MPC proof status without claiming a foreign-chain **payment** unless broadcast+confirmed.
- Feed the pass into Chronicle automatically.

## AI commands

- “Pay 0.001 NEAR toll” → charter/board propose to `toll.nearcarta.near` under cap.
- “Check signature” → live derive / visit status.
- “Explain the Base address” → show recorded foreign address from `mainnet.json` / derive.

## Live data

- Contract views `get_visit`, `get_tx`, `policy`.
- MPC `v1.signer` — https://docs.near.org/chain-abstraction/chain-signatures/implementation (200); https://github.com/near/mpc (200).

## Contract changes

- Prefer fix-forward on `contracts/toll` only with owner OK before redeploy; backup state; first call ≤0.001 NEAR.
- Teardown: owner `close()` 1 yocto → funds to `nearcarta.near`.

## Competitors

NEAR Business / Trezu treasuries (do **not** claim Social Money). Shore. Intents any-token pay. Beat with: tiny live pass + MPC proof + Chronicle line in &lt;2 minutes.

## Sources

1. Business loop sale at Toll (ANY_INPUT later with Ferry/Payouts).
   - https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request
2. Chain signatures implementation.
   - https://docs.near.org/chain-abstraction/chain-signatures/implementation
3. Aurora docs (foreign EVM context): https://doc.aurora.dev/ (200)
4. Board caps / propose: `charter_board` + access keys docs.
5. Ferry lessons: cap sizing, seal hygiene, city entry, AI executes same CTA.

Also: https://docs.near.org/llms.txt · https://docs.hotdao.ai/ · HEX interactive blocks https://hot-labs.gitbook.io/hex/concepts-and-systems/interactive-blocks (200) as UX bar only.

## Acceptance

- [ ] Mainnet 0.001 NEAR pass tx linked; signature check shows live status.
- [ ] No false “paid on Base” copy.
- [ ] Chronicle shows the pass.
- [ ] City AI + manual CTA both work; tests + teardown noted.
