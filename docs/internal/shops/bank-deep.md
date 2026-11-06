# Mist Bank — deep brief (Privacy & Private AI)

**Audience:** the Cursor chat that owns `bank` (PR #37 open, branch `cursor/bank-ferry-depth-797b`).
**Do not** send mainnet txs or deploy. No "untraceable" wording. Teardown via board close.

## Read first
1. `docs/internal/source-pack.md` §1 (privacy is the #1 theme: 576 posts; Mert, Haseeb, Avichal on confidential; DevHub on TEE vs proxied models), §2 (Illia: sell viewing keys for copy trading; private OTC; ThePiVortex: confidential x402, Zcash gateway), §3 Privacy row, §4 **Confidential swaps + signed intent execution + authentication**, NEAR AI verification, §7 R1, §12.
2. `docs/internal/research/tracks/03-privacy.md` (private expense auditor; model in TEE; proof; fictional sample docs).
3. Code: `app/src/panels/deep.js` `mountBank` L919–993, `backend/src/{mistbank,tee,ai,zcash}.js`, `app/src/tee-view.js`, `app/src/tee-public.json`; PR #37: `app/src/panels/bank-{tray,dock,agent}.js`, `backend/src/bank-proof.js`, `shared/board/bank-seal.js`.

## 1. Attack the idea
| Question | Today (main + PR #37) |
|---|---|
| 1. Problem / gain | "Send privately" picks a note (0.001/0.002/0.005) and a payee — then it is a **public board `propose`**, visible on nearblocks with amount and payee. Nothing is private. The TEE tab checks an attestation but no private work is done for the user. |
| 2. Who gets the money | A payee from the row — but the "privacy" claim is false. |
| 3. What is new | Nothing; sealed rules are a nice touch but small. |
| 4. Why judges love it | Privacy is their top theme, so a fake-private shop is the worst possible fit. |
| 5. Any user | Note sizes fixed (`deep.js:922`, PR `bank-agent.js:4`). |

**Idea score today: 3/10. Implementation: 5/10.** **Verdict: replace. PR #37: rework** (keep the attestation file/verify UI and no-retention text).

## 2. Replacement concept: "Mist Bank = private pay + a private AI teller"
**One line:** (a) **Private pay:** the visitor's agent pays anyone on any chain through **Confidential Intents** (1Click `confidentiality`), so the deposit and the withdrawal cannot be linked on chain, under the same session caps. (b) **Private teller:** the visitor drops bank statements/receipts (fictional samples provided), a NEAR AI **TEE** model categorises spending and flags anomalies, and the bank proves it ran in a TEE (signature + attestation) without storing the data. (c) **Viewing key (stretch, Illia):** the visitor can grant a time-limited view of their private history to one account (accountant, copy-trader).

| Question | New answer |
|---|---|
| 1. Problem / gain | Salaries, rent, vendor payments on public chains expose everyone's finances. Gain: pay privately in one sentence; get a private financial review nobody else can read. |
| 2. Who gets the money | The recipient the visitor names; 1Click/solver fees; nothing to us. |
| 3. What is new | Confidential Intents are B2B-new (Jul 2026); no entry pairs them with a capped agent session + an attested private auditor + viewing-key sharing. R1 proves balances but does not act. |
| 4. Why judges love it | Mert/Haseeb/Avichal privacy posts, Illia's viewing-key idea, Privacy track prompt literally (private expense auditor), NEAR AI partner. |
| 5. Any user | Yes: amount, asset, chain, recipient, documents — all user input. |

**Idea score after replacement: 8/10.**

## 3. Feasibility checks the assistant must run first (UNVERIFIED today)
- Our 1Click partner key supports `confidentiality` on ORIGIN_CHAIN→foreign quotes (docs: foreign-to-foreign confidential swaps follow the standard deposit flow). Test a dry quote with `confidentiality` set; record the response.
- For CONFIDENTIAL_INTENTS deposits the user signs NEP-413 — the session key is ed25519 and signs off-chain, so it **may** sign the intent without a popup (the agent key is not the account's access key; `intents.near` must know the public key → needs `add_public_key` in intents.near once at setup). Mark UNVERIFIED; fall back to ORIGIN_CHAIN deposit from the board row (`propose_call` wrap + ft_transfer to depositAddress, as Ferry).
- NEAR AI Cloud: list TEE models; verify a response signature end to end (verifier repo).

## 4. Hardcoded (file:line)
| Where | What |
|---|---|
| `app/src/panels/deep.js:922` | notes `[0.001, 0.002, 0.005]` |
| PR `bank-agent.js:2,4` | hint + `NOTES` constant; refuses other amounts |
| PR `bank-tray.js:40` | placeholder "Send 0.001 NEAR privately" |
| Copy | "Send privately" on a public propose — **false claim**, remove now |

## 5. Deep design
- **Private pay:** reuse Ferry's settle path (session `propose_call` on wrap.near: `near_deposit` + `ft_transfer` to the 1Click depositAddress) with a quote that sets `confidentiality`; recipient any chain (validated per chain, like Ferry PR #44). Show what is visible on chain (the deposit) and what is not (the link to the withdrawal), honestly.
- **Private teller:** `POST /api/bank/review` → NEAR AI TEE model; response signature verified server- and browser-side; return `{summary, flags, signature, attestation, sha256(input)}`; nothing stored (keep `NO_RETENTION` text, `bank-proof.js:14`). Ship 3 fictional statements.
- **Viewing key (stretch):** encrypt the visitor's private history summary to a recipient public key; share a link; expiry. No custody claims.
- **City UX:** tabs **Pay privately / Teller / Proof**. Real token/chain icons (Ferry library). Cinema: mist closes over the coin only on 1Click SUCCESS.
- **AI commands:** "pay 5 USDC privately to 0xabc on Arbitrum", "review my statement", "what did I spend on food?", "prove it ran in a TEE", "share my view with accountant.near for 7 days".

## 6. Costs
No contract. Per private pay: ≥ corridor minimum (≈0.05 wNEAR) + 1Click fee + ≈0.005 NEAR gas. NEAR AI ≈ $0.01 per review (UNVERIFIED).

## 7. Acceptance checklist
- [ ] One confidential 1Click swap/pay delivered (SUCCESS) from the session; README states exactly what is hidden.
- [ ] One TEE review of a sample statement whose signature verifies in the browser.
- [ ] No fixed note sizes; no "private" copy on a public propose.
- [ ] Real icons; AI executes; tests green.
