# Nearcarta

A town of shops on NEAR. In every shop an AI agent (the Lamplighter) moves money, and each move is checked first by an on-chain oath: a contract that holds the agent's rules. Each shop below is real on NEAR testnet, or real on 1Click mainnet as a dry quote (no spend).

## Run it (2 minutes)
```
npm ci
npm test                 # 28 unit tests: ZIP-316 vectors, quote echo guard, event parsing, TEE quote checks
npm run verify           # reads every proof tx back from testnet (33/33 expected)
npm start &              # read-only API on :8787 (no route signs)
npm run build && node app/serve.mjs &   # UI on :5173
npx playwright install chromium && npm run e2e   # 12 browser tests
```
Optional: `ONECLICK_PARTNER_KEY` enables confidential quotes. `NEARAI_CLOUD_API_KEY` enables the live NEAR AI TEE check (`npm run tee`; non-billable). Without them the public paths still run.

## Check each shop: do X, see Y
| Shop | Do | See |
|---|---|---|
| Ferry | UI `#ferry` → *Get dry quote* (USDC on Base → ZEC) | 3 PASS rows: 1Click ed25519 signature, echo guard, dry. The Zcash recipient is decoded as an Orchard-only unified address (shielded). Code: `backend/src/ferry.js`, `zcash.js` |
| Ferry | Set the recipient to `t1Nk7gi97dKeY7WAU3ryJnSDCoqp7VDaXzC` | "public on Zcash" warning |
| Guardhouse | UI `#guardhouse`, or `near account list-keys r11oath-82930.testnet network-config testnet now` | 0 full-access keys; one function-call key, method `propose` only |
| Guardhouse | `judges/TESTNET_TXS.md` rows *block receipt denied*, *dao freeze*, *owner unfreeze refused* | The contract refuses a TEE receipt that says BLOCK; the DAO can freeze; the owner cannot unfreeze |
| Guardhouse (TEE) | UI `#guardhouse` → *Verify NEAR AI TEE now*, or `npm run tee` | The browser makes a 32-byte nonce. The gateway and model (z-ai/glm-5.3-flash) Intel TDX quotes are checked with dcap-qvl (TCB UpToDate, debug off). report_data binds the signer and our nonce, MRCONFIGID = sha256(app_compose), RTMR3 replays from the event log, and NVIDIA NRAS approves the GPUs. Code: `backend/src/tee.js`. Offline tamper tests: `backend/test/unit/tee.test.js`. Last live run: `judges/proofs/tee-check.json` |
| Chronicle | UI `#chronicle` | The latest `propose` txs with decision/reason decoded from the oath's NEP-297 events; events from failed receipts are dropped |
| Town Hall | UI `#townhall` | The Sputnik DAO voted the oath FROZEN; rewards after the freeze fail with ERR_FROZEN |
| Arena | UI `#arena` | Guardian g1; one NEP-245 case token per refused attack class (C1_CAP, C3_ALLOWLIST, C6_BAD_PROOF, C7_HANDOFF) |
| Toll | UI `#toll` | The oath asks `v1.signer-prod.testnet` to sign a Base Sepolia tx only for an allowlisted recipient under cap; the broadcast tx is from the MPC-derived address |
| Town | `/design/D9_world/` and `/design/D8_shops/` | The 3D town and shop interiors. Interiors read live chain data through `app/src/live/data.js` |

## Layout
- `contracts/oath`: the agent oath (Rust, near-sdk). 38 unit tests, plus near-workspaces sandbox and 10 exploit reproductions in `tests/`.
- `contracts/artifacts`: the deployed oath wasm. `npm run wasm-hash` prints its hash, which equals the on-chain code_hash.
- `contracts/townhall`, `contracts/arena`, `contracts/toll`, `contracts/mock_ft`: the shop contracts.
- `backend/`: Hono API that reads chain, 1Click and NEAR AI. `scripts/` holds the testnet demo and the proof checker.
- `app/`: the console UI, the live data interface for the design views, and the design views themselves (`app/design`).
- `shared/deployments/testnet.json`: every contract address and proof tx hash used anywhere.
- `judges/`: VERIFY.md (commands), TESTNET_TXS.md (all txs with results), proofs/ (raw JSON).

## Limits (stated plainly)
- 1Click has no testnet. Ferry quotes are mainnet `dry:true`: no deposit address is created and nothing is swapped.
- NEAR AI Cloud: the TEE evidence check runs live and is free. Chat completions are billable and the account has no credits (HTTP 402), so `/api/ai/prove` is off unless `AI_PROVE_ENABLED=1`. When enabled, it verifies the TEE first and sends the completion only if every check passes, then matches the response signer to the verified report.
- Mist Bank (confidential balances) is not built; its interior shows labelled SAMPLE data.
- The deployed API is read-only. Agent txs are sent only by `backend/scripts/guardhouse-demo.js` from a machine that holds the propose-only key.
