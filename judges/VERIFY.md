# Verify with commands

All commands are read-only unless marked.

1. Proof txs exist and have the stated outcome:
   `npm run verify` → `38/38 proof txs found on testnet` (it also re-reads the Zcash testnet payout and checks the amount is hidden). The output is in judges/proofs/proof-check.json, and `npm run txs` turns it into TESTNET_TXS.md.
2. The charter account cannot be drained by a key:
   `curl -s https://test.rpc.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"r11oath-82930.testnet"}}'`
   → exactly one key, with `FunctionCall` and `method_names:["propose"]`.
3. The deployed code is the committed build:
   `view_account r11oath-82930.testnet` → `code_hash` EpfJkY8tgedM1T6iZH6kFAUBy4iuEihvmQFvPU3Co9Zq. `npm run wasm-hash` prints the same value for contracts/artifacts/oath.wasm. The hash is also asserted in backend/test/integration/live.test.js.
4. Ferry quote checks offline: `npm test`. The test "silent privacy downgrade keeps a valid signature but the echo guard rejects it" uses a recorded real quote (backend/test/fixtures).
5. Live: `npm run test:integration`. It runs 14 tests against testnet, 1Click (dry) and the NEAR AI TEE check.
5b. NEAR AI TEE (needs `NEARAI_CLOUD_API_KEY`; non-billable): `npm run tee` → `PASS` for each check on the gateway and on every model report, then `TEE preflight verified`. Offline tamper tests (wrong nonce, swapped signer, edited app_compose, forged event, flipped quote byte, expired collateral) are in `npm test`.
6. Contracts: `cd contracts/oath && cargo test --lib` (38) and `cd contracts/arena && cargo test --lib` (14). Then `cd contracts/oath && cargo test --test exploits` (10 attacks in a near-workspaces sandbox against the deployed wasm; all must be refused).
7. Browser: `npm run e2e` (13 tests; `BASE_URL=https://nearcarta.vercel.app npm run e2e` runs them against the deploy; set BASE_URL to test a deployed preview).
8. (Writes to testnet; needs the agent key) `AGENT_KEY_FILE=… node backend/scripts/guardhouse-demo.js`: one allowed and one refused proposal. Output goes to judges/proofs/guardhouse-demo.json.
9. Mist Bank, the private payout (read-only; `npm start` first):
   - `curl -s localhost:8787/api/mistbank` → `street.amount_hidden: true`, `oath.memo_on_chain: true`, `binds: true`.
   - The street view, straight from a public Zcash testnet explorer: `curl -s https://api.testnet.cipherscan.app/api/tx/d0b520673362ff6acd8d4ff9eb87beda9fa89f258ed9a07a5ffc57dfbcfa6897` → no transparent inputs or outputs. The value balance is the fee only (20000 zats); the 0.0137 TAZ paid does not appear.
   - The auditor view, using the viewing key published in `shared/deployments/testnet.json` (`mistbank.disclosure.ufvk`) and zcash-devtool:
     `zcash-devtool wallet -w /tmp/view init-fvk --name view --fvk <ufvk> --birthday 4549352 && zcash-devtool wallet -w /tmp/view sync && zcash-devtool wallet -w /tmp/view enhance && zcash-devtool wallet -w /tmp/view list-tx`
     → `d0b52067…` mined at 4549357, `0.01370000 TAZ`, memo `nearcarta mistbank v1 oath=5HG5SPJ5… salt=67d50c7f78cc0cfdc145392edd674f83`. Run from a fresh directory on 2026-10-28; it connects to testnet.zec.rocks.
   - The binding: `curl -s "localhost:8787/api/mistbank/verify?zats=1370000&salt=67d50c7f78cc0cfdc145392edd674f83"` → `matches: true`: sha256 of the opening equals the commitment in the charter's approved action (tx 5HG5SPJ5…). With any other amount → `matches: false`.
   - Contrast: `curl -s localhost:8787/api/mistbank/street/17a9a84d758b4feebea5d8fc2c556a95cd0778506cce791c7de23c4a08e0b497` (a faucet payment) → `amount_hidden: false`, `pool_crossing_reveals_amount`.
10. Owner approval of a large move: TESTNET_TXS rows *escalated owner approved* and *owner resolve approve*. Then `curl -s https://test.rpc.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"r11oath-82930.testnet","method_name":"get_action","args_base64":"'$(printf '{"action_id":"4"}' | base64)'"}}'` → `status: confirmed`, `clause_id: tip`, `amount: 100001000000000000000000` (0.100001 NEAR, over the 0.1 NEAR cap). The raw run is in judges/proofs/escalation-approved.json. (It writes to testnet and needs the agent and owner keys: `node backend/scripts/escalation-demo.js`.)
11. Vault Arena attack corpus: `curl -s "localhost:8787/api/arena/attempts?from=0&limit=25"` → every attempt with its player, `prompt_hash_hex`, block, verdict and `revealed` (true once someone calls `reveal_prompt` with text whose sha256 equals the hash).

