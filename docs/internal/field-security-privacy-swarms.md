# Field notes: security, privacy, swarms (NEAR Hackathon 2026)

Internal. Not for judges. Written 2026-11-09 from the public project list and from cloned repos.

Source data: `https://nearhackathon.com/api/projects` — **335 projects total**, **202 of them** in
`security`, `privacy` or `swarms` (security 165, privacy 54, swarms 29, agents 162; most entries tag
two or three). The API silently caps `pageSize` at 8 regardless of what you ask for, so the list was
read 42 pages at a time and deduped by id. Re-checked twice against a fresh directory; the counts are
stable.

Method: for every shortlisted project, clone `--depth 1`, count Rust/JS/TS lines and tests from the
tree, read the contract's public methods and its authority checks, extract every `*.near` /
`*.testnet` id and every 43–44 char base58 string from the README and docs, then **call NEAR RPC**
(`view_account` on testnet/mainnet, `tx` on archival RPC) to confirm the account exists, has code,
and the cited transaction is real, signed by the named account, to the named receiver. Numbers below
are measured from the cloned tree, not read from a badge.

Two cautions on the data:
- Rust line counts include test modules inside `src/` for some projects and not others. The `tests`
  column (file count) plus `#[test]` count is the more honest comparator.
- Several projects ship a **JS/TS contract** (`near-sdk-js`) or anchor only. "Rust files = 0" does
  not by itself mean "no contract"; it means no Rust contract. I flag which.

**A roster caveat worth recording.** Three repos that read as obvious top-18 candidates — Parallax
(`bank.useparallax.near`, real mainnet USDC escrow), Banbo (`vault.banbo-mia.testnet`, CaMeL origin
labels on chain), and Midge (`c.fly-1793636729.testnet`, `hatch_out` unilateral refund) — are tagged
NEAR HACKATHON in their READMEs but **do not appear anywhere in the 335-project submission list**
under those names or any obvious variant. They are excluded from the 18 because they are not in the
field. They are discussed in the last section anyway, because if they *are* submitted, they are the
three projects most likely to beat us. That distinction matters more than any number in the table.

---

## The table (18)

`ON` = enforcement on chain in a contract that holds the money. `OFF` = the policy lives in a
server, a prompt, or a client. `MIXED` = a real contract gate but the decisive evidence is
off-chain.

| # | Project | Tracks | Repo | Rust files / lines | Tests | Mainnet tx? | Live URL | Video | Primitive | Enforcement | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Leash** (ksin751119) | security, agents | `ksin751119/leash-near` | 19 / 9,444 | 121 `#[test]` + 205 js | No (testnet, verified) | No app URL | No | Function-call key scoped to `spend`, WebAuthn passkey to loosen rules, NEP-297 refusal events | **ON** | **Strongest security entry.** Real mechanism, real depth. |
| 2 | **Veto** (Bronxydrone) | security, agents | `Bronxydrone/Veto` | 1 / 1,241 | 31 rust + 100 js | No (testnet, verified) | Static browser demo (raw.githack) | Yes (scripted) | `spend`-only key, contract recomputes caps, hash-chained decision log | **ON** | Strong. Contract is small; the rigor is in the harness. |
| 3 | **AgentGuard** (zaxcoraider) | security, agents | `zaxcoraider/AgentGuard` | 9 / 3,026 | 71 rust + 74 js | No (testnet, verified) | `sentinel.agentguard.app` (200) | Yes (youtu.be/DInKclSnPkc) | Vault + registry + factory, agent key restricted on the vault account, `lock_rules` one-way | **ON** | Strongest *presentation*. npm + MCP registry, live "try to rob it". |
| 4 | **Allowance** (soldanoandrea) | business, security, agents | `soldanoandrea/allowance` | 10 / 7,387 | 72 rust + 147 js | No (testnet ids in docs, NOT VERIFIED on RPC) | GitHub Pages ledger (200) | Yes (mp4, scripted) | Function-call key on the vault account itself, policy, approval threshold, kill deletes keys, factory, revenue split | **ON** | Deepest feature list. Best "kill switch is protocol-level" argument. |
| 5 | **Claw Guard** | security, agents | `metafrogmeme-droid/claw-guard-near` | 25 / 13,639 | 187 rust + 379 js | Yes — `clawguard-demo.near` exists with code (verified) | No | No | NEAR chain signatures + MPC; contract builds the payload and signs only if rules pass | **ON** | Largest Rust surface of any security entry. Cross-chain signing gate. |
| 6 | **KeyLease** | swarms, security, agents | `metafrogmeme-droid/keylease` | 23 / 5,905 | 113 rust + 291 js | No (testnet verified) | No | No | OutLayer TEE seals an API key; on-chain leases for N calls / endpoints only | **ON** | Best *different* primitive in swarms. Lends the call, never the key. |
| 7 | **Co-op** | swarms, security, agents | `AlphaTechini/co-op` | 9 / 3,533 | 65 rust + 120 js | No (testnet `coop.coop-alpha.testnet` verified) | `coop.cyberpunkinc.xyz` | No | Group-buy rooms: contract settles every agent at the reached price tier, no agent pays over its own limit | **ON** | Best *swarm economics* story. 12-agent testnet run, 64 tx hashes. |
| 8 | **Tollgate** (Mattbusel) | security, agents | `Mattbusel/tollgate` | 2 / 1,101 | 18 rust + 22 js | No (testnet verified, deploy tx verified) | `near-tollgate.vercel.app` (402 on purpose) | Yes (youtu.be/RItnCVGQ_2s) | Payment channels, off-chain signed vouchers, on-chain cash-out | **ON** | Best *different* primitive in security. Not a wallet firewall. |
| 9 | **Semilla1 Guard** | security, agents | `semilla1lab/semilla1-guard-near` | 1 / 169 | 10 rust | No (testnet; 4 txs verified) | No | No | Function-call key + per-tx/daily cap/cooldown/allowlist | **ON** | Smallest real contract. Perfect proof hygiene. |
| 10 | **NEAR Agent Spend Guard** | business, security, agents | `mubudot/near-agent-spend-guard` | 2 / 713 | 26 rust + 99 js | No (testnet) | No | Yes | Same shape: caps + allowlist + owner approval | **ON** | Solid, unremarkable. |
| 11 | **near-threshold-guardian** | security | `exocognosis/near-threshold-guardian` | 5 / 1,020 | 7 rust | No (testnet id NOT VERIFIED — `exocognosis.testnet` has no code) | No | No | t-of-n FROST threshold approval over the exact signing payload, before the MPC signer | **ON** | Sharpest single idea in security after Leash's passkey. Underexplained. |
| 12 | **NearGuard** (MarwanWidjaya) | security | `MarwanWidjaya/nearguard` | **0 / 0** (Python) | 0 | No | No | Yes (mp4 in repo) | Counterparty risk check before paying (allow / warn / block) | **OFF** | No contract. A scorer in Python. |
| 13 | **LeashPay** | security, agents | `hassaanraja282-lgtm/leashpay` | 4 / 972 | 24 rust | No | No | No | Caps/allowlist in Rust, but the demo runs through a Node server that holds the agent key | **MIXED** | Contract exists; the demo's trust story is a server. |
| 14 | **Readback** | security, agents | `2TheMoom/readback` | 9 / 1,138 (**WASI engine, not a contract**) | 14 rust + 103 js | No | Railway (200) | No | OutLayer TEE re-runs a Rust check on a 1Click quote | **OFF** | Excellent analysis, no on-chain gate. |
| 15 | **Jurat** | privacy, realworld | `nftkingiii/jurat` | 3 / 873 | 23 rust | **Yes — `juratapp.near`, tx verified** | `jurat.up.railway.app` | No | OutLayer TDX enclave + NEP-413 empty intent + threshold proof | **MIXED** | Best privacy *idea*: prove a confidential balance without revealing it. |
| 16 | **Undiluted** | privacy, business | `Elioz404/Undiluted` | 55 / 12,307 | 208 rust | No (testnet, 2 contracts verified) | GitHub Pages (200) | asset link only | TEE cap table + on-chain commitment anchor + distribution | **MIXED** | Real privacy primitive; the private part is off-chain by construction. |
| 17 | **TEE Receipts** | privacy, open | `tmdry4530/tee-receipts` | 2 / 500 | 9 rust + 13 js | No (testnet verified) | GitHub Pages | No | Contract re-checks a NEAR AI Cloud TEE signature, keeps attested signer history | **ON** | Narrow, honest, small. |
| 18 | **SwarmShop** | business, swarms, agents | `mohammedfirdouss/swarmshop` | 1 / 376 | 15 rust | No (2 testnet contracts verified) | `swarmshop.onrender.com` (**000, down**) | Yes (X post) | Escrow + sub-account-per-agent + patch hash | **ON** | Thin contract, good narrative. |

Also measured and dropped, with reason: **Tontine** (4,068 rust lines but a 19k-line JS shell, no
live URL, no video), **NEXUS AiOS** (4,046 rust lines, video and 8 tx hashes, but its own README
calls the demo boundary testnet-only and its scoring is a server call), **HiveBid** (2,871 rust
lines, `hivebid-yksunder.testnet` verified — the closest miss; loses to Co-op on the same
swarm-auction idea because Co-op has a hosted demo and a 12-agent run), **HADES OMEGA** (1 / 184
Rust lines, 138 JS files — an orchestration shell, not a contract), **Skyll** (0 Rust, 0 `*.near`;
the entire NEAR contribution is a NEAR AI Cloud API call), **Antibody** (54k own Rust lines plus 48k
vendored in `third_party/`; its own NEAR contracts total 6,494 lines, no mainnet tx),
**Aftercall** (14.9k Rust lines, but 22 of its Rust files are Tauri desktop code; the contract is
2,147 lines), **Flock**, **Swarm-for-Hire**, **FlashFirm**, **Settle** — all real, a tier below on
proof.

---

## Per project

**1. Leash (ksin751119/leash-near).** A wallet account holds the money and runs the contract; each
agent gets a key that can call exactly one method, `spend`. Loosening a rule (widening a cap, adding
a payee, unpausing, withdrawing) needs a **WebAuthn passkey signature the contract verifies itself**,
with a challenge and a nonce per credential. Refusals do not panic — they return
`{"status":"refused","code":4,"reason":…}` and emit a NEP-297 event, deliberately, so the reason
survives on chain. Stranger calls go into a separate ring buffer so they cannot evict real decisions
from the log. Strongest idea: **the recovery path is a passkey, not an admin key**, and freeze
deletes every access key at the protocol level. I confirmed over RPC that the live wallet has **0
access keys**, which is what that claim requires.

**2. Veto (Bronxydrone/Veto).** One 1,241-line contract, `spend`-only agent key, per-tx/daily/30-day
limits recomputed from the contract's own storage on every call, plus a **hash-chained decision log**
(`head = sha256(previous_head || decision_hash)`) so a gap in the record is detectable. Anything over
the owner threshold waits for a human and the approval is **re-checked against today's policy** so a
stale approval cannot be spent. A separate `check()` view answers the same question without moving
money. The tests are the product: 37 conformance checks re-run against the deployed contract, 29
adversarial scenarios, 1,000 random actions against invariants. The contract even fails closed on
insufficient balance, which its own docs say was found on testnet, not in review.

**3. AgentGuard (zaxcoraider).** Three contracts (vault, registry, factory), so a new user gets a
vault from a global contract. Agent keys live **on the vault account** and are restricted by the
protocol; `request_payment` requires `predecessor == current_account` and a registered key. A
cross-vault **registry** means a scammer flagged once is blocked even if another owner allowlists
them. `lock_rules` is one-way: after it, nothing can loosen the vault, and the README shows refused
owner calls as proof. Shipped an npm package (`@zaxcoraider/agentguard-mcp` 0.1.1, confirmed live on
the registry), an official MCP registry listing, and a NEAR Agent Market listing — the only entry in
my tracks with a distribution story.

**4. Allowance (soldanoandrea).** The most complete feature set: per-payment cap, budget per window,
payee allowlist, vault denylist, time window, cooldown, human approval above a threshold, expiry,
pause, kill, a `simulate` free view returning `allow` / `needs_approval` / `block` + reason, income
splits, vault-to-vault deposits, and a factory at ~0.003 NEAR per vault. The kill switch **deletes
every agent key** so the next transaction is refused by the network, not by a flag. Best single
argument in the field: the access-key layer is enforced by the protocol *before* the contract runs,
so a bug in the contract cannot be reached by the agent. Caveat: I could not resolve its testnet
accounts from the README into account ids that answer on RPC, so its deployment status is NOT
VERIFIED even though its engineering is clearly real.

**5. Claw Guard.** The only entry that gates **cross-chain** signing: the contract checks markets,
receivers, tokens, per-order cap, daily cap, daily order count, leverage, expiry and pause, and only
then builds the exact payload itself and asks NEAR chain signatures to sign it. Ships a mock-MPC
contract so the whole flow runs offline. 13.6k Rust lines is the largest real contract surface in the
security track. Weakness: no live URL, no video, and the testnet ids printed in the README
(`clawguard.testnet`) **do not exist** — only the small locked `clawguard-demo.near` on mainnet does.

**6. KeyLease.** The most interesting non-firewall security idea: an owner seals an API key once
**inside an OutLayer TEE** and issues *leases* — N calls, until a time, these endpoints only. Agents
call through a pinned open-source proxy build that runs in the enclave; one click revokes, and the
next call is refused. Receipts on chain name hashes and status, never the body or the key. This is
spend control applied to a **credential** instead of a balance, which is a bigger market and a
cleaner primitive. 5.9k Rust lines, 23 files, 113 tests, TEE attestation rather than a cap table.

**7. Co-op.** Group buying for agent swarms: open a room for LLM credits or GPU hours, agents join
from their own wallets, the contract guarantees **no agent pays more than its own limit** and settles
everyone at the price tier the group actually reached. 12-agent testnet run with 64 tx hashes, a
hosted demo, and a `make verify` that deploys the committed wasm to a local sandbox and recomputes
the invariants. Best answer in the swarms track to "why does this need a contract instead of a
spreadsheet" — the price tier is the shared state.

**8. Tollgate.** Not a wallet guard: **HTTP 402 micropayment channels.** The agent locks a budget
once, then pays per API call with an off-chain signed voucher the seller verifies in microseconds;
the seller cashes the newest voucher on chain once for hundreds of calls, and the agent can always
take back the unspent remainder. `curl -i` on the live endpoint returns a real 402 offer. Best
demonstration that "agent payments" is not one problem.

**9. Semilla1 Guard.** The smallest honest version of the whole idea: 169 lines, one key, one method,
per-tx cap, rolling 24h cap, allowlist, cooldown, NEP-297 event for every attempt, and an explicit
**anti-griefing** fix (stranger calls emit an event but write nothing, so they cannot burn the
vault's storage stake). Six `ALLOW`/`DENY` tx hashes, four verified on archival RPC, and a
`verify.sh` that needs only `curl` + `python3`. Best proof-per-line ratio in the field.

**10. NEAR Agent Spend Guard.** 713-line contract, caps, allowlist, owner approval, spend-only key.
README carries an explorer file and a video plan. Correct, competent, and indistinguishable from five
other entries at the same depth. Nothing here is wrong; nothing is memorable.

**11. near-threshold-guardian.** A policy layer between an agent and `v1.signer-prod.testnet`: a
signature request at or below the limit goes straight to the MPC signer; anything above it is
released only with a **t-of-n threshold approval from a guardian set, produced with FROST over the
exact request**, so an approval for one payment cannot be reused for another. That binding is the
detail almost everyone else misses. Only 1,020 Rust lines and 7 tests, no live URL, no video, and
the testnet account it names has no code — so it is an idea with a proof of concept, not a product.
The idea is strong enough to rank it eleventh anyway.

**12. NearGuard (MarwanWidjaya).** **No contract at all.** Python: a counterparty check service that
returns allow / warn / block for a payee, with a synthetic drain demo and a `.mp4`. The demo is
convincing and the problem is real, but the agent still holds the money. In a track where the
question is "does the contract enforce it", this is the clearest no.

**13. LeashPay.** A real 972-line Rust contract with `request_payment`, `approve`, `reject`,
`set_policy`, `add_recipient`, `pause`, `withdraw` — and a Node server (`server/near.js`) that holds
the agent's function-call key and signs for it. The contract gate is genuine, but the demo's trust
story is a server that could be replaced. 24 Rust tests. No live URL, no video.

**14. Readback.** The best *analysis* in the field and the weakest *chain* story. A Rust engine
(compiled to `wasm32-wasip2`, not to a NEAR contract) decodes a 1Click quote plus intent JSON and
answers CLEARED / HOLD / REFUSED on 17 checks; the same engine re-runs inside OutLayer's TEE and must
agree. Real findings: a signed 1Click quote stays valid ~3 days; 1Click signs payout quotes to an
implicit address **off the ed25519 curve** (nobody can hold that key); a prompt-injected invoice got
a real NEAR AI Cloud model to pay the inflated amount in 2 of 3 runs. But there is no `near_bindgen`
anywhere in the repo — the decision is enforced before signing, not on chain.

**15. Jurat.** Prove a NEAR **confidential** balance is at least X without revealing it. The holder
signs an empty NEP-413 intent for `intents.near` whose nonce carries `sha256(request)[0..7]`, so the
signature answers one request and moves nothing; an OutLayer TDX enclave reads the confidential
balance and outputs only `confirmed` / `not_confirmed` / `refused`; anyone checks the NEAR tx plus
Intel's signature on the quote. `juratapp.near` is on mainnet and the example tx verified. Best
privacy primitive I found in the 54 privacy entries, and one of only two mainnet verifications in
this table.

**16. Undiluted.** A confidential cap table: the table lives in a TEE, only a commitment to its
history goes on chain, investors can prove the total adds up without seeing each other, and SAFEs,
MFN and exit payouts run from contract rules. 12.3k Rust lines, 208 tests, browser-side Intel TDX
attestation check. The privacy is real because the data is never on chain — which is also why the
chain is a notary here, not the enforcer.

**17. TEE Receipts.** Solves a narrow, real problem: a NEAR AI Cloud reply is signed inside a TEE but
the signature is only fetchable for a while and the signer key rotates. This contract re-checks the
signature on chain and keeps a timestamped history of attested signer keys, so an old receipt still
verifies. 500 lines of Rust, 9 tests, one real anchored receipt. Small and finished.

**18. SwarmShop.** A bug-fixing shop: customer pays, worker agents bid from their own sub-accounts
(`worker-ace.<shop>`), a foreman runs the tests and pays the cheapest fix that passes. The contract
only accepts bids from direct sub-accounts, so every bid and payout traces to one agent, and each
payout stores the SHA-256 of the winning patch. Honest limitation in its own README: the contract
trusts the foreman to pick, the hash only makes the choice checkable. Its live URL returned no
response when probed (curl 000), which for a free-tier host may just mean it was asleep.

---

## What they have that we might lack

Concrete, copyable. Ordered by value to us.

1. **`simulate` as a free view returning allow / needs_approval / block + reason** (Allowance). An
   agent can plan before it spends, and the answer is the same words the real call will use. We have
   `simulate` in `contracts/charter_board/src/v2.rs`, but it is a board view, not the charter's own
   pre-flight for `propose`. A model that can ask "would this be refused, and why" before composing a
   payment is a materially better agent.
2. **A refusal that does not panic** (Leash, Veto). Leash returns a structured refusal and emits
   NEP-297 *because* a panic rolls back the record of why. Veto emits then panics. We refuse with
   reason strings (`over_daily_action_count`, `below_min_amount`, `outside_time_window`,
   `clause_expired`, `frozen`) — worth checking whether those reasons survive as queryable events on
   the refused path, or only as a returned error.
3. **Origin labels / provenance, not just amount** (Banbo — see the caveat above; a repo, not a
   submission). "The payee is on the allowlist and the amount is under the cap" does not stop the
   attack where a trusted vendor's account is hijacked, or where the owner was tricked into
   allowlisting earlier. Banbo's answer is that the contract checks *which input* the recipient and
   the amount came from, and holds when the amount came from an untrusted source. This is the single
   most important idea in this space that we do not have.
4. **A one-way `lock_rules`** (AgentGuard). After the owner is satisfied, nothing — including the
   owner — can loosen the vault. Cheap to add, and it converts "trust the owner" into "verify the
   owner gave up the ability".
5. **A cross-vault registry / blocklist** (AgentGuard, Mattbusel's Leash). A scammer flagged once is
   blocked in every vault that consults the registry. Turns N isolated vaults into a network. We have
   a public board, which is adjacent, but not a deny signal other rows consult.
6. **A hash-chained decision log** (Veto). `head = sha256(previous || decision)`. Anyone can prove no
   decision was removed. We have per-charter refusal counters; a chain would let a judge verify
   completeness rather than trust our index.
7. **A passkey (WebAuthn) recovery path verified in the contract** (Leash). Loosening a rule requires
   a device signature with a per-credential nonce, verified on chain. No admin key, no server. This is
   the strongest answer to "who can widen the cap" that anyone in the field has.
8. **Threshold approval bound to the exact payload** (near-threshold-guardian). A t-of-n FROST
   signature over the exact request, so an approval cannot be replayed for a different payment. Our
   escalation path holds for the owner; it does not require a quorum, and the approval is not
   cryptographically bound to the bytes.
9. **A protocol-level kill switch** (Allowance). Kill deletes every agent access key, so the next
   transaction is refused by the network before any contract code runs. Our `set_frozen` is a flag the
   contract must remember; deleting keys fails closed even against a bug in our own code.
10. **A license-style lease on a credential** (KeyLease). N calls, until a time, these endpoints only,
    key sealed in a TEE. If our agent ever needs to call a paid API, this is the pattern, and it is a
    better fit than a NEAR cap for spending that is not NEAR.
11. **Group settlement at a reached tier** (Co-op). Many small buyers, one price tier, contract
    settles everyone and guarantees each paid no more than its own limit. A genuinely swarm-shaped
    use of a contract, not a chat wrapper.
12. **Distribution.** AgentGuard is on npm and in the official MCP registry and on the NEAR Agent
    Market. Semilla1 ships a `verify.sh` that needs only `curl` + `python3`. Both lower the cost of a
    judge's first check below ours.
13. **Video.** Seven of the eighteen have a video; the top three security entries all do. We have none
    in the repo. This is a judging-surface gap, not an engineering one.

---

## Where we are clearly ahead

Measured against the 18 above, from this repo.

- **Contract surface.** Our contracts total **12,978 lines of Rust in `contracts/*/src`** plus 2,728
  lines of integration tests, **612 `#[test]`** across 13 crates that carry tests (15 crates total),
  and five sandbox suites (`sandbox`, `exploits`, `adversarial`, `teardown`, `props`). The largest
  security entry here, Claw Guard, is 13,639 Rust lines including its tests and ships one contract;
  Leash is 9,444 across contract + sandbox tests. We are in the same order of magnitude on the single
  biggest entry and ahead of every other one, and we are the only entry with **several distinct
  contracts that call each other** (charter, board, toll, hall, house, arena, factory, guard, reaper).
- **Mainnet.** Only **two** of the eighteen have a verified mainnet transaction: Jurat
  (`juratapp.near`) and, on a small locked demo account, Claw Guard (`clawguard-demo.near`). Everyone
  else is testnet, demo-only, or off-chain. We run **eight live mainnet contracts of our own**
  registered in `shared/deployments/mainnet.json` (`charter`, `board`, `toll`, `factory`, `guard`,
  `house`, `townhall`, `arena`; the file also names `outlayer.near`, which is OutLayer's, not ours)
  and the deployments file carries 145 account ids and tx hashes. In these tracks that is close to
  unique.
- **Refusals as a first-class, tested outcome.** Our refusal buckets are named and asserted
  (`over_daily_action_count`, `below_min_amount`, `outside_time_window`, `clause_expired`, `frozen`),
  and `contracts/oath/tests/exploits.rs`, `adversarial.rs` and `props.rs` test the adversarial path,
  not just the happy path. Of the 18, only Veto (29 adversarial scenarios) and Leash (refusal codes
  with a three-way assertion per code) are in the same posture.
- **One receipt shape across four rails.** `shared/rails/receipts.js` gives a NEAR transfer, a
  chain-signature toll, a dry Intents quote and a NEAR AI job the same keys. **Nobody else in these
  three tracks does this.** Everyone else has one rail.
- **Both a spend gate and an agent that is not trusted with the decision.** The charter refuses; the
  model's output is checked against the visitor's words (`backend/src/agent.js` `propose`, with the
  two tests that discard an invented payee and cap a raised amount). Readback is the only other entry
  that treats the model as an adversary, and it has no contract. NearGuard treats the *payee* as an
  adversary, and also has no contract.
- **Caps on the model job itself.** 160 tokens, $0.05, 300 calls/day (`budgetStatus`,
  `GET /api/agent/budget`). Nobody else in my three tracks caps the *inference* cost.
- **A public leaderboard with a real exclusion list.** `shared/vault/denied-accounts.json` plus
  `publicPlayers`. Adjacent to AgentGuard's registry, but ours is a live mainnet surface.

Honest gaps against the field, stated plainly: no video; no passkey recovery; no cross-vault deny
registry; no origin/provenance labels; no threshold approval bound to the payload; no unilateral exit
story; no npm/MCP distribution; and our `simulate` is not wired to the charter's `propose` the way
Allowance's is.

---

## Who would beat us in a judging round, and exactly why

Ranked by how likely they are to take a room we are in. This assumes a judge who reads code and
clicks links, and who has 5–10 minutes per project.

**1. Leash (ksin751119) — the deepest security mechanism.**
Why it wins: the passkey-gated rule change is the best answer anyone has to "the owner is also an
attack surface", and it is verified in-contract with a per-credential nonce and a challenge. Freeze
deleting all access keys is not a claim — I read 0 access keys off the live wallet over RPC. Refusal
codes each have a test asserting three things at once (tx succeeded, no balance moved, decision names
the code). 121 Rust tests. Against us: testnet only, no video, no live app, one contract, no
business/UX layer. It beats us on **"would I trust this with my agent's money today"** for a
security-minded judge. We beat it on mainnet, on surface area, and on the town.

**2. AgentGuard (zaxcoraider) — the best presented, and the only distributed one.**
Why it wins: a live site with a "try to rob Sentinel" button, a 2-minute video, an npm package that
really resolves, an official MCP registry listing, a NEAR Agent Market listing, a cross-vault scammer
registry, and `lock_rules` as a one-way switch. A judge who does not read Rust still leaves convinced,
and the Rust they *would* read is real (3,026 lines, 71 tests). Against us: testnet only, three modest
contracts, no Intents/chain-signature story. It beats us on **first-five-minutes conversion** and on
distribution. This is the one most likely to win a popular vote.

**3. Veto (Bronxydrone) — the most rigorous small contract.**
Why it wins: the hash-chained decision log is a real auditability property, not a log table, and the
re-check of a human approval against *today's* policy closes a hole most entries leave open. The
harness is the strongest in the field: 37 conformance checks re-run against the deployed contract, 29
adversarial scenarios with asserted verdicts, 1,000 random actions against invariants. Against us:
1,241 Rust lines, one contract, no live app (a static browser demo), testnet only. It beats us on
**verifiability of the audit trail** and on proof-per-claim. We beat it on breadth, mainnet, and
surface.

**4. Claw Guard — wins if the judge cares about cross-chain.**
Why it wins: it is the only one that gates **what gets signed for another chain**, and the contract
builds the payload itself so the agent cannot smuggle a different transaction past the policy. 13.6k
Rust lines, 187 tests, a mock-MPC so it all runs offline, and one small locked mainnet contract
(verified with code). Against us: no live URL, no video, the testnet ids in its README do not exist,
so its demo evidence is recorded rather than clickable. It beats us on **scope of the thing being
guarded** — we guard NEAR transfers and Intents quotes; it guards arbitrary EVM/Hyperliquid orders.

**5. KeyLease — wins if the judge values a new primitive over a better implementation of an old one.**
Why it wins: "lend the call, never the key" applied to API credentials, with the key sealed in a TDX
enclave and revocable in one click. It is the only entry that makes spend control work for money that
is not on chain, which is most of what an agent actually buys. Against us and everyone else: testnet
only, no live URL, no video, and the security argument depends on trusting one pinned enclave build.
It beats us on **novelty** and on the size of the market it addresses.

**6. Co-op — wins the swarms room if the judge is scoring swarm mechanics.**
Why it wins: rooms, tiered group pricing, contract-guaranteed per-agent limits, 12 agents in one
testnet run with 64 tx hashes, a hosted demo, and `make verify` that recomputes invariants from the
committed wasm. It is the only swarm entry where the contract is load-bearing for the economics
rather than for an escrow. Against us: one narrow product, 3,533 Rust lines, no video, no mainnet.
It beats us on **swarm-native reasoning**; we do not really have a swarm story, we have a town.

**Not in the table, and the real risk: Parallax, Banbo, Midge.** None of the three appears in the
335-project list, so none is in the field today. If any is submitted late or under a different name,
the ranking changes:

- **Parallax** (`bank.useparallax.near`, 2 mainnet txs verified: `cfo.useparallax.near` opens a job,
  `house.useparallax.near` escrows 1 USDC) would immediately be the only project in these tracks with
  **real money on mainnet**, and it has a job page that replays sealed bids, reveals, awards, TEE
  signed deliverables and hand-over from the bank's own record. It would beat us on the one axis we
  currently lead on in this comparison. It has no multi-track town, no Intents, no chain signatures,
  and fewer contracts (5 Rust files / 3,686 lines).
- **Banbo** (`vault.banbo-mia.testnet`, 2 txs verified) is the only implementation I found of
  provenance-checked payments on chain. Against a judge who has read the prompt-injection literature
  it beats every caps-and-allowlist project including ours, because it stops the attack the others
  cannot see. Testnet only, 5,443 Rust lines, and its own README admits the recorded runs used a
  vouched local MCP server rather than its TEE.
- **Midge** (`c.fly-1793636729.testnet`, verified) is the only entry anywhere with a real
  **unilateral exit** (`hatch_out`, refund proven by tx) for a stalled enclave. That is a liveness
  property we cannot currently demonstrate. It is 9,413 Rust lines with 225 tests, and it has no live
  URL and no video.

**Would not beat us, with reason:** Semilla1 (too small, but the best proof hygiene — copy its
`verify.sh`), Allowance (feature-rich, but I could not verify its deployment and it has no mainnet),
near-threshold-guardian (great idea, 7 tests, no working deployment), Tollgate (different problem;
excellent, but not competing for our room), Readback (best analysis, no contract), NearGuard and
Skyll (no contract at all), LeashPay (server holds the key), Undiluted and TEE Receipts (real, but
narrow privacy primitives with no live surface), SwarmShop (376-line contract, live URL down).

**The one-line risk.** The field has converged on "caps + allowlist + function-call key" — at least
eight of the 202 implement essentially that. We implement it better and on mainnet, but the *idea* is
commoditised. The differentiators that still separate us are mainnet usage, the multi-rail receipt,
and the untrusted-model check. The differentiators that would separate us further, in order of value:
provenance labels (Banbo), a passkey-gated rule change (Leash), a one-way lock (AgentGuard), a
threshold approval bound to the payload (near-threshold-guardian), and a cross-vault deny registry
(AgentGuard). Any one of those plus a 90-second video would move us ahead of everything in the table.

---

## Appendix: verification log

Everything below was checked against NEAR RPC or live HTTP during this survey, not taken from a
README.

- **Semilla1**: `vault.semilla1guard-1792872425535.testnet` exists with code; txs
  `Ht1aft7ry…`, `ATysBMEH…`, `GCdA74Uv…` all SUCCESS, signer `agent.semilla1guard-…testnet`,
  receiver the vault, action FunctionCall.
- **Veto**: `vetoguard.testnet` exists with code (12.5 NEAR). `5ac5ef1f…29633` (an implicit account)
  exists **only on archival RPC** with code; deploy `9J4khkaM…` and init `BbsTWLvG…` SUCCESS with
  signer = that implicit account; `FuVdUWzA…` is an `AddKey` on the agent account.
- **Leash (ksin)**: `leash-wal-11074c4d.testnet` exists with code and **0 access keys** (checked with
  `view_access_key_list`, matching its freeze claim); `Hxm5Hhv1…` (allowed) and `Avw594Nm…` (refused)
  both SUCCESS, signer `alpha.leash-bud-11074c4d.testnet`, receiver the wallet.
- **Tollgate**: `channels.tollgate-busel.testnet` exists with code; deploy `FHcP4UiV…` is a
  `DeployContract` signed by the contract account itself; `seller` and `agent` accounts exist without
  code, as expected.
- **AgentGuard**: `agentguard.testnet` exists with code and a `DeployGlobalContract` tx
  (`6apkVZAw…`); `guard.cm-agentguard.testnet` (CodeMasterLabs) exists with code;
  `@zaxcoraider/agentguard-mcp` resolves on the npm registry (latest 0.1.1).
- **Claw Guard**: `clawguard-demo.near` exists with code on mainnet; `clawguard.testnet` does **not**
  exist (UNKNOWN_ACCOUNT) — the testnet ids in the README are not the deployed ones.
- **Jurat**: `juratapp.near` exists on mainnet; `EPSQKGKG…` SUCCESS signed by `juratapp.near`.
- **Undiluted**: `anchor.undiluted-dev.testnet` and `distribution.undiluted-dev.testnet` both exist
  with code.
- **SwarmShop**: `swarmshop.testnet` and `v2.swarmshop-mw7wjo67.testnet` both exist with code;
  `https://swarmshop.onrender.com` returned no response (curl 000).
- **TEE Receipts**: `tee-receipts-chamdom.testnet` exists with code.
- **Co-op**: `coop.coop-alpha.testnet` exists with code; `credits`, `gpu-hours` and `dataset-seats`
  sub-accounts exist.
- **KeyLease**: `keylease.keylease-spike-3298edc1.testnet` exists with code.
- **near-threshold-guardian**: `exocognosis.testnet` exists but **has no deployed code**
  (`code_hash = 1111…`), so its contract deployment is NOT VERIFIED.
- **HiveBid**: `hivebid-yksunder.testnet` exists with code (dropped from the 18 but measured).
- **NEXUS AiOS**: `nexus-escrow.yksunder.testnet` exists with code (dropped).
- **Flock** (repo only, not a submission): `market.flock-live.testnet` and
  `hours.flock-live.testnet` exist with code.
- **Parallax** (repo only, not a submission): `bank.useparallax.near` exists with code on mainnet;
  `AcjLwfnb…` signed by `cfo.useparallax.near`, `Hvc9wkq6…` signed by `house.useparallax.near`, both
  to the bank.
- **Banbo** (repo only, not a submission): `vault.banbo-mia.testnet` exists with code; `5L4qWeSv…`
  and `5m3AGeim…` SUCCESS, signer `banbo-agent-mia.testnet`, receiver the vault.
- **Midge** (repo only, not a submission): `c.fly-1793636729.testnet` exists with code.
- **Laurel** (not in my tracks): `laurel.laurel-team-mw0x0c8g.testnet` exists with code.
- **Live URLs probed**: `sentinel.agentguard.app` 200, `agentguard.app` 200, `useparallax.xyz` 200
  (not a submission), `readback-production…railway.app` 200, `mhiah.github.io/Banbo` 200 (not a
  submission), `soldanoandrea.github.io/allowance` 200, `sealed-ledger.vercel.app` 200,
  `laurel-near.vercel.app` 200, `antibody-near.vercel.app` 200, `near-leash.vercel.app` 200
  (Mattbusel's Leash), `near-tollgate.vercel.app/v1/quakes` **402** (correct — it is the paid
  endpoint), `swarmshop.onrender.com` **000**, `nearcarta.vercel.app` 200.

Not verified, and marked as such above: Allowance's testnet accounts (no id survived extraction from
the README in a form that resolves on RPC); Skyll's NEAR contribution beyond a NEAR AI Cloud API call;
Antibody's mainnet status (it advertises `practice.antibody.testnet`, which exists with code, and no
mainnet id).
