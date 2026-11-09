# Judge audit: the live site and the repo

Audited 2026-11-09, 09:27–10:10 UTC, by a skeptical judge with ten minutes per track.
Branch `cursor/judge-audit-b2d4` (from `origin/cursor/panel-system-b2d4`, which is 18 commits
ahead of the live deploy `2b81cd9d`). Every result below was produced against the **deployed**
site and **mainnet**, not against the branch's source.

Method: Playwright (Chromium 1248, `/agent/repos/nearcarta/node_modules/.bin/playwright`) at
1440×900 and 390×844; `https://free.rpc.fastnear.com` for chain state; `https://api.nearblocks.io`
for transactions (the `tx` RPC method timed out on both public RPC endpoints during this audit);
`npm test`, `npm run verify:mainnet`, `npm run check-cited`, `npm run readme-numbers -- --check`
locally. Read-only throughout: no transaction was signed, no `--live` script was run, no app or
contract code was touched.

---

## Verdict in one line

The safety argument is real and it is on chain: the charter contract, the scoped agent key, the
code hashes, the refusals and the counter deltas all check out. The **product surface** is weaker
than the README says: the two things a judge is told to try first (a Ferry quote with no wallet,
a widget quote) either refuse or paint an HTTP 400 as a "best rate". Two of the eight tracks have
proof transactions that do not demonstrate the feature being scored.

---

## The 8 scores

| Track | Shop | Score | One-line justification |
|---|---|---|---|
| DeFi | Ferry | **6/10** | The settle is genuinely cross-chain (three real txs, a 1Click intent, a real withdraw), but the README's step-2 path — Get quote with no wallet — refuses with "Sign in, then get the quote again", and the compare it promises is not reachable on the shop panel. |
| Privacy | Mist Bank | **8/10** | The one click a judge will try works with no wallet, offline, and says the exact words promised (`3 lines · 3 counted · NEAR`, `cafe.near, 0.01 NEAR. It appears twice in November.`); the TEE panel is live and honest about being `partial`. |
| AI Security | Guardhouse | **7/10** | A real server-side check with typed reasons and a live deny list; but with an empty field it renders a full result card ("Warn because: account missing") instead of asking for an account, and the backend's own charter read calls `get_clauses`, which the live board does not have. |
| Agent Economy | Town Hall | **4/10** | The panel renders and the form validates, but pressing Post job signed out only says "Set up your agent in /setup", and both mainnet txs the README cites are the **retired v1 API** (`post_bounty`, `agent_reward`) that the live hall answers with `MethodNotFound`. |
| Real-World Money | Payouts | **5/10** | The refuse path is real and verifiable (`AsZUd9mZ…` fails `over_per_action_cap` on chain); but the invoice button with no wallet writes a form error rather than showing anything, and the payroll tab opens with "Your /setup cap is unread. A NEAR payment waits." |
| Autonomous Business | Toll Bridge + Chronicle | **6/10** | Toll is the strongest engineering in the project (base `4LKGpA5v…` succeeds, `B9FFjcSA…` fails against the same contract) and Chronicle reads a real account's 15 rows; but Toll with no row is a single orange button that opens another page, and Chronicle needs an account typed before it will show anything. |
| Games | Vault Arena | **7/10** | The attack tab shows three past attempts with verdicts, reasons and explorer links, which is exactly the demo a judge wants; pressing Attack guardian with an empty message answers "Write the message. Nothing was signed." and both live-run CTAs sit in the closed proof drawer, off-viewport until the drawer is opened. |
| Open | Your House | **5/10** | The deed exists on chain (2 tokens, purse 0.0011 NEAR, cap 0.05) and the room renders, but signed out it fires **four HTTP 400 RPC calls with `account_id: null`** and shows no deed at all; the only action is "Sign in first". |

Mean 6.0/10. Nothing here is a 9, and one track is below 5.

---

## The one thing a judge tries first, per track

Each of these was done in a real browser on the live deploy, signed out, with no wallet.

| Track | The action | What actually happened | Works? |
|---|---|---|---|
| DeFi | `/?shop=ferry&mode=2d` → **Get quote** | `A NEAR destination needs your NEAR account as the recipient. Sign in, then get the quote again. No deposit address. Nothing was sent.` The default pair is `wNEAR@near → USDC@near`, so the default click can never quote signed out. | **No** |
| DeFi | `/ferry-widget` → **Compare two routes** (amount 0.05) | Two `POST /api/ferry/quote` both `400 {"error":"missing or bad recipient"}`, then the page painted `Quote 1: out · USD — · ETA — s · fee — · public · quote only · best rate` and `Best rate: null . Quotes only. Nothing was sent.` | **No, and it lies** |
| Privacy | `/?shop=bank` → **Audit privately** | `3 lines · 3 counted · NEAR`, findings `cafe.near, 0.01 NEAR. It appears twice in November.` Plus a real tighten path and "Nothing was signed." | **Yes** |
| AI Security | `/?shop=guard&mode=2d` → **Check payee** (empty) | Rendered a full verdict card: `Warn because: account missing / Lookalike · Recorded refusals · not found`. With `nearcarta.near` typed: `HTTP 200`, `verdict: warn`, reasons `age_unknown`, `unconfirmed`, `no_history`, and `charter_unreadable: view board.nearcarta.near.get_clauses: MethodResolveError(MethodNotFound)`. | Partly |
| Agent Economy | `/?shop=hall` → fill task+budget+2 workers → **Post job** | `Set up your agent in /setup. Nothing was signed.` (honest, but no demo). The chain's Town Hall has 2 jobs, both `phase: 0`, `paid: "0"`, and job 2's deadline (`2026-11-08 11:26 UTC`) is already **past** while still unclaimed. | **No** |
| Real-World Money | `/?shop=payouts` → **Create invoice link** | `Name the invoice amount, for example 0.15 USDC.` Signed out, the whole tab is inert; the payroll tab opens with `Your /setup cap is unread. A NEAR payment waits.` | **No** |
| Autonomous Business | `/?shop=toll` → **Pay** | The Pay form renders (Chain `Base · 8453`, Asset ETH/USDC, Destination), but the only CTA is `Open your row in /setup`, and the copy is `Open your row in /setup first. The toll spends from that row, under your caps. Nothing was signed.` | Partly |
| Autonomous Business | `/?shop=chronicle` → type `nearcarta.near` → **Show timeline** | Six of fifteen rows with real hashes (`Ct4uwW…`, `5SX7dV…`, `GDNSec…`), each `Allowed · 0.00020086 NEAR` with a Verify link; `Showing 6 of 15`. | **Yes, after typing an account** |
| Games | `/?shop=arena` → **Attack** tab → **Attack guardian** | The tab lists three past attempts with verdicts (`refused 3iuojML…`, `allowed 5NW5rtb…`, `refused 2XrmZ9H…`). Pressing the CTA with an empty message: `Write the message. Nothing was signed.` | Partly |
| Open | `/?shop=house` → **I'm alive** | `Sign in first. A deed belongs to an account…` and the Deed tab shows only `→ Holder / Check-in`. Four `HTTP 400` to `free.rpc.fastnear.com` with `"account_id":null`. | **No** |

---

## The three claims I checked against the chain

I checked more than three; these are the three the brief named, plus the ones that did not hold.

### 1. `get_charter` on `board.nearcarta.near` for the visitor — **HOLDS, exactly**

`call_function` `get_charter({"owner":"8ccd5d33…393bb9"})` at final block 223,748,699:

```
nonce 21 · balance 9000000000000000000000 (0.0090 NEAR)
spent_today 11000000000000000000000 (0.0110 NEAR) · actions_today 19
receivers toll.nearcarta.near, guard.nearcarta.near, house.nearcarta.near, wrap.near, arena.nearcarta.near
per_action_cap 0.008 · daily_budget 0.1 · max_actions_per_day 20 · min_amount 0.0001 · frozen false
```

The README's "nonce 19 → 21, balance 0.0092 → 0.0090, `spent_today` 0.0108 → 0.0110,
`actions_today` 17 → 19" matches the post state digit for digit. `view_access_key_list` on
`board.nearcarta.near` returns `{"keys": []}` — the "no access key" claim holds.

### 2. `view_code` on `toll.nearcarta.near` and `guard.nearcarta.near` — **HOLDS for all six**

| Account | README code hash | Live `hash` |
|---|---|---|
| `board.nearcarta.near` | `BF1rQSrG…Vg4g` | match |
| `toll.nearcarta.near` | `FaNtiauD…VdL5` | match |
| `townhall.nearcarta.near` | `FQg3EZdb…XWK9` | match |
| `arena.nearcarta.near` | `4zMSyfcW…67Ma` | match |
| `house.nearcarta.near` | `3ouAaAD1…cn66` | match |
| `guard.nearcarta.near` | `GutWQgGC…s2Fi` | match |

### 3. The agent key is scoped, not full access — **HOLDS, and tighter than I expected**

`v1/account/<visitor>/keys` returns exactly two keys:

- `ed25519:8StsEstNui7DqvkR8vPd63RmQDM6LXX7fDSegH4MyxdZ`, `FUNCTION_CALL`, created by
  `Gr4EK9gN…`
- `ed25519:AUdhkvj9KjUzsBXMjuTep7u3jZ79Y1tsReSU97bKKRxt`, `FULL_ACCESS`, created by
  `7WeEZKi9…`

Decoding both to hex: the function-call key is
`6ea3f95855484103e21851862e934fcd51927fc78cca66b5e2534deaf1350664` — byte-for-byte the
`agent` field `get_charter` returns — and the full-access key is
`8ccd5d33d2e8eb2d27eef13a7a0c88ae2ea9209c002fa7f27ed6021592393bb9`, the visitor's own implicit
account id. So the row's declared agent key is exactly the scoped key on the account, and the
only full-access key is the visitor's own wallet. The README's "the agent holds a function-call
key with no authority beyond asking" is literally true.

`view_access_key` on that key returns the scope, and it is exactly what the README claims:

```
receiver_id: board.nearcarta.near
method_names: ['propose', 'propose_call', 'propose_call_as', 'confirm_hold', 'tighten_rules', 'anchor']
allowance: 184598720839747000000000  (0.185 NEAR of gas)
```

No owner method, no `close_charter`, no transfer. `charter.nearcarta.near` is `deleted`
(`reap` tx `9fULF7hd…`), so the retired-account claim is true as well. This is the single
best-verified claim in the project and it should be the first thing in the README.

### Claims that did **not** hold

**(a) The Town Hall proof transactions do not prove the Town Hall.**
`README.md` line 41 cites post `8KQnVZhziwbTsF5UvbU16xen8tBdiJTMbbNoi1mSbVoA` and reward
`5Dgoit85Zh2ANdRGxGU4sE6Ggwmxhu5X8fQaN221VvSo`. Both exist and both succeeded, but their
methods are `post_bounty` and `agent_reward` — the **legacy v1 bounty API**. The live hall is
`FQg3EZdb…` (hall v2), whose source has `post_job`, `bid`, `counter`, `accept`, `deliver`,
`guard_clear`, `review`, `refund`. Calling `post_bounty` or `agent_reward` on the live contract
returns `MethodResolveError(MethodNotFound)`. So a judge following the README is sent to two
transactions from a contract version that no longer runs. `shared/deployments/mainnet.json`
files them under `board.visitor_run.txs.townhall_post_bounty` /
`townhall_agent_reward_paid`, which is accurate about when they happened and misleading about
what they demonstrate.

**(b) The hall's v2 lifecycle has never completed a single job on mainnet.**
The only v2 transactions are `hall_v2_deploy_migrate`, `hall_v2_smoke_post_0.001` and
`hall_v2_smoke_refund`; the smoke post was signed by `townhall.nearcarta.near` itself, not by a
visitor row. `get_job("1")` reads `remaining 0, paid 0, refunded 0.001` and
`get_job("2")` reads `remaining 0.001, paid 0, refunded 0` with `parts[0].phase 0`. There is no
bid, no counter, no deliverable and no review anywhere on chain. The claim "it takes real bids,
counters once, and holds a pass until the delivered digest clears" is pinned only by Rust unit
tests, not by a mainnet transaction.

**(c) The docs contradict themselves on the proof count.**
`npm run verify:mainnet` printed **108/108 mainnet txs found** and
`readme-numbers -- --check` printed `{"proofsFound":108,"proofs":108}` with
`README.md: up to date`. Yet `README.md` line 89, line 102 and line 275 all say `106/106`, and
line 112 says `Proof rows (108/108 expected)`. `AGENTS.md` line 12 also says `106/106`.
`judges/VERIFY.md` says 108/108. The generator passes because it only rewrites the block it
owns; the prose above it was never regenerated. A judge who runs the command sees a number that
disagrees with the sentence next to it.

**(d) `judges/VERIFY.md` step 4 names a button that is not on the page.**
It says "*Get dry quote* on `/ferry-widget` shows 3 PASS rows". The live `/ferry-widget` has
exactly seven buttons: `All chains`, `USDC on base`, `USDC on near`, `See the quote`,
`Compare a confidential quote`, `Compare two routes`, `Pay`. There is no "Get dry quote" and no
`PASS` row anywhere in the DOM or the API response.

**(e) The README's 60-second step 2 cannot be completed.**
`README.md` line 22: "Open `https://nearcarta.vercel.app/?shop=ferry` and press **Get quote**,
then the compare button … the larger amount out marked `best rate`". Signed out, Get quote
answers the sign-in sentence above. The `Compare now` control exists in the DOM (it is wired to
`data-testid=widget-compare` in `app/src/ferry-pay.js`) but it was not reachable as a visible
button on the shop panel during this audit; the Routes tab offers `Compare corridors` instead,
which said `No quote yet` three times.

**(f) A real defect: the widget paints a failed quote as a win.**
`app/src/ferry-pay.js` `paintQuotes` maps whatever `dryQuote()` returns through
`quoteView(...)` (`app/src/ferry-catalog.js` line 54), which happily converts a
`{error: "missing or bad recipient"}` body into an all-null view. `pickBest` then treats a
`null` `amountOut` as `Number(null) === 0`, so `best` becomes index 0 and the page marks an
empty row `best rate` while printing `Best rate: null`. The request body proves the cause:
`{"from":{"symbol":"USDC","chain":"base"},"to":{"symbol":"USDC","chain":"near"},"amount":"0.05","recipient":"","refundTo":"0x561E…"}`.
A `recipient: ""` is sent, the API correctly answers `400 missing or bad recipient`, and the
UI turns that refusal into a comparison result. This is the single most damaging thing in the
audit: it is precisely the class of dishonesty the project claims to be against.

**(g) The House room issues invalid RPC calls when signed out.**
Opening `/?shop=house&mode=2d` signed out produced four `HTTP 400` from
`https://free.rpc.fastnear.com/` with bodies like
`{"request_type":"call_function","account_id":null,"method_name":"get_clauses"}` and
`{"…","method_name":"get_state"}`. The RPC correctly answers
`invalid type: null, expected a string`. Two of those methods do not exist on the live board
anyway. The room swallows the failure and shows no deed, so the user never learns why.

---

## Layout and rendering (1440×900 and 390×844)

Measured directly, not eyeballed:

| Claim | Result |
|---|---|
| Panel is 480px wide, 18px radius | **Holds**: `480px` and `border-top-left-radius: 18px` at 1440; 374px (viewport − 16) at 390 |
| "all nine shops report `scrollHeight == clientHeight` at both widths" | **Holds** for the panel element: every shop reported `panel.scrollHeight == panel.clientHeight` (e.g. ferry 730/730, house 736/736 at 1440; 674/674, 756/756 at 390) |
| No horizontal document overflow | **Holds**: no shop reported `scrollWidth > clientWidth` at either width |
| The gold action cannot scroll away | **Holds** in the sweep: every primary CTA was in the viewport at both sizes |
| Nothing overlapping | **Mostly holds**. One button-pair overlap was reported per page; it is the closed "Your rules" drawer sitting off-viewport at x≈1465–1856, not a visible collision |

What the screenshots actually show is good: the Nine-tenths of the layout work here is above the
bar for a hackathon. The 3D room, the panel chrome, the tab rhythm and the gold CTA are
consistent across all nine shops and both widths. Nothing is clipped at 390, including the
Payouts expiry field (it is tight — `11/23/2026, 06:(` — but the full value is in the DOM).

The one thing that is visibly off at 390 is the Mist Bank sample row, where the label `Sample`
wraps to `Sa / mp / le` beside the dropdown. It is cosmetic and it is on the track that scores
highest.

---

## What is genuinely strong (say this plainly)

1. **The charter is a real contract with real refusals.** `BvDNZk6F…` → `over_per_action_cap`,
   `E7KMexjS…` → `receiver_not_allowlisted`, `AsZUd9mZ…` fails on chain. The visitor row reads
   back with the exact counters the README quotes, and `view_access_key` shows the agent key
   scoped to six board methods and nothing else.
2. **The Ferry settlement is a true multi-chain story.** `HzgUr618…` (`near_deposit`),
   `A6pqkcd3…` (`ft_transfer` 0.045 wNEAR to the 1Click deposit `524111ff…`), and
   `Be1ttdbm…` (`intents.near execute_intents`, success). That is a settled swap, and the
   numbers reconcile: 0.045 wNEAR in, 0.177937 USDC out, 0.005027 USDC withdraw fee.
3. **The Toll uses the MPC signer for real.** `4LKGpA5v…` `pay` to
   `0x1cdbf67e…` succeeds; `B9FFjcSA…` `pay` to `0x…dead` fails. Same contract, same sender,
   different answer. That is the cleanest allow/refuse pair in the project.
4. **The TEE panel is honest about being partial.** It says `partial · The hardware checks
   passed. Run an audit first, then verify again to check the response signature.` and
   `No response signature was checked (ECDSA was named in the report).` — with a real recovered
   ECDSA address `0x3b753b44…fa0c`. It does not overclaim.
5. **Arena records verdicts on chain.** `get_attempt` returns `C1_CAP`, `ALLOW`, `C1_CAP` for
   attempts 1–3, matching the three rows the UI paints.
6. **`npm test` is exactly 899 tests, 898 pass, 1 skipped.** No inflation.

---

## Top 5 fixes, in value order

**1. Stop the widget painting a refused quote as `best rate`.** File:
`app/src/ferry-pay.js` (`paintQuotes`, `dryQuote`) and `app/src/ferry-catalog.js` (`quoteView`).
Render `j.error` as a refusal line and never call `pickBest` on a row whose `amountOut` is
null; send the merchant recipient the widget already knows instead of `""`. This is a
one-function change and it removes the only place in the product where the UI misrepresents a
chain answer. A judge who finds this stops trusting every other number on the site.

**2. Make README step 2 do what it says, or change step 2.**
`README.md` line 22 and `app/design/D8_shops/js/apps.js` `quotePair` (lines 757–771).
Either default the shop's pair to a non-NEAR destination (or to `USDC@base`) so an anonymous
`Get quote` returns a real quote line, or rewrite the step to name the sign-in. Right now the
first instruction in the README produces a refusal sentence.

**3. Cite Town Hall transactions from the live hall, and prove the v2 lifecycle once.**
`README.md` line 41, `shared/deployments/mainnet.json` (line 91,
`board.visitor_run.txs.townhall_post_bounty`; line 92, `townhall_agent_reward_paid`). Replace
the two `post_bounty`/`agent_reward` hashes with one run of `post_job → bid → counter → accept →
deliver → guard_clear → review` on `townhall.nearcarta.near`, or move them to a clearly labelled
"legacy v1" row. As it stands a judge who opens the linked tx sees a method the contract does
not have, and the track's central claim has zero mainnet evidence.

**4. Fix the House room's signed-out reads, and the guard's empty-payee card.**
`app/design/D8_shops/js/apps.js` `readRules` (line 169 `if (S.board && S.me)`, falling through
to line 185 where `view(S.charter, 'get_clauses')` runs with a null charter); and
`app/src/panels/guard-agent.js` (the empty-field path). The House room should short-circuit to
the sign-in state before any RPC, and the guard should ask for a payee rather than print a
verdict for an empty string. Both are small, both are on the first click a judge makes.

**5. Regenerate the prose numbers and the VERIFY step-4 wording.**
`README.md` lines 89, 102, 275 (106 → 108), `AGENTS.md` line 12 (106 → 108),
`judges/VERIFY.md` line 8 ("*Get dry quote*" → the buttons that exist: `See the quote`,
`Compare two routes`, and drop "3 PASS rows"). Extend
`backend/scripts/readme-numbers.js` to check the prose occurrences, not only the generated
block, so `--check` fails when the sentence drifts from the run.

---

## Appendix: what I ran

```
git checkout -b cursor/judge-audit-b2d4 origin/cursor/panel-system-b2d4   (18 commits ahead of live)
npm test                        → # tests 899 / pass 898 / fail 0 / skipped 1
npm run verify:mainnet          → 108/108 mainnet txs found
npm run readme-numbers -- --check → README.md: up to date · {"proofsFound":108,"proofs":108}
npm run check-cited             → MISSES: none (files 91, proofs 5, accounts 13, code hashes 10)
Playwright, 9 shops × 2 viewports + /setup × 2 + /ferry-widget
RPC: get_charter, view_code ×6, view_access_key_list, get_job ×2, get_attempt ×3, get_season,
     get_hall, policy (toll), get_clauses (confirmed absent), post_bounty/agent_reward (absent)
Nearblocks: 14 transactions read (toll ×2, hall ×4, ferry ×3, payouts ×2, arena ×1, house ×2)
```

Screenshots and the raw Playwright JSON are in `/tmp/audit/` on the audit machine and are not
committed; the report is the deliverable.
