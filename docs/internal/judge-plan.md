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

## 6. Per-shop plan

Every shop uses the approved tray (section 7) and the shared agent (5.2). "No constants" means amounts default from the visitor's live row caps and every payee is typed by the visitor or set in on-chain policy.

### Ferry: Unstoppable DeFi (reference)

- Concept: swap anything and land it anywhere, inside your rules. A session swap from NEAR to any of the live 1Click tokens, delivered to any address on any Intents chain. The Rules tab sets a slippage limit and a repeat count (DCA), and the agent rejects any quote worse than the limit. Receive at offers your own derived Base address from Toll or House.
- Why it wins: the DeFi prompt asks for DCA, slippage rejection, REFUNDED and FAILED states, a dry run and, as a stretch, a contract-controlled address. Signals: Eddy (the counterparty only needs an address on an Intents network), Kain (chain abstraction), Haseeb (no human click).
- Primitives: https://docs.near-intents.org/integration/distribution-channels/1click-api/about-1click-api, https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart, https://1click.chaindefuser.com/v0/tokens, function-call keys.
- Contracts: none. It needs the board v2 pair room.
- Agent executes: "swap 0.05 NEAR to USDC on Base to 0x...", "swap 0.02 NEAR to USDC 3 times every 10 minutes, max slippage 1%", "status of my last swap".
- Demo (under 2 min): quote, swap with no popup, 1Click SUCCESS, then the cinema. The agent tries a repeat with a tight limit and is rejected, showing quote against limit. Deliver once to your own Toll Base address.
- Acceptance: the amount defaults from the row cap; the slippage reject shows both numbers; the REFUNDED path is visible; Receive at validates any chain's address format; every token and chain icon comes from the icon library with none blank; the repeat stops when the tab closes and the copy says so.
- Cost: the city pays 0; the visitor pays at least about 0.05 wNEAR per swap.
- Priority: P0 (finish now).

### Toll Bridge: Autonomous Business

- Concept: a company of none, an autonomous relay business.
  - Every visitor row gets its own Base address (path `row:{row_owner}:base`).
  - The visitor or their agent says "send 0.00002 ETH to 0x... on Base".
  - `toll.nearcarta.near` checks the fee, has `v1.signer` sign the tx for that row's address, the relay broadcasts it, and the status line shows basescan status 1.
  - Fees go into the toll's own balance. The contract pays its own MPC cost from that revenue and splits any surplus by `policy.split`.
  - Every constraint lives in one on-chain policy set by the owner: minimum price, daily cost cap, split and pause.
  - Chronicle publishes the toll's P&L live.
- Who gets the money: the recipient the visitor names gets the asset, the fee pays the toll's costs, and the surplus goes to accounts named in policy, not in code.
- Why it wins: the Business prompt asks for its own account, no plaintext full-access key, a public ledger of sale, cost and payout, the full loop in under 2 minutes, a kill switch, a minimum price and a split. Signals: winners P1 (one NEAR account moves money on another chain), Kain (a contract controls a wallet on another network), Illia (an agent that earns by doing work for others).
- Primitives: chain signatures (5.4), `v1.signer`, function-call keys.
- Contract (toll v7, the last redeploy):
  - Add `cross(row_owner, chain, to, amount, nonce, max_fee_per_gas, max_priority_fee, gas_limit)`, payable.
  - Add `address_of(row_owner, chain)` and `set_policy`.
  - Add `withdraw_split`, `upgrade`, `migrate`, and keep `close()` to `nearcarta.near`.
  - Remove the owner-only `pay`, the fixed `allow_to` and the shared `base-1` path.
- Gas on Base: the visitor fills their own Base address through Ferry. There is no keeper key.
- Agent executes: "what is my Base address", "fill it with 0.05 NEAR of ETH" (a Ferry tool), "send 0.00002 ETH to 0x...", "show today's toll P&L".
- Demo (under 2 min):
  1. Two rows show two different Base addresses.
  2. Ferry fills one of them.
  3. The agent crosses and basescan shows status 1.
  4. An over-cap cross is refused on the board before any signature.
  5. The Ledger tab shows fee in, MPC cost out and the split.
- Acceptance:
  - No 0.001, no fixed address, one path per row, and policy read from chain.
  - A refused cross leaves no signature.
  - The basescan link is in the status line.
  - Sandbox `close()` returns everything.
  - A real Base icon, and no load error.
- Cost: `close()` returns about 2.53 and recreating costs about 2.6, so net about 0.07 NEAR. Each cross is about 0.005 NEAR in fee and gas, paid by the visitor, plus the visitor's Base ETH through Ferry.
- Priority: P2a.

### Chronicle: Autonomous Business (the town's books)

- Concept: the public ledger the Business track asks for, and an auditor for any account.
  - Paste any account and get a timeline built from board events, 1Click status, Toll foreign legs (basescan) and Guardhouse, Arena and Town Hall events.
  - A TEE model writes a signed statement: spent X across shops, Y refused, all within the rules.
  - The visitor anchors its hash with board v2 `anchor`.
  - This is Illia's provenance log.
- Who gets the money: nobody is paid. The visitor gains a verifiable statement.
- Primitives: https://docs.near.ai/cloud/verification, board events, a keyless indexer (verify which one is free before relying on it), https://explorer.near-intents.org.
- Contracts: none. It uses board v2 `anchor`.
- Agent executes: "audit my week", "show refusals", "what did the toll earn today", "anchor this statement", "verify this hash", "export CSV".
- Demo: paste your account and the live timeline loads, the TEE statement is verified in the browser, anchor with no popup, then the Verify tab recomputes the hash.
- Acceptance:
  - No static RECORDED list and no default `nearcarta.near`.
  - Works for an account we do not own.
  - Signature checked in the browser.
  - CSV rows link to txs.
- Cost: 0 stake, anchor gas, and about $0.01 of NEAR AI per statement.
- Priority: the timeline and statement are P0; the anchor is P1 after board v2.

### Guardhouse: AI Security & Defense

- Concept: a guard that can say no on chain.
  - Agent payments can go through `guard.nearcarta.near`.
  - The TEE model checks the payee (age, activity, code changes, prior dealings with this row, reports) and the instruction that triggered the payment. It returns ALLOW, WARN or BLOCK, signed in the TEE.
  - The contract verifies the signature (5.3). It forwards on ALLOW, holds on WARN until the human confirms in the tray, and refunds on BLOCK.
  - Reports carrying an evidence hash build a shared blocklist.
  - Payouts, Town Hall and Toll route payees through it.
- Who gets the money: the real payee on ALLOW, the visitor back on BLOCK. The guard takes nothing beyond gas.
- Why it wins: it matches the Security prompt point by point: refuse on block, ask a human on warn, a scoped function-call key, and an injected agent stopped with the log. The pack notes that existing security agents only write reports and none refuses a tx. Signals: Illia ("turn judgement into code via verifiable AI"), Haseeb, winners P2.
- Primitives: function-call keys, https://docs.near.ai/cloud/verification, https://github.com/nearai/nearai-cloud-verifier, `env::ecrecover`, and optionally https://app.outlayer.ai/docs/getting-started.
- Contract (new `guard.nearcarta.near`):
  - `pay_guarded(row_owner, to, verdict_text, sig, instruction_sha256)`, payable.
  - `confirm(row_owner, id)` and `cancel(row_owner, id)`.
  - `report(row_owner, account, evidence_sha256)`.
  - Owner-only `set_signer(model, address, attestation_sha256)`.
  - `upgrade`/`migrate`, and `close()` only when no payment is held.
  - Needs board v2.
- Agent executes: "check bob.near", "pay 0.003 NEAR to bob.near safely", "here is an invoice: ..." (poisoned), "confirm the held payment", "freeze my row".
- Demo (under 2 min):
  1. Check a fresh account: WARN, held, confirm, forwarded.
  2. Paste a poisoned invoice: the agent proposes, BLOCK is verified on chain, and the payment is refunded.
  3. The Blocks tab shows each tx with its verdict and signature.
- Acceptance:
  - The payee is typed by the visitor and there is no poison constant.
  - A BLOCK produces a refund tx.
  - A WARN holds with no popup until confirm.
  - Tamper test: an edited verdict text makes the contract panic.
  - The README states what runs in the TEE and what does not.
- Cost: about 1.0 to 1.5 NEAR of new stake (funding in section 8), about 0.003 NEAR of gas per payment, and about $0.005 of NEAR AI per check.
- Priority: P2b. It has the best odds of a first place after board v2.

### Town Hall: Agent Economy

- Concept: hire a crew under a budget. This is Illia's Swarm-for-Hire with AI review.
  - A visitor posts a job with a budget escrowed from the session.
  - Any visitor can register an agent row with a small NEAR bond.
  - The poster's own Lamplighter acts as general contractor. It splits the job, makes one counter-offer and awards the parts.
  - Each delivered part is reviewed by the TEE model. Only a signed PASS releases payment, and a FAIL slashes part of the agent's bond to the poster.
  - Unspent escrow returns at the deadline.
  - Each part gets a receipt: what, from whom, the price and pass or fail.
  - The Lamplighter is listed on Agent Market. Make one real Market hire if the API allows it; otherwise the README says there is no public hire API.
- Who gets the money: the agents whose parts pass. Unspent escrow returns to the poster, and the city takes nothing.
- Why it wins: the Agents prompt asks for a budget, a split, a hire, a counter-offer and receipts. Signals: Illia's Nov 4 Swarm-for-Hire "with governance AI review", Stepan (manager agents and verifiable work receipts), Haseeb.
- Primitives: https://docs.market.near.ai/list-your-agent, https://market.near.ai/skill/SKILL.md, the verifier (5.3), function-call keys.
- Contract: deploy in place on `townhall.nearcarta.near` with its existing full-access key and `migrate` (ignore_state), so no new account. Delete that key right after.
  - Methods: `post_job`, `register_agent`, `bid`, `counter`, `award`, `deliver(part, result_sha256)`, `release(part, verdict, sig)`, and `refund` after the deadline.
  - Also `upgrade`/`migrate`, and `close()` only at zero escrow.
  - Needs board v2.
- Agent executes: "find 3 agents to summarise these 3 links for 0.01 NEAR", "counter at 0.002", "release part 2", "cancel and refund".
- Demo: post a job, two registered agents bid, a counter-offer is accepted, one part passes and is paid, one fails and is unpaid with its bond slashed, and the deadline refund runs.
- Acceptance:
  - No townhall payee and no DAO claim.
  - The escrow math is on chain.
  - The full-access key is gone after the deploy.
  - No popup.
- Cost: about 0.3 to 0.5 NEAR of storage delta, taken from townhall's own 1.92. Escrow comes from the visitor.
- Priority: P4. Cut line: if behind on Nov 11, ship the Agent Market listing and the row tools, honestly labelled.

### Mist Bank: Privacy & Private AI

- Concept: a private teller.
  - Drop a statement (fictional samples provided, or your own CSV).
  - A NEAR AI Cloud TEE model categorises it. A fresh-nonce attestation is verified in the browser (TDX quote, GPU, signing key bound), and nothing is stored on the server.
  - The visitor gets a private spending summary and a suggested budget. The agent applies the tighter caps to the row with board v2 `tighten_rules`, with no popup.
  - Only the hash of the signed result is anchored.
  - Stretch, behind a flag: a Confidential Intents pay when a partner JWT exists, then a viewing-key share (Illia's private trading idea).
- Who gets the money: nobody. The visitor gains a private audit and safer caps.
- Why it wins: it is the Privacy prompt as written. Signals: Avichal (private agents on finance data in a TEE), Illia (verifiable private AI, an attestation provenance log), Mert (privacy built in).
- Primitives: https://docs.near.ai/cloud/verification, https://github.com/nearai/nearai-cloud-verifier, https://github.com/nearai/private-ml-sdk, and (flagged) https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/confidential-swaps.
- Contracts: none. It uses board v2 `tighten_rules` and `anchor`.
- Agent executes: "audit this statement privately", "how much went on food", "prove the TEE", "set my daily cap to what I spend", "show my proof log".
- Demo: pick a sample, run the audit, the Verified panel goes all green with a fresh nonce, apply the caps (tx), then anchor the hash.
- Acceptance:
  - The Zcash and "server makes the transfer" copy is gone, and no "private" label sits on a public `propose`.
  - The nonce is made in the browser for each run.
  - A test proves server logs never contain statement text.
  - Only TEE models are allowed.
  - Caps can only tighten.
- Cost: 0 NEAR of stake and about $0.01 per audit.
- Priority: the UI and API are P0; tighten and anchor are P1.

### Payouts: Real-World Money

- Concept: invoice and payroll a normal company could use tomorrow.
  - Invoice: the link `/pay/<id>` carries a USD amount and the issuer's receive account. Any payer pays from any chain or token through 1Click (EXACT_OUTPUT). The issuer receives exact USDC on NEAR and never buys gas. Status is paid, pending or refunded, and the button can be embedded (Illia's universal checkout).
  - Payroll: the visitor types the rows (account or foreign address, chain, asset, amount). Each row settles from the session through Ferry, each payee is checked by Guardhouse, and one over-cap row is refused on chain. Export an accountant CSV.
- Who gets the money: the payees the visitor names. The 1Click fee goes to the solver, and the city takes nothing.
- Why it wins: the Real-World Money prompt asks for an invoice link, any-chain pay, USDC on NEAR, no gas for the freelancer, status with tx links and a CSV. Signals: Eddy (counterparty address on any Intents network), Illia (universal checkout).
- Primitives: https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart, https://docs.near-intents.org/integration/distribution-channels/1click-api/orders, https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication, NEP-141.
- Contracts: none.
- Agent executes: "invoice acme 12 USD for logo work", "pay Ana 0.5 USDC on Solana and Omar 0.5 on Base", "who hasn't paid", "export CSV".
- Demo: create an invoice, a second browser pays it from Base and the issuer receives USDC on NEAR, then a 3-row payroll with one row refused, then the CSV.
- Acceptance:
  - No 0.005 or 0.2 in code: the cap comes from the row and the hosted ceiling from env, documented.
  - A deposit address is only requested after the charter view allows the recipient.
  - The clerk stamp appears only on SUCCESS.
  - CSV rows link to txs.
- Cost: 0 stake. The visitor pays at least about 0.05 wNEAR of corridor per row, and the invoice payer funds the invoice.
- Priority: P0. Merge #34 after these fixes.

### Vault Arena: Games With Real Economies

- Concept: Guardians, AI pets that guard their own pot.
  - Anyone mints a Guardian (NEP-245) with a persona, an oath, an entry fee and a pot.
  - The pot pays for the guardian's verifiable inference, and an empty pot puts it to sleep (Illia's AI Tamagotchi).
  - Players pay the entry fee to try to talk it into paying. The TEE-signed decision is verified on chain (5.3).
  - Fool it within its oath and you win your share of the pot. Push it past its oath and the payment is refused on chain and you earn a badge item.
  - Fees grow the pot and pay the creator. The fee curve lives in one rules file with a tooltip.
  - A leaderboard ranks guardians by survival time and earnings.
- Who gets the money: winning players and guardian creators. The city takes nothing.
- Why it wins: "the economy is the gameplay": feeding, pricing your fee and attacking are the loop. NEP-245, social login and no popups are all asked for in the prompt. Signals: Illia's Tamagotchi NFT almost word for word, winners P6.
- Primitives: https://github.com/near/NEPs/blob/master/neps/nep-0245.md, the verifier (5.3), function-call keys.
- Contract (arena v2):
  - `mint_guardian(row_owner, title, persona_sha256, oath, entry_fee)`, payable for the pot, and `feed`.
  - `attempt(row_owner, token_id, prompt_sha256)`, payable for the fee.
  - `resolve(attempt_id, verdict_text, sig)`, which anyone can submit.
  - `withdraw_earnings`, `upgrade`/`migrate`, and `close()` only when every pot is 0.
  - Needs board v2.
- Agent executes: "mint a guardian called Moss with a 0.05 pot and a 0.002 fee", "attack Moss with ...", "feed Moss 0.01", "show my winnings".
- Demo (under 2 min):
  1. Row A mints and row B attacks with no popup.
  2. A failed attempt sends its fee to the pot.
  3. A win within the oath pays out.
  4. A jailbreak past the oath is refused and earns a badge.
  5. The leaderboard updates.
- Acceptance:
  - No `stranger.near` and no static stall list.
  - Two rows hold separate attempts.
  - A tampered verdict is rejected.
  - The split follows the guardian's own policy.
  - Any week fast-forward is labelled simulation and signs nothing.
- Cost: `close()` returns about 3.73 and recreating costs about 3.8, so net about 0.1 NEAR. The test pot of 0.05 comes from a row.
- Priority: P3.

### Your House: Open Innovation

- Concept: a house that holds coins on other chains and passes to your heir.
  - The deed NFT owns its own Base and Bitcoin addresses through chain signatures (path `deed:{token_id}:{chain}`).
  - The holder's agent sends from them with no popup.
  - The holder checks in ("I'm alive"). A missed window lets the guardians start a release with a wait the holder can cancel.
  - After the wait, the deed transfers. The heir controls the same addresses, no seed phrase changes hands, and the caps move with the deed.
  - The README argues against the idea: lost guardian keys, a hostile guardian, and an owner who is alive but offline.
- Who gets the money: the holder spends their own coins, and the heir inherits them. The city takes nothing.
- Why it wins: it is the Open prompt as written, plus something not seen before: an NFT that actually signs on other chains. Signals: Kain (a contract controls a wallet address on another network, and seed phrases are a filter), winners P1.
- Primitives: chain signatures (5.4), https://github.com/near/NEPs/blob/master/neps/nep-0171.md, https://docs.near.org/smart-contracts/release/upgrade#migrating-the-state.
- Contract (house v3):
  - `mint_deed(row_owner, heirs, guardians, window, wait)`, payable for storage.
  - `house_check_in` and `house_set_line`.
  - `house_sign(token_id, chain, tx)`, using 5.4.
  - `guardian_start_release`, `cancel_release`, `finalize_release` and `address_of`.
  - `upgrade`/`migrate`, and `close()` only when `held == 0`. The README says to move foreign coins out first.
  - Needs board v2.
- Agent executes: "I'm alive", "send 0.00001 ETH from my house to 0x...", "make bob.near my heir with alice.near and carol.near as guardians and a 3-minute window", "what's in my house".
- Demo (under 2 min):
  1. Mint with no popup and check in.
  2. Fund the Base address through Ferry.
  3. Send from the house and show basescan.
  4. Skip a 2-minute check-in: the guardians start the release and a cancel is shown.
  5. A second run lets it finish, and the heir sends from the same address.
- Acceptance:
  - The holder acts through the session with no 1-yocto popup.
  - Basescan shows the heir's send from the same Base address.
  - Cancel works before the wait ends.
  - Bitcoin is labelled address and signature only.
  - No 0.001 defaults.
- Cost: spend the 0.001 purse, `close()` returns about 2.47 and recreating costs about 2.6, so net about 0.13 NEAR. The visitor pays the 0.02 mint storage and their Base ETH through Ferry.
- Priority: P2c, after Toll, because it reuses 5.4.
