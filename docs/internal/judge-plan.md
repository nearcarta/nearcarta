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
