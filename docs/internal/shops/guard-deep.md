# Guardhouse — deep brief (AI Security)

**Audience:** the Cursor chat that owns `guard` (PR #35 open, branch `cursor/guard-city-shop-11ea`).
**Do not** send mainnet txs or deploy. Teardown to `nearcarta.near`. Do not claim TEE custody we do not have.

## Read first
1. `docs/internal/source-pack.md` §1 (Illia: SHIELD paused Intents; "turn judgement into code via verifiable AI"; injections in the wild; 1337wallet critique), X fact: Agent Market security agents only write reports, none refuses; §3 Security row; §4 **OutLayer yield/resume**, NEAR AI verification, access keys; §7 R4 R5 R6; §8 P2 P4; §12.
2. `docs/internal/research/tracks/06-security.md` (counterparty allow/warn/block + reasons; injected agent stopped; show the log).
3. Code: `app/src/panels/deep.js` `mountGuard` L678–709, `app/src/guard-score.js`, `backend/src/guardhouse.js`, `counterparty.js`, `board-guard.js`, `outlayer.js`, `shared/guard/denylist.json`, `app/design/D8_shops/js/shopui.js` APPS.guard; PR #35: `app/src/panels/guard-{agent,tray,dock}.js`, `guard.css`, `backend/test/unit/guard-city.test.js`.

## 1. Attack the idea
| Question | Today (main + PR #35) |
|---|---|
| 1. Problem / gain | Real: agents get tricked into paying bad addresses. The check returns allow/warn/block with reasons from live RPC signals + a denylist. |
| 2. Who gets the money | After "allow", the trick pays **0.001 NEAR to the checked account** (`guard-agent.js:12–14,61,128`) just to prove the gate. A payment that buys nothing. |
| 3. What is new | Weak: the verdict is **advisory** (off-chain API); rivals R5/R6 do the same. Our real edge — the board refusing on chain — is not connected to the verdict. OutLayer is `enabled: false`. |
| 4. Why judges love it | The track prompt literally; but "a score API" is the most common entry. |
| 5. Any user | Mostly yes for checks; trick payee `shop-moved-pay-here.near` (`guard-agent.js:11`, `deep.js:689`) and 0.001 are constants. |

**Idea score today: 6/10. Implementation: 6/10.** **Verdict: keep the shop, rework the core so the verdict is enforced on chain. PR #35: rework** (merge-worthy UI; replace the 0.001 trick payment).

## 2. Deepened concept: "Guardhouse = an on-chain firewall your agent cannot skip"
**One line:** every outgoing payment from any shop (and from any NEAR agent that opts in) passes through `guard.nearcarta.near`, which asks an **OutLayer TEE** worker (yield/resume, one transaction) to score the payee and scan the instruction for injection; the contract **only forwards the money on an attested ALLOW**, holds it for human confirm on WARN, and refunds on BLOCK. The log of every verdict with its attestation is public.

| Question | New answer |
|---|---|
| 1. Problem / gain | Safety that acts, not reports: a jailbroken agent physically cannot pay a flagged address. |
| 2. Who gets the money | The real payee the agent intended (vendor, freelancer, Toll recipient) — Guard only forwards. Guard can charge a tiny per-check fee that pays the OutLayer execution (real cost). |
| 3. What is new | Market security agents write reports; rivals score off chain. **An attested AI verdict that gates the transfer inside the same NEAR transaction (yield/resume)** is new — Illia's "judgement into code via verifiable AI" made literal. |
| 4. Why judges love it | Illia's SHIELD + judgement-as-code posts; Security track; OutLayer partner; function-call keys; addresses the 1337wallet critique (each tx is seen and checked before it moves). |
| 5. Any user | Yes: any payee, any amount; policy per row (strict/normal) chosen in `/setup`; no constants. |

**Idea score after rework: 9/10.**

## 3. Live state
No guard contract on mainnet. `mainnet.json` has no `outlayer` entry (`backend/src/outlayer.js` → `enabled:false`). Board refusals proven: over cap `CcPMX1Dt…`, off list `E7KMexjS…`.

## 4. Hardcoded (file:line)
| Where | What |
|---|---|
| `app/src/panels/deep.js:689` | default account `shop-moved-pay-here.near` |
| PR `guard-agent.js:11–15` | `POISON_PAYEE`, `TRICK_NEAR '0.001'`, `TRICK_YOCTO`, hint |
| PR `guard-agent.js:61,128,197` | copy hardcodes 0.001 |
| PR `guard-tray.js:247–248` | attestation `{enabled:false}` fallback (honest, but no live run) |
| `shared/guard/denylist.json` | static list (fine as one signal; add live sources) |

## 5. Deep design
### 5.1 Contract `guard.nearcarta.near` (new, upgradeable)
- `pay_guarded(row_owner, to, memo, instruction_sha256)` payable via board `propose_call_as`: stores the pending payment, calls OutLayer `request_execution` (project `guard-check`, pinned wasm sha256) with `{to, amount, memo, instruction}`, yields.
- `on_verdict` (resume): parse `{verdict, reasons, attestation}`; ALLOW → transfer to `to`; WARN → hold, `confirm(row_owner, id)` by the row's session releases it; BLOCK → refund to the row owner's board row (or the owner account). Events to Chronicle.
- `fee` in `policy` (pays OutLayer); `upgrade`/`migrate`; `close()` only with no pending payments → `nearcarta.near`.
- Board CALLS for each row add `guard.nearcarta.near:pay_guarded`; other shops route payouts through it (Hall awards, Payouts rows, Toll recipients can be checked too).
### 5.2 OutLayer worker `guard-check`
Signals: account age/code hash/keys via RPC, denylist + live scam feeds (UNVERIFIED sources, list them), lookalike names, injection patterns in the instruction (hidden markdown, "ignore previous"), optional NEAR AI TEE classifier. Returns JSON + reasons. HTTPS mode for the in-tray "Check" (no tx).
### 5.3 City UX
Tabs **Check / Pay safely / Log**. Check: any account → allow/warn/block + reasons + attestation link. Pay safely: amount + payee → guarded payment. Log: every verdict on chain. Injection drill: paste a poisoned invoice; the agent tries; the contract blocks and refunds — the log shows it.
### 5.4 AI commands
"check X.near", "pay 0.02 NEAR to X safely", "try this invoice: …", "freeze my row" (board `set_frozen` via session if allowed), "show what you blocked today".
### 5.5 Listing
List the checker on Agent Market as a paid security skill (none exists there that refuses).

## 6. Costs
New contract ≈1.5 NEAR stake. OutLayer execution: deposit ≈0.1 NEAR per request with refund of unused (per docs example; real cost UNVERIFIED — measure). Per guarded payment ≈0.01 NEAR gas.

## 7. Acceptance checklist
- [ ] One ALLOW payment forwarded with an OutLayer attestation on chain.
- [ ] One BLOCK: poisoned invoice from the AI agent, refunded, attestation shown.
- [ ] One WARN held until the visitor confirms (session, no popup).
- [ ] No 0.001 trick payment; no default payee constant.
- [ ] HTTPS check works with no tx; README explains what is and is not in the TEE.
- [ ] `upgrade`/`migrate`, `close()` → `nearcarta.near`; tests green.
