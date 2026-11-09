# Town Hall — deep brief (Agent Economy)

**Audience:** the Cursor chat that owns `hall` (PR #40 open, branch `cursor/hall-city-shop-4911`).
**Do not** send mainnet txs or deploy. No Social Money / DAO track claim. Teardown to `nearcarta.near`.

## Read first
1. `docs/internal/source-pack.md` §2 (Illia 4 Nov: **hire-a-swarm with guardrails or AI governance review**; Kickback event escrow; ERC-8004 agent identity), §1 (Illia "make an agent that earns"; cyntro: manager agents splitting tasks), §3 Agents row, §4 Agent Market + Agent API, §7 R9, **§12 P0 #4**.
2. `docs/internal/research/tracks/07-agents.md` (general contractor: task + budget, split, hire, check, pay).
3. Code: `contracts/townhall/src/lib.rs`, `app/src/panels/hall-ui.js`, `app/src/panels/hall.js`, `app/design/D8_shops/shops/hall.js`, `app/shops/hall/`; PR #40: `shared/hall/plan.js`, `app/src/panels/hall-{actions,dock,panes}.js`, `backend/src/hall-market.js`.

## 1. Attack the idea
| Question | Today (main + PR #40) |
|---|---|
| 1. Problem / gain | Main: the visitor edits their own row caps (useful, but that is `/setup`'s job). PR: "hire an agent" negotiates a counter-offer then pays. |
| 2. Who gets the money | `hirePlan` pays `HALL_PAYEE = 'townhall.nearcarta.near'` (`shared/hall/plan.js:6,126`) — our own contract, for a "lamp check" no agent performs. Meaningless. |
| 3. What is new | Nothing; no real agent is hired. |
| 4. Why judges love it | They would not: Agent Economy wants real hires and payouts. |
| 5. Any user | No. `post_bounty` and `set_policy` are `only_dao` (`dao = nearcarta.near`); `agent_reward` only `nearcarta.near`. A visitor cannot post a job. |

**Idea score today: 3/10. Implementation: 5/10.** **Verdict: replace. PR #40: replace** (salvage the dock, row-rules helpers and tests).

## 2. Replacement concept: "Hire Hall" — a guarded hire-a-swarm with escrow
**One line:** the visitor posts a job and a budget (e.g. "find 3 cheapest flights Cairo→Dubai under $200, 0.5 USDC"); the budget goes into **escrow on chain from their session**; the Hall's **contractor agent** splits the job, hires real agents (Agent Market listings via API, plus city agents anyone can register by staking NEAR for inference — Illia's hire-a-swarm), checks each deliverable with a NEAR AI TEE reviewer, and releases payment per part. Guardhouse reviews every payee (guardrails). Unspent escrow returns to the visitor.

| Question | New answer |
|---|---|
| 1. Problem / gain | People and agents want work done by specialists without trusting one of them with the whole budget. Gain: one sentence, escrowed money, pay only for checked work. |
| 2. Who gets the money | The **hired agents** (their NEAR account or USDC via Intents), per accepted deliverable. Refund to the poster. A small published hall fee only if it pays real inference. |
| 3. What is new | Agent Market has escrow per hire, but not a contractor agent that splits a budget across many agents **under an on-chain cap it cannot edit**, with AI-reviewed releases and Guard checks. Open registration of swarm agents with staked NEAR for inference is Illia's exact 4 Nov ask. |
| 4. Why judges love it | Illia's hire-a-swarm + "make an agent that earns"; cyntro's manager agents; Agents track general contractor prompt; Agent Market partner. |
| 5. Any user | Yes: any row posts jobs; any account registers an agent; amounts and payees are user data. |

**Idea score after replacement: 8/10.**

## 3. Live mainnet views (2026-11-06)
`townhall.nearcarta.near`: 1.953 NEAR, storage 192,231 B, **1 FullAccess key** (teardown key; noted in `mainnet.json`). `get_state`: dao = agent = `nearcarta.near`, per_reward_cap 0.001, total_cap 0.002, spent 0.001, role_threshold 1000, role "council". `get_bounties`: 2 (one claimed by nearcarta.near, one open 0.002). `agent_propose_role` calls `add_proposal` on the dao (Sputnik shape — do not claim).

## 4. Hardcoded (file:line)
| Where | What |
|---|---|
| PR `shared/hall/plan.js:6–8` | `HALL_PAYEE`, `BOARD`, `MARKET_BASE` constants |
| PR `plan.js:16` | Hint with 0.001 |
| PR `plan.js:126,240` | default `near = '0.001'` |
| PR `backend/src/hall-market.js:109` | contract constant |
| `contracts/townhall` | `only_dao`, `only_agent` = one account; policy caps tiny and global; no per-user jobs; no upgrade |

## 5. Deep design
### 5.1 Contract `hall` v2 (new account `hall.nearcarta.near` or upgrade townhall after `close`)
- `post_job(row_owner, brief_hash, budget, deadline, parts_max)` payable (budget attached from the row via `propose_call_as`; the row's per-action cap and daily budget limit it).
- `register_agent(row_owner, endpoint_hash, stake)` payable: city swarm agents stake NEAR that pays their inference (Illia's mechanism); slashed 0, just withdrawable.
- `award(job_id, part, agent, amount)` callable by the **contractor agent key** only (function-call key on `contractor.hall.nearcarta.near`), `amount ≤ remaining budget`, payee must pass Guard (`guard_ok` flag from Guard v2 or a stored verdict hash).
- `release(job_id, part, review_sha256)` after a TEE review; `refund(job_id)` after deadline → poster. `upgrade`/`migrate`/`close()` (only with zero escrow) → `nearcarta.near`.
- USDC jobs: budget as wNEAR/USDC via `ft_transfer_call` from the row (board `propose_call` on the token) — UNVERIFIED with the current CALLS allowlist; plan it.
### 5.2 Backend contractor agent
Splits the brief with a NEAR AI TEE model, queries Agent Market for listings (`aat_` token in a hidden env field, never committed), posts sub-jobs, polls deliveries, reviews with a TEE model, calls `award`/`release`. Every step logs to Chronicle.
### 5.3 City UX
Tabs **Post / Agents / Jobs**. Post: brief, budget, deadline, live cap left. Agents: real listings (Market + city), price, reputation (on-chain award counts). Jobs: parts, deliverables, review seal, release txs. Keep "My rules" as a link to `/setup`, not a tab.
### 5.4 AI commands
"hire agents to … for 0.5 USDC by tonight", "register my agent at <url> with 0.05 NEAR stake", "accept part 2", "cancel job 4 and refund", "who did best this week?".

## 6. Costs
New contract ≈2 NEAR stake (townhall `delete_account` returns ≈1.95 first). Per job: budget (user money, escrow) + ≈0.01 NEAR gas; Agent Market hire fees per listing (USDC, UNVERIFIED amounts); NEAR AI review ≈ $0.01.

## 7. Acceptance checklist
- [ ] A visitor posts a job with escrow from the session (no popup); over-cap budget refused on chain.
- [ ] At least one real external agent (Agent Market) and one city-registered agent each deliver and get paid.
- [ ] One deliverable rejected by the TEE reviewer → no payment; refund of unspent budget to the poster.
- [ ] A Guard-blocked payee is never paid.
- [ ] No `townhall.nearcarta.near` as payee; no 0.001 defaults; no DAO/Social Money claim.
- [ ] `upgrade`/`migrate`; `close()` with zero escrow → `nearcarta.near`; tests green; README.
