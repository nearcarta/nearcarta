# Fresh testnet deploy on 1 November 2026

The hackathon runs 1–14 November 2026 (UTC). Every testnet account and transaction in
`shared/deployments/testnet.json` today was made before that window. On 1 November we redeploy
the same reproducible artifacts to fresh accounts, rerun the proofs, and regenerate the numbers.
Mainnet is not used.

## Check first (sends nothing)

    bash scripts/fresh-deploy.sh

For each step this prints the script, the artifact's sha256 and its NEAR code hash
(base58 of the sha256). Those hashes must equal the `code_hash` values in
`shared/deployments/testnet.json` and the reproducible builds listed in `judges/VERIFY.md`.
The script exits non-zero if an artifact or script is missing.

## Order (run from `backend/`, testnet only, smallest amounts)

| # | Part | Script | Artifact |
|---|------|--------|----------|
| 1 | Charter factory + Town Hall | the factory worker's scripts | `charter_factory*.wasm`, global oath code |
| 2 | Vault Arena | `scripts/arena-fresh.js` | `arena.wasm` |
| 3 | Toll (MPC → Base Sepolia) | `scripts/toll-deploy.js`, then `scripts/toll-proofs.js` | `toll.wasm` |
| 4 | Oath R16 (rule expiry) | `scripts/oath-r16.js` | `oath.r16.wasm` |
| 5 | Your House charter | `scripts/house-deploy.js` | `oath.r11.wasm` |
| 6 | House deed (NEP-171) | `scripts/house-nft-fresh.js` (`HOUSE` = the new house charter) | `house_nft.wasm` |
| 7 | Mist Bank payout | `scripts/mistbank-record.js` with a payee whose viewing key was never public | — |
| 8 | Proof check + tables | `scripts/verify-proofs.js`, `scripts/txs-table.js`, `scripts/readme-numbers.js` | — |

Each script writes the new account names and tx hashes into its proof file. Copy them into
`shared/deployments/testnet.json` before the next step, because later steps read them
(for example, the deed needs the new House charter).

## Rules for the run

- Keys are created fresh per step and stay outside the repo. No contract account keeps a
  full-access key: each deploy is one batch (create, fund, deploy, init) with no AddKey.
- Accounts whose keys or viewing keys were ever shown are retired and not reused.
- `scripts/fresh-deploy.sh --run` refuses before 2026-11-01 UTC. Even after that date it only
  prints the order, because each step needs the previous step's outputs.
- After the run, the API on Render picks up the new `shared/deployments/testnet.json` on redeploy.
  `GET /api/health?deep=1` must report `routes_ok: true`.
