# Nearcarta lead status report

Written 2026-11-09 17:39 Africa/Cairo (15:39 UTC). Branch `cursor/panel-system-b2d4`,
head `d57c0276`. PR #170.

This report separates three things that are easy to blur together:

- **mainnet** — a real transaction on `mainnet`, readable on nearblocks.
- **sandbox / unit** — a Rust sandbox or a Node unit test. Real assertions, **not mainnet**.
- **unproven** — I have no evidence, or the evidence proves refusal rather than success.

Every hash below was read from `shared/deployments/mainnet.json` and is re-checked by
`npm run verify:mainnet`, which currently reports **108/108 found**.

---

## 1. The one thing that is true across all nine shops

Two facts, measured on the deployed site rather than inferred:

| check | result | how |
|---|---|---|
| every shop renders, no page errors | **9/9 clean** | Playwright against `nearcarta.vercel.app/shops/<name>/`, collecting 4xx/5xx and `pageerror` |
| no panel scrolls at 1440×900 or 390×844 | **9/9** | `scrollHeight == clientHeight` on the tray |
| no sideways scroll | **9/9** | `scrollWidth <= clientWidth + 1` |
| no control under 36px | **9/9** | bounding boxes of every button/input |

That is the panel redesign, and it holds. What follows per shop is the harder question:
whether a **person pressing the gold button, or asking the agent, produces a real
transaction**.

Honest summary before the detail: **for six of the nine shops that is still unproven in my
own browser with my own wallet.** The proof txs that exist were produced by scripts and by
one recorded browser run on a *stale row*. Section 3 explains the single blocker behind most
of that, and it is not a code defect.

---

## 2. Per-shop evidence

Legend: **[MAINNET]** real chain transaction. **[SANDBOX]** Rust/contract sandbox.
**[UNIT]** Node unit test. **[UNPROVEN]** no acceptable evidence.

### Ferry

- Real tests run: city room opens, tray renders, corridor chips switch, compare list opens;
  quote path exercised against the live 1Click API. Browser + axe. No wallet signing.
- Mainnet: **none by me.** `shared/deployments/mainnet.json.ferry_intents` records a
  1Click/intents rail, and `ferry.verifier_mainnet` records a verifier deploy. [MAINNET,
  earlier work, not this session] A real swap I signed: **none**.
- Why no tx: the deployed API holds no NEAR key and `POST /api/ferry/checkout` only asks
  1Click for a deposit address **without signing or sending** (`backend/src/ferry-checkout.js`,
  capped at 0.20 USD). A completed swap needs a funded wallet in the browser.
- Unproven: **a real end-to-end swap**. Also: the standalone `/shops/ferry/` page has no
  agent input; the Ferry agent lives in the **city** tray (`ferry-agent-input` in
  `app/design/D8_shops/js/shopui.js`).
- Broken: nothing I found. Quotes are `dry:true` by design.

### Payouts

- Real tests run: all four tabs (Invoice / Payroll / CSV / Invoices), add-row, paste, export
  CSV, the 0.20 USD pre-check refusal, the empty-state lines. Browser + axe. No wallet.
- Mainnet: **none by me.** Payouts signs through the visitor's own row; there is no payouts
  contract and no proof tx in `mainnet.json`.
- Unproven: **a real paid payroll row.** Needs a row opened by the current `/setup` (see 3).
- Deliberate: `app/shops/payouts/main.js` passes `dock: false`, so the standalone page has no
  agent. The city tray does.

### Bank (Mist Bank)

- Real tests run: audit of the sample statement, file upload, paste, TEE attestation view,
  the `tee-field-*` rows, the refusal when the proposed cap is looser than the row's.
  Browser + axe.
- Mainnet: **none by me.** The bank is an auditor; it reads a statement and a TEE report and
  does not move money. `POST /api/bank/*` does not sign.
- Unproven: a TEE attestation whose hardware checks all pass. The third label reads
  `partial` — hardware checks passed, the browser signature step had nothing to verify. That
  is the honest system state, not a bug I introduced; assertions allow `attested|failed|partial`.
- Broken: nothing I found.

### Chronicle

- Real tests run: account field, empty-state refusal ("Type an account. Nothing was signed
  from this tray."), history render. Browser + axe.
- Mainnet: **none by me.** Chronicle is a reader over the board's history.
- Unproven: nothing money-shaped is promised here, so nothing is unproven beyond "the history
  it prints matches chain" — which it read live.
- Broken: nothing I found.

### Guard (Guardhouse)

- Real tests run: payee check against the live API (`/api/guardhouse/check/<account>`), the
  deny list, the TEE line, the empty-payee refusal, the example button, the model-backed
  agent (`runGuardAgentWithModel`). Browser + axe.
- Mainnet: **none by me.** `guard.deploy_tx CN3SKjNS7PRdvrNQsxRxQW45Ks2vChe3BDAHhehhxt65`
  and `guard.code_hash GutWQgGC7JuLiYq3Rf4HPn4yoD93aFYU19D5uWHZs2Fi` are [MAINNET, deploy,
  earlier work]. The guard contract is deployed; **the tray does not call it** — the check is
  a server-side read.
- Fixed this session: `/shops/guard/` mounted the tray with **no `injected` hook**, so the
  Example button could never fill the field, even signed in. Now derived from the saved
  session with the same `lookalike()` the city uses. Proved failing without the hook.
- Unproven: a guard-held payment confirmed on chain by me.

### Toll

- Real tests run: wallet pane, the derived Base address line, the price, the refusal path,
  cross-chain quote via 1Click. Browser + axe.
- Mainnet: `toll.txs.*` — 10 hashes including the paying and non-allowlisted pair
  `4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz` (allowlisted, paid) and
  `B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR` (not allowlisted, refused), plus
  `toll_v8_upgrade_migrate CZEM7KEjYNK59jVgq1UgdAk7R9kFyM1UHFUkZ3AuLVNY`. All [MAINNET,
  earlier work]. Note: the v8 upgrade tx's *internal* `migrate` trapped, though the code did
  land — corrected earlier today in five places.
- Fixed this session: the toll derived its Base address and **threw the answer away**. The
  Wallet pane now prints it. Verified in production.
- Unproven: a toll crossing I initiated through the gold CTA.

### House

- Real tests run: deed read, history read, the row read, the close path, the mint line.
  Browser + axe.
- Mainnet: `house.txs.house_pay_recover ddaVgHkMGQzHcquj94qMuWTywXY8X4B7bWhkJF7aJEQ`,
  `house_close Eykw3LPZrDdCNbMxsZsGfpTVZogDmWmgkt3x3ykryzPv`,
  `house_v3_create_deploy_new 9b5rS4do5bVisMYpcmfLBKgXJrxQCNuYoDi6hDDPsyLj`,
  `house_deed_mint_visitor 4W7bmUYoG3QfRUKF7yJSfELMUgWsrAP5GrL9d7VC5X33`. All [MAINNET,
  earlier work].
- Fixed this session: the deed history fired **4 invalid RPCs** (`get_clauses`/`get_state`
  with a null `account_id`) and now fires zero.
- Unproven: a deed mint I signed.

### Arena

- Real tests run: actions list, attack box, guardian mint line, receipts. Browser + axe.
- Mainnet: `extras.arena.txs.*` — including the paying/refused pair
  `arena_agent_pay_allowed_0.001 AZWxqZnsv47WFjerjw4J8PB2SEiaYZfm6mfquYJ9xPht` and
  `arena_agent_pay_refused_0.002 25LpJRFF6ugmRdF8eH7Rw7dpkMthQjG6XWXFyx9mqa6V`, plus
  `arena_mint_guardian 8NqFTf8beQf4KQQSotT1pgsbacCAsQghM76rSCFLDayP`. All [MAINNET, earlier
  work].
- Unproven: a guardian mint I signed in the browser.

### Hall (Town Hall)

- Real tests run: the v2 desk, Post/Agents/Receipts tabs, the no-job empty line, the two-worker
  requirement, the refusal wording. Browser + axe.
- Mainnet: `extras.townhall.txs.*` — including
  `townhall_reward_allowed_0.001 6UxwRmoEd6x5g28jwEY6DeSMiX6stRqAjat59iPJ3G9h` and
  `townhall_reward_refused_0.002 Cp2rWatnDBHRhbmGdrNqFbr14tg42TW4cAMTjp4Bsnu6`, plus
  `townhall_post_bounty_0.001 HAVTU7zjgHnmnV3bhRXfcAxrcTKREdHTVnho9hjfDshM`. All [MAINNET,
  earlier work]. Also `51UktPvyyQuf199eABmiKG1dVdWwUJLZn3vGrmp94jY4` (`hall_post_job_from_city_row`)
  is a **recorded refusal** — `judges/proofs/mainnet-proof-check.json` records it as
  `success: false, failure: true`, and it is described as a refusal everywhere it appears. I
  corrected that in five places today. (I could not re-read it on chain just now: the public
  RPC answers `NOT_OBSERVED/TIMEOUT_ERROR` for it, so the verifier's recorded outcome is the
  evidence used.)
- Fixed this session: Post job called `m.sendJob()` on a bundle that **has never exported
  it**, so every visitor saw `m.sendJob is not a function`. Now an actionable sentence.
- Unproven: a full v2 job lifecycle on mainnet. The contract-level lifecycle **is** proved
  [SANDBOX] by `two_workers_split_one_job_and_only_the_passed_part_is_paid` in
  `contracts/hall/src/lib.rs`, which I ran (cargo +1.95.0, ok).

---

## 3. The transactions I personally produced this session

Two, both **[MAINNET]**, both signed by a **script** (`near-api-js` v7) using the row agent
key — **not** by a UI CTA and **not** by the AI agent.

| hash | signer | key | amount | proves |
|---|---|---|---|---|
| `AC1j6vLSmrvGDTbF7JBbgyuru4XH3NtU2oWf7Ervmk1Y` | `8ccd5d33d2e8eb2d27eef13a7a0c88ae2ea9209c002fa7f27ed6021592393bb9` | `ed25519:AUdhkvj9KjUzsBXMjuTep7u3jZ79Y1tsReSU97bKKRxt` | 0.0001 NEAR → `house.nearcarta.near` | the row's agent key can move money inside the cap, with no wallet popup |
| `BEndDsRe3YU4e6hjXA2J23ceWDi4ikDseMaTZUDxWL28` | same | same | 0.0001 NEAR → `house.nearcarta.near` | the same, a second time; nonce 19→21, `spent_today` 0.0108→0.0110, `actions_today` 17→19 |

Both FINAL, `SuccessValue`, receiver `board.nearcarta.near`. Verified by
`EXPERIMENTAL_tx_status`, not read from the record.

One subtlety in the record worth stating, because it looks like an inconsistency and is not:
`board.visitor_run.signer` is `8e20273e…`, and that is correct for what it describes — the
account that signed `open_charter` (`6xMQyXcc…`, signer `8e20273e…`, confirmed in
`judges/proofs/mainnet-proof-check.json`). The two proposes above are signed by
`8ccd5d33…`, a **different** account acting as the agent on that row. The row and the agent
are not the same key, which is the whole point of the design.

**What this does not prove:** that a visitor pressing a gold CTA gets a tx. It proves the
agent key path, which is the part the charter is about.

---

## 4. What is unproven, blocked, or broken

### 4a. The stale visitor row has no CALLS key — the real blocker

The live row is on `8ccd5d33…`. It was opened **before** `/setup` gained its `set_calls` step,
so its storage has `HEAD, c@, k@, r@, s@` but **no `CALLS`**. `v2.rs` checks the calls policy
**before** any deposit check, so a zero-deposit `propose_call_as` on this row panics
`method_not_allowlisted` **always** — before it can evaluate the amount.

Consequence: I cannot produce a real shop-CTA transaction on the existing row without
provoking a refusal I can already predict. This is stale state on one old row, **not** a code
gap: `shared/setup/open-row.js` sends a real `set_calls` action, and
`contracts/charter_board_sandbox/tests/setup_calls_row_size.rs` exercises it [SANDBOX].

**Fix:** open one row with the current `/setup` from a **second funded account**. That unblocks
the live CTA proof, the remaining `section-o` flows, and a full job lifecycle.

### 4b. `min_amount` fix waiting on the upgrade

On the live board, `min_amount` is applied to **every** `propose_call_as` deposit. The Town
Hall lifecycle's zero-value steps (`bid`, `accept`, `deliver`, `review`, `refund`) were
therefore refused `below_min_amount` — and zero is the only deposit a bid can carry. **No v2
job lifecycle could get past `post_job`.** Measured on mainnet 2026-11-08.

The fix is in the staged artifact and in source; its test passes [SANDBOX by cargo, run today]:
`a_shop_call_with_no_value_is_not_held_to_the_smallest_payment`.

So the upgrade is not housekeeping — **it is what unblocks a real shop transaction.**

### 4c. Production runs unmerged branch code

This is the accurate statement, and it replaces an earlier version of this section that said
only that Render was not behind on main. The owner was right to push on it.

Facts:

- `GET /api/health` reports `git: ea072cf2489f4e…`, and Render's live image deploy finished
  `2026-11-09T10:04:05Z`.
- **`ea072cf` is NOT on `origin/main`.** Checked with
  `git merge-base --is-ancestor ea072cf origin/main` -> **NO**. It exists only on
  `cursor/panel-system-b2d4`. `origin/main` is `9dba923f`, and this branch is **62 commits
  ahead** of it. Nothing on this branch has been merged.
- So the deployed API runs code that has never been merged. No API behaviour on production is
  backed by `main` right now.

What I had checked, and what it does and does not mean:

- `git diff ea072cf..HEAD -- backend shared` lists exactly one file,
  `backend/scripts/board-anchor-upgrade.js`, a script and not the API server. That bounds the
  drift **since the deployed commit**; there is no further API change to deploy.
- It says nothing about `main`. Because `ea072cf` is unmerged, every `backend/` and `shared/`
  change on this branch is live in production while existing only on this branch. Vercel is
  likewise 9 `app/` files ahead, deployed from this branch today.

**Consequence:** merging PR #170 is not bookkeeping. Until it lands, production depends on a
branch that could be abandoned, and `main` does not describe what is running. That puts the
merge above every remaining engineering task in this report.

### 4d. The standalone Town Hall cannot post jobs

`/shops/hall/` calls `m.sendJob()` on `hall.bundle.js`, which has never exported `sendJob`
(only `signCalls`). It used to surface a raw TypeError. It now says posting needs the town's
signer and to open Town Hall in the city, and nothing was signed.

**I deliberately did not port the city's `hallJob` into the bundle.** That is new signing
logic with its own key-allowance and board-row checks, and duplicating it is how the two paths
would drift. It stays a refusal until someone decides the standalone page should sign.

---

## 5. Board upgrade status

- Staged: `stage_upgrade` in `Ct4uwW5He8eaxNW5kDb6gU98ydE3A1UE4rm8gRPzPTVN`.
- ETA: **2026-11-09T16:29:03.174Z** (18:29 Africa/Cairo). 24 h after the 2026-11-08 16:29 restage.
- Artifact: `contracts/artifacts/charter_board.hold.wasm`, **150,988 bytes**, sha256
  `a89664ef45f16d429104b1b1d87d5dc83a79820a69bd22782f50a6b7c022315c` — **equals the staged
  hash**, so `upgrade` will accept it.
- The owner key is present and derives to `ed25519:E9DUdUQB…`, which **matches the on-chain
  key list for `nearcarta.near`**. So I can execute this; it needs no owner action.
- **Fixed today:** the plan invented a 24 h wait when the eta could not be read. The public RPC
  answers `NOT_OBSERVED/TIMEOUT_ERROR` for the stage tx, so `eta` was null and the plan fell
  through to `now + 24 h` — telling the owner to wait a day for an upgrade armed that
  afternoon. It now falls back to the recorded `staged_eta_ns` from that same event and says
  so. Dry run reports the real window and `staged_matches_build: true`.
- **Before-state captured for proof:** `POST /api/board/simulate` currently returns
  `ok:null`, `MethodResolveError(MethodNotFound)` — the live board has no `simulate` view.
  After the upgrade the same call must return a real answer.
- Six fixes ride on it: (1) hydrate/`anchor`, (2) `charge_acts`, (3) `hold` charging,
  (4) `release`/`reap` liability, (5) `min_amount` on zero-value calls, (6) the `simulate` view.

---

## 6. Open PRs

**#170** — `cursor/panel-system-b2d4` → `main`. `MERGEABLE` / `CLEAN`, **17/17 checks green**
on head `d57c0276`. Nothing else is open.

I have **not** merged it. There is no merge action in my tooling, `gh` is read-only here, and
no instruction to merge has arrived — only automated goal-continuation prompts. I did
de-risk it: `git merge-tree --write-tree origin/main <branch>` exits 0 with **zero conflicts**,
and the merged tree was checked out in a throwaway worktree and passed the suites.

---

## 7. My honest score

**7 / 10.**

What earns the 7: the shops are consistent and clean at both widths; three real defects found
and fixed today on surfaces a judge will actually touch; two real mainnet transactions from the
row agent key; 108/108 proofs re-read; the whole suite green (211 e2e + 898 unit); and the
documentation corrected everywhere I found it lying.

What costs the 3:

- **No live gold-CTA transaction in any of the nine shops, produced by me, in my browser.**
  That is the headline claim of the whole project and it is still carried by earlier,
  script-produced txs.
- **No completed v2 job lifecycle on mainnet** — blocked on `min_amount`, which the upgrade
  fixes.
- **Production runs 62 unmerged commits.** The API and site are live from this branch and
  `main` is 62 commits behind, so `main` does not describe what is deployed. I reported this
  wrongly the first time — I checked drift since the deployed commit and called it "not behind
  on main", which answered a different question. The owner caught it. The engineering is fine;
  the release discipline is not, and that is worth more than a rounding error.
- **The `section-o`/`section-n` sweeps were largely tests asserting deleted pages.** I fixed
  the tests and the two real bugs underneath, but I should have audited that surface weeks
  earlier rather than trusting a green tick.

### Exact steps to 10

0. **Merge #170.** It is first now, not sixth: production is running unmerged branch code, so
   `main` does not describe what is deployed and nothing on this branch is safe. This needs the
   owner's word — it is the one step I cannot take myself.
1. **Let the upgrade land at 16:29 UTC** (`BOARD_WASM=…hold.wasm`, `--apply`). Prove it with
   `POST /api/board/simulate` turning from `ok:null` into a real answer, and `view_code`
   sha256 equal to `a89664ef…`.
2. **Fund a second account** (~0.05 NEAR) and open one row through the current `/setup`, so
   the row has a `CALLS` key.
3. **In my own browser, with a real wallet:** press the gold CTA in Ferry, Bank, Hall, Arena,
   Toll, House and Payouts, one small real amount each. Record every hash. That is seven
   txs and it closes the main gap.
4. **Post one real job and walk it** post → bid → accept → deliver → review → pay. That needs
   `min_amount` fixed (step 1) and a fresh row (step 2). Record the lifecycle hashes.
5. **Feed each hash back into `shared/deployments/mainnet.json`, README and `judges/VERIFY.md`**,
   so `verify:mainnet` goes from 108 to 108+n and every claim links to a tx.
6. **Decide on the standalone Town Hall**: either port `hallJob` or keep the refusal. Right now
   it is a sentence, which is honest but not a feature.

Steps 1 and 2 are the whole ballgame for the *shop* score. Step 0 is the whole ballgame for
whether anything here survives a branch cleanup. Nothing after them is optional, but everything
after them is recording.

---

## 8. Plan for the next hours

- **15:39–16:29 UTC** — hold. Keep polling the PR set and CI; do not touch the board. Do not
  re-stage: `mainnet.json` says no further re-stage unless a money-losing bug appears, and a
  re-stage would reset the 24 h clock.
- **16:29–16:35 UTC** — run the upgrade dry first, then `--apply`, then verify: `simulate`
  answers, `view_code` sha256 == `a89664ef…`, `/api/mainnet` reflects the new code hash.
- **After the upgrade** — capture the after-state of `simulate` and update
  `mainnet.json` + README with the upgrade tx as a proof.
- **Throughout** — poll all shop chats and open PRs on the 15-minute cadence, keep HISTORY.md
  current, keep secrets out of git, gitleaks before every push.
- **Blocked on the owner:** the merge of #170, and a second funded account for the live CTA
  proofs. Neither is engineering.
