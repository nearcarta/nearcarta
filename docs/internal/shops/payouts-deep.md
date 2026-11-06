# Payouts — deep brief (Real-World Money)

**Audience:** the Cursor chat that owns `payouts` (PR #34 open, branch `cursor/payouts-city-shop-c354`).
**Do not** send mainnet txs or deploy. Teardown via board close.

## Read first
1. `docs/internal/source-pack.md` §1 (Eddy: counterparty only needs an address on any Intents network; NEAR Business payroll launch), §2 (Illia: **universal checkout widget**; ThePiVortex: x402 merchant revenue), §3 RWM row, §4 1Click quickstart + meta tx, §7 R4 R7, §8 P3, §12.
2. `docs/internal/research/tracks/08-realworld.md` (freelancer invoice link; client pays any chain/token; freelancer gets USDC on NEAR, never buys gas).
3. Code: `app/src/panels/deep.js` `mountPayouts` L787–918, `app/design/D8_shops/js/payouts.js`, `payout-ready.js`, `app/shops/payouts/`; PR #34: `app/src/panels/payouts-{plan,dock}.js`, `backend/src/payouts-invoice.js`, `backend/test/unit/payouts-shop.test.js`.

## 1. Attack the idea
| Question | Today (main + PR #34) |
|---|---|
| 1. Problem / gain | Real: pay several people and send invoices. PR #34 pays NEAR rows under the cap and quotes USDC invoices. |
| 2. Who gets the money | Payees the visitor enters — sensible. Invoice: quote only; no payer page, no delivered invoice yet. |
| 3. What is new | Little vs R7 and NEAR Business (payroll exists). |
| 4. Why judges love it | Track fit is good; Illia's universal checkout is a named wish. |
| 5. Any user | Rows ≤ 0.005 NEAR each (`deep.js:794,810,852`), `CHECKOUT_USD = 0.2` (PR `payouts-plan.js:10`); NEAR-only payroll. |

**Idea score today: 6/10. Implementation: 6/10.** **Verdict: keep the concept, go deep. PR #34: merge after fixes** (remove the 0.005 / 0.2 constants, then build on it).

## 2. Deepened concept: "Get paid from anywhere, pay anyone anywhere"
**One line:** a freelancer or shop creates an **invoice link** (amount in USD, payout in USDC on NEAR to *their* account); **any stranger pays it from any wallet and chain** via 1Click (EXACT_OUTPUT, so the freelancer receives the exact amount); the link page is a universal checkout button any site can embed. On the other side the visitor's agent runs **payroll**: "pay Ana 20 USDC on Solana, Omar 15 USDC on Base, Lina 0.5 NEAR" — each row settles through 1Click from the session under caps, with a CSV the accountant can match.

| Question | New answer |
|---|---|
| 1. Problem / gain | Freelancers lose clients who hold the "wrong" token/chain; payers lose time bridging. Gain: one link, exact dollars in, gasless for the freelancer. Payroll in one sentence across chains. |
| 2. Who gets the money | The invoice issuer (exact USDC); payroll recipients on their own chains. |
| 3. What is new | R7 does invoices; NEAR Business does treasury payroll for teams. New here: **agent-run cross-chain payroll under on-chain caps the agent cannot edit + an embeddable any-chain checkout + Chronicle statements**, all from one session. |
| 4. Why judges love it | Track prompt literally; Illia's universal checkout; Eddy's "any address on a network supported by Intents". |
| 5. Any user | Yes: issuer, amount, asset, chain, recipients — all user data. |

**Idea score after deepening: 8/10.**

## 3. Hardcoded (file:line)
| Where | What |
|---|---|
| `app/src/panels/deep.js:794,810,852` | "at most 0.005 NEAR" per row (should be the row's `per_action_cap`) |
| PR `payouts-plan.js:10` | `CHECKOUT_USD = 0.2` |
| PR `payouts-plan.js:11` | hint with fixed examples |
| `shopui.js` APPS.payouts (main) | "this page did not send it" — prepare-only path on main |

## 5. Deep design
- **Invoice:** `POST /api/invoice` stores `{issuer, usd, payout_asset (USDC@NEAR default), memo, expiry}` (backend persist; optional on-chain anchor via Chronicle). Payer page `/pay/<id>`: token picker = live 1Click list (Ferry catalog + icons), EXACT_OUTPUT quote, depositAddress + QR, status poll (`PENDING_DEPOSIT … SUCCESS/REFUNDED`), refundTo = payer. Embeddable `<script>` button (`/ferry-widget` already exists: reuse).
- **Payroll:** rows `{name, recipient, chain, asset, amount}`; each row = Ferry session settle with `recipient` on the destination chain (Ferry PR #44 validation). Rows over the cap refused on chain and shown. CSV with tx hashes, 1Click status, explorer links.
- **Gasless freelancer:** payout to a NEAR account as USDC; if the account is new, the 1Click delivery covers storage (verify) — no NEAR needed.
- **AI commands:** "invoice acme 50 USD, pay me USDC", "pay Ana 2 USDC on Solana and Omar 1 USDC on Base", "who hasn't paid?", "export March CSV".
- **Cinema:** clerk stamps "PAID" only on SUCCESS.

## 6. Costs
No contract. Per payroll row: corridor min (≈0.05 wNEAR ≈ $0.15) + 1Click fee + ≈0.005 NEAR gas. Invoice paid by the payer.

## 7. Acceptance checklist
- [ ] A stranger pays an invoice from a non-NEAR chain; issuer receives exact USDC on NEAR (SUCCESS link).
- [ ] Payroll with 3 rows on 3 different chains from the session (no popup); one over-cap row refused on chain.
- [ ] CSV rows match the txs; Chronicle shows them.
- [ ] No 0.005 / 0.2 constants; caps from the row.
- [ ] Embeddable button works on a plain HTML page; tests green; README.
