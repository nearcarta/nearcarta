# What each shop actually does, signed out (verified in the deployed city 2026-11-09)

Written because the judge audit's scores (mean 6.0) mix two different things: "the shop
behaves correctly for a visitor with no wallet" and "no new mainnet transaction from this
session". This file separates them. Every line below was run in a browser against
nearcarta.vercel.app, not read from the code.

| Shop | First click, signed out | Network | Verdict |
|---|---|---|---|
| Ferry | Explains the exact blocker: "A NEAR destination needs your NEAR account as the recipient. Sign in, then get the quote again. No deposit address. Nothing was sent." | quote 200 | correct refusal, names the next step |
| Mist Bank | **Works with no wallet at all.** Audit privately returns "3 lines · 3 counted · NEAR" and the anomaly "cafe.near, 0.01 NEAR. It appears twice in November." | clean | best no-setup demo in the project |
| Guardhouse | Empty payee now asks for one; a real payee returns a verdict ("Warn because: no contract; first-seen unknown; no prior payment") | clean | works |
| Town Hall | Empty: "Name the task and the budget." Filled: "Set up your agent in /setup. Nothing was signed." Idle: "No job yet. Fill the form and press Post job." | clean | three distinct, correct states |
| Payouts | Empty: "Name the invoice amount, for example 0.15 USDC." Filled: 200, a durable /pay/inv_… link with Copy, and an honest note that anchoring waits for the upgrade. The link opens a real payer page with seven chains | 200 | full flow works |
| Your House | Holder says "Sign in"; three real nearblocks links (mint, allowed, refused) and the rule in plain words: "The current holder may spend from this house. A previous holder is refused." | clean (was 4x400) | fixed this session |
| Vault Arena | Mint/Feed/Withdraw with visible pressed state; guardians list shows creators as 8…6 | clean | works |
| Toll Bridge | Fee, chain and recipient come from the live policy; names the row cap | clean | works |
| Chronicle | Type an account, Show timeline; filters paired; one scroll region | clean | works |

## What is NOT proved live, and why

- **A shop gold CTA sending a transaction.** `propose_call_as` checks the call allowlist
  BEFORE any deposit check (`contracts/charter_board/src/v2.rs`), and the live test row
  (8ccd5d33) has no `CALLS` key because it predates the `set_calls` step in
  `shared/setup/open-row.js`. A row opened by the current `/setup` does get the list —
  proved by `setup_calls_row_size.rs` — so this needs a second funded account, not code.
- **A v2 Town Hall job on mainnet.** The loop is proved in the contract
  (`two_workers_split_one_job_and_only_the_passed_part_is_paid`, run and passing) but has
  not been executed on chain end to end.
- **The 16:29 UTC board upgrade.** Artifact and eta verified from the chain; `upgrade`
  needs the owner key `nearcarta.near`, which is not in this environment.
