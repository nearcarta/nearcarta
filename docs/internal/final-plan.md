# Nearcarta final combined plan

Planning baseline: 6 November 2026, Africa/Cairo (UTC+2). Public-repository-safe planning: no credentials, personal wallet identities or named rivals. This plan supersedes conflicts in the [judge plan](judge-plan.md), [blueprint](shops-blueprint.md) and [deep briefs](shops/). [Source pack](source-pack.md), [research](research/) and [approved tray](design/approved-tray-ferry.jpg) remain evidence. Private summary informed feasibility but is not copied. Judge observations were on an older snapshot and mostly standalone pages: newer live CITY receipts override stale claims. Source quotations retain their VERIFIED/REPORTED/PROVISIONAL status, not endorsements or invented scoring weights.

## 1. Target and comparison

**FIRST IN ALL EIGHT TRACKS remains the target.** Nine doors cover eight tracks; Toll and Chronicle share Business. No outcome is guaranteed. Judge realism identifies stronger likely-first candidates (Guard, House, Ferry, Toll/Chronicle), which determines proof priority, not a lower goal for Bank/Payouts/Arena/Hall. A cut line cuts unproved stretch claims, not mandatory acceptance; honest fallbacks that miss gates are not final/10-of-10.

| Shop | Original plan | Judge plan | Final choice and why |
|---|---|---|---|
| Ferry | Proven manual cross-chain session; shared executor | Add slippage/repeats/derived recipient | Fix stale-key AI stamp first, use real swap function; preserve successful manual flow. Repeat/slippage follow correctness. |
| Toll | Per-visitor multichain wallet, USDC, gas fill, revenue | Autonomous relay, Base native first, no keeper | Per-user address + Base native AND USDC gates; keyless relay and real sale/cost/split. Extra chains after Base complete. |
| Chronicle | Any-account TEE auditor, new anchor account | Same, board event anchor | Adopt no new stake; retain rule-versus-action provenance, CSV, both-chain receipts. |
| Guard | OutLayer yield/resume core | Shared Cloud signed-verdict verifier, OutLayer optional | Protocol feasibility gate, shared verifier; keep on-chain non-bypassable enforcement. Advisory fallback not final. |
| Bank | Confidential pay + auditor + viewing keys | Auditor first, tighten rules/anchor | Auditor first matches prompt and uses working stack. Confidential payment is a separately proved gate, not a false public-private label. |
| Payouts | Exact invoice, cross-chain payroll, CSV | Same, prioritize payer page/gasless delivery | Keep original; require paid invoice and usable receipt, prove registration/sponsorship rather than assume it. |
| Arena | Guardian pots, inference, oaths, badges | Same economy, shared verifier, no city cut | Keep original economy, permissionless verified resolution; original already pays creators, not city tax. |
| House | Deed controls foreign vaults with inheritance | Same, shared signer, Base first/BTC labelled | Keep real control/inheritance; heir does NOT inherit old holder agent key/session privileges. |
| Hall | Real specialists/contractor, escrow, reviews, refunds | In-place narrow Hall, API gate, slash failed work | Keep real hire loop, adopt safe in-place migration. AI FAIL alone never confiscates worker bond. |

Adopt judge shared modules, zero-stake Chronicle, auditor-first Bank, keyless gas fill, board test rigor, dated gates and visual checks. Keep original arbitrary-user bar, substantive Base USDC/guardian/inheritance/hire acceptance and eight-track target. Correct deploy count: Board, Toll, Guard, House, Arena and Hall are **six code transitions**, even if Hall is in place. Only Guard necessarily needs a new account; Chronicle needs none.

## 2. Shared acceptance contract

Every shop answers: user gain; recipient and reason; differentiated composition versus ecosystem/past-winner archetypes; sourced judge/partner fit; any-user operation. Decorative transfers fail.

- No per-user deployments or deploy-fixed user receivers/amounts/allowlists. Visitor setup defines safety. Protocol identifiers, chain metadata, measured storage and visible configurable service pricing are not arbitrary user limits.
- AI and gold CTA call the EXACT SAME validated browser function, active key resolved at execution after refresh/reload/remount; server never signs. Incomplete intent asks, not invents. Invoice text is untrusted data and cannot replace a user's intended receiver or policy.
- No wallet popup after setup. Rights increases require explicitly owner-authorized setup update, not a disguised shop prompt. Read-only actions send no tx. Idempotency stops AI+button or Enter+click duplicate spend.
- NEAR receipt or MPC signature is not foreign delivery. Distinguish pending, held, refused, failed, refunded, delivered; cinema only on real final success/destination receipt or verified 1Click SUCCESS.
- No stranded/appropriated principal; gas/approved provider costs are actual expenses, not free. Liability-safe refunds precede teardown to nearcarta.near; never destroy foreign control with funded paths.
- Every stateful contract has access-controlled upgrade+migrate and safe close/reap. Disclose upgrade trust, delay/notice/code hash and withdrawal window; no false immutability claim.
- Hosted abuse ceilings are disclosed config, not fixed transaction amounts. Separate per-visitor/shop/global inference quota; funding increases require approval. Do not remove the last recovery key before proven replacement paths. No unconstrained full-access shop key remains after safety gate.

## 3. Board v2 decision

**YES. Owner chat: existing Board/Ferry session chat**, queued once AFTER its active stale-key Ferry fix. Never interrupt/restart active work or open duplicates. All shop chats run alone on grok-4.7 with no subagents.

### API and invariants

1. propose_call_as authenticates owner, active agent, receiver/method, exact args/deposit, nonce, expiry, network/contract/version domain. Require JSON object, overwrite reserved TOP-LEVEL row_owner, reject ambiguous/duplicate reserved fields. Nested identity never authorizes; shop trusts only this field AND board predecessor. Preserve compatible existing propose/propose_call.
2. Deposit counts against row per-action/daily NEAR limits. Bounded CALLS capacity becomes 24 unique receiver/method pairs, deduplicated; overflow and storage tested. Setup owner approves privilege expansion.
3. **Actual-effect budgets are mandatory for foreign/already-held assets.** Tiny service/MPC deposit cannot authorize draining ETH/USDC/House purse. Setup records visitor-selected chain/asset/value/receiver/fee limits. Signed action includes structured effects; board admits/reserves relevant budget and downstream contract constructs/validates exact decoded value/to/data/chain against that admission. Bind policy epoch/target; document counter ownership, nonces, failures and released reservations. No arbitrary-hash signing. Frontend checks alone fail. If not safely proved, foreign spending is blocked, not called protected by setup caps.
4. tighten_rules is monotonic: smaller cap/budget/receiver/method scope, shorter expiry, freeze. Never reset spent/day/nonces, unfreeze, swap key, grant calls, erase spend through policy version or loosen anything. Owner setup handles increases.
5. anchor emits bounded authenticated owner/kind/digest/nonce/time/version event, zero persistent storage per anchor. Rebuildable event index supplies query history; no imaginary anchors_of map. Private documents use optional salted commitments, never raw hash by default.
6. Authenticated allowlisted per-action settlement/refund callback restores the CORRECT row exactly once, or explicitly reconciles direct-owner refund. A plain transfer back to board is NOT a row refund. Test spoof/replay/failure/timeout.
7. WARN human approval is distinguishable from agent execution: setup grants a separately scoped confirmation authority bound to held digest and explicit browser user-presence intent, or equivalent enforceable design. Agent-callable unrestricted confirm is not human approval. Document browser-compromise boundary; no extra wallet popup.
8. Delayed owner-only upgrade/migrate preserves balances, policies, rows, pending actions, nonces. Keep close_charter/force_close/reap; cannot redirect visitor refunds. Account for aggregate liabilities before deletion.

### Migration gate

Chat confirms deployed wasm, keys and available upgrade path, not assumed source behavior. Snapshot rows, pending actions, NEAR/FT assets and rightful liabilities. Prefer verified safe upgrade. If reap/recreate required, exact authorized sequence is refund -> final receipt/balance check -> reap -> same-name recreate -> deploy -> setup key refresh, with separate owner approval. Never consume visitor money or pooled FT liabilities as treasury. Compile exact wasm, price storage/gas+reserve; no simultaneous creates. Keep recovery artifacts and clean reproducible toolchain, not an assumed SDK version.

Visitors redo setup only if needed. Remove only known obsolete board keys with authorization, preserve unrelated keys; allowance is not a funded purse. Sandbox blockers: two users; top-level/nested/duplicate spoof; non-object JSON; stale/replayed/domain signatures; deposit AND actual-effect caps; 24-pair limit; monotonic edges; guard bypass; human-confirm separation; refund callback spoof/replay; state-preserving migrate; complete liabilities before teardown.

## 4. Shared modules

### TEE verifier: Guard chat owns; Arena/Hall consume

Docs: https://docs.near.ai/cloud/verification ; https://github.com/nearai/nearai-cloud-verifier . Obtain real signed-response/attestation fixture. Exact algorithm/bytes, challenge/context binding, key lifecycle and on-chain gas are **UNVERIFIED until spike passes**. Do not assume judge's ecrecover/address recipe is correct. Authentic provenance does not prove model judgment or RPC input truth.

One versioned module verifies and parses only signed bytes. Bind network, contract, model/key epoch, row, action id/nonce, recipient/asset/amount, instruction/deliverable hash, policy, expiry. Reject reused/unbound outcomes; browser verification alone is not on-chain enforcement. If unsuitable, validate https://app.outlayer.ai/docs/getting-started actual mainnet id, pinned worker, caller/resume authenticity, context and refunds/cost. No silent advisory downgrade; fallback does not pass final target.

### Foreign signer: Toll owns; House consumes

Docs: https://docs.near.org/chain-abstraction/chain-signatures ; https://docs.near.org/chain-abstraction/chain-signatures/implementation ; https://docs.near.org/chain-abstraction/chain-signatures/tutorials/controlling-near-accounts/1-setup ; https://github.com/near-examples/near-multichain .

Canonical owner/deed+chain derivation, structured native/ERC-20 EIP-1559 build, MPC request/result verify, raw signed broadcast. Commit chain id, to/data/value, nonce and gas bounds; relay holds no key and cannot edit. Configured validated RPCs only, not arbitrary user endpoint. Base native+USDC first; additional chains separately proved. BTC address/signature-only unless real UTXO spend. Ferry funds current derived address; no keeper key.

### Executors, evidence and costs

Tools map to exact button executors/current key/idempotency. Typed receipts separate source/destination, action id, nonce, policy, verdict and explorer links. Chronicle consumes facts and labels coverage gaps. Export verifier bundle without private docs/secrets. Meter visitor/shop/global AI budget against actual credits. A guardian pays real reconciled inference expense or discloses subsidy, not merely a cosmetic counter.

## 5. Budget and owner decisions

Treasury input **about 0.45 NEAR**, not fresh guaranteed balance. Estimates below are planning, NOT approval. Measure latest balances/storage/liabilities/current wasm first.

| Transition | Recoverable estimate after liabilities | Requirement / net estimate |
|---|---|---|
| Board | ~1.09 NEAR stake | ~0.05–0.10 net + gas; larger v2 may grow |
| Toll | ~2.53–2.55 | recreate ~2.6; ~0.05–0.10 net + gas |
| Guard | none | ~1.0–1.5 new stake + runtime float |
| House | ~2.47–2.50 AFTER entitled purse refund | recreate ~2.6; ~0.10–0.15 net + gas |
| Arena | ~3.73 LESS pots/earnings | recreate ~3.8; ~0.07–0.15 net + gas |
| Hall | ~1.92–1.95 largely locked/obligated | ~0.3–0.5 extra storage if in-place, headroom unverified |
| Chronicle/Bank/Payouts | no new account | inference/action gas only, no new contract stake |

Added storage/deploy need roughly **1.6–2.5 NEAR before runtime reserve**, against 0.45 liquid: **~1.2–2.1 shortfall plus reserve**, IF all recycled stake really recoverable. Code growth/liabilities can increase it. Replacement float ~2.6–3.8 is recycled sequentially, not all additive expense, nor proof 0.45 suffices. Judge's 1.5 top-up is not guaranteed enough.

Owner decisions; no transfers/retirements authorized by this plan:
1. **A: top-up** exact measured shortfall+reserve or next milestone. Rough 2–3 extra NEAR envelope is proposal only, replace with precise ledger before approval.
2. **B: retire charter.nearcarta.near** for judge-estimated ~4.26 recovery ONLY after current obligations/control/foreign dependencies and historical verify/check-cited are rehearsed. Exact beneficiary/retirement require explicit approval; preserve proofs and label retired.
3. **C: combination/sequential funding**; never visitor money. If unavailable, code remains ready and mainnet blocked, not silent abandonment of tracks.
4. Approve exact board refunds/migration/reset and temporary maintenance separately.
5. Approve inference credits and each paid live test with amount+destination. Prior Ferry approval is not blanket spending authority.
6. Owner chooses cut-line scope/claim tradeoffs without lowering eight-track target.

**Deploy order:** Board v2 -> Toll/shared foreign service -> Guard -> House -> Arena -> Hall safe in-place migration. Six code transitions. Guard spike and code-only work run in parallel, not idle until deploy turn. Immediate non-contract work: Ferry AI fix, shared tray/executors, Payouts invoice, Chronicle audit, Bank auditor. Re-run Ferry manual+AI smoke after each transition. No dependent fake substitute if verifier/funding blocks.

## 6. Dated go/no-go

All dates **2026, Africa/Cairo UTC+2**, internal cutoff **18:00 Cairo**, NOT asserted official deadline. Re-read https://nearhackathon.com/HACKATHON.md before submission.

| Date | GO evidence | NO-GO |
|---|---|---|
| Nov 6 | Visual baseline/PR inventory/honesty fixes; Ferry key/executor regression | No AI-complete claim or conflicting dispatch |
| Nov 7 | Board effect/refund/human intent interface; real verifier fixture; public Market API feasibility; budget draft | Report gaps, no assumptions/spend |
| Nov 8 | Board adversarial+migration suite; verifier binding/gas or validated OutLayer; Bank data path | No on-chain-TEE claim/unapproved redeploy |
| Nov 9 | Approved Board proof; two-user Toll native+USDC and P&L | Shared address blocks; extra chains wait |
| Nov 10 | Guard ALLOW/WARN/BLOCK/refund/anti-bypass; stranger-paid invoice | Guarded route disabled, not advisory masquerade |
| Nov 11 | House old-holder revoke/same-address heir; Bank tighten; Chronicle anchor; cut-line review | Cut unproved stretch only, owner chooses funding/scope |
| Nov 12 | Arena two-player economy; Hall legacy migrate/escrow/review | No fake stalls/hires or unaudited spending |
| Nov 13 | Hall real work/pay/refund; city screenshots/fresh-user manual+AI; CI/README/scan/demo | Only proved claims; incomplete stays incomplete |
| Nov 14 | Official rules/timezone re-read; reproducible evidence; owner-approved submission | Never invent completion for missed gate |

No backdating. A two-minute demo may show labelled prepared timer/earlier receipt, not falsely compress real bridge/timer work.

## 7. City design contract

Reference [approved Ferry tray](design/approved-tray-ferry.jpg): top tabs, dark icon-flow card, labelled spaced fields, ONE raised gold CTA, max two short status lines. Real web3icons; no supported chain question-mark/blue-square placeholder. Plain value sentence; jargon behind tooltip.

Shop chat MUST open **https://nearcarta.vercel.app/?shop=<id> in its OWN browser**, within CITY/All shops. Screenshot EVERY tab at 1280x800 and 390x844, AI open, empty/error/refusal, success/held. Also verify actual PR preview/local CITY with URL+commit: old production baseline does not prove unmerged code. If preview absent, post-deploy check remains pending.

Fail handoff for stacked unlabeled white text, overflow/hidden fields, absent flow card, duplicate CTA, tiny controls, header/All shops/Back/AI overlap, load error. Button >=40px, tap target >=44x44; keyboard focus/Enter/arrow work. Human-labelled links, not long hashes. Legacy entry uses same tray. No cinema before success.

## 8. Final shop specifications

### toll

**Toll Bridge — Autonomous Business**

**Final concept:** A real autonomous signing/relay business: each visitor owns a distinct foreign address, pays any typed recipient under their setup limits, and sees genuine service revenue/cost/split in Chronicle.

1. **User gain:** No second seed phrase, with useful foreign payments constrained on chain.
2. **Money and why:** Typed recipient gets selected asset. Disclosed configurable fee buys MPC/relay work; realized surplus pays configured contributors after real costs. Foreign principal is never revenue.
3. **What is new:** Composition of per-row foreign wallet, non-editable spend budgets and executing AI with reproducible P&L, not a claim of an unverified global first.
4. **Judge/partner fit:** Source-pack §1 revenue/chain-abstraction and address-only receiving signals, §3 sale→cost→split, §8 P1 real foreign control. Partners: Chain Signatures and Intents gas fill.
5. **Any user:** Typed visitor parameters plus that visitor's current setup/session; two unrelated users pass without wallet-specific contract changes.

**Sources:** [source pack](source-pack.md) §1 revenue/address-only counterparty; §2 micropayments; §3 Business; §4 Chain Signatures/proxy path; §5 multichain; §7 R3; §8 P1; §11 toll; §12; [original deep brief](shops/toll-deep.md); [winner patterns](research/winners-patterns.md); [judge signals](research/judges-x-signals.md). Signals are sourced hypotheses, not endorsements.

**Primitives/docs:** https://docs.near.org/chain-abstraction/chain-signatures ; https://docs.near.org/chain-abstraction/chain-signatures/implementation ; https://docs.near.org/chain-abstraction/chain-signatures/tutorials/controlling-near-accounts/1-setup ; https://docs.near.org/chain-abstraction/chain-signatures/tutorials/multichain-dao/2-signing

**Contract/tasks:** Rework toll on existing account: board-authenticated cross/address_of, owner+chain derivation, per-row nonce/spend counters, configurable price/cost/split/pause policy, callback/refund, upgrade+migrate/close. Remove shared base-1 authority and owner-only visitor pay. Enforce actual native/ERC-20 decoded effects and receiver limits, not merely NEAR service fee. Contract constructs structured payload; no raw arbitrary signature. Keyless relay broadcasts fixed raw transaction. Base native AND USDC required. Ferry gas fill targets displayed derived address. Ledger separates pending signatures, delivered transfers, realized fees and costs. No hot keeper.

**AI executes:** Address/balances; explicit Ferry gas fill; typed recipient/asset/amount cross via EXACT Cross CTA; receipt/P&L. Missing intent asks, never inserts a default.

**Tray:** Pay / Wallet / Ledger. **Fields:** Pay: chain, asset, amount, destination, live fee, caps left. Wallet: derived address/copy/balances/explicit gas fill. Ledger: NEAR and foreign legs, costs/splits. **One active gold CTA:** Pay on selected chain.

**Demo under two minutes:** 0–20s two rows show different addresses; 20–45s inspect pre-funded wallet and Ferry proof; 45–90s AI cross reaches Base status 1; 90–115s over-cap attempt has no signature and ledger shows real cost/split. Show actual settlement delay honestly.

**Acceptance checklist:**
- [ ] Two unrelated rows derive distinct addresses, cannot use each other’s nonce/funds.
- [ ] Manual and AI native AND USDC produce real Base receipt with executor parity.
- [ ] Small NEAR fee plus excessive foreign value, calldata mismatch, wrong chain/payee and nonce replay fail BEFORE signing.
- [ ] Gas fill uses Ferry; broadcast failure never displays delivered; no private relay key.
- [ ] Fees/cost/split reconcile without principal; failed MPC refunds unused service deposit exactly once.
- [ ] Upgrade preserves counters; teardown waits until foreign control and all liabilities are safe.
- [ ] Functional: fresh visitor, AI/manual executor parity, no post-setup popup, idempotency/error/timeout cases and applicable unit/sandbox/e2e tests green.
- [ ] On-chain: coordinator adds separately approved real receipts/state assertions and exact amounts/recipients; shop chat sends NO mainnet tx. Live/dry/simulation labelled, never pending as success.
- [ ] Design: chat opens own CITY browser, every tab/AI/result at both §7 viewports; URL+commit screenshots in PR, no standalone-only substitute.
- [ ] Safety: applicable upgrade/migrate/liability-refund/teardown suite and README do-X-see-Y verification/proof placeholders.

**Existing PR:** #46: REWORK, not merge as completion. Retain recipient argument validation and upgrade/migrate tests; shared derived address is release blocker. Extend existing branch where practical. Historical #33/#43 do not prove per-user foreign spend.

**Shared ownership:** Own shared foreign-chain module; coordinate stable API with House; no competing implementation.

### chronicle

**Chronicle — Autonomous Business, supporting Toll (not a ninth track)**

**Final concept:** Any-account agent auditor: live typed timeline, rules-versus-actions statement, browser-verified TEE signature, optional board event commitment and reconciled CSV.

1. **User gain:** A readable answer to what an agent spent/refused/earned and whether it obeyed, without raw explorer work.
2. **Money and why:** No entry fee. Only actual disclosed inference and anchor gas; nobody receives a decorative payment.
3. **What is new:** Signed summary tied to canonical input manifest, exact receipts and rule versions, rather than another transaction list.
4. **Judge/partner fit:** Source-pack §1 verifiable provenance, §3 public Business ledger and §8 P4 reusable infra. NEAR AI is used for signed work, not a badge.
5. **Any user:** Typed visitor parameters plus that visitor's current setup/session; two unrelated users pass without wallet-specific contract changes.

**Sources:** [source pack](source-pack.md) §1 provenance/reproducibility; §3 Business; §4 NEAR AI verification; §7 ecosystem archetypes; §8 P4; §11 chronicle; §12; [original deep brief](shops/chronicle-deep.md); [winner patterns](research/winners-patterns.md); [judge signals](research/judges-x-signals.md). Signals are sourced hypotheses, not endorsements.

**Primitives/docs:** https://docs.near.ai/cloud/verification ; https://github.com/nearai/nearai-cloud-verifier ; https://docs.near.org/smart-contracts/anatomy/events ; https://docs.near-intents.org/

**Contract/tasks:** No new Chronicle account. Consume Board v2 event-only anchor and durable rebuildable index/cursor, not persistent anchors_of view. Any typed account timeline merges board, Ferry, Toll/foreign, Guard/Arena/Hall with coverage/gaps. Canonical bundle binds account/period/rule versions/receipt hashes/model/signature. Reconstruct historical rules when available; disclose missing versions. No RECORDED/static owner feed presented as live. Anchor exact reviewed digest with consent; private data uses salted commitment.

**AI executes:** Read timeline, filter refusals/costs; write/verify statement; Anchor CTA executes exact bundle; export CSV. Read-only requests send no transaction.

**Tray:** Timeline / Statement / Verify. **Fields:** Account, period, shop/chain/decision filters, coverage; statement/signature, commitment consent; bundle/hash verification input. **One active gold CTA:** Write statement, then Anchor in next state.

**Demo under two minutes:** 0–25s unrelated account live timeline/coverage; 25–60s receipt and refusal links; 60–90s verify signed statement; 90–115s anchor/recompute bundle and export CSV.

**Acceptance checklist:**
- [ ] Arbitrary unrelated account gives real history or honest empty/partial coverage, not fabricated completeness.
- [ ] No static owner defaults or paid entry; CSV totals match delivered/refunded/attempted categories.
- [ ] Tampered manifest/text/signature rejects; missing historic rules labelled.
- [ ] Board event equals downloaded digest and index can rebuild.
- [ ] Toll P&L and cross-chain legs link to original receipts; private document hash is not published unsalted.
- [ ] Functional: fresh visitor, AI/manual executor parity, no post-setup popup, idempotency/error/timeout cases and applicable unit/sandbox/e2e tests green.
- [ ] On-chain: coordinator adds separately approved real receipts/state assertions and exact amounts/recipients; shop chat sends NO mainnet tx. Live/dry/simulation labelled, never pending as success.
- [ ] Design: chat opens own CITY browser, every tab/AI/result at both §7 viewports; URL+commit screenshots in PR, no standalone-only substitute.
- [ ] Safety: applicable upgrade/migrate/liability-refund/teardown suite and README do-X-see-Y verification/proof placeholders.

**Existing PR:** #38: REWORK existing branch. Preserve dock/feed/filter/export/verify; delete paid entry/static fake rows. No Chronicle contract deploy.

**Shared ownership:** Own Chronicle data/bundle/index; consume Board anchor rather than modifying board in parallel.

### guard

**Guardhouse — AI Security & Defense**

**Final concept:** An enforceable firewall: ALLOW forwards, WARN holds until real human confirmation, BLOCK refunds, with transaction-bound attested verdict and setup-enforced anti-bypass routing.

1. **User gain:** An injected agent cannot redirect a payment, reuse an old ALLOW, auto-confirm a warning or strand blocked principal.
2. **Money and why:** Real intended payee on ALLOW; visitor receives refund on BLOCK/cancel. Only disclosed actual check costs may be charged, no fixed trick payment.
3. **What is new:** Verified AI output becomes a release condition, not an advisory score. It does not prove payee safety or model infallibility.
4. **Judge/partner fit:** Source-pack §1 judgement-as-code and security that acts; §3 prompt-injected payment must be blocked. NEAR AI verifier, optionally validated OutLayer.
5. **Any user:** Typed visitor parameters plus that visitor's current setup/session; two unrelated users pass without wallet-specific contract changes.

**Sources:** [source pack](source-pack.md) §1 judgement-as-code/injection/active security; §3 Security; §4 verification/OutLayer/access keys; §7 R4–R6; §8 P2/P4; §11 guard; §12; [original deep brief](shops/guard-deep.md); [winner patterns](research/winners-patterns.md); [judge signals](research/judges-x-signals.md). Signals are sourced hypotheses, not endorsements.

**Primitives/docs:** https://docs.near.org/protocol/accounts-contracts/access-keys ; https://docs.near.ai/cloud/verification ; https://github.com/nearai/nearai-cloud-verifier ; https://app.outlayer.ai/docs/getting-started

**Contract/tasks:** New guard account only after funding/protocol gates. Implement pay_guarded/confirm/cancel/report-evidence, signer policy rotation, deadline refunds, upgrade+migrate/close. Bind full transaction context in §4, no replay/unbound model text. Guard-required setup must exclude bypass routes; backend wrapper is insufficient. WARN requires separate human-intent authentication from §3, never unrestricted AI confirm. Foreign spending consumes matching guard verdict in Toll/House before MPC, not merely a NEAR forwarding proxy. Live signals disclose missing data; reports are evidence, not an immutable global deploy-time denylist. No provider proof, no on-chain-TEE claim.

**AI executes:** Typed payee check; prepare/execute via Pay safely CTA; inspect held/refunded action; request human confirmation; freeze/tighten only, never silently downgrade to unguarded payment.

**Tray:** Check / Pay safely / Blocks. **Fields:** Payee, chain/asset/amount, instruction/invoice, evidence/reasons; held id with separate human confirm/cancel state. **One active gold CTA:** Check payee, then Pay through guard.

**Demo under two minutes:** 0–30s typed payee evidence; 30–65s WARN held and explicit human confirm releases without wallet popup; 65–100s poisoned invoice BLOCK/refund; 100–115s inspect bound verdict/refund receipt.

**Acceptance checklist:**
- [ ] ALLOW forwards exact signed payment, BLOCK refunds once, WARN stays held until genuine human intent.
- [ ] Edited text/different amount/payee/row/chain, old key epoch, expired or replayed verdict rejects.
- [ ] Injected agent cannot bypass guard through directly allowed route or fabricate WARN confirm.
- [ ] Unknown data remains UNKNOWN/WARN; no fixed poison payee/trick transfer or custody overclaim.
- [ ] Every held payment has timeout/cancel and audited refund; raw transfer to board is insufficient.
- [ ] Cloud/OutLayer bound-context and gas spike passes before any on-chain-enforcement completion claim.
- [ ] Functional: fresh visitor, AI/manual executor parity, no post-setup popup, idempotency/error/timeout cases and applicable unit/sandbox/e2e tests green.
- [ ] On-chain: coordinator adds separately approved real receipts/state assertions and exact amounts/recipients; shop chat sends NO mainnet tx. Live/dry/simulation labelled, never pending as success.
- [ ] Design: chat opens own CITY browser, every tab/AI/result at both §7 viewports; URL+commit screenshots in PR, no standalone-only substitute.
- [ ] Safety: applicable upgrade/migrate/liability-refund/teardown suite and README do-X-see-Y verification/proof placeholders.

**Existing PR:** #35: REWORK existing branch, salvage check endpoint/tray, replace trick transfer; fix red CI. Do not merge advisory-only claim as final.

**Shared ownership:** Own shared TEE verifier spike/module and versioned interface for Arena/Hall; actual protocol, not assumed ecrecover.

### bank

**Mist Bank — Privacy & Private AI**

**Final concept:** Private teller: audit statement with verifiable confidential inference, explain spending/anomalies, and apply only visitor-approved tighter setup limits.

1. **User gain:** Useful private review that changes actual risk limits, not attestation beside an ordinary public transfer.
2. **Money and why:** No meaningless payment. Disclosed real inference cost. Confidential pay, if proved, delivers to typed recipient with solver fees.
3. **What is new:** Fresh-challenge signed private analysis plus executable monotonic cap update; viewing-key sharing remains gated future work.
4. **Judge/partner fit:** Source-pack §3 private expense auditor with fictional samples; §1 privacy and TEE/proxied distinction. Partner NEAR AI Cloud, not a false private-payment badge.
5. **Any user:** Typed visitor parameters plus that visitor's current setup/session; two unrelated users pass without wallet-specific contract changes.

**Sources:** [source pack](source-pack.md) §1 privacy/TEE versus proxy; §2 private work/viewing keys; §3 Privacy; §4 verification/confidential swaps/authentication; §7 R1; §8 P2; §11 bank; §12; [original deep brief](shops/bank-deep.md); [winner patterns](research/winners-patterns.md); [judge signals](research/judges-x-signals.md). Signals are sourced hypotheses, not endorsements.

**Primitives/docs:** https://docs.near.ai/cloud/verification ; https://github.com/nearai/nearai-cloud-verifier ; https://github.com/nearai/private-ml-sdk ; https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/confidential-swaps ; https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication

**Contract/tasks:** No Bank contract; consume board tighten/anchor. Three fictional samples and bounded arbitrary CSV. Browser fresh challenge and provider/model eligibility verification, signed report, no retention. Specify real browser/backend/provider/TEE data path: no server-cannot-see-input claim unless end-to-end protection proved. Public anchor only opt-in salted commitment, never raw financial hash. Confidential settlement behind capability flag until documented access/corridor/signing/no-popup and actual receipt pass. No false private label on public propose or server Zcash transfer claim.

**AI executes:** Audit selected sample/upload through Audit CTA; report-grounded questions; prove attestation; compare proposed caps and apply explicitly chosen tightening with shared function. No unsolicited rule change.

**Tray:** Audit / Attestation / Proof log. **Fields:** Sample/upload, eligible TEE model, fresh nonce; summary/anomalies; proposed before/after limits and publication consent. **One active gold CTA:** Audit privately, then Apply tighter limits in review state.

**Demo under two minutes:** 0–20s fictional statement; 20–65s audit and fresh-response verification/data boundary; 65–95s compare/apply tightening without popup; 95–115s commitment and tamper test.

**Acceptance checklist:**
- [ ] Three runnable fictional samples plus arbitrary valid CSV; logs/errors/analytics/cache never retain statement text.
- [ ] Fresh challenge and signature verify browser/backend; proxied model never inherits TEE label.
- [ ] Actual privacy boundary documented; no server-blind claim from no-retention alone.
- [ ] All loosening/reset/unfreeze variants reject; only salt commitment published with consent.
- [ ] No fixed notes/private-public transfer; confidential feature disabled until access/route/receipt/no-popup proved.
- [ ] Provider/verifier outage fails honestly, no fake verified report.
- [ ] Functional: fresh visitor, AI/manual executor parity, no post-setup popup, idempotency/error/timeout cases and applicable unit/sandbox/e2e tests green.
- [ ] On-chain: coordinator adds separately approved real receipts/state assertions and exact amounts/recipients; shop chat sends NO mainnet tx. Live/dry/simulation labelled, never pending as success.
- [ ] Design: chat opens own CITY browser, every tab/AI/result at both §7 viewports; URL+commit screenshots in PR, no standalone-only substitute.
- [ ] Safety: applicable upgrade/migrate/liability-refund/teardown suite and README do-X-see-Y verification/proof placeholders.

**Existing PR:** #37: REWORK existing branch. Preserve verified-attestation/no-retention UI, replace note-pay with auditor; remove false Zcash/custody/privacy copy.

**Shared ownership:** Own private audit/data-path tests; consume Board APIs and existing verifier references, do not deploy another contract.

### payouts

**Payouts — Real-World Money**

**Final concept:** Get paid anywhere and pay people on chosen chains: durable exact-dollar invoice links, real payer page, capped multichain payroll and reconciled CSV.

1. **User gain:** Freelancer accepts clients’ existing assets; employer pays/reconciles without giving agent unlimited wallet rights.
2. **Money and why:** Immutable invoice issuer and typed payroll recipients; disclosed solver/network fees. No city cut, no quote called payment.
3. **What is new:** Checkout alone is common; differentiation is cap-enforced AI payroll/invoice workflow, guarded recipients and verifiable statements.
4. **Judge/partner fit:** Source-pack §3 asks for stranger-paid invoice, exact USDC on NEAR, no freelancer gas purchase. §2 universal checkout, §1 any-address counterparty.
5. **Any user:** Typed visitor parameters plus that visitor's current setup/session; two unrelated users pass without wallet-specific contract changes.

**Sources:** [source pack](source-pack.md) §1 address-only counterparty; §2 universal checkout; §3 RWM; §4 1Click/NEP-141/meta tx; §7 R4/R7; §8 P3; §11 payouts; §12; [original deep brief](shops/payouts-deep.md); [winner patterns](research/winners-patterns.md); [judge signals](research/judges-x-signals.md). Signals are sourced hypotheses, not endorsements.

**Primitives/docs:** https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart ; https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication ; https://docs.near.org/protocol/transactions/meta-tx ; https://github.com/near/NEPs/blob/master/neps/nep-0141.md

**Contract/tasks:** No new contract; reuse Ferry/session. Durable /pay/<id> EXACT_OUTPUT record/status, immutable receive account/amount, quote expiry/refundTo and double-pay/idempotency handling. Payer query cannot redirect issuer. Verify zero-NEAR issuer token registration/usability; if sponsorship required, design bounded real funded mechanism, not assumed solver storage coverage. Payroll exact rows across supported chains, guard policy and per-row idempotent settlement; partial failure explicit. Remove fixed 0.005/0.20 business caps; visitor limits plus disclosed hosted config. Embeddable plain HTML checkout, source/destination fee/receipt CSV.

**AI executes:** Create explicitly specified invoice via CTA; execute reviewed payroll via Pay rows; show overdue/status/CSV. External payer wallet payment is separate from city session no-popup claim.

**Tray:** Invoice / Payroll / CSV. **Fields:** Invoice USD/receive account/memo/due/expiry; payer source chain/token/refund address; payroll receiver/chain/asset/amount, review and caps left. **One active gold CTA:** Create invoice link OR Pay reviewed rows on active tab.

**Demo under two minutes:** 0–25s durable invoice link; 25–75s second browser foreign-chain payment and exact USDC receipt; 75–110s three-chain payroll/over-cap refusal/CSV. Slow legs may show explicitly labelled earlier receipts, not invented live completion.

**Acceptance checklist:**
- [ ] Unrelated payer reloads/pays invoice and exact output independently confirmed on destination.
- [ ] Issuer with zero NEAR receives usable USDC via proved registration/sponsorship; no false gasless claim.
- [ ] Session payroll has three destination-chain proofs, over-cap row refuses before deposit, paid rows cannot replay.
- [ ] Invoice query tampering cannot redirect; chain address/refundTo/recipientType validated.
- [ ] No fixed business cap constants; partial rows and source/destination/fees/refunds reconcile in CSV.
- [ ] Plain HTML embed works and status never stamps PAID until real SUCCESS.
- [ ] Functional: fresh visitor, AI/manual executor parity, no post-setup popup, idempotency/error/timeout cases and applicable unit/sandbox/e2e tests green.
- [ ] On-chain: coordinator adds separately approved real receipts/state assertions and exact amounts/recipients; shop chat sends NO mainnet tx. Live/dry/simulation labelled, never pending as success.
- [ ] Design: chat opens own CITY browser, every tab/AI/result at both §7 viewports; URL+commit screenshots in PR, no standalone-only substitute.
- [ ] Safety: applicable upgrade/migrate/liability-refund/teardown suite and README do-X-see-Y verification/proof placeholders.

**Existing PR:** #34: KEEP/REWORK, merge only after listed invoice/cap/idempotency/design fixes and green checks. Not permission to merge unfixed quote-only flow.

**Shared ownership:** Own invoice/payer/payroll; consume existing Ferry executor and later Guard, no rewrite of foreign signer.

### arena

**Vault Arena — Games With Real Economies**

**Final concept:** Player-owned guardian pets: feed real pot, pay real entry fee, try in-oath win; model jailbreak beyond oath is refused on chain and earns bounded non-financial case badge.

1. **User gain:** Players can win prizes and benchmark receipts; creators maintain/price guardians whose demand/survival drive economy.
2. **Money and why:** Fees fund pot, creator earnings and real disclosed inference under visible creator policy. Winner gets actual payout; city takes nothing.
3. **What is new:** Verified answer tied to immutable-for-attempt oath and player-owned pot, not house-run unverified model outcome.
4. **Judge/partner fit:** Source-pack §2 AI pet paying its brain and §3 game-loop/economy; §8 P6 says gameplay must be real. NEAR AI/NEP-245 only claimed with actual interfaces.
5. **Any user:** Typed visitor parameters plus that visitor's current setup/session; two unrelated users pass without wallet-specific contract changes.

**Sources:** [source pack](source-pack.md) §1 injection; §2 verifiable AI pet; §3 Games; §4 verification/NEP-245; §7 R8; §8 P6; §11 arena; §12; [original deep brief](shops/arena-deep.md); [winner patterns](research/winners-patterns.md); [judge signals](research/judges-x-signals.md). Signals are sourced hypotheses, not endorsements.

**Primitives/docs:** https://github.com/near/NEPs/blob/master/neps/nep-0245.md ; https://github.com/near/NEPs/blob/master/neps/nep-0171.md ; https://docs.near.ai/cloud/verification

**Contract/tasks:** Arena v2 open mint/feed/attempt/resolve/withdraw, authenticated row-owner attempts not board predecessor, timeout/refund, creator fee policy, upgrade/migrate/close. Snapshot oath/persona/fee at attempt. Permissionless resolve only with shared verified bound envelope; no backend spending FAK. Contract oath controls payout even when model fooled. Real metered inference cost or disclose subsidy, empty budget sleeps. Preserve standards-compliant NFT guardians plus NEP-245 badges if least-risk; no claim all assets are NEP-245 without interfaces. Delete static market/nonexistent stall accounts. Simulation uses current live state but labels simulation and signs nothing.

**AI executes:** Mint via Mint CTA, attack selected guardian via Attack, explicit feed amount, actual score/badges/earnings/withdraw. No simulated reward presented live.

**Tray:** Guardians / Attack / Score. **Fields:** Guardian pot/fee/creator/history; mint title/persona/oath/pot/fee/split; selected target/message/live fee; actual winnings/badges/explorers. **One active gold CTA:** Mint guardian OR Attack guardian on active tab.

**Demo under two minutes:** 0–25s A mints/B selects; 25–70s paid attempt changes pot and returns verified reply; 70–100s show in-oath payout and over-oath refusal/badge; 100–115s leaderboard and creator earnings. Week fast-forward separately labelled simulation.

**Acceptance checklist:**
- [ ] Two unrelated rows mint/play independent attempts; no fixed guardian-only path or nonexistent merchant.
- [ ] Fees, real inference expense, creator withdrawal, prize and timeout refund reconcile.
- [ ] Swapped player/prompt/attempt/oath/response/nonce rejects; oath and pot bound payouts.
- [ ] Empty-budget sleep/provider outage cannot silently drain pot or strand entry fee.
- [ ] Permissionless resolve cannot invent outcome; no backend signing account.
- [ ] NEP-245 badge interface tests and bounded farming; simulation sends nothing.
- [ ] Functional: fresh visitor, AI/manual executor parity, no post-setup popup, idempotency/error/timeout cases and applicable unit/sandbox/e2e tests green.
- [ ] On-chain: coordinator adds separately approved real receipts/state assertions and exact amounts/recipients; shop chat sends NO mainnet tx. Live/dry/simulation labelled, never pending as success.
- [ ] Design: chat opens own CITY browser, every tab/AI/result at both §7 viewports; URL+commit screenshots in PR, no standalone-only substitute.
- [ ] Safety: applicable upgrade/migrate/liability-refund/teardown suite and README do-X-see-Y verification/proof placeholders.

**Existing PR:** #39: REPLACE static market concept; salvage safe tray/dock/tests. If needed open linked replacement; request old PR closure only after reviewable successor, do not close automatically.

**Shared ownership:** Own game economy; consume Guard shared verifier as versioned dependency, no second verifier or backend signer.

### house

**Your House — Open Innovation**

**Final concept:** Deed controls real foreign vaults and can pass to heirs after missed check-in, guardian threshold and cancellable wait, without seed-phrase handover.

1. **User gain:** Holder keeps control/cancel window; heir gains actual authority over same foreign address, not an address display.
2. **Money and why:** Holder’s typed payees or designated heir; no city sale. Storage/MPC explicit, guardians do not gain free spending access.
3. **What is new:** Stable deed-owned foreign control plus session check-in and transparent inheritance state, not a claimed global first.
4. **Judge/partner fit:** Source-pack §3 Open prompt is inheritance controlling foreign addresses; §8 P1 needs real spend, §1 chain-control/seed-phrase signal supports thesis.
5. **Any user:** Typed visitor parameters plus that visitor's current setup/session; two unrelated users pass without wallet-specific contract changes.

**Sources:** [source pack](source-pack.md) §1 chain control/seed phrase; §3 Open inheritance; §4 Chain Signatures proxy/NEP-171/upgrade; §8 P1; §11 house; §12; [original deep brief](shops/house-deep.md); [winner patterns](research/winners-patterns.md); [judge signals](research/judges-x-signals.md). Signals are sourced hypotheses, not endorsements.

**Primitives/docs:** https://github.com/near/NEPs/blob/master/neps/nep-0171.md ; https://docs.near.org/chain-abstraction/chain-signatures ; https://docs.near.org/chain-abstraction/chain-signatures/tutorials/controlling-near-accounts/1-setup ; https://docs.near.org/smart-contracts/release/upgrade#migrating-the-state

**Contract/tasks:** House v3: board-authenticated current holder mint/check-in/set-line/pay/sign; direct holder path may retain yocto guard. Stable deed path, shared foreign build/sign, actual-effect caps. Threshold guardian approvals/start/cancel/finalize, timer/epoch views, upgrade/migrate/close. Ownership epoch revokes former-holder session and queued signing, recheck async callbacks. Heir uses own setup, NOT inherited old agent key/caps. Changing heirs/loosening rights needs owner-intent authorization, not free agent tool. Existing purse refund/withdraw goes only to rightful holder, never spend merely to unlock close. Teardown cannot destroy control of funded foreign path; BTC signing-only honest unless actual spend.

**AI executes:** Mint with explicit params; I’m alive via check-in CTA; owner-authorized heir update; Send from vault via exact CTA; inspect/cancel release, never old-holder control after transfer.

**Tray:** Deed / Vaults / Heirs. **Fields:** Deed holder/check-in; chain/derived address/balance/payee/asset/amount/gas; heir/guardians/threshold/period/wait/approvals/countdown/cancel. **One active gold CTA:** I’m alive OR Send from house on active tab.

**Demo under two minutes:** 0–25s mint/check-in; 25–65s pre-funded Base send; 65–100s labelled prepared release/cancel and completed heir transition; 100–115s heir same-address send/former-holder refusal. Full multi-minute wait cannot honestly start and finish in a two-minute demo.

**Acceptance checklist:**
- [ ] Unrelated visitors mint/check-in/sign through own sessions; no predecessor=holder bug.
- [ ] Base receipt proves contract control; heir receipt uses identical address.
- [ ] Threshold/early finalize/cancel/stale release/hostile and lost guardian/offline owner cases covered.
- [ ] Ownership epoch blocks prior-holder session/queued signing including async callback race.
- [ ] Actual foreign value/to/asset caps enforced, not only fee; heir uses own setup.
- [ ] BTC scope honest; upgrade preserves state; liabilities and foreign evacuation block unsafe close.
- [ ] Functional: fresh visitor, AI/manual executor parity, no post-setup popup, idempotency/error/timeout cases and applicable unit/sandbox/e2e tests green.
- [ ] On-chain: coordinator adds separately approved real receipts/state assertions and exact amounts/recipients; shop chat sends NO mainnet tx. Live/dry/simulation labelled, never pending as success.
- [ ] Design: chat opens own CITY browser, every tab/AI/result at both §7 viewports; URL+commit screenshots in PR, no standalone-only substitute.
- [ ] Safety: applicable upgrade/migrate/liability-refund/teardown suite and README do-X-see-Y verification/proof placeholders.

**Existing PR:** #36: SUPERSEDE with v3, salvage inheritance state/tests not fake board purse pay. Verify actual deployed upgrade/key state before choosing safe upgrade vs authorized teardown; link successor before requesting closure.

**Shared ownership:** Own deed/guardian/authority state; consume Toll foreign module, no duplicate signing implementation.

### hall

**Town Hall — Agent Economy, NOT Social Money**

**Final concept:** Contractor splits job inside visitor budget, gets real bids, counters once, reviews deliverables, pays accepted parts and refunds unused escrow.

1. **User gain:** Buy specialist work without entrusting worker/contractor with whole wallet; evidence-linked receipt for every part.
2. **Money and why:** Actual workers for accepted parts; unused escrow back to poster. Registration stake stays withdrawable liability, not city revenue.
3. **What is new:** Budget-bound multi-agent procurement with signed work review and guarded recipients, beyond single-hire escrow. No fake public API integration.
4. **Judge/partner fit:** Source-pack §2 guarded hire-a-swarm and §3 decomposition/counter-once/pay/receipts. Agent Market integration only if documented API permits and real hire proves it.
5. **Any user:** Typed visitor parameters plus that visitor's current setup/session; two unrelated users pass without wallet-specific contract changes.

**Sources:** [source pack](source-pack.md) §1 agents earning/manager; §2 guarded swarm; §3 Agents; §4 Market/API; §7 ecosystem; §8 P2/P4; §11 hall; §12; [original deep brief](shops/hall-deep.md); [winner patterns](research/winners-patterns.md); [judge signals](research/judges-x-signals.md). Signals are sourced hypotheses, not endorsements.

**Primitives/docs:** https://market.near.ai/skill/SKILL.md ; https://docs.market.near.ai/list-your-agent ; https://market.near.ai/jobs ; https://docs.agentsonintents.com/integration/agent-api/overview ; https://docs.near.ai/cloud/verification

**Contract/tasks:** Prefer in-place townhall migration only after full legacy snapshot/obligation mapping and sandbox rehearsal; never blind ignore_state reset. NEAR escrow first. post_job/register_agent/bid/counter/award/deliver/release/refund, per-row authority, budget conservation/deadline, upgrade/migrate/close. Contractor outputs use visitor-authorized session executor, no extra backend hot key. Review binds job/part/worker/price/deliverable/policy; prevent double release. AI FAIL means no payment/contest/refund, not subjective stake seizure. Preserve/refund old bounty obligations with proper authority. Verify public Market API before building around it; real registered workers not invented substitutes for advertised external hires. Remove final full-access key only after safe paths proven.

**AI executes:** Post exact task/budget; split bounded parts; real agent discovery; counter once then accept/walk; award/review/release/refund through matching CTA functions. No scripted result claimed live external hire.

**Tray:** Post job / Agents / Receipts. **Fields:** Task/budget/asset/deadline/max parts; real worker endpoint/quote; one counter; deliverable/review/acceptance/escrow remaining. Personal rules link setup. **One active gold CTA:** Post job OR single selected part action.

**Demo under two minutes:** 0–25s post bounded real task; 25–55s distinct workers bid/counter; 55–90s one part passes/paid, one fails/unpaid; 90–115s refund/receipts. Short actual work, no fake lamp check.

**Acceptance checklist:**
- [ ] Any unrelated visitor posts and eligible worker registers; no only_dao restriction.
- [ ] Two independent actual workers deliver; full target includes real external Market hire if public API exists. Unavailable API is explicit integration gap, not passed criterion.
- [ ] Escrow=paid+remaining+refunded; no overspend/double release, stake never treated revenue.
- [ ] Swapped review/payee rejects; Guard BLOCK cannot release; timeout/cancel refunds.
- [ ] AI FAIL alone never slashes stake; contest/withdraw rules explicit.
- [ ] Legacy migrate preserves obligations; safe upgrade/refund/close before full-access removal.
- [ ] Functional: fresh visitor, AI/manual executor parity, no post-setup popup, idempotency/error/timeout cases and applicable unit/sandbox/e2e tests green.
- [ ] On-chain: coordinator adds separately approved real receipts/state assertions and exact amounts/recipients; shop chat sends NO mainnet tx. Live/dry/simulation labelled, never pending as success.
- [ ] Design: chat opens own CITY browser, every tab/AI/result at both §7 viewports; URL+commit screenshots in PR, no standalone-only substitute.
- [ ] Safety: applicable upgrade/migrate/liability-refund/teardown suite and README do-X-see-Y verification/proof placeholders.

**Existing PR:** #40: REPLACE pretend hire core, salvage safe dock/rules/tests in linked successor, fix CI. No townhall payee for nonexistent work; no automatic PR closure.

**Shared ownership:** Own contractor/job state only; consume shared verifier/Guard and documented Market, no board rewrite.

### ferry

**Track: DeFi.** Live-catalog NEAR session swap to typed destination address. Mainnet manual NEAR→Base is proven in README. AI is still incomplete: known stale-key charter stamp instead of actual swap. Fix shared executor/current key first without regressing manual proof. No new live spend authorized by plan.

Five answers: capped cross-chain receipt without second wallet; typed recipient plus actual solver/network service costs; differentiator is one enforced session across city, not a generic private swap; source-pack §1 address/chain-abstraction and §3 DeFi wishlist; any visitor chooses pair/amount/chain/address and uses their own setup limits. Docs: https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart ; https://docs.near.org/protocol/accounts-contracts/access-keys . No shop contract, preserve board/wrap/transfer/status path.

Tabs **Swap / Routes / Rules**. Fields token/chain, amount/output, typed receive address; bounded max slippage/repeat count/interval after core. Single quote→swap gold CTA. AI quote/swap/status/repeat uses exact button functions, never stamp substitute. Demo <2m: quote, no-popup AI swap, actual verified delivery, over-limit refusal; show delay honestly. Acceptance: refreshed key after reload/remount, no false frozen state, destination receipt/cinema, FAILED/REFUNDED, real web3icons, city §7 screenshot check; repeats stop with tab/session and respect aggregate budget unless durable execution really shipped. Board migration must preserve proof history and trigger manual+AI regression. Existing Ferry chat owns fix then queued Board task; do not disturb active run.

## 9. PR disposition and handoff

| PR | Action recommended, not automatic authorization |
|---|---|
| #34 | Payouts rework then merge after exact-output/cap/idempotency/design gates |
| #35 | Guard rework, salvage check/tray, fix CI; shared verifier owner |
| #36 | House supersede with v3; salvage inheritance tests |
| #37 | Bank auditor rework; no public-private payment theatre |
| #38 | Chronicle rework; no new contract stake |
| #39 | Arena replace static market, reuse safe UI/tests |
| #40 | Hall replace pretend hire; rehearse in-place migration |
| #46 | Toll rework recipient/upgrade work into per-user foreign service; shared address blocks |
| #49 | Preserve judge document as separate historical input after scanning; final plan governs conflicts |

Check actual branch/state/checks before acting on PR numbers. Do not automatically close/merge/deploy from this table. Use existing owning chats, queue a prompt ONCE, no duplicate interruption. Shops work alone on **grok-4.7, NO subagents**, scoped branch+PR, no mainnet tx/deploy or private data. Coordinator reviews/scans and obtains any needed irreversible-action approval before merge/deploy/live proofs. No conflicting shared-file work. No force-push or rewriting published history.

## 10. Final release evidence

- [ ] All eight track claims have distinct useful acceptance proof; no ninth track invented.
- [ ] Fresh-visitor city manual+AI no-popup proof, desktop/mobile screenshots, refusal/failure states for every shop.
- [ ] Board identity/actual-effect budgets/human intent/refund/migration/teardown adversarial suites and principal reconciliation.
- [ ] No lost derivation control; old-holder authority revoked on inheritance; foreign scope honest.
- [ ] TEE/private/guarded claims match actual protocol/data/enforcement boundary.
- [ ] README do-X-see-Y reproduces from clean environment; each claim links to test/receipt, all CI green.
- [ ] Secret scan exact judge-plan.md, final-plan.md and staged diff; no personal wallet identity/private notes/named rivals.
- [ ] No automatic mainnet spending, retirement, deletion, PR closure or submission from this planning file.

## Owner decision: funding

Retire contracts that are old or unused, after confirming no live shop or README proof depends on them. Send their balance to nearcarta.near through teardown and reuse it for new deploys. The first candidate is charter.nearcarta.near.
