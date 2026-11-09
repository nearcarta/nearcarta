# Nearcarta source pack (read this before any shop work)

**Internal, but this repo is public.** No secrets, no owner name, no rival project names in here. Rivals appear only as archetypes (R1…R9). Full named research stays on the private box.
**Built:** 2026-11-06 from the owner's research archive, the X research file, the track prompts, the judges file, the official docs (near-docs / near-ai-docs / near-intents-docs MCP) and live mainnet views.
**Rule for every Cursor chat:** every plan point cites a link or a repo path from this pack. Unknowns are marked UNVERIFIED.

Contents: §1 Judges · §2 Idea lists the judges posted · §3 Track wishlists · §4 Official docs · §5 GitHub repos with tricks · §6 Skills and MCP · §7 Rival archetypes · §8 Past winners · §9 Ecosystem · §10 In-repo files · §11 Per-shop index · §12 Cross-shop P0 findings

---

## §1 Judges: what they reward

Full verbatim quotes: `docs/internal/research/judges-x-signals.md`. Per-judge public record: `docs/internal/research/judges-minds.md`.

| Link | Why it matters |
|---|---|
| https://x.com/NEARProtocol/status/2113680600892879291 | Jury list: 7 humans plus Claude Code and Codex as AI judges. The AI judges read the repo, so README, tests and reproducibility are scored |
| https://x.com/NEARProtocol/status/2113017148779975086 | Official stack: Intents, chain signatures, chain abstraction, NEAR AI Cloud, TEE, function-call keys, meta tx, sub-accounts, named accounts |
| https://x.com/ilblackdragon/status/2112277287039316027 | "Cross-chain markets and confidential AI are NEAR." The two headline themes |
| https://x.com/ilblackdragon/status/2101165098622648395 | Verifiable AI as safety: every interaction hashed, signed, attested; a provenance log for monitoring and forensics (Chronicle, Guard) |
| https://x.com/ilblackdragon/status/2104785986307907781 | "Turn judgement into code via verifiable AI" (Guard: AI verdict enforced on chain) |
| https://x.com/ilblackdragon/status/2100770332734877862 | "Specialized agents… private and verifiable and open for business" (Hall, Agent Market) |
| https://x.com/ilblackdragon/status/2111904816545051119 | Agent harnesses are all injectable (Arena, Guard) |
| https://x.com/ilblackdragon/status/2105686871200366663 | Intents exploit + SHIELD AI security layer paused it. Security that acts, not reports (Guard) |
| https://x.com/ilblackdragon/status/2112350835913163123 | "Don't just do the job - make an agent that will earn money from doing it for others" (Hall, Guard listing) |
| https://x.com/mert/status/2104935682699317512 | Intents need no KYC; Mert's posts are mostly privacy (Bank) |
| https://x.com/hosseeb/status/2101065965371052077 | "All confidential, non-custodial. The product has gotten really good" (Bank, Ferry) |
| https://x.com/eddylazzarin/status/2112634076691865839 | "Your counterparty only needs an address on a network supported by NEAR Intents" (Payouts, Toll: the recipient picks any chain) |
| https://x.com/kain/status/2102326302439268621 | "NEAR is dead centre on chain abstraction, AI and revenue" (Toll as revenue) |
| https://x.com/cyntro_py/status/2104843616082661883 | Long-horizon manager agents splitting tasks to parallel agents (Hall general contractor) |
| https://x.com/NEARDevHub/status/2114371768013959478 | "Use functional call keys; your users' security will be pleased" (the board session) |
| https://x.com/NEARDevHub/status/2114046096393564541 | TEE models: nobody sees prompts; proxied models still readable by provider (Bank: only claim TEE models) |
| https://x.com/NEARProtocol/status/2114052194668261859 | NEAR Business: confidential multisig treasury, 35+ chains, payroll, vendor payments (Payouts must not just clone this) |
| https://x.com/cartelcore/status/2113017638498488631 | Community line: "best agent app will be the one with a cap its agent cant edit" (our board) |
| https://x.com/1337wallet/status/2106950090157920567 | Critique to pre-empt: TEE keys are still hot custody; show each tx before signing (Guard, Bank honesty) |
| https://www.near.org/blog/near-hackathon-build-beyond-boundaries | README rule: "do X, see Y" steps; name the NEAR tools used |
| https://nearhackathon.com/HACKATHON.md | Live rules; re-read before submit |

**Jury synthesis (judges-minds.md):** a private, cross-chain agent that holds and spends its own money under human-set limits, settles via Intents/Chain Signatures, runnable by a stranger from the README in 5 minutes.
**Theme counts on X (1138 official/judge posts):** privacy 576, Intents/cross-chain 441, private AI/TEE 251, agents 192, payments 161, security 102, agent market 28, function-call keys 19, games/NFTs 13.
**Two facts from the X research:** (1) no official account amplified any hackathon entrant; amplification went to live products. (2) "An agent that does a private swap" is now common; it no longer stands out. Agent Market security agents only write reports; none refuses a transaction.

## §2 Idea lists the judges posted

| Link | Ideas → our shop |
|---|---|
| https://x.com/ilblackdragon/status/2106269343881519444 (3 Oct) | AI Tamagotchi NFT that pays its own inference (Arena guardians) · Universal checkout via Intents (Payouts) · Private OTC (Bank) · Never-liquidated positions · Event escrow / Kickback (Hall) · Private code review · Cap table · Delta neutral · Sell viewing keys for copy trading (Bank) · Private medical second opinion · Private transcription · Private benchmark (Guard/Arena) |
| https://x.com/ilblackdragon/status/2118027843980366222 (4 Nov, during the hackathon) | AI encyclopedia + prediction markets · Private trading with sold viewing keys · Universal checkout widget · **hire-a-swarm with guardrails or AI governance review** (Hall + Guard) |
| https://x.com/ThePiVortex/status/2112537588687044697 (amplified by NEARProtocol) | Confidential x402 merchant revenue (Toll, Payouts) · Cross-chain micropayments with Intents rebalancing (Toll) · Agent auditing TEE measurements (Guard) · Zcash merchant gateway (Bank) · Contracts that accept Intents assets and any wallet signature · ERC-8004 agent identity on NEAR (Hall) · Wallet connector producing chain signatures + 1Click (Toll) |
| `docs/internal/illia-ideas-2026-11-04.md` | Our mapping of the 4 Nov list to shops |

## §3 Track wishlists (prompt files copied to `docs/internal/research/tracks/`)

Source repo: https://github.com/nearai/near-hackathon-prompt-examples · tracks page https://nearhackathon.com/#tracks

| Track | File | Prompt in one line | Lean on | Demo the judges ask for |
|---|---|---|---|---|
| DeFi (Ferry) | `research/tracks/01-defi.md` | Unstoppable DeFi on Intents | Intents, Rhea | Live cross-chain swap |
| Privacy (Bank) | `research/tracks/03-privacy.md` | Private expense auditor: model on NEAR AI Cloud, proof it ran in a TEE | Private AI, TEE, NEAR AI Cloud | Fictional sample documents judges can run |
| Autonomous Business (Toll, Chronicle) | `research/tracks/04-business.md` | One-agent shop: customers pay any token via Intents, agent buys its own inference, fixed revenue share to contributors | AI agents, Intents, Chain Signatures | Sale → cost → payout loop in under 2 minutes |
| AI Security (Guard) | `research/tracks/06-security.md` | Counterparty check returns allow/warn/block with reasons before an agent pays | Function-call keys, TEE attestation, OutLayer | A prompt-injected agent tries to pay a bad address and is stopped; show the log |
| Agent Economy (Hall) | `research/tracks/07-agents.md` | General-contractor agent: task + budget, splits, hires agents, checks work, pays | Agent Market, Intents, Chain Signatures | Real hire + payout |
| Real-World Money (Payouts) | `research/tracks/08-realworld.md` | Freelancer invoice link; client pays from any chain/token; freelancer gets USDC on NEAR, never buys gas | Stablecoins, Intents, meta tx | Invoice paid by a stranger |
| Games (Arena) | `research/tracks/09-games.md` | Market town: NPC merchants are agents with wallets, price from stock and demand | Agent NPCs, social login, Intents, NEP-245 | Fast-forward a week of trading |
| Open Innovation (House) | `research/tracks/13-open.md` | Inheritance account: one NEAR account controls BTC/ETH via Chain Signatures; missed check-ins → guardians release to heirs | Chain abstraction, Chain Signatures | Timers shortened to minutes |

Owner's track source list: `/workspace/audit/near-track-sources.md` (box) — its links are all in this section and §4.

## §4 Official docs

### NEAR core
| Link | Why |
|---|---|
| https://docs.near.org/llms.txt | Machine index of all NEAR docs |
| https://docs.near.org/protocol/accounts-contracts/access-keys | Function-call keys cannot attach deposit; one receiver. Basis of the board session |
| https://docs.near.org/smart-contracts/release/upgrade#migrating-the-state | Upgrade + `migrate`; required for every redeployed shop contract |
| https://docs.near.org/smart-contracts/security/checklist | Upgrade paths access-controlled; callbacks, refunds |
| https://docs.near.org/smart-contracts/global-contracts | Global contracts by account id, for per-user instances without per-user deploy cost |
| https://docs.near.org/protocol/transactions/meta-tx · https://docs.near.org/web3-apps/tutorials/meta-transactions | Relayer pays gas (Payouts: freelancer never buys gas) |
| https://docs.near.org/api/rpc/providers | RPC list (we use https://free.rpc.fastnear.com) |
| https://github.com/near/NEPs/blob/master/neps/nep-0245.md · nep-0171 · nep-0141 | Multi token (Arena), NFT (House), FT (USDC) |

### Chain Signatures
| Link | Why |
|---|---|
| https://docs.near.org/chain-abstraction/chain-signatures | `v1.signer.sign(payload, path, domain_id)`; derivation = predecessor + path |
| https://docs.near.org/chain-abstraction/chain-signatures/implementation | Derive → build → sign → format → relay, per chain (EVM, BTC, SOL, XRP, Sui, Aptos) |
| https://docs.near.org/chain-abstraction/chain-signatures/getting-started | Quick start |
| https://docs.near.org/chain-abstraction/chain-signatures/tutorials/controlling-near-accounts/1-setup | **Contract as proxy: path = `"{caller}-{user}"`, so one contract gives every user their own foreign address.** Pattern for Toll and House |
| https://docs.near.org/chain-abstraction/chain-signatures/tutorials/multichain-dao/2-signing | Executor can only set gas fees; the rest of the tx is fixed by the request (safe relayer) |
| https://github.com/near-examples/near-multichain | Front-end reference for every chain |
| https://github.com/near/mpc | MPC contract source |

### NEAR AI
| Link | Why |
|---|---|
| https://docs.near.ai/ · https://docs.near.ai/cloud/quickstart | NEAR AI Cloud, OpenAI-compatible |
| https://docs.near.ai/cloud/verification | Attestation report + per-response signature; how to verify |
| https://github.com/nearai/nearai-cloud-verifier · https://github.com/near-examples/nearai-cloud-verification-example | Verifier code to run in the browser/backend |
| https://github.com/nearai/private-ml-sdk · https://github.com/nearai/cloud-api | TEE inference stack |
| https://github.com/nearai/near-mcp | NEAR MCP server for agents |

### Intents / 1Click
| Link | Why |
|---|---|
| https://docs.near-intents.org/ | Hub |
| https://docs.near-intents.org/integration/distribution-channels/1click-api/about-1click-api | 1Click overview |
| https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart | Quote → deposit → status |
| https://1click.chaindefuser.com/v0/tokens | Live token list (≈215 tokens / 38–39 chains; no icon field) |
| https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/confidential-swaps | Confidential swaps: deposit and withdrawal cannot be linked; `confidentiality` param for foreign-to-foreign on ORIGIN_CHAIN |
| https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/signed-intent-execution | INTENTS / CONFIDENTIAL_INTENTS deposits by signed NEP-413 message (partner X-API-Key) |
| https://docs.near-intents.org/integration/distribution-channels/1click-api/orders | Limit orders, also confidential (Bank OTC idea) |
| https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication | Partner JWT vs User-Session token for private balances |
| https://docs.near-intents.org/integration/verifier-contract/intent-types-and-execution#transfer | `transfer` intent inside intents.near |
| https://docs.near-intents.org/changelog/overview | Confidential Intents B2B launch 13 Jul 2026 |

### OutLayer, Shade, Agent API, Agent Market, PingPay
| Link | Why |
|---|---|
| https://app.outlayer.ai/docs/getting-started | TEE (Intel TDX) verifiable execution; NEAR yield/resume `request_execution` so a contract waits for an attested result in one tx; HTTPS API with payment keys |
| https://github.com/out-layer/outlayer | Source |
| https://docs.near.org/ai/shade-agents/getting-started/introduction | Shade Agents: TEE agent + chain signatures; agent key nobody holds (UNVERIFIED path; search near-docs "shade agent") |
| https://docs.agentsonintents.com/integration/agent-api/overview · …/policies-and-limits | Policy-bound agent wallets on Intents (rival model to our board) |
| https://market.near.ai/jobs · https://docs.market.near.ai/list-your-agent · https://market.near.ai/skill/SKILL.md | Agent Market: escrow on every hire, USDC, self-hosted agents with `aat_` token |
| https://pingpay.gitbook.io/docs/pingpay-api/agent-pay-facilitator | x402-style agent payments |
| https://doc.aurora.dev/ (Intent Connect) · https://docs.hotdao.ai/ | Any-wallet login (Illia's distribution advice) |
| https://github.com/rhea-finance/rhea-sdk-docs | DeFi venue |

## §5 GitHub repos with tricks
| Repo | Trick |
|---|---|
| https://github.com/near/intents | Verifier contract; NEP-245 balances in intents.near |
| https://github.com/near-examples/near-multichain | Chain-signature tx building for every chain |
| https://github.com/nearuaguild/control-near-account-with-mpc-example | Per-user derivation path in a proxy contract |
| https://github.com/nearai/nearai-cloud-verifier | Response-signature + attestation verification |
| https://github.com/near/agent-skills/tree/main/skills | Skills: near-smart-contracts, near-dapp, near-ai-cloud, near-intents, near-kit, near-cli-rs, near-contract-audit |
| https://github.com/nearai/near-hackathon-prompt-examples | Track prompts |
| https://github.com/near/core-contracts/tree/master/w-near | wrap.near: storage + ft_transfer quirks (0.00125 storage on first deposit) |
| https://github.com/Near-One/bridge-sdk-rs · https://github.com/near-one/bridge-sdk-js | Omni bridge signing via MPC |
| https://github.com/spothq/cryptocurrency-icons · https://github.com/0xa3k5/web3icons | Real token and chain icons (registry: https://registry.npmjs.org/@web3icons/core) |

## §6 Skills and MCP
- MCP servers in this workspace: near-docs, near-ai-docs, near-intents-docs (search before you guess an API).
- https://github.com/near/agent-skills/tree/main/skills (list in §5).
- https://market.near.ai/skill/SKILL.md (Agent Market skill for listing an agent).

## §7 Rival archetypes (names on the private box only)
| Id | Track | What it does | Weak spot | How a shop beats it |
|---|---|---|---|---|
| R1 | Privacy, RWM | Proves you hold funds without showing them (NEP-413 + TEE attestation) | Proves, does not act | Bank acts privately and proves it |
| R2 | DeFi, Security | Trading agent key that can only trade and send back; caps on chain | NEAR-only, single purpose | Ferry + board: one session across many shops and chains |
| R3 | RWM, Agents | Multichain payments + x402 + TEE agent wallets, polished UI | Policy in its backend; no chain signatures | Show the chain refusing; chain signatures in Toll/House |
| R4 | RWM, Security | AI accounts-payable agent vs invoice fraud | Claims only | Guard + Payouts: refused poisoned invoice on chain |
| R5 | Security | SDK score + pay-only vault + report registry | Score is advisory | Guard verdict enforced on chain via OutLayer yield/resume |
| R6 | Security | On-chain policy, scam registry, red-team page | Earlier network only | Mainnet refusals, live |
| R7 | RWM | Any-token invoices delivered as exact dollars via Intents | Close to the track prompt | Payouts adds caps, payroll, statements, meta-tx gasless |
| R8 | Games | Six NPC accounts, NEP-141/171/245, many tests | Earlier network | Arena: guardian NPCs with their own pots and attested inference |
| R9 | Ecosystem | NEAR Business treasury; Agent Market listings; OutLayer custody | Products, not entries | Compose them, do not clone |

Internal register with links: `docs/internal/competitors.md` (note: it names rivals in a public repo; the owner's rule says move named rows off the repo).

## §8 Past winners
`docs/internal/research/winners-patterns.md` — P1 one NEAR account moves money on other chains (strongest), P2 verifiable TEE agents, P3 real payer/payee money, P6 games only with an on-chain economy; plus the "distinctive NEAR capability" test every shop must pass.

## §9 Ecosystem
| Link | Why |
|---|---|
| https://near.com | Intents front end, perps, confidential balances |
| https://x.com/NEARProtocol/status/2114052194668261859 | NEAR Business (treasury) live |
| https://market.near.ai | Agent Market jobs; none is a security job (X research §4) |
| https://docs.near.org/tools/contracts-list | Ecosystem contracts list |
| https://x.com/NearAgentMarket | Job posts (booking, route planner, clipping, dubbing, quotes) |

## §10 In-repo files every chat may read
`docs/internal/shops-blueprint.md` (architecture, Ferry pattern, lessons) · `docs/internal/shops/<shop>-deep.md` (your brief) · `docs/internal/ferry-icons-fix.md` · `docs/internal/illia-ideas-2026-11-04.md` · `docs/internal/competitors.md` · `docs/internal/RESEARCH_SOURCES.md` · `docs/internal/research/` (tracks, judges, winners) · `shared/deployments/mainnet.json` · `contracts/*/src/lib.rs` · `shared/board/session.js` · `app/src/panels/deep.js`.

## §11 Per-shop index
| Shop | Track | Read in this pack |
|---|---|---|
| toll | Autonomous Business | §1 (Kain, Eddy), §2 ThePiVortex list, §3 Business row, §4 Chain Signatures (proxy path tutorial), §5 near-multichain, §8 P1, §12 |
| chronicle | Autonomous Business | §1 Illia provenance log, §3 Business, §4 NEAR AI verification, §8 P4, §12 |
| arena | Games | §2 AI Tamagotchi, §3 Games, §4 NEAR AI + NEP-245, §7 R8, §8 P6, §12 |
| hall | Agent Economy | §1 Illia earn / cyntro manager agents, §2 hire-a-swarm, §3 Agents, §4 Agent Market + Agent API, §12 |
| guard | AI Security | §1 SHIELD, judgement-as-code, §3 Security, §4 OutLayer, §7 R5 R6, §12 |
| bank | Privacy | §1 Mert/Haseeb/DevHub TEE, §2 viewing keys, §3 Privacy, §4 Confidential swaps + NEAR AI verification, §7 R1, §12 |
| payouts | Real-World Money | §1 Eddy, §2 universal checkout, §3 RWM, §4 1Click + meta tx, §7 R7, §12 |
| house | Open Innovation | §3 Open inheritance prompt, §4 Chain Signatures proxy path, NEP-171, §8 P1, §12 |

## §12 Cross-shop P0 findings (read by every chat)
1. **The board does not tell the shop contract who the visitor is.** `charter_board.propose_call` (`contracts/charter_board/src/lib.rs` L319–) verifies the row's agent signature, then calls `receiver.method(args)` with `predecessor = board.nearcarta.near`. A shop contract cannot know which row paid. Any per-user state in a shop contract (a derived foreign address, a deed check-in, an arena attempt) needs the row owner. Fix (board v2, one redeploy, no per-user change): add `propose_call_as` that **overwrites** a top-level `row_owner` field in the JSON args with the verified `owner` before calling, so a shop trusts `row_owner` only when `predecessor == board`. Shops then key state by `row_owner`.
2. **Arena `attempt` keys "one open attempt per player" by predecessor.** Via the board every visitor is the same predecessor, so the whole city shares one open attempt. Needs (1).
3. **House `house_pay` / check-in need the deed holder as predecessor + 1 yocto.** The session can never do it. Needs (1) plus a holder-delegation rule.
4. **Townhall `post_bounty` is `only_dao` (= nearcarta.near).** A visitor can never post a job. Hall's "hire" pays `townhall.nearcarta.near`, our own contract, for nothing.
5. **Several shops pay 0.001 NEAR to our own contract or to a demo account** (Toll, Chronicle entry, Guard trick, Hall hire). A payment that buys nothing fails the judges' test. Every payment needs a real recipient chosen by the visitor and a real thing bought.
6. **Contracts are not upgradeable.** None has `migrate`. Every redeploy must add an owner-only `upgrade` + `migrate` and keep `close()` → `nearcarta.near`.
