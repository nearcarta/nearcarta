# Verify with commands

All commands are read-only unless marked.

1. Proof txs exist and have the stated outcome:
   `npm run verify` → `33/33 proof txs found on testnet`. The output is also in judges/proofs/proof-check.json.
2. The oath account cannot be drained by a key:
   `curl -s https://test.rpc.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"r11oath-82930.testnet"}}'`
   → exactly one key, with `FunctionCall` and `method_names:["propose"]`.
3. The deployed code is the committed build:
   `view_account r11oath-82930.testnet` → `code_hash` EpfJkY8tgedM1T6iZH6kFAUBy4iuEihvmQFvPU3Co9Zq. `npm run wasm-hash` prints the same value for contracts/artifacts/oath.wasm. The hash is also asserted in backend/test/integration/live.test.js.
4. Ferry quote checks offline: `npm test`. The test "silent privacy downgrade keeps a valid signature but the echo guard rejects it" uses a recorded real quote (backend/test/fixtures).
5. Live: `npm run test:integration`. It runs 11 tests against testnet, 1Click (dry) and the NEAR AI TEE check.
5b. NEAR AI TEE (needs `NEARAI_CLOUD_API_KEY`; non-billable): `npm run tee` → `PASS` for each check on the gateway and on every model report, then `TEE preflight verified`. Offline tamper tests (wrong nonce, swapped signer, edited app_compose, forged event, flipped quote byte, expired collateral) are in `npm test`.
6. Contracts: `cd contracts/oath && cargo test --lib` (38) and `cd contracts/arena && cargo test --lib` (14). Then `cd contracts/oath && cargo test --test exploits` (10 attacks in a near-workspaces sandbox against the deployed wasm; all must be refused).
7. Browser: `npm run e2e` (12 tests; `BASE_URL=https://nearcarta.vercel.app npm run e2e` runs them against the deploy; set BASE_URL to test a deployed preview).
8. (Writes to testnet; needs the agent key) `AGENT_KEY_FILE=… node backend/scripts/guardhouse-demo.js`: one allowed and one refused proposal. Output goes to judges/proofs/guardhouse-demo.json.
