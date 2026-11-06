# Payouts: live steps for the owner

This file is the owner's checklist. Everything in this repository signs nothing and sends nothing;
the two live proofs below are the only steps that spend money, and only the owner runs them.

## What is code, and what is not yet a live proof

| Claim | Where it is | Proof today |
|---|---|---|
| Every payroll row is paid by the visitor's own session under that visitor's own `/setup` cap | `app/src/panels/payouts-tray.js` `payReviewed`, `app/design/D8_shops/js/apps.js` `payouts` / `payoutsForeign` | unit: `payroll: three chains are priced, sent and capped, not held`, `plan: classifyPayroll sends the in-cap rows...` |
| A foreign row is a real 1Click EXACT_OUTPUT swap, priced before it is sent | `backend/src/payouts-payroll.js` `openPayrollCheckout`, `backend/src/payouts-invoice.js` `quotePayrollRow` | unit: `a live checkout asks 1Click only after the row allows it`; live dry prices in `node backend/scripts/payouts-live-dryrun.js` |
| The row gate is the visitor's row, not a shop allowlist | `backend/src/payouts-payroll.js` `payrollRowGate` | unit: `the row gate mirrors the board checks before a deposit address exists` |
| A zero-NEAR or unregistered issuer can be registered for USDC from the same session cap | `payouts-plan.js` `sponsorshipPlan`, `shared/board/session.js` `payoutsCalls`, setup call list | unit: `sponsorship: bounded by the contract minimum and the visitor own cap`; the route reads the real `storage_balance_bounds.min` (`curl /api/payouts/sponsor?account=...`) |
| A row is Paid only after 1Click SUCCESS | `backend/src/payouts-payroll.js` `payrollRowStatus`, tray `watchForeignRow` | unit: `every 1Click status is plain words and only SUCCESS is paid` |
| The CSV reconciles multi-chain rows with fee and refund | `payouts-plan.js` `accountantCsv` / `csvReconcile` | unit: `CSV reconcile sums what the session did, and paid only from SUCCESS` |
| No business cap constant remains in the shop | `app/design/D8_shops/js/payouts.js` | unit: `the row call list carries the USDC storage pair...` asserts `NEAR_CAP` and `MAX_ROWS = 3` are gone, and `slice(0,3)` is gone from the tray |

A NEAR row's on-chain receipt is the board `propose` tx: already proven on mainnet by the town charter
tests and the visitor-run proofs in `shared/deployments/mainnet.json`. A **foreign** payroll row has no
mainnet receipt yet in this repository, because producing one moves real USDC. That is the first live
step below, and until it is run the honest sentence is "priced and planned, not yet paid once".

## Step 0. Dry run (no keys, no money)

```bash
node backend/scripts/payouts-live-dryrun.js --owner <your.near>
```

It prints, from live reads only: each chain's 1Click price for one row, your row's cap / budget /
count / balance, the gate's answer for each row, the exact `set_calls` pair list (and whether the row
has room for the USDC `storage_deposit` pair), the sponsorship plan, and an indicative invoice quote.
Every price is a real 1Click quote; every limit is read from your row.

## Step 1. One foreign payroll row, on chain (moves real USDC)

Do this in the city, signed in, with a row that has a balance and a cap above the row's NEAR cost:

1. Open `https://nearcarta.vercel.app/?shop=payouts`, Payroll tab.
2. Add one row: Receiver = a Base address you control, Chain = Base, Asset = USDC, Amount = 0.15.
3. Press **Review these rows**. The row is priced; the receipt shows the route spread in USD.
4. Press **Pay reviewed rows**. No wallet popup: the session key calls `propose_call` on
   `board.nearcarta.near` three times (near_deposit, storage_deposit for the 1Click address, ft_transfer).
5. The receipt says **Waiting for the deposit.** It says **Paid.** only when 1Click reports SUCCESS,
   usually under a minute on Base. Click the receipt tx: that is the NEAR `propose_call`.
6. Check the USDC arrived at the Base address. That tx is the destination proof.

Record both hashes: the NEAR `propose_call` and the Base transfer.

## Step 2. A stranger pays an EXACT_OUTPUT invoice

1. Create an invoice for a **zero-NEAR, unregistered** receive account (a fresh mainnet name works).
2. If the invoice pane offers **Register <account> for USDC**, press it once. That is a
   `storage_deposit` on native USDC paid from your own session cap (0.00125 NEAR, read from the
   contract), not from the shop. Without it, the paid USDC cannot land.
3. Open the pay link in a second browser profile (the stranger's). Pick a chain, type that browser's
   refund address, press **Pay this invoice**. Send the quoted USDC from the payer's own wallet.
4. The payer page says **Delivered.** only on 1Click SUCCESS, and names the receive account and amount
   it locked. The issuer's Invoices tab shows **Paid**.

## What must never happen

- No script in this repository signs or sends a mainnet transaction.
- A row is never called paid from a PENDING status.
- Nothing says "gasless": the storage deposit is real NEAR, from the visitor's own cap.
- No fixed business cap. If a row is refused it is because the visitor's own row refused it, and the
  receipt says which limit.
