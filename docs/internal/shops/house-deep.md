# Your House — deep brief (Open Innovation)

**Audience:** the Cursor chat that owns `house` (PR #36 open, branch `cursor/house-city-shop-6bdf`).
**Do not** send mainnet txs or deploy. `close()` only with empty purses → `nearcarta.near`.

## Read first
1. `docs/internal/source-pack.md` §3 Open row (**inheritance account controlling BTC/ETH via Chain Signatures, guardians, timers in minutes**), §4 Chain Signatures + **proxy-path tutorial**, NEP-171, upgrade/migrate, §8 P1 (one NEAR account controls money on other chains — strongest past-winner pattern), **§12 P0 #1 and #3**.
2. `docs/internal/research/tracks/13-open.md`.
3. Code: `contracts/house_nft/src/lib.rs`, `app/src/panels/deep.js` `mountHouse` L994–1049, `app/src/panels/deed.js`, `app/house/`, `app/design/D8_shops/shops/house.js`; PR #36: `contracts/house_nft/src/lib.rs` (+inheritance line), `app/src/house-derive.js`, `app/src/panels/house-{room,agent,dock}.js`, `backend/src/house-views.js`, `backend/scripts/house-inherit-plan.js`.

## 1. Attack the idea
| Question | Today (main + PR #36) |
|---|---|
| 1. Problem / gain | Main: a deed NFT with a NEAR purse and a cap. PR adds an inheritance line (heirs, guardians, check-in window, wait, release) — a real problem. |
| 2. Who gets the money | The deed holder's chosen payee / the heir — sensible. |
| 3. What is new | The PR's inheritance only moves a **NEAR purse**; ETH/BTC addresses are only *displayed* (`house-derive.js`), never controlled by the contract. Without chain signatures it is a plain dead-man switch. |
| 4. Why judges love it | Track prompt literally — if BTC/ETH are really controlled. |
| 5. Any user | No: `house_pay`, `house_check_in`, `house_set_line` need predecessor == deed holder + 1 yocto (`lib.rs` house_pay L103; PR adds the same) → the session (board) can never do them; the PR's "Pay from house" is in fact a board `propose`, not the purse (`house-room.js:127` → `runHouseTurn`). `mint_deed` must be called by the visitor's own wallet (popup). |

**Idea score today: 5/10. Implementation: 5/10.** **Verdict: rework. PR #36: rework** (keep the inheritance state machine and tests; wire chain signatures + session).

## 2. Deepened concept: "The House that outlives you — on every chain"
**One line:** the deed NFT owns **real ETH and BTC addresses** (Chain Signatures, path = `deed:{token_id}:{chain}`, derived by the house contract), plus the NEAR purse. The holder checks in from their session with one sentence ("I'm alive") — no popup. Miss the window → guardians approve → after a cancellable wait the deed transfers to the heir, and **with it control of the BTC/ETH addresses** — no bridge, no seed phrase handed over.

| Question | New answer |
|---|---|
| 1. Problem / gain | Billions in crypto are lost when owners die; seed-phrase inheritance is unsafe. Gain: multi-chain inheritance with rules nobody can override. |
| 2. Who gets the money | The heir (deed + foreign assets) or payees the holder chooses. |
| 3. What is new | Inheritance products exist per chain; **one NEAR NFT whose transfer moves control of BTC + ETH addresses via MPC, with check-ins from an agent session**, is not in the ecosystem or past winners. |
| 4. Why judges love it | Track prompt literally; P1 pattern; Chain Signatures + NFT that does something (NEP-171). |
| 5. Any user | Yes after board v2: any visitor mints, checks in, names heirs/guardians. |

**Idea score after rework: 9/10.**

## 3. Live mainnet views (2026-11-06)
`house.nearcarta.near`: 2.5028 NEAR, storage 247,204 B, 0 keys, code_hash `8amkMEcC…`. `nft_total_supply` 1 (`nearcarta.near`, "Charter: charter.nearcarta.near"). `house_purse(nearcarta.near)`: balance 0.001, cap 0.001, paid 0.001, pays 1. `house_held` 0.001 NEAR (blocks `close()` until spent).

## 4. Hardcoded (file:line)
| Where | What |
|---|---|
| PR `house-room.js:67,127` | default amount `0.001` |
| PR `house-agent.js:18` | hint "Pay 0.001 NEAR to toll.nearcarta.near" |
| `contracts/house_nft/src/lib.rs` L42–43 | `MINT_STORAGE` 0.02, `MAX_CAP` 5 NEAR (fine as safety), default cap 0.1 |
| `lib.rs` `house_pay`/`house_lower_cap` | holder + 1 yocto only → no session path |
| No `upgrade`/`migrate` |

## 5. Deep design
- **Contract `house` v3 (upgradeable):** accept `propose_call_as` from the board with `row_owner` = holder for `mint_deed`, `house_check_in`, `house_set_line`, `house_pay`, `house_sign` (deposit from the row; remove the 1-yocto requirement **only** for the board path). Holder may also act directly with 1 yocto.
- `house_sign(token_id, chain, tx_payload)`: holder-only (current owner of the NFT), builds/requests `v1.signer.sign` with path `deed:{token_id}:{chain}`; returns signature; relayer broadcasts (same relayer as Toll). Views `address_of(token_id, chain)`.
- Inheritance (from PR #36): heirs, guardians (any accounts), threshold, period, wait; `house_release` transfers the NFT (`internal_transfer`) → the heir now controls `house_sign` for all paths. Timers in minutes for the demo.
- Funds safety: `close()` only when `held == 0`; foreign funds are not "held" by the contract but owned by the deed paths — document that teardown must first move foreign funds out.
- **City UX:** tabs **Deed / Vaults / Heirs**. Vaults: ETH (Base) + BTC addresses with live balances and explorer links; "send" from the vault. Heirs: line setup, countdown, guardian approvals, release.
- **AI commands:** "I'm alive", "send 0.00001 ETH from my house on Base to 0x…", "make sara.near my heir with ali.near and omar.near as guardians, 2 of 2, 30 days", "show my vaults".

## 6. Costs
House v3 redeploy: spend the 0.001 purse first, `close()` returns ≈2.50 NEAR, recreate ≈2.6 NEAR. Mint 0.02 NEAR storage. Check-in ≈0.002 NEAR gas. Foreign demo: ≈0.00005 ETH on Base (Ferry gas fill); BTC on mainnet is expensive — use a tiny UTXO or show BTC address + signing only (honest).

## 7. Acceptance checklist
- [ ] Mint + check-in + set heirs from the session, no popup.
- [ ] Deed's Base address receives and sends a real tx signed via `house_sign` (basescan).
- [ ] Missed check-in (2-minute window) → guardian approvals → release → heir signs a Base tx from the same address.
- [ ] Owner cancels a pending release.
- [ ] No 0.001 defaults; `upgrade`/`migrate`; `close()` guarded; tests green; README with failure cases.
