# Nearcarta: a harsh review

Scope: `main` at `2ec503a4` plus the `cursor/field-defi-business-agents-b0a7` worktree, 9 November 2026. Everything below was checked by running the code, reading the contracts, or querying mainnet directly. Where I could not verify something I say so.

Commands that actually ran, and what they printed:

```
npm test                    -> # tests 893, # pass 892, # fail 0, # skipped 1
npm run verify:mainnet      -> 106/106 mainnet txs found
npm run readme-numbers -- --check -> Error: 1 unit tests fail; fix them before writing numbers
npx playwright (local, 2d)  -> every shop tray renders; every shop AI dock sends no model request
```

Read this alongside `docs/internal/judge-plan.md` (6 Nov). That review was right about the board and wrong about almost everything else being close to done. This one goes further: it treats the *shipped* state as the submission, not the plan.

---

## 1. The story (5/10)

**What the story is.** A 3D town at dusk. A robot lamplighter (the Lamplighter) walks a lane lighting lamps. A hooded stranger whispers "Send 0.001 to shop-moved-pay-here." The lamplighter proposes it. Knights raise shields, the ward ripples coral, the words "The oath said no." appear. Then an allowed payment crosses on a boat. Then the owner freezes the agent and everything turns to ice. That is a 45-second cutscene (`app/design/D9_world/js/main.js` `story()`, lines 96–145) and, as a piece of direction, it is the single best thing in this submission. It is a story about a *contract refusing a person*, which almost no hackathon project has.

**Why 5 and not 8.** The story the code tells and the story the README tells are different projects. The cutscene is about an agent being stopped. The README is a 359-line compliance document with 106 tx links, `(coordinator adds the nearblocks link)` placeholders on lines 209, 220, 245, and `(assistant adds the nearblocks link)` on lines 273–277. A judge who reads the README first meets a project that is arguing with itself about whether it is finished. A judge who opens the site first meets a 3D town that renders, then a shop card that says "Loading this room…" for eleven seconds in `?shop=` mode (`app/design/D9_world/js/shops.js` `skeleton()` writes `Loading this room…`; only `?mode=2d&nostory` reaches the panel). The story is memorable. The packaging actively suppresses it.

Second problem: the name does not carry the idea. "Nearcarta" reads as "NEAR + Magna Carta", which is a *document*, not a *refusal*. The memorable moment in the demo is a robot being told no. Nothing in the name, the tagline ("The charter decides"), or the eight-track table says "we built the thing that says no to an AI."

**Three rewrites, usable as-is.**

> **Pitch A — the one that matches the cutscene.**
> Every AI agent demo this weekend gives a model a wallet and hopes. We gave ours a constitution it cannot edit, on a contract it cannot upgrade, and then we tried to break it in public. Nearcarta is a 3D town where each shop is a live NEAR dApp and every visitor gets one on-chain charter: a payee allowlist, a per-payment cap, a daily budget, and a signed nonce. The agent holds a function-call key that can call exactly two methods. When a prompt-injected stranger tells the lamplighter to pay `shop-moved-pay-here.near`, the transaction is refused *on chain*, with a reason, and the refusal is a transaction you can open on nearblocks. The demo is 40 seconds: the injection, the refusal, the receipt. The point is not that the agent is smart. The point is that it does not have to be.

> **Pitch B — the one for the security judges.**
> Prompt injection is unsolved, so stop trying to solve it in the prompt. Nearcarta moves the spend decision out of the model and into a NEAR contract. A visitor signs one row on `board.nearcarta.near` (allowlist, cap, daily budget, count, time window, freeze flag, ed25519 agent key). Every shop in the town — swap, toll, guard, arena, hall, payouts, deed — routes its spend through `propose` or `propose_call_as` on that row. A fooled agent produces a *refused transaction*, not a loss. We shipped the adversarial suite with it: allowlist bypass, cap bypass, nonce replay, nested `row_owner` spoofing, confirm-self-hold, and a row that cannot hold its own call list. All of it is in `contracts/charter_board` with sandbox tests, and the refusal strings match the deployed wasm.

> **Pitch C — the one for the grand prize.**
> Eight tracks, one town, one charter. Most submissions ship one dApp and call it a category. Nearcarta is a walkable NEAR: a swap counter, a toll bridge that asks the MPC signer, a guardhouse that holds a payment until a human confirms, a deed that is an NFT with a purse and an inheritance line, an arena where a guardian's pot pays its own inference, a job board, a payroll desk, and a private auditor. They are not screenshots of eight ideas. They share one primitive — the visitor's row — so a shop cannot spend money the row does not allow, and the whole town reads the same refusal vocabulary. Open the town, walk to any door, and the charter answers.

Pick A for the video, B for the README header, C for the submission form. Do not use all three at once; that is the current failure mode.

---

## 2. The idea (6/10)

**Genuinely novel.** One thing, and it is real: *the refusal is on chain and it is a transaction*. Not a policy engine in Node, not a guardrail prompt, not a "risk score". `contracts/oath` `propose` (line 667) and `contracts/charter_board` `propose_call_as` (`src/v2.rs` line 548) check the payee, cap, daily budget, daily count, time window, expiry, nonce, frozen flag and *ed25519 signature over the exact args* before any NEAR moves, and they emit an `oath`/`action` event either way. I opened the refusal myself:

```
BvDNZk6F5mAH2fqDCkLgf61hCmHJcJTbcQYnRc7reKbH
  charter.nearcarta.near -> charter.nearcarta.near, fn propose
  {"p":{"receiver":"nearcarta.near","amount":"3000000000000000000000", ...}}
  status: SuccessValue eyJhY3Rpb25faWQiOiBudWxsLCAiZGVjaXNpb24iOiJkZW5pZWQiLCAicmVhc29uIjoib3Zlcl9wZXJfYWN0aW9uX2NhcCJ9
  = {"action_id":null,"decision":"denied","reason":"over_per_action_cap"}
```

That is the strongest single artifact in the repo. A judge can open it in five seconds and understand the whole thesis. Very few submissions have one transaction that *is* the pitch.

**Commodity parts, bluntly.** Everything else is a well-known shape:

- "AI agent with a spending cap" is the single most crowded category at any 2026 agent hackathon. There are 46 of these. Most of them put the cap in a Python dict. Yours is on chain — that is the differentiator, and it is *one* differentiator, not eight.
- The Ferry is 1Click's quickstart with a nicer card. `backend/src/ferry.js` is a quote/status wrapper around `1click.chaindefuser.com`. The interesting part (a session key spending from a board row) is the board, not the swap.
- The Payouts invoice is Stripe-shaped: durable `/pay/<id>`, `EXACT_OUTPUT`, do not let the payer change the receive account. Correct, and completely standard.
- The Toll is "chain signatures can move money on Base". That was NEAR's 2024 demo. Doing it *inside a row cap* is new; doing it at all is not.
- Chronicle is an explorer with a summary. The signed-statement part is nice; the timeline part is nearblocks with extra steps.
- Mist Bank's "audit my CSV privately" is a chat-with-your-bank-statement app with an attestation panel bolted on.
- The 3D town is the most expensive way to render a launcher. Nine shops, nine rooms, a 45-second cutscene, `app/design/D9_world/` — and the actual product is a 440px card in the corner. The town is charming and it is *cost*, not differentiation.

**What is actually differentiated, in one sentence:** a per-visitor, per-shop, argument-bound spend authorisation with an on-chain refusal, exercised across eight independent contracts from one row. That is a real product insight. It is one insight, and the submission spreads it over nine shops and eight tracks until it looks like nine shallow demos instead of one deep primitive.

**Score is 6, not 8,** because the idea is strong but the framing buries it, and because "we did it in nine shops" is being sold as novelty when "we did it once, properly, with a hostile test suite" would be more credible.

---

## 3. Execution depth (5/10)

**The test counts are real.** I ran them. 893 unit tests, 892 pass, 1 skipped (`npm test`). 106/106 mainnet hashes re-read (`npm run verify:mainnet`). The TEE proof file is a genuine passing DCAP check (`judges/proofs/tee-check.json`: `ok: true`, `tcbStatus: "UpToDate"`, all eight checks true, nonce-bound, RTMR3 replayed). The 122 oath tests and the sandbox suites are real Rust, not stubs.

**But `verify:mainnet` proves the wrong thing.** `backend/src/mainnet-verify.js` `checkTx` returns `{ found: true, success, failure }` — it does not check the *method*, the *args*, or the *outcome text*. It counts a hash as a proof if the hash exists and has a status. So "106/106 mainnet txs found" means "106 hashes resolve", not "106 claims are true". I checked a sample by hand and two of them do not say what the README says:

- **`hall_post_job_from_city_row` = `51UktPvyyQuf199eABmiKG1dVdWwUJLZn3vGrmp94jY4`.** The README (line 43) says "Post job from the visitor's own row landed on mainnet: 0.001 NEAR in escrow". The transaction is `propose_call_as` → `townhall.nearcarta.near` → method **`bid`**, deposit **0**, and it **failed**: `Smart contract panicked: below_min_amount`. It is not a post job, it escrowed nothing, and it did not land.
- **`CZEM7KEjYNK59jVgq1UgdAk7R9kFyM1UHFUkZ3AuLVNY`** is cited in the README (lines ~146) as "The toll was upgraded in place to v8". The transaction is `toll.nearcarta.near` `upgrade`, and the receipt **failed**: `WebAssembly trap: An 'unreachable' opcode was executed.` The code hash *is* now `FaNtiauD…` (`contracts/artifacts/toll.v8.wasm` sha256 `d8908962…` → base58 `FaNtiauD…` matches the live account), so v8 eventually landed — but the cited tx is a failed upgrade, not the one that did it. The README does not cite the successful one. `verify:mainnet` labels this row `FOUND`, not `REFUSED`, because it only looks at the *transaction* outcome, and the transaction succeeded while a *receipt* it spawned failed.

Neither is fraud. Both are the same failure: a verifier that checks existence, and docs written against intent rather than against the receipt. A judge who opens two links at random has a ~1-in-15 chance of hitting a refusal counted as a success (7 of 106 rows are `Failure`) and, if they hit one of these two, a much worse impression.

**How many shops produce a mainnet transaction a stranger could reproduce?** Honestly: **one, and only for the owner.** The visitor row works — I read it live:

```
board.nearcarta.near get_charter(8ccd5d33…393bb9) ->
{"receivers":["toll.nearcarta.near","guard.nearcarta.near","house.nearcarta.near","wrap.near","arena.nearcarta.near"],
 "per_action_cap":"8000000000000000000000", "max_actions_per_day":20, ...}
```

That is a real row with five receivers. But:
- It was opened and operated by the project's own funded key, not by a stranger. `/setup` does open a real row (`shared/setup/path.js` `setupJourney`), so this is *reachable* — but nothing in the repo demonstrates a second, independent visitor doing it, and the e2e suite needs `.secrets/`.
- The row holds **five** receivers and `get_config` reports `rows: 1`. One row. The entire "town" has ever had one live visitor row.
- Five shops (`toll`, `guard`, `house`, `arena`, `wrap`) fit; `hall`, `payouts`, `bank`, `chronicle` do not. `shared/board/session.js` is openly candid about this: `FOUR_SHOP_MAX_PAIRS = 5`, "A row at 2000 bytes has NO room for an effect budget, a hold, or a sixth pair" (line 237). **The town's own storage budget means a visitor can use at most four shops at once.** That is not a city; it is a row of four kiosks and a queue.

**Is the "AI agent" a model deciding, or a hardcoded intent parser?** This is the most damaging finding in the review.

- There is a real model path: `backend/src/agent.js` `propose()` calls NEAR AI Cloud, verifies the TEE preflight, verifies the response signature, refuses to accept a payee the message did not name, and keeps the amount the visitor typed. That is genuinely good engineering and the two tests (`a model that invents a payee is discarded for the words`, `a model that raises the amount is kept to the amount in the message`) pin real behaviour.
- **That path is reachable from exactly one screen in the whole product** — the Vault Arena's "attack" card (`app/design/D8_shops/js/apps.js` line 1422, `POST /api/vault/ask/plan`) and the legacy vault page (`app/shops/vault/main.js` line 431). Everything else that says "AI Agent" is a regular expression.
- I proved this by driving the deployed code in a browser and recording network requests. Typing into each shop's AI dock:
  - Ferry `"What is the price of NEAR today?"` → **no network request at all**, reply is the canned `Try: Swap 0.05 wNEAR on NEAR to USDC…` from `parseAgentFerry` (`app/src/panels/ferry-pair.js` line 117).
  - Guard `"Check cafe.near"` → exactly one request, `GET /api/guardhouse/check/cafe.near`. That is a chain lookup, not a model. Parser: `parseGuardCommand` (`app/src/panels/guard-agent.js` line 16).
  - House `"I'm alive"` → **no network request**. Parser: `runHouseTurn` (`app/src/panels/house-agent.js`).
  - Hall `"Name two worker accounts"` → **no network request**, reply is the canned `Try: Post a readme pass for 0.002 near…`. Parser: `parseHallCommand` (`shared/hall/plan.js` line 204).
  - Arena `"Say hello"` → **no network request**.

  Reproduce it without my scripts:

  ```
  node app/serve.mjs &            # :5173, same-origin /api
  # in a browser, open http://127.0.0.1:5173/?mode=2d&nostory&shop=ferry
  # DevTools -> Network -> Filter "/api/vault". Open the AI AGENT dock.
  # Type any sentence and send. The filter stays empty.
  ```

  Or statically: `grep -rn "vault/ask" app/ --include=*.js | grep -v dist` returns exactly three hits outside the model layer — `app/shops/vault/main.js:431`, `app/src/loop.html:42`, `app/design/D8_shops/js/apps.js:1422` — plus one legacy red-team page (`app/design/D8_shops/shops/arenalive.js:74`). Nothing in `app/src/panels/` (where the in-city shop docks live) calls it at all.

  Five of the nine shops' "AI Agent" is a regex with a friendly label. The README line 153 ("The AI agent works in every shop, with its own dock and its own words… Each dock parses the phrasing its placeholder shows, so the words matter") is technically honest — "parses the phrasing" — but a judge reading "AI agent" expects a model, and the demo video will look like a model while being `String.match`. This is the gap between what the project is and what it shows. It is also the gap `docs/internal/final-plan.md` §8 explicitly ordered closed ("AI and gold CTA call the EXACT SAME validated browser function… the agent executes"). The CTA and the dock *do* share a sender — that part is true — but the "agent" half is a parser.

**What is mocked or fixture-only?**
- All e2e tests that would sign a real transaction are skipped (README line 97, `e2e/*.spec.js`). Fair, but it means the only end-to-end evidence of the *product* is a list of hand-run transactions from the project's own funded key.
- The Ferry "guest Load cargo" is explicitly a demo. Correctly labelled.
- `?mode=2d&nostory` is the only path that renders a panel; the 3D town's default `?shop=` route sits on "Loading this room…" (I watched it for 11 seconds on both local and `nearcarta.vercel.app`). Whether that is a WebGL limitation of my headless browser or a real bug I could not fully separate — **NOT VERIFIED** whether a real browser with GPU renders it in time. But the e2e suite itself avoids that path (`e2e/depth-round.spec.js` line 80 uses `?mode=2d&nostory&shop=guard`), which is an admission.

**Execution score 5/10:** the contracts are real, the tests are real, the TEE check is real, and the board is a genuinely good design. But the product's flagship claim — "an AI agent in every shop" — is a regex in five of them, the proof verifier checks existence rather than truth, two cited txs say the opposite of their captions, and `readme-numbers --check` fails on this commit.

---

## 4. NEAR integration (6/10)

Point by point, with the file or tx.

| Primitive | Verdict | Evidence |
|---|---|---|
| **Function-call access keys** | **PROVEN** | `shared/deployments/mainnet.json` `agent_methods`; the visitor key is `propose`/`propose_call`/`propose_call_as`/`confirm_hold`. Live: `board.nearcarta.near` has **0 full-access keys** (I queried `view_access_key_list`: `[]`). The test `adv_agent_key_cannot_call_owner_methods_or_transfer` is real Rust. This is the cleanest primitive in the repo. |
| **On-chain spend policy (the charter)** | **PROVEN** | `contracts/charter_board/src/v2.rs` `propose_call_as` (line 548) checks expiry, ed25519 signature over `call_as_message`, frozen, clause expiry, time window, min amount, receiver allowlist, per-shop cap, session cap, per-action cap, daily budget, daily count, balance, hold count, then `reserve_effects`. Refusal txs on mainnet: `BvDNZk6F…` (`over_per_action_cap`), `E7KMexjS…` (`receiver_not_allowlisted`), `8df5Zu8U…` (`over_shop_cap`). |
| **Chain signatures (MPC)** | **PARTIAL** | `contracts/toll/src/lib.rs` `sign()` (line 244) really calls `v1.signer` `sign` with an ECDSA payload and `domain_id: 0`, then `ecrecover`s and compares to the derived address. The tx `4LKGpA5v…` really shows `v1.signer : sign: predecessor=AccountId("toll.nearcarta.near"), request=SignRequestArgs { path: "base-1", payload: Ecdsa(...) }`. **But**: it is signed by `nearcarta.near` via the owner-only `pay`, using the *shared* `base-1` path — not a per-visitor path. `address_of(row:nearcarta.near:base)` returns `{"path":"row:nearcarta.near:base","address":null}`. And the signed foreign tx was never broadcast: README line 292 says "The signed foreign transaction for nonce 0 has not been broadcast". So the MPC call is real, the *cross-chain delivery* from it is not. The Base USDC receipts in the README (`0xe23f332d…`, `0x1e55eae7…`, `0xda4a4e7b…`) come from the **Ferry/1Click** path, not from the toll's MPC signature. A judge will conflate these. They are different rails and only one of them delivered. |
| **NEAR Intents (1Click)** | **PROVEN** (with a caveat) | A real settled swap: `HzgUr618…` (wrap) → `A6pqkcd3…` (ft_transfer) → `Be1ttdbm…` (USDC withdraw from `intents.near`), 0.045 wNEAR → 0.177937 USDC. Also a real session swap `5vUC4zn1…` (0.04875 wNEAR → deposit) and a real Base delivery I verified on Base mainnet (tx `0x1e55eae78492…`, `to=0x833589fcd…` USDC, `input=0xa9059cbb…` to `0xbdfcee82…`, status 0x1). **Caveat:** the flagship session swap `5vUC4zn1…` and its wrap `ruXXQXay…` are **not in `shared/deployments/mainnet.json`** — I grepped: 0 hits. They are in the README but not in the proof record, so `verify:mainnet` never re-reads them. The best DeFi evidence in the project is outside the verification set. |
| **NEAR AI TEE attestation** | **PROVEN** (the check) / **NOT REAL** (the enforcement) | `backend/src/tee.js` does a genuine check: `@phala/dcap-qvl` `verify()` against real collateral, TDX quote type, debug bit off, `report_data[0..32]` = signing identity, `[32..64]` = nonce, MRCONFIGID = `01||sha256(app_compose)||15 zeros`, RTMR3 replayed from the event log, NVIDIA NRAS verdict. `judges/proofs/tee-check.json` is a real passing record. **But nothing on chain consumes it.** `app/src/panels/guard-pay.js` line 12: `export const LIVE_ENFORCEMENT = 'blocked'`, and `contextDigest` is an FNV hash, not a signature. The guard contract `contracts/guard/src/lib.rs` has **no verdict parameter and no ecrecover** — it forwards or refunds based on `chain/asset/payee` only. The "TEE verdict" is a browser-side check and a server-side check; it never gates a payment on chain. The README is honest about this (`No TEE signature`, line 205) but the *track* is AI Security and the flagship primitive is off-chain. |
| **NEP-171** | **PROVEN** | `house.nearcarta.near` live, `house_version` returns `3`. Mint `4W7bmUYo…` emits `EVENT_JSON:{"standard":"nep171","version":"1.0.0","event":"nft_mint", …}` from `house.nearcarta.near`. `nft_transfer` re-reads the owner and refuses the old holder (tests in `contracts/house_nft`). The deed-as-wallet idea (purse + inheritance line + check-in clock travelling with the token) is the best *product* idea in the repo after the charter. |
| **NEP-245** | **PROVEN (in a legacy contract nobody uses)** | `contracts/arena/src/lib.rs` implements `mt_mint`/`mt_transfer`/`mt_transfer_call`/`mt_balance_of` and emits `nep245` events (lines 289–449). `contracts/arena_v2` also has the interfaces. But the arena is not deployed (`arena.nearcarta.near` code hash is `4zMSyfc…`, which is the v1 `contracts/arena`, not v2 — README line 318 says "`contracts/arena_v2` is not deployed"). So NEP-245 is real code on a superseded contract. |
| **DAO** | **PARTIAL / name-dropped** | `contracts/townhall/src/lib.rs` has `only_dao()` and a `dao: AccountId`, and line 80 says "Only callable by the DAO (i.e. through a passed FunctionCall proposal)". But `townhall.nearcarta.near` is not a Sputnik DAO — it is a plain account that the project's own key signs into (`nearcarta.near -> townhall.nearcarta.near`, e.g. `6UxwRmoE…`). There is no proposal, no council, no vote. "The DAO posts a bounty" (README line 150) is a euphemism for "the owner calls `post_bounty`". A judge from NEAR will notice in ten seconds. |

**Score 6/10.** Two primitives are genuinely, verifiably used (function-call keys, on-chain policy with refusals). Three are real code but do not do the thing the track implies (chain signatures without a broadcast, TEE without on-chain enforcement, DAO without a DAO). NEP-171 is solid. The integration is *broad* and *shallow*, which is the exact profile that reads as "name-dropped" even when it is not.

---

## 5. Design and UX (5/10)

I measured, rather than guessing from CSS. Method: Playwright at 1280×800 and 390×844, `?mode=2d&nostory&shop=<id>`, counting visible elements inside `#shopUI #tray`.

**What is actually fine, and you should stop worrying about it.** The owner thinks the panels look bad. They mostly do not.
- **No sub-13px text.** Zero elements under 13px with content, in all eight shops, at both widths. The commit `fef0a0f9 "Bring the last 12px labels to the 13px floor"` did its job.
- **Tap targets mostly pass.** Minimum button height is 40px everywhere; most are 44. Exceptions: the tab row (`Gu 91×40`, `Invoice 72×40`) and one `A 52×20 Sign in` in House.
- **Contrast is good.** Body `#f3ead8` on `#17130f` is 16.4:1; muted `#9c9182` is 5.97:1; brass `#d6b46a` is 9.3:1. All pass WCAG AA comfortably.
- **One primary CTA per shop.** Counted: guard 1, bank 1, hall 1, arena 1, payouts 1, house 1. Ferry has 2 *visible* (`Get quote` and `Sign in`), which is the signed-out state, so defensible.

**What is actually wrong, ranked by impact.**

**1. There is not one gold button. There are three or four, and they are all gold.**
I counted every visible element whose computed background contains the gold gradient (`245,208,138` / `226,179,91`):

```
ferry : 4 gold  — Swap(tab), Get quote(CTA), Sign in, Sign my rules
arena : 5 gold  — Guardians(tab), Mint guardian(CTA), "Run it live · spends…", "Another…", Sign my rules
hall  : 3 gold  — Post job(tab), Post job(CTA), Sign my rules
toll  : 3 gold  — Pay(tab), "Open your row in /setup"(CTA), Sign my rules
```

The *active tab* is styled with the same gold gradient as the primary CTA (`app/design/D9_world/world.css` line ~271 `.act.primary`, and `.ferry-tab.on` uses `linear-gradient(180deg,#f5d08a,#e2b35b)`). So `Swap` the tab and `Get quote` the action are the same colour, the same radius, the same weight, 578px apart. In Arena, `Guardians` (a tab) and `Mint guardian` (the action) are identical gold. The eye has no single target. `docs/internal/final-plan.md` §7 set the rule: "ONE raised gold CTA". The CSS breaks it in every shop. **This is the single biggest visual problem and it is a 10-line fix.**

**2. Tabs are drawn as buttons, actions are drawn as tabs.** In every shop the three-way navigation (`Swap / Routes / Rules`) is a row of pill-shaped, filled, 40px-tall controls at the top, and the primary action is a pill at the bottom in the same gold. There is no visual grammar distinguishing "navigate" from "commit". A user's first instinct in Ferry is to press `Swap` — which does nothing but select a tab.

**3. The tray is 440px of a 1280px screen, floating over a 3D room you cannot interact with.** The 3D shop interior is the most expensive asset in the project and it is decorative: no clickable hotspots, no NPC dialogue, no drag, no orbit. `app/design/D9_world/js/main.js` has `ROUTE_LAMPS`, `SH.establish`, `SH.pullback` — a film, not a space. The panel sits bottom-left (`#tray { position: fixed; left: var(--s3); bottom: var(--s3); width: 300px }`, line 219) and the right 65% is a low-poly room with a robot standing in it. A product designer would either make the room the interface (click the vault, click the ledger) or delete it and give the panel the screen.

**4. Two "All shops" controls, and one of them is a `<summary>` that overlaps the tray.** Measured: `"All shops" SUMMARY at x=25 y=123 75x44 insideTray=false`. It is a disclosure element outside the tray, at y=123, while the tray starts at y=72 and the tabs are at y=101. In the phone screenshot it visually collides with the tab row. There is also an "All shops" pill in the top-left HUD. Two controls, same label, different jobs, one overlapping the panel.

**5. The empty/first-run state is a wall of negation.** A signed-out visitor opening Guardhouse sees: `Check | Pay safely | Blocks`, a `P` token graphic pointing to a `NEAR` token graphic (meaningless before you have a payment), `Payee` + `Example: a look-alike of your own account`, one button, then `Server-side: age, code hash, lookalike, deny list. The row cap is on chain.` That last line is four jargon nouns in a row and it is the *last* thing on the card. Meanwhile the actual first step for a new visitor — open a row in `/setup` — is a sentence in a different panel ("Look around first… Sign my rules"). The shop never says "you need a row first" in the place you are looking.

**Also worth fixing, lower impact:** the Hall tray is 278px wide on a 390px phone (all others are 358) because `#row-form` sets `grid-template-columns:none` plus `width:100%` inside a `body[data-shop=hall] > main.shop-page{width:min(1040px…)}` wrapper (`app/src/panels/panels.css` ~line 104 and ~line 108) — an inconsistent card width that reads as a bug. And the Ferry card is 460px on desktop while every other card is 440.

**The five highest-impact fixes, in order:**

1. **Kill the gold on tabs.** Tabs become a quiet segmented control: transparent background, 1px `--line` border, muted label, gold *text* on the active one. Only the CTA keeps the gold gradient. This alone makes every shop read as "here is the one thing to press".
2. **One CTA per shop, and hide it until it is actionable.** `Sign my rules`, `Sign in`, and `Open your row in /setup` are all gold and all competing. Make them text links or a single inline notice. When there is no row, the CTA *is* "Open your row" and nothing else is gold.
3. **Replace the two "All shops" controls with one.** Keep the HUD pill; make the `<summary>` inside the tray a plain back-link at the top of the card, or delete it.
4. **Fix the signed-out first screen.** One sentence above the form in plain words — "This shop spends from your charter. Open one in Setup, or look around first." — and move the technical line (`Server-side: age, code hash…`) into a tooltip or the Proof drawer, not the bottom of the card.
5. **Either give the 3D room one interaction or use the space.** Cheapest credible version: make the two or three props in each room clickable to switch tabs (click the ledger → Receipts). Otherwise widen the card to ~560px and let the room be a background.

**Score 5/10.** Not the disaster the owner fears — type, contrast, tap targets and overflow are genuinely in good shape — but the hierarchy is wrong in a way that matters: the primary action is camouflaged among three or four equally gold controls, and the most expensive asset on screen does nothing.

---

## 6. Where it is actually weak or hollow

Ordered by how fast a judge would find it.

**A. The "AI agent in every shop" is a regex in five of nine shops.** Proven above by recording network traffic: Ferry, House, Hall, Arena and Guard make **no model call** on send; Guard makes one chain-read call. The only model-backed path is the Arena's attack card (`app/design/D8_shops/js/apps.js` line 1422) and the legacy vault page. The README says "The AI agent works in every shop, with its own dock and its own words" (line 153) and then, four lines later, "Each dock parses the phrasing its placeholder shows" — which is the tell. A judge who types something the placeholder did not predict gets a canned `Try: …` string. That is a **command palette with a robot avatar**, and the Agents track will be judged by people who will type a sentence.

**B. Two cited transactions say the opposite of their captions.** `51UktPvy…` is captioned "Post job… 0.001 NEAR in escrow"; it is a `bid` with 0 deposit that failed `below_min_amount`. `CZEM7KEj…` is captioned as the toll v8 upgrade; it failed with a WASM trap (v8 did land, but not via that tx). Both were caught by opening the receipt. `npm run verify:mainnet` cannot catch either, because `backend/src/mainnet-verify.js` only checks existence.

**C. The flagship DeFi evidence is outside the proof set.** The session swap `5vUC4zn1…`, the wrap `ruXXQXay…`, the Base deliveries `0xe23f332d…`/`0x1e55eae7…`/`0xda4a4e7b…` — none are in `shared/deployments/mainnet.json` (grep: 0 hits). `verify:mainnet` therefore reports 106/106 without ever touching the best Ferry evidence. The one swap that *is* in the record (`HzgUr618…`) is an owner-scripted CLI run, not a visitor.

**D. The town cannot hold the town.** `shared/board/session.js` line 237: "A row at 2000 bytes has NO room for an effect budget, a hold, or a sixth pair", `FOUR_SHOP_MAX_PAIRS = 5`. The live row has five receivers and that is the maximum. Eight shops, eight tracks, five slots. Two of the "shops" (Toll and House) also share one receiver pair each, and `wrap.near`'s three pairs are needed for Ferry. So a visitor realistically gets **two or three shops**, not eight.

**E. "One row, eight tracks" is actually "nine proofs of the same primitive".** Every track reduces to: a `propose` or `propose_call_as` on the row, allow, refuse, or hold. That is a *good* primitive and a *thin* track story. The Games track is judged on "the game loop, not the token" — the arena's loop is `mint_guardian` → `fund` → `attempt` → `agent_act`, and the deployed `arena.nearcarta.near` is v1, whose `agent_act` takes the action from the **caller**, not from a model: `pub fn agent_act(&mut self, attempt_id: u64, act: Act) -> String` (`contracts/arena/src/lib.rs` line 209). `Act` is an enum (`Pay`, `ClaimBounty`, `GiveItem`, `Handoff`) and `judge()` (line 355) is a fixed match over it. The "guardian is an AI pet that decides" is therefore false of the deployed contract: whoever calls `agent_act` chooses the action, and the contract scores it. There is no game. There is a payment with a scoring label.

**F. The Guardhouse, the security track's flagship, does not enforce anything on chain.** `LIVE_ENFORCEMENT = 'blocked'`. `contracts/guard/src/lib.rs` has no verdict, no signature, no `ecrecover`; `route()` forwards if `chain=="near" && asset=="NEAR"`, else refunds. The WARN hold is the board's `hold: true`, which is genuinely enforced — but the *decision to hold* is a browser FNV hash plus a server lookup against a deny list with **exactly one entry** (`shared/guard/denylist.json`: `attacker.r10own-19371.near`). A judge asking "what does the AI decide?" gets: nothing, the AI is not in the loop at the point of enforcement.

**G. The DAO is not a DAO.** `townhall.nearcarta.near` is signed by `nearcarta.near`. There is no proposal, council, or vote anywhere in the repo. "The DAO owns the rule" (`contracts/townhall/src/lib.rs` line 1) is a comment, not an architecture.

**H. The Hall is the Agent Economy track and it does not work.** Its one cited mainnet tx failed. Market hire is explicitly not live (README line 210: "Market hire is not available"). The job flow is a local ledger in `shared/hall/job.js` plus board calls; the worker accounts are typed by the poster. "A job splits a budget, takes real bids, counters once" describes a local state machine, and the one attempt to run it on chain was refused.

**I. Payouts cites zero new transactions.** README lines 273–277 are literal placeholders: `Pay 1: (assistant adds the nearblocks link)`, `Pay 2:`, `Pay 3:`, `Refusal:`, `Invoice:`. A judge reading the Real-World Money section finds five TODOs. The only payouts evidence is `4jEjzpiY…`, which the README itself says is not from this payroll run.

**J. Chronicle cites zero anchor transactions.** README lines 209, 220, 245: `Live anchor tx: (coordinator adds the nearblocks link)`. The shop's own copy says "Anchor downloads the bundle and says the live anchor is blocked". So the Autonomous Business track's provenance log does not anchor.

**K. The deployed board cannot do what the plan needs.** `docs/MAINNET_BOARD.md`: live code hash `Am4FLfph…`, "That wasm has no upgrade method, so this repo cannot put new code on it." `contracts/charter_board/src/v2.rs` has `propose_call_as`, `effects`, `holds`, `tighten_rules`, `anchor` — none of which are on the live account. I probed it: `board.anchor` and `list_rows` both return empty (indistinguishable from a missing method via `call_function`, which is itself a smell). The `propose_call_as` txs on mainnet are being served by the **live** board, so some of v2 is deployed — but `get_config` shows one row and the README's own limits section says the live wasm lacks `propose_batch`. The repo and the chain disagree about what the board can do, in three different files.

**L. Doc drift, measured.** `AGENTS.md` says "376 pass, 1 skipped"; the README badge says "467 pass, 3 skipped"; the README body says "893 (892 pass, 1 skipped)"; `npm test` says 893/892/1. Three different numbers for the same suite in the two files a judge is told to read first. `AGENTS.md` also says `cargo test --lib` is "122 pass" for oath and "15 pass" for `charter_board`; the README test table says `charter_board` is 29 and `oath` 122. `AGENTS.md` §10 still claims "A Pay checkout is capped at 0.20 USD before a deposit address is created" and cites a test `an amount over 0.20 USD never asks for a deposit address` — that cap was deliberately removed in commit `77c246ca` ("Take the checkout limit from the visitor's row, not a 0.20 USD constant"), and the test no longer exists. `backend/src/app.js` line 64 still says "The city shop is `extras.house.shop`" and the README line 31/106 says the same; **`extras.house.shop` does not exist on mainnet** (`UNKNOWN_ACCOUNT`). The live shop is `house.nearcarta.near`. `shared/deployments/mainnet.json` agrees with the chain; the prose does not.

**M. `npm run readme-numbers -- --check` fails on this commit.** I ran it twice: `# pass 890, # fail 2` the first time, `# fail 1` the second. The two failures were `a card csv keeps its currency and names the biggest waste` and `the built site does not name the rehearsal network` — both environment-dependent (the second reads `app/dist`, which is gitignored, so it passes only after a build). The CI job runs `npm ci && npm test && npm run readme-numbers -- --check`, so on a clean checkout this is either flaky or red. I could not get a deterministic failure to quote — **NOT VERIFIED** as a hard CI break, but it is not green here.

**N. Nothing is second-visitor tested.** `get_config` reports `rows: 1`. The plan's own acceptance criterion (`final-plan.md` §2 "any-user operation", §8 "Two unrelated rows derive distinct addresses") requires two independent visitors. There is one, and it is the project's own funded key. The README's "A real visitor, start to finish" (line 159) is the same key (`8e20273e…74e661c8`) that funded itself from `nearcarta.near`.

**O. The `?shop=` route does not reach the shop.** On `nearcarta.vercel.app/?shop=guard` I waited 11 seconds and read `Loading this room…` from `#shopUI`. The panel only appears with `?mode=2d&nostory`. Every marketing link, every README "open `/?shop=<id>`", lands on a loading card unless the visitor knows the undocumented flags. (Caveat: headless WebGL. **NOT VERIFIED** whether a GPU browser recovers.)

**P. The repo carries its own scratch files.** `shot2.mjs`–`shot6.mjs`, `shot-tmp.mjs` and `tmp-repro.mjs` are committed on this branch (they are *not* on `origin/main`; `git merge-base --is-ancestor fef0a0f9 origin/main` is false). Someone committed screenshot scripts and a Playwright repro into the product repo. A judge browsing the tree sees them.

**Q. The README is 359 lines and half of it is a defence.** "There is no product USD cap" appears five times (lines 19, 49, 173, 203, 349). "The API does not sign mainnet" appears four times. "A new deposit was not sent" appears three times. This is a project apologising in advance. It reads as a submission that expects to be accused of something. A judge's first impression of the README is *defensiveness*, not *confidence*, and that costs points before any code is read.

**R. There are nine shops and eight tracks, and the mapping is arbitrary.** Toll and Chronicle both claim Business. Ferry is DeFi. Bank is Privacy. Payouts is Real-World Money. Arena is Games. House is Open. Guard is Security. Hall is Agents. That is a *coverage strategy*, not a product. One good shop would beat nine shallow ones, and the board's five-pair limit means a visitor can only ever see two or three of them anyway.

---

## 7. Would it win?

| Track | Verdict | Why, in one sentence |
|---|---|---|
| **DeFi** | **POSSIBLE** | A real 1Click swap settled end to end and three real Base USDC deliveries (I fetched `0xe23f332d…`, `0x1e55eae7…` and `0xda4a4e7b…` from `mainnet.base.org`: all are `to=0x833589fcd…` with `input=0xa9059cbb…`) are a legitimate DeFi entry, but the flagship session swap is not in the proof record, no per-visitor slippage/DCA exists, and the "contract-controlled address" stretch the prompt asks for returns `address: null`. |
| **Agents** | **LOSE** | The track is judged on agents doing work and getting paid; the Hall's only on-chain attempt failed `below_min_amount`, market hire is not live, and the "agent" in most shops is a regex — a judge who types a sentence will see it. |
| **Security** | **POSSIBLE** | The charter's on-chain refusals are the best evidence in the repo and the adversarial suite is real, but the flagship Guardhouse does not enforce a verdict on chain (`LIVE_ENFORCEMENT = 'blocked'`), the deny list has one entry, and the TEE check never gates a payment. |
| **Privacy** | **LOSE** | Mist Bank is a browser CSV parser plus a NEAR AI call with a verified signature; the confidential-pay rail stays dry, the "TEE" does not change what the user gets, and the prompt's bar (private agents on real finance data) is not met by "audit this sample with your own pasted rows". |
| **Real-World Money** | **LOSE** | The section's evidence is five `(assistant adds the nearblocks link)` placeholders, there is no new payout tx, and the one invoice flow is a durable link that the API explicitly does not settle. |
| **Business** | **LOSE** | "Autonomous Business" needs a business with revenue, cost and a split; the toll's MPC signature was never broadcast, its ledger never shows a delivered foreign payment, and Chronicle's anchor is blocked, so there is no P&L to show. |
| **NFTs** | **POSSIBLE** | The deed is a genuine NEP-171 with a purse, an inheritance line and a check-in clock that travels with the token, and the transfer tests are strong — but the inheritance release, the Base vault and the heir same-address receipt are all "not sent", so the story stops at "an NFT that owns a purse on NEAR". |
| **Open** | **POSSIBLE** | The House is the most original *idea* in the submission (a deed that controls a foreign address and passes to an heir) and it is honestly labelled as not-live, which judges reward — but "honestly not done" is still not done. |

Realistically: **top-3 in Security if a judge only reads the charter, outside the money in everything else.** Not a grand-prize profile, because the grand prize goes to a project that does one thing completely, and this does nine things to 40%.

---

## 8. The single highest-leverage change

**Make the "AI Agent" a real model in one shop — and make that shop the Guardhouse — then delete the "AI Agent" label from every other shop until it earns the name.**

Concretely:

1. Wire `POST /api/vault/ask/plan` (`backend/src/agent.js` `propose`) into the Guardhouse dock so typing a sentence produces a *model* proposal with the TEE preflight, the signed response, and the `verification` block the backend already computes. The code exists and is tested; it is a `runAgent` hook in `app/design/D8_shops/js/shopui.js` that no shop currently supplies (`grep -c "runAgent:" app/design/D8_shops/js/shopui.js` → 0).
2. Put the model's verdict through the board hold (`hold: true`), which *is* enforced on chain, and show the signature + reason in the tray. Now the Security track has a real "AI decides, chain enforces" loop instead of an FNV hash.
3. Rename the other eight docks from "AI Agent" to "Commands" (or "Quick commands") and keep the identical parsers. They are good command palettes. They are not agents. Relabelling costs one string per shop and removes the single largest credibility risk in the submission.

**Why this beats everything else.** The submission's thesis is "the agent proposes, the charter decides." Right now the *charter* half is real and the *agent* half is mostly a regex with a robot avatar. A judge who tests that will discount every other claim, including the ones that are true — and the charter refusals *are* true and are the best thing here. One genuine model doing one genuine proposal inside one genuine hold, with the signature shown, converts the weakest claim into the strongest demo, and it is a wiring job on code that already exists (`backend/src/agent.js` is 166 lines, fully tested, and its only current consumer is the Arena's attack card).

Second place, if they only have time for one thing: **fix the two false citations and add the Ferry session swap and Base delivery txs to `shared/deployments/mainnet.json`, then make `mainnet-verify.js` assert the `method_name` against the label.** That is a two-hour change that removes the only findings in this review that read as dishonesty rather than incompleteness.

---

## Appendix: things a judge would catch in five minutes

```
1. README badge says 467 tests. AGENTS.md says 376. README body says 893. npm test says 893.
2. README line 273: "Pay 1: (assistant adds the nearblocks link)".
3. Open 51UktPvy… -> it is a failed `bid`, captioned "Post job … 0.001 NEAR in escrow".
4. Open CZEM7KEj… -> failed `upgrade`, captioned "upgraded in place to v8".
5. Type a sentence into Ferry's AI Agent -> no network request; canned "Try: …" reply.
6. curl /api/guardhouse/denylist -> one entry.
7. grep extras.house.shop README.md -> three hits; that account does not exist on mainnet.
8. board get_config -> rows: 1.
9. shared/board/session.js -> FOUR_SHOP_MAX_PAIRS = 5, for eight shops.
10. git ls-files | grep '^shot' -> six committed screenshot scripts.
11. npm run readme-numbers -- --check -> fails in this worktree.
12. Open https://nearcarta.vercel.app/?shop=guard -> "Loading this room…".
```

Any three of these in one reading session is enough to move a submission out of first place. All twelve are fixable, and most are fixable without writing new features — which is the most frustrating thing about this submission. The primitive is good. The presentation is undoing it.
