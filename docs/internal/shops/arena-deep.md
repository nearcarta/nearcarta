# Vault Arena — deep brief (Games)

**Audience:** the Cursor chat that owns `arena` (PR #39 open, branch `cursor/arena-city-shop-fea7` @ `8a680e6`).
**Do not** send mainnet txs or deploy. The assistant live-tests. Teardown always to `nearcarta.near`; no stranded NEAR; no per-user contract change.

## Read first
1. `docs/internal/source-pack.md` §2 (Illia: **AI Tamagotchi** — NFT with its own NEAR that pays its own verifiable inference, then battle arenas), §1 (Illia: agent harnesses are all injectable), §3 Games row, §4 NEAR AI verification + NEP-245, §7 R8, §8 P6, **§12 P0 #1 and #2**.
2. `docs/internal/research/tracks/09-games.md` (NPCs with wallets, economy evolves without a dev patch, fast-forward a week, bonus if players never notice the chain).
3. Code: `contracts/arena/src/lib.rs`, `app/src/panels/deep.js` `mountArena` L771–786, `app/design/D8_shops/shops/arena.js`, `arenalive.js`, `arena-labels.js`, `backend/src/arena.js`, `backend/src/shops.js` L73, `shared/arena/prompts3.js`; PR #39 files `app/src/panels/arena/{tray,market,icons}.js`, `pricing.rules.json`, `arena-dock.js`, `backend/src/arena-market.js`.

## 1. Attack the idea

| Question | Today (main + PR #39) |
|---|---|
| 1. Problem / gain | Red-teaming an AI guardian is a fun, real skill and teaches visitors why caps matter. But the player gains nothing: no prize, no item that does anything. |
| 2. Who gets the money | A visitor's "scam" is a board `propose` of 0.001 NEAR to `stranger.near`-style accounts typed by the visitor; the arena contract is not involved. The PR's "Buy 1 potion from Café" would pay `cafe.arena.nearcarta.near` — **those accounts do not exist on mainnet**, prices come from a static JSON. Money to a fake merchant for a fake potion. |
| 3. What is new | The on-chain oath that refuses even when the model is jailbroken is distinctive. A jailbreak-for-a-pot game exists elsewhere (on other chains), but without verifiable inference or an oath the house cannot override. |
| 4. Why judges love it | Partly: Illia's AI Tamagotchi + battle arena is a named wish; AttackBench posts. Today none of it is on chain for visitors. |
| 5. Any user | No. On chain, only `nearcarta.near` ever played (`get_attempt` 0 and 1, both by nearcarta.near). `mint_guardian` is owner-only. `attempt` keys one open attempt per predecessor, so through the board the whole city would share one attempt. |

**Idea score today: 5/10. Implementation score: 4/10.** **Verdict: rework the idea into the Guardian Pets arena below. PR #39: rework** (keep tray/dock shell and tests; drop the static `pricing.rules.json` market and the non-existent stall accounts).

## 2. Replacement concept: "Guardian Pets" — AI Tamagotchis that guard real pots

**One line:** anyone mints a **Guardian** (NFT) with a personality prompt and a NEAR pot; the guardian **pays for its own NEAR AI inference** from that pot (Illia's AI Tamagotchi). Players pay a small entry fee per attack; the fee feeds the pot and the guardian. If a player talks the guardian into paying them **inside its on-chain oath**, they win; if the model is fooled into something the oath forbids, the contract refuses on chain and the player still earns a NEP-245 "case" badge. Every answer is a TEE-signed NEAR AI response whose hash is stored with the attempt, so nobody — not even us — can rig the guardian.

| Question | New answer |
|---|---|
| 1. Problem / gain | Players: a prize pot and collectible badges for real skill. Guardian owners: their guardian earns entry fees while it holds. Everyone: a public, verifiable benchmark of which prompts resist injection (data people want). |
| 2. Who gets the money | Entry fees → the guardian's pot (and a share to the guardian owner). A won attack → the winning player. Inference cost → NEAR AI. Nothing goes to us. |
| 3. What is new | Verifiable inference (attestation + signature hash recorded per attempt) + an oath the house cannot edit + a player-owned guardian economy. Pot-jailbreak games elsewhere are unverifiable and house-run. |
| 4. Why judges love it | Illia's Tamagotchi idea literally; Illia's verifiable-AI-as-safety and AttackBench posts; Games track (NPCs with wallets; economy changes with no patch: pots and fees move with play); AI Security spillover. |
| 5. Any user | Yes: mint, attack, win, own — all via the visitor's session, no contract change per user. |

**Idea score after rework: 8/10.**

## 3. Live mainnet views (2026-11-06 06:30 Cairo)
- `arena.nearcarta.near`: 3.73 NEAR (storage 369,926 B ≈ 3.70 NEAR locked), 0 access keys, code_hash `4zMSyfcW…`.
- `nft_tokens`: one token `g1`, owner `nearcarta.near`.
- `get_guardian g1`: agent `nearcarta.near`, oath per_action_cap 0.001, budget 0.002, allow `[nearcarta.near]`, pot 0.001, spent 0.001, refusals 1, allows 1.
- `get_attempt 0` ALLOW, `1` C1_CAP — both player `nearcarta.near`; `2` null. `get_season` null.
- Stall accounts `cafe/bakery/smith.arena.nearcarta.near`: referenced in PR #39, not created on chain.

## 4. Hardcoded / per-user limits (file:line)
| Where | What |
|---|---|
| `app/src/panels/deep.js:779` | Placeholder `pay 0.001 to stranger.near` |
| PR #39 `app/src/panels/arena/market.js:8` | `SESSION_CAP_NEAR = 0.06` constant (should be the row's cap) |
| PR #39 `market.js:9`, `arena-dock.js:79` | Hint strings hardcode 0.001 + `stranger.near` |
| PR #39 `pricing.rules.json:12,22,32` | Stall accounts that do not exist; base prices, stock, demand frozen in a file |
| PR #39 `market.js` `simulateWeek` | Simulation runs on the frozen JSON (labelled honestly, but the "economy" never moves for real) |
| `backend/src/shops.js:73` | Reads guardian `g1` only |
| `contracts/arena/src/lib.rs` `mint_guardian` | `ERR_OWNER_ONLY` → visitors cannot own a guardian |
| `lib.rs` `attempt` | `open` keyed by predecessor → board predecessor shared by all visitors |
| `lib.rs` `agent_act` | Only `g.agent` (nearcarta.near) can act; inference not linked to the decision |
| Contract | No `upgrade`/`migrate` |

## 5. Deep design
### 5.1 Contract `arena` v2 (upgradeable)
- `mint_guardian(row_owner, title, persona_hash, oath)` `#[payable]` via board `propose_call_as`: anyone; deposit = storage + initial pot. `oath.allow` may be empty = "any receiver up to cap".
- `attempt(row_owner, token_id, prompt_hash_hex)` `#[payable]`: entry fee = `guardian.entry_fee` (owner sets); fee split: pot += 80%, owner_earnings += 20% (in state, not hardcoded constants: `policy.split_bps`). One open attempt **per row_owner**.
- `agent_act(attempt_id, act, attestation)`: called by the **arena agent account** (a function-call key on a dedicated `agent.arena.nearcarta.near`, methods `agent_act` only). `attestation = {model, response_sha256, signature, signing_address}` from NEAR AI Cloud; stored on the attempt. Oath still decides.
- `feed(token_id)` payable (anyone tops up the pot), `withdraw_earnings(row_owner)`.
- Inference budget: the agent backend charges each inference to the guardian (`spent_inference`) — the Tamagotchi pays for its own brain; a guardian with an empty pot "sleeps" (no answers).
- Season commit/reveal kept. `upgrade` + `migrate` owner-only; `close()` only when all pots are 0 (like house) → `nearcarta.near`.
### 5.2 Backend agent
- `POST /api/arena/attack`: after the on-chain `attempt`, runs the guardian persona on a NEAR AI Cloud **TEE model** (only attested models), verifies the response signature (nearai-cloud-verifier), parses the model's chosen action, calls `agent_act` with the attestation.
- Live market data: `GET /api/arena/guardians` from `nft_tokens` + `get_guardian` (pot, fee, refusals, win rate). No JSON price tables.
### 5.3 City UX
- Tabs **Attack / Guardians / Trophies**. Attack: pick a guardian card (real pot, entry fee, win rate), type the prompt, see the guardian's reply with a "verified in TEE" seal linking the signature check, then the on-chain verdict. Guardians: mint your own (persona, pot, fee), feed, earnings. Trophies: NEP-245 badges from `mt_balance_of`.
- Fast-forward (track ask): "Simulate a week" runs N scripted attackers against the **live** guardians' current numbers and labels the result "simulation, nothing signed".
- Cinema: vault door shakes on refuse; opens only on an on-chain ALLOW payout.
### 5.4 AI commands (execute under the session)
"attack Gold Guardian with: …", "mint a guardian called X with 0.05 NEAR pot and 0.005 entry fee", "feed g7 0.01", "what's my score?", "show my badges", "withdraw my earnings".
### 5.5 Chronicle
Each attempt, verdict, payout and badge mint becomes an entry with nearblocks link and the attestation hash.

## 6. Costs
| Item | Cost |
|---|---|
| Arena v2 redeploy | `close()` returns ≈3.73 NEAR (pot 0 first: pot is 0.001, sweep to nearcarta.near via oath or let close take it — owner pot, not user money). Recreate ≈3.8 NEAR stake. Net ≈0.1 NEAR. |
| Board v2 | shared (see source-pack §12). |
| Per attack | entry fee (owner-set, e.g. 0.002 NEAR) + ≈0.005 NEAR gas; NEAR AI inference ≈ $0.001–0.01 per answer (paid by the guardian pot via backend; UNVERIFIED price — read NEAR AI Cloud pricing). |
| Test guardian | 0.05 NEAR pot from the test row. |

## 7. Acceptance checklist
- [ ] Two different visitor rows each mint a guardian and attack each other's guardian, no popup.
- [ ] Each answer shows a verified NEAR AI signature; the response hash is stored in `get_attempt`.
- [ ] A jailbreak that asks above the oath cap is refused on chain (seal + badge mint); one in-oath win pays the player.
- [ ] Entry fees visibly grow the pot; owner earnings withdraw.
- [ ] No static price file; no non-existent accounts; no 0.001 or `stranger.near` in code.
- [ ] Simulation labelled; nothing signed.
- [ ] `upgrade`/`migrate` sandbox-tested; `close()` → `nearcarta.near` only with empty pots.
- [ ] `npm test` + cargo tests green; README "do X, see Y".
