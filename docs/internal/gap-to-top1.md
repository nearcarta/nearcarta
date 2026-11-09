# Gap to top-1: what would actually make this win its tracks

Internal. Written 2026-11-09. Every claim below is either backed by a command whose output is quoted,
a file with a line reference, or marked **NOT VERIFIED**. Nothing here is estimated favourably.

Verification baseline: `main` at the start of this review, `npm test` 893 (892 pass, 1 skip),
`npm run verify:mainnet` 106/106 found, `npm run check-cited` MISSES: none,
`cargo +1.95.0 test --lib` in `contracts/oath` 122 passed,
`cargo +1.86.0 test --lib` in `contracts/charter_board` 36 passed (README says 30, AGENTS.md says 15).

---

## Headline

The engineering is real and it is the strongest in the field. The problem is not code volume, it is
that **four of the claims a judge is most likely to check are false as written, and one flagship
action is provably broken on the day of judging.** A judge who checks carefully will find that the
project over-claims in exactly the two places it also happens to be strongest. That is the single
biggest risk to a top-1 finish, and it is cheap to fix.

Concretely, at the time of writing:

| Claim in a judge-facing doc | What the chain says | Where |
|---|---|---|
| "Post job from the visitor's own row landed on mainnet: 0.001 NEAR in escrow" | The tx `51UktPvy…` labelled `hall_post_job_from_city_row` is a **`bid`** call that **failed** `below_min_amount` | README:43; `shared/deployments/mainnet.json`; RPC |
| "The toll was upgraded in place to v8" | The recorded tx `CZEM7KEj…` is a **Failure: WebAssembly trap** | README:146; RPC |
| "The live board wasm has … no upgrade method" | The deployed board has `stage_upgrade`, `upgrade`, and a staged upgrade pending | README:49 vs `node /tmp/probe-board.mjs` |
| "The guard contract is not deployed yet" | `guard.nearcarta.near` is deployed (0.35 NEAR, code `GutWQgG…`) and has answered `pay` on mainnet | README:205 vs RPC + `9qxsoyA8…` |

Two of those four (`51UktPvy…`, `CZEM7KEj…`) are recorded **in the proof file itself** as failures —
`judges/proofs/mainnet-proof-check.json` has `failure: true` on 7 of 106 rows — while the README text
around them reads as success. `npm run verify:mainnet` cannot catch this: it checks that a hash
**exists**, not that it did what its label says (`backend/src/mainnet-verify.js` `checkTx` returns
`found` and a separate `failure` boolean that nothing asserts on).

Fix the four rows above and the honesty problem largely disappears. Then the remaining gap is
product shape, not engineering.

---

## A. The judge's five minutes

An AI judge following `nearhackathon.com` will: read the README, run what it says, click the live URL,
pick tracks. Below is what actually happens, in order, with the friction.

**Minute 1 — README top.** The judge sees a badge saying `backend unit tests-467 pass, 3 skipped`
(line 4). The "Do this, see that" table (line 61) says `# pass 892`. Line 77 says `893 … (892 pass, 1
skipped)`. Line 94 says `470 (467 pass, 3 skipped)`. Line 327 says `893`. The real number is **893
tests, 892 pass, 1 skipped**. AGENTS.md line 7 says **376 pass**, and line 12 says **54/54** proofs
where every other doc says 106/106. Five different counts for one fact (376, 467, 470, 892, 893), in
the first two screens. That is the first confidence hit, and it costs nothing to fix.

**Minute 2 — `npm ci && npm test`.** Works. 893/892/1, ~37–67 s depending on machine. Passes the stated
`# pass 892`. One inconsistency: the skip is described as "1 skipped e2e that would sign a real tx", but
the skipped test is a *unit* test: `ok 538 - real payout: the auditor opening matches the commitment on
chain # SKIP set MIST_AUDITOR_FILE (auditor only)`. Nothing here would sign anything. A judge who greps
for the skip will see the description does not match the test.

**Minute 3 — `npm run verify:mainnet`.** Prints `106/106 mainnet txs found` in ~2 s. Good. But the
output labels are `FOUND`, and two of them are failures labelled as wins (see table above). A judge
who clicks `51UktPvy…` from the README and sees `below_min_amount` will conclude the project
fabricates proof. This is the highest-severity item in the whole review **because it is the exact
thing the README invites them to do**.

**Minute 4 — `npm run check-cited` and `cargo test`.** Both pass (`MISSES: none`; 122 passed). This is
genuinely unusual and it earns real credit. `cargo +1.95.0` requires the `+1.95.0` pin — a judge on a
default toolchain who drops it gets a build failure that reads like broken code.

**Minute 5 — the URL.** `https://nearcarta.vercel.app` returns 200 in ~140 ms and shows a 3D town with
a robot and a wizard, `All shops`, `Sign in`, a `For judges` menu (Proofs / Ledger / Check / README),
and a live chronicle strip with three real tx hashes. This is the strongest single moment in the
submission and it lands in the first screen. `/setup` is clean: `STEP 1 OF 7 · SIGN IN`, mainnet, no
faucet. `/console` and `/ledger` both load.

**Where they get stuck:**

1. **Nothing executes without money.** Every gold button that moves value needs a row opened with a
   0.02 NEAR deposit in `/setup`, which needs a funded mainnet account. The README says "Two of these
   need a row … which `/setup` opens in one wallet approval" (line 71), but a judge with no NEAR
   stops at step 7. There is no funded demo path and no read-only replay of a full action.
2. **`/console` contradicts the README.** The console page says a payment "is at most 0.20 USD"
   (`app/src/console.html`, live at `nearcarta.vercel.app/console`). README line 49 says "There is no
   product USD cap." A judge who reads both believes one of them is stale.
3. **`/api/board/simulate` returns `ok: null`.** The board's own note says a free `simulate` view is in
   the staged build; the live board does not have it. `curl` returns
   `{"ok":null,"note":"This board build has no simulate view; a real send is the only check."}`. That
   message is admirably honest and also a direct admission that an agent cannot plan without spending.
4. **The board upgrade has not landed.** On-chain code hash is `BF1rQSrG…`; the staged build is
   `CM6WA2gZ…` with `eta_utc: 2026-11-09 16:29`. Until it lands, `anchor` panics `ERR_NO_CHARTER`
   (measured: `GaVEzhfw…`), and the per-action hold cannot fit a 0.03 NEAR row, so **Toll crossings and
   Town Hall `post_job` are refused `ERR_DEPOSIT`**. Measured: `3sAWZghN…` → `ERR_DEPOSIT`.
   This is a *timing* problem, not a design problem — but if the judge arrives before 16:29 UTC on
   Nov 9, or the owner's `upgrade` fails, two tracks' headline actions do not work.
5. **`render.yaml` sets `NEAR_RPC` to `https://test.rpc.fastnear.com`.** The Dockerfile overrides it to
   mainnet, so the live service is fine today. But a judge who reads `render.yaml` sees a testnet RPC in
   a mainnet submission, and any redeploy from the blueprint (not the image) would point the API at
   testnet. Replace with `https://free.rpc.fastnear.com` and delete the ambiguity.
6. **Root directory clutter.** Tracked: `shot-tmp.mjs`, `shot2..6.mjs`, `csp.mjs`, `tmp-repro.mjs`,
   `judges_review/MAINNET_PLAN.md`, `judges_review/PUBLIC_FLIP_CHECKLIST.md`. Untracked but present:
   `ar.tmp.mjs`, `ar2..ar7.tmp.mjs`, `measure-shops.tmp.mjs`. For a public repo this reads as a working
   directory, not a submission.
7. **`docs/internal/` is public and contains the competition analysis** (44 tracked files, including
   `competitor-field-2026-11-08.md` with named rivals and their weaknesses, and `judge-plan.md` scoring
   our own shops 2.5–4.5/10). A judge who finds it will read an internal doc that says "not competitive
   in the other six tracks". That is honest, and it is also the most damaging page in the repo.

---

## B. Gap analysis against each track brief

Briefs read from `/tmp/hex/tracks/`. Quotations are verbatim. MET / PARTIAL / NOT MET is against the
brief, not against what we chose to build.

### 01-deﬁ (Unstoppable DeFi)

> "Build [a cross-chain DCA vault]. A user deposits USDC from any chain NEAR Intents supports, picks a
> target asset (BTC, ETH or NEAR) and a schedule. On each interval the app requests a quote from the
> 1Click API, rejects it if slippage beats the user's limit, and executes the swap…"

| Requirement | Status | Evidence |
|---|---|---|
| Deposit USDC from any Intents chain | **MET** | Live quote `USDC@base → USDC@near` works: `{"ok":true,… "amountOut":"9.99808","checks":{"signature":true,"echo":{"ok":true},"dry":true}}`. Recorded swap `HzgUr618…` |
| Pick a target asset (BTC/ETH/NEAR) | **MET** | `app/src/ferry-catalog.js` `tokenChoices` + live `/api/ferry/tokens` |
| **A schedule / DCA interval** | **NOT MET** | No scheduler, no interval loop, no persistence of a plan. `rg "dca\|recurring\|schedule"` over `app/src backend/src shared` finds only `slippageBps` and unrelated hits. There is no "3 buys every 10 minutes" anywhere. |
| Reject if slippage beats the user's limit | **PARTIAL** | `slippageBps` is sent to 1Click (`backend/src/ferry.js` `buildQuoteRequest`), and `quoteView` shows quotes. There is **no user-set limit compared against the delivered quote with a named rejection** in the UI. |
| Handle REFUNDED and FAILED, show in UI | **MET** | `app/src/ferry-catalog.js` lines 116–122 (`REFUNDED`, `FAILED`, `INCOMPLETE_DEPOSIT`, `REFUND`/`DONE` sets); `backend/src/ferry.js` 178–179 |
| Show where funds sit at every step | **PARTIAL** | Quote → deposit address → 1Click status → `SUCCESS`. But "where funds sit" mid-flight is a status string, not a balance view |
| Small web UI: deposit, schedule, history | **PARTIAL** | `deposit` and `history` exist (`/ferry-widget`, chronicle feed). **`schedule` does not exist** |
| Dry-run mode with real quotes, no funds | **MET (strong)** | `/api/ferry/quote` is `dry:true`, signature verified, echo-guarded. Verified live |
| Stretch: NEAR contract owns the vault + Chain Signatures to a BTC address | **NOT MET** | No vault contract. Chain signatures exist in `contracts/toll` for Base only (`require!(chain_id == 8453 \|\| 84532)`, `contracts/toll/src/lib.rs:76`) |

**Biggest missing thing: the vault.** We shipped a swap *route*, not a *vault*. The brief's noun is
"a cross-chain DCA vault" and every acceptance sentence in it is about a schedule that persists and
fires unattended. We have no object that holds a user's USDC between intervals, no schedule, and no
recurrence. A judge comparing brief-to-build sees "cross-chain swap page". That is a different product.

**Second: "rejects it if slippage beats the user's limit" is the only *policy* sentence in the brief,
and it is the one thing a DeFi judge can verify in ten seconds.** We should have a visible number:
quote 1.42%, your limit 1.00%, refused, here is both.

### 06-security (AI Security & Defense)

> "Build [a counterparty check for agents that pay]… The service returns allow, warn or block, plus the
> reasons."

| Requirement | Status | Evidence |
|---|---|---|
| Returns allow / warn / block with reasons | **PARTIAL** | `GET /api/guardhouse/check/:account` returns all three; verified `block` for `attacker.r10own-19371.near` (`account_missing` + `denylisted`), `warn` for fresh accounts. **But every ordinary account returns `warn`** — `nearcarta.near`, `townhall.nearcarta.near`, `wrap.near` all `warn`. No path produces `allow` except an already-allowlisted payee, and `age_unknown` fires for any account whose tx index misses |
| Signals: account age and activity | **PARTIAL** | `age_ms` present for `wrap.near` (22.2e9 s) but `null` for `nearcarta.near` and `townhall.nearcarta.near` → `age_unknown`. The index coverage is inconsistent, and the verdict degrades to `warn` instead of saying "unknown" |
| Whether receiver is a contract, code changed recently | **PARTIAL** | `is_contract` correct (`board.nearcarta.near` true, `evil.near` false); `code_hash` present. `code_changed_ms` is a field but no live case shows it firing |
| Prior interactions between agent and receiver | **MET** | `prior_payments` in signals |
| Shared blocklist with evidence | **MET** | `/api/guardhouse/denylist` returns one entry with two mainnet evidence txs |
| **Agent-side wrapper that refuses to sign on block, asks a human on warn** | **PARTIAL** | The hold/confirm logic is modelled on the board (`confirm_hold`, `cancel_hold`, proven by `9qxsoyA8…` and `GWnPvGBc…`). But the deployed `guard.nearcarta.near` has **only `pay`**: probing shows `confirm` ABSENT, `cancel` ABSENT, `report` ABSENT, `pay_guarded` ABSENT. `contracts/guard/src/lib.rs` is 199 lines of a plain forwarder with no verdict concept |
| Function-call key scoped to one contract, never full-access; explain limits | **MET (strong)** | Board rows hold a scoped session key (`Gr4EK9gN…`); `docs/` and README explain the limits; the refusal `E7KMexjS…` is a real off-list refusal |
| **Attack demo: injected agent tries a bad address and is stopped, show the log** | **MET (script) / PARTIAL (product)** | `npm run attack-demo` prints three real refusals (`8df5Zu8U…`, `9qxsoyA8…`, `GWnPvGBc…`). It is not reachable from the city UI as a one-click "watch the attack" |

**Biggest missing thing: an `allow` verdict that means something.** A firewalls that says `warn` for
everyone is not a firewall; it is a rubber stamp that always asks a human. The Security brief's whole
premise is that the agent's own code cannot be trusted and the check must *decide*. We should have one
account that comes back `allow` with named positive signals (age known, verified contract, prior
successful payment, on the row's list) and one that comes back `block`. Right now `block` only fires
for a denylisted/nonexistent account — the easy case.

**Second: the deployed guard is not the guard the docs describe.** The README says the guard contract
"is not deployed yet"; it is deployed, and it is a forwarder. The `guard` crate has no TEE verifier.
This is the one place where the *strongest track* (Security) is weaker than the docs imply.

### 07-agents (Agent Economy)

> "Build [a general contractor agent]. I give it a task and a budget. It breaks the task into parts,
> decides which parts to do itself and which to buy, hires other agents or pays for data to get them
> done, checks the work, and pays out. Everything it spends stays inside my budget."

| Requirement | Status | Evidence |
|---|---|---|
| Task + budget, splits into parts | **MET** | `contracts/hall/src/lib.rs` `post_job(row_owner, task, parts, deadline, workers, idempotency)`; live job 1 reads `{"task":"smoke","budget":"…","remaining":"0","paid":"0","refunded":"…"}` |
| Counters once, then accepts or walks | **MET (contract)** | `counter()` in `contracts/hall`; unit `a job conserves escrow, counters once` |
| **Hires other agents / real Market** | **NOT MET** | `docs/internal/final-plan.md` and README: "Market hire is not available". `shared/hall/plan.js` `MARKET_HIRE_GAP`. A public `GET /v1/agents` read may work; the hire call does not |
| Payments in USDC or NEAR | **PARTIAL** | NEAR escrow works (smoke `post_job` `DTqpzuh…` returned job 1, refund `JC9ojuN…`). USDC payroll exists in `backend/src/payouts-payroll.js` but not through Hall |
| Receipt per task: what, from whom, price, passed | **MET** | `get_job` returns per-part records; `contracts/hall` `review()` binds deliverable digest |
| Everything inside my budget | **MET (contract)** | Escrow conservation asserted in unit tests; refund path proven |
| **The end-to-end loop a judge can run** | **NOT MET** | `post_job` from a visitor row is refused `ERR_DEPOSIT` on the live board (`3sAWZghN…`) until the staged upgrade lands. The tx cited as proof, `51UktPvy…`, is a failed `bid` |

**Biggest missing thing: a second real agent.** The brief is about hiring *other* agents. Hall is a
single-poster escrow with hand-typed worker account ids. There is no discovery, no bidding from an
independent party, no real second agent in the loop. The `counter once` and `review` machinery is
well-built and it is being exercised entirely by the same person on both sides.

**Second: the honest failure is in a doc, not in the UI.** "Market hire is not available" is in the
README, which is right, but a judge clicking *Post job* gets `ERR_DEPOSIT` with no explanation of why
and no pointer to the pending upgrade.

### 03-privacy (Privacy & Private AI)

> "Build [a private expense auditor]… proves the analysis ran inside a TEE… Keep nothing server-side
> after a response returns… Ship fictional sample documents so judges can run it without real data."

| Requirement | Status | Evidence |
|---|---|---|
| NEAR AI Cloud, OpenAI-compatible, TEE model | **MET (strong)** | `GET /api/ai/tee` live returns `{"gateway":{"ok":true,"checks":{"quote":true,"debugOff":true,"signerBound":true,"nonceBound":true,"echoedNonce":true,"configBound":true,"rtmr3":true,"composeEvent":true}},"tcbStatus":"UpToDate","model":"z-ai/glm-5.3-flash"}`. This is the best single artifact in the repo |
| Attestation with a **fresh random nonce**, verified per the docs, "Verified" panel | **MET (strong)** | Fresh nonce each call (`41f733a7…` vs `56bce13f…` seconds apart); browser checks the signature by the reported algorithm (`app/src/panels/bank-audit.js`; unit `an ecdsa receipt is recovered in the browser…`) |
| **Keep nothing server-side** | **PARTIAL** | `retention` string on `/api/bank/proof` says request/response bytes are not stored; `backend/src/tee.js` has no store. But there is no test that asserts *logs* never contain statement text, which is the brief's actual bar ("make it obvious in the code") |
| Fictional samples, runnable with no data | **MET** | Three samples; sample audit is browser-side; no wallet needed |
| **The auditor actually finds waste** | **PARTIAL** | Sample flow works (`3 lines · 3 counted`, `cafe.near, 0.01 NEAR. It appears twice in November`). The *model* path is capped at 160 tokens and $0.05/day, and `calls_today: 5` — a judge running several audits will hit the cap with no explanation in the UI |

**Biggest missing thing: a reason to believe the model, not just the enclave.** The TEE proof is
excellent. But the brief asks for a *useful* private auditor, and ours proves provenance of an analysis
whose quality is untested. There is no eval, no labelled expected output, no "here is what it should
have said and here is what it said". Add one sample with a known answer and a test that the model finds
it. That converts "attested" into "correct and attested", which is a much stronger claim.

### 08-realworld (Real-World Money)

> "Build [crypto invoicing for freelancers who don't care about crypto]… The freelancer receives USDC on
> NEAR and never buys NEAR for gas."

| Requirement | Status | Evidence |
|---|---|---|
| Invoice with amount, due date, line items, pay button | **PARTIAL** | `POST /api/payouts/invoices` works live (`inv_f275e4fb…`). `usd`, `receive`, `memo`, `due`, `expiry` exist; **line items do not** |
| Payment through 1Click | **MET** | `backend/src/ferry-checkout.js` `openCheckout`, `EXACT_OUTPUT`, real 1Click quotes |
| **Gasless via meta-transaction relayer** | **NOT MET** | No NEP-366 / `SignedDelegate` anywhere in the repo (`rg` finds only comments). `/api/toll/relay` is a *foreign* broadcast relay, not a NEP-366 relayer |
| Status paid / pending / refunded with tx links | **MET** | `app/src/ferry-catalog.js` status map; `invoiceDelivered` only on `SUCCESS` |
| CSV an accountant could open | **MET** | `source,destination,asset,amount,fee,refund,status,tx` (README:267) |
| **"Never buys NEAR for gas" (the core sentence)** | **PARTIAL** | There is a `sponsorshipPlan` and `PAYOUTS_SPONSOR_STORAGE` flag, but the README is explicit that this "does not claim a funded storage sponsor". A zero-NEAR account still needs NEP-141 `storage_deposit` |
| **Invoice durability** | **NOT MET** | Invoices live in `MEMORY` + an optional file (`backend/src/payouts-invoice.js` lines 34–38). Render's filesystem is ephemeral; the API itself returns `"durability":"…A new host starts empty. This is not a chain record."` A freelancer's invoice link dies on redeploy |

**Biggest missing thing: durability + line items.** For "a normal company could use tomorrow", an
invoice that disappears on deploy is disqualifying, and the brief explicitly asks for line items. Put
the invoice in contract state (or at minimum a durable store with a chain anchor) and add items. This
is the cheapest track to *win* because the bar is "boring and correct", and we are one storage decision
away from it.

### 04-business (Autonomous Business)

> "Build [a one-agent research shop]… Customers pay in whatever token they hold through NEAR Intents,
> the agent buys its own inference from NEAR AI Cloud, and a fixed share of every sale goes to a
> contributors' account automatically. I set the rules in one config file…"

| Requirement | Status | Evidence |
|---|---|---|
| Agent has its own NEAR account | **MET** | `toll.nearcarta.near`, `townhall.nearcarta.near` etc. |
| Never store a full-access key; scoped key or custody | **PARTIAL** | `toll` has 0 full-access keys. **`townhall.nearcarta.near` still has `full_access_keys: 1`** (`shared/deployments/mainnet.json` `extras.townhall`), with a teardown note naming the key file. That is a direct contradiction of the brief and of our own "served accounts have 0 full-access keys" line |
| Public ledger of sale, cost, payout | **PARTIAL** | `/ledger` page exists; Chronicle lists rows. Toll P&L: `fee == cost == 1e21`, `splits: []`, `surplus: 0` → **no revenue, no split, nothing to publish** |
| **Min price / max inference per day / revenue split % / kill switch** | **PARTIAL** | `set_price` has `fee/cost/splits/paused`. Live: `paused:false`, `splits:[]`, `fee == cost`. The kill switch exists (`freeze`/`paused`), the split does not, and nothing is earned |
| Demo: one full loop sale → payout under 2 minutes | **NOT MET** | Requires a Toll crossing, which is refused `ERR_DEPOSIT` on the live board |
| **A real sale** | **NOT MET** | There is no customer, no price paid above cost, no payout to a contributor. `service_held: 1e21` is a held fee, not revenue |

**Biggest missing thing: a sale with a margin.** The Business brief is the one place where "who gets
the money and why" has a factual answer, and ours is "nobody, fee equals cost". Set `fee > cost`, set
one `split` to a real account, and record one crossing that produces a positive `surplus`. That single
change turns Toll from "a payment gate" into "a business with a P&L", which is the entire track.

**Second: remove the full-access key on Hall.** It is one line in the teardown plan and it is the most
checkable requirement in the brief.

### 10-nfts (NFTs That Do Something)

Note: we did **not** select this track (README `## Tracks` lists 8, not nfts). The analysis is included
because the brief is the closest external description of Your House and a judge may select it for us.

> "Build [a membership NFT that carries its own wallet]. Each NFT maps to a sub-account that holds a
> share of the club treasury… Explain in the README exactly how control passes on transfer and what
> stops the old owner."

| Requirement | Status | Evidence |
|---|---|---|
| NEP-171 + logic tying token to a sub-account | **PARTIAL** | `contracts/house_nft` is NEP-171 (`mint_deed`, `nft_transfer`, `nft_token`). There is **no sub-account**: `rg "create_account\|subaccount"` in `house_nft` returns nothing. The "wallet" is a purse in contract state plus a derived MPC path |
| **Explain how control passes / what stops old owner** | **MET (strong)** | README §"What a deed is, and what moves when it is sold" is the best-written section in the repo; three named tests (`the_deed_moves_with_its_purse_and_the_old_holder_loses_control`, `the_new_holder_can_spend_the_purse_immediately`, `a_stranger_cannot_take_the_deed`) |
| Gated page only current holders can open | **MET** | `/deed/<token>`, `app/src/deed-gate.js`; test `the deed page opens only for the current holder, decided from the chain` |
| History per NFT: earned, paid out, who held it | **PARTIAL** | `/api/house/history/<id>`; README admits the id ≠ owner after resale |
| Tests for transfer, including sale mid-payout | **PARTIAL** | Transfer tests exist. A "sale in the middle of a payout" test: **NOT VERIFIED** as existing |
| **Real money in the wallet on another chain** | **NOT MET** | `live: false`. Base/BTC receipts: "not sent" (README:255). The deed's purse is NEAR only |

**Biggest missing thing: the foreign address.** The brief's "NFT as account" and our Open-track pitch
both hinge on the deed controlling an address on another chain. That has never happened. `address_of`
on toll returns `{"path":"row:nearcarta.near:base","address":null}` — a path, never a signature. Until
one Base tx is signed by a deed-derived path, "the NFT is an account on another chain" is a design, not
a fact.

### 13-open (Open Innovation)

> "Build [an inheritance account]… One NEAR account controls the owner's addresses on Bitcoin and
> Ethereum through Chain Signatures. The owner checks in on a schedule. If they miss check-ins for
> [90] days, a set of guardians can approve releasing the assets to named heirs…"

| Requirement | Status | Evidence |
|---|---|---|
| Contract controls BTC **and** ETH addresses via Chain Signatures | **NOT MET** | Toll is Base-only (`chain_id == 8453`), path is `row:{owner}:base`. No BTC, no ETH mainnet |
| Owner checks in on a schedule | **MET** | `house_check_in`, `house_session_check_in`; live `house_line` shows `last_check_in_ns: 1794185722021044700`, `period_ns: 86400000000000` |
| Missed check-ins → guardians approve release | **MET (contract)** | `house_guardian_approve`, `house_release`, threshold/approvals in `house_line` |
| Owner can cancel until the wait ends | **MET (contract)** | `house_cancel_release`; unit tests |
| **Release rules readable by anyone** | **MET** | `house_line` is a public view |
| Demo with timers shortened to minutes | **PARTIAL** | `wait_ns: 3600000000000` (1 h), `period_ns: 86400000000000` (24 h). No shortened demo timer and **no release tx has ever been sent** |
| README on failure cases: lost guardian keys, hostile guardian, owner offline | **PARTIAL** | `docs/internal/final-plan.md` §house lists the cases; README:255 does not |

**Biggest missing thing: one completed inheritance.** Every contract method exists, is tested, and has
never been run end to end on mainnet. The Open track is judged on "something we haven't seen"; a
working 2-minute release to an heir, with the heir then spending from the same derived address, is the
demo. We have the code and none of the receipts.

---

## C. Story and pitch

**Our pitch, as a judge would repeat it:** "It's a 3D town where every shop is a real mainnet dApp, and
one on-chain charter caps what an AI agent can spend in all of them."

**Is it memorable?** Partly. Two of the three nouns are strong and one fights the other. "3D town" is
the thing they will describe to another judge ("the one with the town"). "On-chain charter that caps
the agent" is the thing that wins Security. But "every shop is a mainnet dApp" makes a judge ask "why
is a town hall a dApp", and nine shops in eight tracks reads as breadth rather than depth. The pitch
also buries the strongest fact: **the agent has no key that can move money outside the rules, and a
refusal is a transaction you can open.** That is the sentence a Security judge remembers.

### Three alternative one-liners

1. **"Every AI payment in this town is a legal opinion you can open on nearblocks: the charter allows
   it, refuses it with a reason, or holds it for a human."**
   — leads with the differentiator (refusal is on chain), not the setting.

2. **"Give your agent a wallet it cannot misuse: one NEAR row caps every shop, and the agent holds a
   key that can only ask."**
   — the Security/Business framing; "can only ask" is the whole product in three words.

3. **"A town where the shops are real, the agent pays, and a contract — not a prompt — says no."**
   — shortest; keeps the town, keeps the enforcement, and the contrast in the last clause is the hook.

### The 80-word pitch (usable verbatim)

> Nearcarta gives an AI agent money without giving it the keys. A visitor opens one row on a NEAR
> contract and writes the rules: who the agent may pay, how much per payment, how much per day. The
> agent holds a key that can only *ask*. Every ask is checked on chain and either paid, refused with a
> reason, or held for the human. The 3D town is how you see it: nine real shops, one charter, and every
> decision is a transaction.

(79 words. Says what it is, what is novel, what the judge can verify, and what the town is *for* — which
the current pitch never does.)

---

## D. What a sharp competitor would do that we are not doing

Taken from our own field measurement (`docs/internal/competitor-field-2026-11-08.md`, 308–335 projects)
and from the briefs. For each: S/M/L difficulty for us, and whether it needs money.

1. **Ship a `simulate` view on the charter and put it on the landing page.** `soldanoandrea/allowance`
   already ships this and our own staged note calls it out as taken from them. A judge types a payment
   and gets `allow / needs-approval / block` + reason, with **no wallet and no funds**. Ours returns
   `ok:null` live. *S (the code exists in the staged build; it needs the upgrade to land + the landing
   page wired). Needs no money.* This is the single highest-leverage competitor gap because it fixes
   the "nothing works without funding" problem in section A.

2. **Make the refusal the hero of the demo, not the payment.** A 20-second clip: agent asked to pay
   `evil.near`, `receiver_not_allowlisted`, tx link, red seal. Every rival demos a *successful* swap
   because their enforcement is off-chain and cannot show a refusal. *S. No money.* We already have the
   txs (`E7KMexjS…`, `CcPMX1Dt…`); they are buried in a README table.

3. **Put the attack demo in the city as one button.** `CareRail` and `LeashPay` both name an attack
   demo; ours exists only as `npm run attack-demo`. A `For judges → Watch an attack` tile that plays
   the three refusals with live links beats a CLI. *M. No money* (reads recorded txs).

4. **A real sale with a positive margin and one split on Toll.** Nobody else in Business has a live
   P&L. `fee > cost`, `splits: [{account, bps}]`, one crossing, `surplus > 0`, Chronicle renders it.
   *M. Needs NEAR* (one crossing of ~0.005 NEAR fee + Base gas; the visitor row pays).

5. **A second real agent in Hall.** The Agents brief is "hire *other* agents". A rival that lists two
   independent workers who bid against each other and get paid on a digest wins the track on shape.
   *L. Needs NEAR* (two rows, two escrows) and either the Market API or a second self-hosted agent.

6. **Durability: put the invoice in contract state.** Veridom Pay already verifies a TEE signature on
   chain. Our invoice dies on redeploy and we say so. A 40-line invoice registry contract (or a board
   `anchor`-backed record) makes "a company could use this tomorrow" true. *M. Needs NEAR for the
   deploy (or zero if added to the staged board).*

7. **Line items on invoices.** The brief names them; every rival invoicing page has them. *S. No money.*

8. **A slippage rejection with both numbers on screen.** The one policy sentence in the DeFi brief:
   quote 1.42% vs limit 1.00%, refused. *S. No money.*

9. **A DCA schedule that actually persists.** Even a 3-interval schedule on a 30-second demo timer,
   clearly labelled, with the row cap as the budget. Turns "swap page" into "vault". *L. Needs NEAR for
   live intervals; a sandbox/dry version needs none.*

10. **One Chain-Signature transaction from a derived address.** `Kain`-signal projects and every
    serious rival claim a contract controlling a foreign wallet. `address_of` returns `null` for every
    row. One Base tx signed by `row:*:base` and linked to basescan would put us ahead of the entire
    field on the single most-cited primitive. *M. Needs money* (Base gas at the derived address).

11. **Kill the agent key at the protocol level.** `allowance` deletes the function-call key so the
    *network* refuses; we freeze at contract level. A "Revoke my agent" gold button that calls
    `DeleteKey` is a visible, protocol-level answer to "what if I don't trust it". *S/M. No money.*

12. **A public, one-page "what is proven / what is not" table with counts.** Judges reward honesty when
    it is structured. Right now the honest limits are scattered across 360 lines of README and one
    internal doc. A single table (13 rows: claim, evidence, status) would make the four false claims in
    the headline impossible to ship. *S. No money.*

---

## E. Top 5 things to do before submission

Ranked by expected effect on winning. Each names the exact file or command.

**1. Fix the four false/misleading claims, and make the verifier assert outcomes.**
Effect: removes the only failure mode that can lose a track outright (a judge who catches a fabricated
proof stops reading).
- `README.md:43` — the "Post job … landed on mainnet: 0.001 NEAR in escrow" row. Either cite the real
  `post_job` (`DTqpzuhNs5bSDoiSEQP4eAHizCNFHN7wcZcWpzRqAhjZ`, smoke, job 1, **not** from a visitor row)
  with that exact wording, or say plainly: "the visitor Post job is refused `ERR_DEPOSIT` until the
  staged board upgrade lands; the smoke post on the Hall's own account is `DTqpzuh…`."
- `shared/deployments/mainnet.json` — rename the key `hall_post_job_from_city_row` (it is a failed
  `bid`) and `toll_v8_upgrade_migrate` (it is a wasm trap). Then `README.md:146`.
- `README.md:49` — delete "no upgrade method"; the deployed board has `stage_upgrade`/`upgrade`.
- `README.md:205` — delete "the guard contract is not deployed yet"; it is deployed. Say what it
  actually is: "a keyless forwarder with no verdict logic; the verdict is computed server-side."
- `backend/src/mainnet-verify.js` — add an `expect` field per proof row (`success` / `failure`) and exit
  non-zero when the on-chain status contradicts it. Then the claim cannot regress.
- `README.md:4`, `AGENTS.md:7,12` — one test count, generated by `npm run readme-numbers`.

**2. Get the staged board upgrade on chain, or say loudly that it is pending.**
Effect: unblocks Toll crossings and Town Hall `post_job` — two tracks' headline actions.
- Owner-only, cannot be done from this repo: `upgrade` with the `CM6WA2gZ…` code after
  `2026-11-09 16:29 UTC` (`shared/deployments/mainnet.json` `board.upgrade_staged`). **Needs the owner.**
- If it slips: put a dated banner in README and in the Toll/Town Hall trays that names the refused tx
  and the ETA. Do not let a judge discover `ERR_DEPOSIT` alone.

**3. Make the product verifiable without funds.**
Effect: converts the five-minute judge from "read-only tourist" into "person who saw it decide".
- Owner-gated by the board upgrade: `simulate` (already written, `contracts/charter_board/src/v2.rs`),
  surfaced at `POST /api/board/simulate` (`backend/src/app.js:735`, already returns the honest
  `ok:null` today).
- Wire the `/console` page (`app/src/console.html`, `app/src/console.js`) to lead with: type a payee →
  `allow / hold / block` + reason, then the matching recorded tx. No wallet.
- Fix `app/src/console.html` "at most 0.20 USD" to match README:49.

**4. Turn one track from "proven parts" into "proven loop".**
Effect: a top-1 needs at least one track where a judge can say "I saw the whole thing work".
Pick **Real-World Money**, because it is the least crowded and the bar is "boring and correct":
- `backend/src/payouts-invoice.js` — line items + durable storage (contract state or anchored record).
  **Needs NEAR** for a deploy (or zero if added to the staged board).
- One full invoice paid end to end from a second browser with a 1Click `SUCCESS` and a basescan/Near
  receipt link in the CSV.
- Alternative if no funds: **Open** — one shortened-timer inheritance release on sandbox, recorded, with
  the heir's own send from the same derived path, clearly labelled sandbox. *No money; weaker.*

**5. Cut the surface a judge trips over.**
Effect: removes noise that reads as "not finished" and lets the real strength show.
- Delete or gitignore the working files in the repo root. **Tracked and needing a commit to remove:**
  `shot-tmp.mjs`, `shot2.mjs`–`shot6.mjs`, `csp.mjs`, `tmp-repro.mjs`, `judges_review/`.
  **Untracked but present:** `ar.tmp.mjs`–`ar7.tmp.mjs`, `measure-shops.tmp.mjs` (`git status`).
- `render.yaml:18` — `NEAR_RPC` from `https://test.rpc.fastnear.com` to `https://free.rpc.fastnear.com`.
- Move `docs/internal/` out of the public tree, or at minimum `competitor-field-2026-11-08.md` and
  `judge-plan.md` (named rivals + our own 2.5/10 self-scores). Verified safe: neither `README.md` nor
  `scripts/check-cited.mjs` references `docs/internal/`, so moving it breaks no link or check.
- README (359 lines): replace the wall with the pitch (section C), a one-page claims table with status,
  and the four commands. Move the per-shop detail to `docs/`.

---

## Appendix: the one-sentence finding

The repo is the best-engineered entry in its tracks and it undersells that by making four checkable
claims that are not true, while the single most persuasive artifact — a fresh NEAR AI attestation with
every check passing, and a refusal you can open on nearblocks — is buried on line 158 of a README that a
judge will not finish.
