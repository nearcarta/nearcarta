# Chronicle — deep brief (Autonomous Business)

**Audience:** the Cursor chat that owns `chronicle` (PR #38 open, branch `cursor/chronicle-ferry-depth-b3c6`).
**Do not** send mainnet txs or deploy. Teardown to `nearcarta.near`; no stranded NEAR; nothing per user.

## Read first
1. `docs/internal/source-pack.md` §1 (Illia: verifiable AI "provenance log useful for monitoring and forensics"; AI judges read reproducibility), §3 Business row (public ledger, revenue share), §4 NEAR AI verification, §8 P4 (infra others plug into), §12.
2. `docs/internal/research/tracks/04-business.md`.
3. Code: `app/src/chronicle-feed.js` (`RECORDED` L17), `app/src/panels/deep.js` `mountChronicle` L714–770, `app/design/D8_shops/shops/chronicle.js`, `backend/src/board-chronicle.js`, `ledger.js`, `txindex.js`; PR #38: `app/src/chronicle-loop.js`, `chronicle-commands.js`, `chronicle-icons.js`, `app/src/panels/chronicle-{dock,view,style}.js`.

## 1. Attack the idea
| Question | Today |
|---|---|
| 1. Problem / gain | A searchable list of board decisions is useful as an audit log, but today it shows mostly **recorded** owner txs and a feed; a visitor learns little about *their* agent. |
| 2. Who gets the money | PR #38 adds a 0.001 NEAR "entry" (`chronicle-loop.js:6–7`) proposed from the row — paid to a receiver that buys nothing. Meaningless payment. |
| 3. What is new | A tx list is not new (every explorer has one). |
| 4. Why judges love it | Only as the "public ledger" box of the Business track; weak alone. |
| 5. Any user | Partly: board feed is per row, but `RECORDED` (L17–) is a static list of owner txs; `SIGNER = 'nearcarta.near'` (`chronicle-feed.js:15`). |

**Idea score today: 4/10. Implementation: 6/10.** **Verdict: replace the concept; PR #38 rework** (keep dock, view, icons, CSV; drop the 0.001 entry and lean on live data).

## 2. Replacement concept: "Chronicle = your agent's auditor"
**One line:** for **any** NEAR account (the visitor's row or any account they paste), Chronicle reads every action across the city and the chain — board allows/refusals, Ferry 1Click statuses, Toll foreign legs (basescan), Payouts — and a NEAR AI **TEE** model writes a plain-language **statement**: what the agent spent, on what, versus the rules it was given, with anomalies flagged ("3 refusals to a new payee at 03:00"). The statement is signed by the TEE; its hash is anchored on chain from the visitor's session. Anyone can verify it later.

| Question | New answer |
|---|---|
| 1. Problem / gain | Whoever gives an agent money needs to know "did it obey, what did it cost, what earned what" — today they read raw explorers. Gain: a 10-second, verifiable answer and an accountant-ready CSV. |
| 2. Who gets the money | Nobody is paid for nothing. The only NEAR spent is storage for the anchor (the visitor's own record) and gas. Optional: the statement is sold as an Agent Market skill (earns USDC) — Illia: "make an agent that earns money doing it for others". |
| 3. What is new | An **attested AI audit of an agent's behaviour against its on-chain rules**, anchored on chain. Explorers list txs; nobody proves "this summary came unmodified from this model on these exact txs". |
| 4. Why judges love it | Illia's provenance-log post is the exact framing; Business track wants a public ledger and revenue share; AI judges love verifiable outputs. |
| 5. Any user | Yes: input is any account id; data from chain indexers; no constants. |

**Idea score after replacement: 7/10.**

## 3. Live data
- No Chronicle contract today. Board feed: `backend/src/board-chronicle.js` (receipts of `board.nearcarta.near`).
- Sources to add: a NEAR indexer API (fastnear / nearblocks API; read tx list by account — UNVERIFIED which has a free key-less endpoint; test both), 1Click `GET /v0/status`, Base RPC for Toll legs, `get_attempt` for Arena, toll `get_tx`.

## 4. Hardcoded (file:line)
| Where | What |
|---|---|
| `app/src/chronicle-feed.js:15` | `SIGNER = 'nearcarta.near'` |
| `app/src/chronicle-feed.js:17–` | `RECORDED` static owner txs used as feed rows |
| `app/src/panels/deep.js:761` | default sender `nearcarta.near` |
| PR #38 `app/src/chronicle-loop.js:6–7` | `ENTRY_NEAR = '0.001'`, `ENTRY_YOCTO` |
| PR #38 `chronicle-loop.js:68–81` | Fixed demo rows ("allowed_0.001", "house_pay_allowed_0.001"…) |
| PR #38 `chronicle-loop.js:156,159` | Copy hardcodes 0.001 |

## 5. Deep design
- **Contract (tiny, new, upgradeable):** `chronicle.nearcarta.near` with `anchor(row_owner, period, statement_sha256, signer_address, model)` payable (storage only, refunded excess) via board `propose_call_as`; views `anchors_of(account)`. `upgrade`/`migrate`/`close()` → `nearcarta.near`. Alternative without a contract: write the hash in the memo of a board `set_seal` — UNVERIFIED fit; contract is cleaner.
- **Backend:** `GET /api/chronicle/:account?from&to` merges all sources into one typed timeline (shop, action, amount, asset, chain, decision, rule hit, tx links). `POST /api/chronicle/statement` sends the timeline + the row's rules to a NEAR AI Cloud TEE model, verifies the response signature, returns `{statement, sha256, signature, attestation}`.
- **City UX:** tabs **Timeline / Statement / Verify**. Timeline: live, filter by shop/decision/chain, real chain icons, links. Statement: one press → TEE statement with "verified" seal → "Anchor it" (session, no popup). Verify: paste a statement or hash → check signature + anchor.
- **AI commands:** "audit my agent this week", "show refused payments", "how much did Ferry cost me?", "anchor this statement", "verify <hash>", "export CSV".
- **Cinema:** the scribe seals the scroll only after the anchor tx succeeds.
- **Feeds every other shop:** Toll fee revenue, Arena payouts, Payouts invoices appear here — Chronicle is the business ledger the Business track asks for.

## 6. Costs
New contract ≈1.5 NEAR storage stake (returned by `close()`); per anchor ≈0.002 NEAR storage + gas from the row; NEAR AI ≈ $0.001–0.01 per statement (UNVERIFIED price).

## 7. Acceptance checklist
- [ ] Paste any account → live timeline (no `RECORDED` rows unless the account is the owner's).
- [ ] Statement from a TEE model with a signature that verifies in the browser.
- [ ] Anchor via session (no popup); `anchors_of` shows it; Verify tab re-checks it.
- [ ] No 0.001 entry fee, no `nearcarta.near` default.
- [ ] CSV matches the timeline; real icons; `npm test` green; README do-X-see-Y.
