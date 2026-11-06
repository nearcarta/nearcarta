# Judge plan: Nearcarta, NEAR Hackathon 2026

Internal. A judge's review of `main` at `4c57e06` on 2026-11-06, scored against the published rules, the track prompts and the jury's public signals. No app or contract code was changed and no mainnet tx was sent to write this.

Sources: `docs/internal/source-pack.md`, `docs/internal/research/` (judges-minds, judges-x-signals, tracks, winners-patterns), `docs/internal/shops-blueprint.md`, `docs/internal/shops/*-deep.md`, the shops depth summary, `README.md`, `shared/deployments/mainnet.json`, `contracts/charter_board/src/lib.rs`, `backend/src/agent.js`, open PRs #34 to #40, the live app (standalone shop pages screenshotted 2026-11-06) and the approved city tray (`docs/internal/design/approved-tray-ferry.jpg`).

## 1. How this was judged

- Rules (nearhackathon.com/HACKATHON.md, Q-017): Claude Code and Codex screen the repo first. They reproduce the README, verify features, write a report and give a preliminary score. Humans decide. No numeric weights are published (`research/judges-minds.md` GAPS). Do not invent weights.
- The only published judging lines: Autonomous Business "Humans only set the constraints." AI Security "Give AI money without giving it the keys to everything." Games "Judged on the game loop, not the token." Real-World Money "Something a normal company could use tomorrow." Open Innovation "Something we haven't seen."
- Lens per shop: track-prompt fit, NEAR-native (the winners-patterns test), real value moved for the visitor with a verifiable tx, originality against the archetypes in `source-pack.md` section 7, design in the city tray, reproducibility from the README.
- Jury signals used (`research/judges-x-signals.md` 3.3, `research/judges-minds.md`):
  - Illia: verifiable and private AI, "every interaction hashed and signed with attestation", a provenance log; "turn judgement into code via verifiable AI"; agents that earn by working for others; idea list: AI Tamagotchi NFT that pays its own inference, universal checkout, private trading with viewing keys, Swarm-for-Hire "with guardrails or governance AI review".
  - Kain: a smart contract that controls a wallet address on another network via chain signatures; seed phrases are a filter.
  - Haseeb: agents are the users; a human click on every tx is the wrong design.
  - Eddy: the counterparty only needs an address on a network NEAR Intents supports; token-first thinking fails.
  - Mert: privacy built in, not bolted on; transactions must land.
  - Avichal: private agents on finance data inside a TEE; UX for the next billion users.
  - Stepan: manager agents that split an objective into tasks; verifiable work receipts; "if an agent can't use it, don't ship it".
- Past winners (`research/winners-patterns.md`): one NEAR account moving money on other chains wins most; verifiable TEE agents tied to an on-chain decision win; real-world money with a named payer and payee wins. A payment to your own contract that buys nothing loses. A chatbot that signs nothing loses.

## 2. Verdict

The city has one primitive that is strong and NEAR-native: a per-visitor row on `board.nearcarta.near`, an in-browser function-call session key, caps and an allowlist on chain, and refusals that land as txs. After one wallet approval in /setup the agent spends with no popup. Setup (polish 9/10) and the city Ferry prove it.

Most other shops still spend a fixed 0.001 NEAR to one of our own accounts and buy nothing. That is the losing pattern in the winners file. The in-shop agent only proposes one payment (`backend/src/agent.js`), the docks are keyword routers, and the board cannot tell a shop which visitor is calling. Today: a credible top-3 in DeFi, an outside chance in AI Security, not competitive in the other six tracks, not in grand-prize contention.

"First in all 8 tracks" is not a realistic target with 8 days left and about 0.45 NEAR liquid. One project rarely takes eight firsts, and spreading thin risks none. This plan aims to make four shops strong enough to win (Guardhouse, Your House, Ferry, Toll with Chronicle), four strong enough to place (Payouts, Vault Arena, Mist Bank, Town Hall), and to contend for the grand prize with one city story: one session, many chains, an AI that cannot break your rules, and every judgement verifiable.

## 3. Scores

Scale 0 to 10. Fit = track prompt. Native = needs NEAR to work. Value = what the visitor gains, proven by a tx. Orig = new against the archetypes. Design = city tray and copy. Repro = a stranger can check it from the README. Now and Target are judgement, not averages. Target assumes this plan ships.

| Shop | Track | Fit | Native | Value | Orig | Design | Repro | Now | Target |
|---|---|---|---|---|---|---|---|---|---|
| Ferry | Unstoppable DeFi | 7 | 8 | 7 | 5 | 8 | 8 | 7.0 | 8.5 |
| Toll Bridge | Autonomous Business | 2 | 6 | 1 | 4 | 5 | 7 | 3.0 | 8.0 |
| Chronicle | Autonomous Business | 4 | 4 | 3 | 3 | 6 | 7 | 4.0 | 6.5 |
| Guardhouse | AI Security & Defense | 6 | 7 | 5 | 6 | 7 | 7 | 5.5 | 9.0 |
| Town Hall | Agent Economy | 2 | 5 | 1 | 2 | 4 | 6 | 2.5 | 7.5 |
| Mist Bank | Privacy & Private AI | 3 | 5 | 2 | 3 | 5 | 6 | 2.5 | 7.5 |
| Payouts | Real-World Money | 5 | 5 | 3 | 4 | 7 | 7 | 4.5 | 8.0 |
| Vault Arena | Games With Real Economies | 3 | 6 | 3 | 6 | 7 | 6 | 4.5 | 8.0 |
| Your House | Open Innovation | 5 | 6 | 2 | 6 | 6 | 6 | 4.0 | 8.5 |

Track placement, now and after this plan:

| Track | Now | After |
|---|---|---|
| Unstoppable DeFi | top 3 | contend for 1st |
| Autonomous Business | no place | contend for 1st |
| AI Security & Defense | outside 3rd | contend for 1st |
| Agent Economy | no place | 2nd or 3rd |
| Privacy & Private AI | no place | 2nd or 3rd |
| Real-World Money | no place | 1st or 2nd |
| Games With Real Economies | no place | 2nd |
| Open Innovation | no place | contend for 1st |
| Grand prize | no | outside chance, only if the city loop works end to end |

Findings that cost points today:

- Honesty (P0): the standalone Mist Bank page says "Nearcarta's own server makes the Zcash transfer" while the payment is a public board `propose`. Remove it unless a tx proves it.
- The standalone Toll page showed "Stopped: something did not load". The Toll Proof tab shows a plain blue square where the Base icon belongs.
- Payments that buy nothing: Toll 0.001 to `toll.nearcarta.near`, the Chronicle entry 0.001, the Town Hall hire to `townhall.nearcarta.near`, the Guardhouse trick to a fixed poison payee, the Mist Bank fixed notes 0.001/0.002/0.005.
- The agent never executes on the standalone pages, and `backend/src/agent.js` has no per-shop tools.
- `townhall.nearcarta.near` still has a full-access key.
- Doc drift: `docs/MAINNET_BOARD.md` and the README board line describe the previous board wasm.
- CI is red on #35 and #40 (`readme-numbers`).
- Jargon on the standalone pages (row, charter, TEE, secp256k1) with no plain first line. Town Hall and Mist Bank score 3/10 for clear value to a first-time visitor.

## 4. Critique of the current plan

The plan is `shops-blueprint.md`, `shops/*-deep.md` and the depth summary.

What it gets right: the board diagnosis; removing every 0.001 payment; Ferry as the reference; Toll as row-owned foreign addresses; Arena guardians whose pot pays their inference (a direct hit on Illia's AI Tamagotchi idea); House as the Open Innovation prompt; keeping Payouts.

What is wrong or weak:

1. Too much to build. Board v2, toll v7, arena v2, house v3, a new hall, a new guard and a new chronicle contract make 7 mainnet deploys. Each is unaudited, they ship in 8 days, and they are funded one after another from about 0.45 NEAR. One failed deploy stalls every shop behind it. This plan uses 5 deploys, no new account for Chronicle, and Town Hall in place.
2. Board v2 is under-specified. There is no method signature and no test list. It does not say what happens when the args are not a JSON object, when `row_owner` is nested, or when a deposit is attached; whether the deposit counts against caps; or what happens to every visitor's existing session key. It also keeps the 8-pair CALLS cap. Ferry alone uses 3 pairs on `wrap.near`, so 8 pairs cannot cover Ferry, 1Click deposits and six shop methods.
3. Board v2 still has no upgrade path, so the next fix means another reap and every visitor redoing setup.
4. OutLayer is a single point of failure for the Guardhouse. The mainnet contract id is unverified, the cost is unmeasured and it is `enabled: false`. Here, Guardhouse enforces a NEAR AI TEE-signed verdict on chain with one shared verifier, and OutLayer is optional.
5. The Town Hall swarm needs the Agent Market API, stakes, TEE review, a Guardhouse flag and USDC escrow. That is more than the window, and the API is unverified. This plan builds a narrow slice on the existing townhall account.
6. Mist Bank bets the Privacy track on a partner JWT for Confidential Intents. This plan builds the Privacy prompt itself, a private auditor in a TEE, on what already works (`/api/ai/tee`). Confidential pay stays behind a flag.
7. Chronicle spends about 1.5 NEAR of stake to store hashes. Here, a board v2 `anchor` emits an event and needs zero stake.
8. Toll covers five chains plus USDC, a gas-fill keeper and a split. A keeper that refills gas needs a server key, which breaks the rule that the API holds no key. This plan covers Base only, native ETH first and USDC as a stretch, and the visitor fills their own Base address through Ferry.
9. Arena sends a 20% fee to the city owner. That fails "who gets the money and why". Here, the guardian's creator earns and the city takes nothing.
10. Toll and House each plan their own signing and relay. This plan builds one shared foreign-chain module.
11. Rule conflict: `AGENTS.md` fixes a 0.20 USD checkout ceiling, and the owner's bar forbids fixed amounts. Here, the visitor's row cap is the real cap. The hosted ceiling becomes server config (env) documented as a demo safety rail, not a code constant.
12. Missing from the plan: implementation-after scores, a design standard, an architecture for an agent that executes, a cut line and a funding source for new stake.
13. The NEAR AI budget is one global cap ($0.05 a day, 300 calls). Mist Bank, Chronicle, Guardhouse, Arena and Town Hall will all call the TEE model. Add a per-visitor and per-shop share in `agent.js`, and raise the global cap only when there are credits.
14. Old PRs: #36 changes `house_nft` with no `migrate` on an account with no key, so it can never land. #37 to #40 implement the 0.001 actions this plan removes.

## 5. Shared foundations (build once, use everywhere)

### 5.1 Board v2: decision YES, deployed once and first

Without it, a shop cannot know which visitor called, so every shop collapses into a board transfer and per-visitor state (arena attempts, house deeds, guard holds, hall jobs, toll addresses) is impossible.

Spec:
- `propose_call_as(owner, receiver, method, args, deposit, nonce, expires, sig)`: verify exactly like `propose_call`. Require `args` to be a JSON object. Set top-level `args.row_owner = owner`, overwriting any value the agent sent. Count `deposit` against per-payment and daily caps. Emit an event.
- Shops trust `row_owner` only when `predecessor == board.nearcarta.near`. Every shop method that takes `row_owner` asserts this.
- Raise CALLS from 8 to 24 `(receiver, method)` pairs, deduplicated.
- `tighten_rules(owner, caps, sig)`: the agent may lower caps, shorten expiry or freeze. It can never raise them. Raising still needs the wallet, by design.
- `anchor(owner, kind, sha256, sig)`: event only, no storage. Used by Chronicle, Mist Bank and Guardhouse.
- Owner-only `upgrade(code)` plus `migrate` (`#[init(ignore_state)]`) behind a short delay with an event. Visitors can `close_charter` at any time during the delay. This is the last time the board needs a reap.
- Keep `force_close`, `close_charter` and `reap`.
- Sandbox tests: impersonation (the agent passes another `row_owner`), non-object args, nested `row_owner`, deposit over cap, expired session, replayed nonce, 24 pairs, tighten cannot loosen, upgrade then migrate keeps rows, reap refunds every row.
- Migration: announce it, `force_close` the live rows (each refunds its owner), `reap` (about +1.09 NEAR to `nearcarta.near`), recreate `board.nearcarta.near` under the same name so setup code and judge links keep working, then deploy v2. Visitors redo /setup once, and the setup approval deletes their stale board key in the same tx.
- Build with rustc 1.86 and near-sdk 5.27 (a 5.30 build failed to link).
- Cost: net about 0.05 to 0.1 NEAR plus gas.
- Docs: https://docs.near.org/protocol/accounts-contracts/access-keys and https://docs.near.org/smart-contracts/release/upgrade#migrating-the-state

### 5.2 A shop agent that executes

- The backend calls a NEAR AI Cloud TEE model with the shop's tool list (JSON schema). It returns one tool call or one question.
- Validation stays as today: the amount and payee must appear in the visitor's words, and the amount must fit the live row caps. Otherwise the agent asks.
- The browser runs the same function the gold CTA runs, signed by the session key. The server never signs.
- The status line and the cinema play only on a SUCCESS receipt. A refusal shows the refusal tx.
- Every tool also works without the model through a keyword fallback.
- Publish the tools in `skills/nearcarta/SKILL.md` so outside agents can drive the shops (Stepan: "if an agent can't use it, don't ship it").

### 5.3 TEE verdict verifier (one Rust module, used by Guardhouse, Arena and Town Hall)

- NEAR AI Cloud signs each response with a key bound to its TEE attestation (https://docs.near.ai/cloud/verification, https://github.com/nearai/nearai-cloud-verifier).
- The contract stores a `signer_address` per model. The owner sets it with the attestation report sha256, emitted as an event.
- A verdict is accepted only when `ecrecover(sig, hash(signed text)) == signer_address`. The verdict field is then parsed from that text. Anyone can submit a verdict, so no server key is needed.
- Day-one spike: confirm the exact signed message format and that `env::ecrecover` reproduces it. Go or no-go by Nov 8.
- Fallback A: OutLayer `request_execution` with yield/resume (https://app.outlayer.ai/docs/getting-started), only if its mainnet id is confirmed. Fallback B: today's off-chain verdict plus the board refusal, labelled exactly that in the README.
- This is Illia's "turn judgement into code via verifiable AI" and winners pattern P2.

### 5.4 Foreign-chain module (used by Toll and House)

- Derive an address from `v1.signer` with a per-row or per-deed path, build an EIP-1559 tx, request the signature, and return `raw_signed`.
- `POST /api/toll/relay` broadcasts a raw signed tx and holds no key.
- Base first. Bitcoin is address and signature only, labelled as such.
- Docs: https://docs.near.org/chain-abstraction/chain-signatures, https://docs.near.org/chain-abstraction/chain-signatures/implementation, https://github.com/near-examples/near-multichain

### 5.5 Rules for every redeploy

- Owner-only `upgrade` plus `migrate`.
- `close()` or `reap` returns everything to `nearcarta.near`, and refuses while visitor funds are held.
- No full-access key is left on any shop account.
- Sandbox tests include teardown.
- Close first, check the balance, then create. Never two creates in flight.
