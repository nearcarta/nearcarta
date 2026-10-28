# Nearcarta

A town of shops on NEAR. In every shop an AI agent (the Lamplighter) moves money, and each move is checked first by an on-chain oath: a contract that holds the agent's rules. Each shop below is real on NEAR testnet, or real on 1Click mainnet as a dry quote (no spend).

Deployed (testnet, read-only, no keys): https://nearcarta.vercel.app. Example: `/api/health`, `/api/guardhouse`. The e2e run against it is in `judges/proofs/e2e-vercel.json`: 10 passed, 2 skipped (the confidential quote and the TEE check need server keys that this deploy does not have). `render.yaml` describes the same API for Render (free plan, testnet); it is not deployed yet.

## Run it (2 minutes)
```
npm ci
npm test                 # 35 unit tests: ZIP-316 vectors, quote echo guard, event parsing, TEE quote checks, Mist Bank street/ledger
npm run verify           # reads every proof tx back from testnet (38/38 expected); `npm run txs` rewrites judges/TESTNET_TXS.md from it
npm start &              # read-only API on :8787 (no route signs)
npm run build && node app/serve.mjs &   # UI on :5173
npx playwright install chromium && npm run e2e   # 13 browser tests
```
Optional: `ONECLICK_PARTNER_KEY` enables confidential quotes. `NEARAI_CLOUD_API_KEY` enables the live NEAR AI TEE check (`npm run tee`; non-billable). Without them the public paths still run.

## Check each shop: do X, see Y
Every tx below is a row in [judges/TESTNET_TXS.md](judges/TESTNET_TXS.md), re-read from chain by `npm run verify`. Competitor comparison per shop: [docs/COMPARE.md](docs/COMPARE.md).

| Shop | Do | See | Proof |
|---|---|---|---|
| Mist Bank | `curl $API/api/mistbank` | `street.amount_hidden: true` (Zcash testnet tx: no transparent parts; the only value leaving Zcash's Ironwood pool is the 20000-zat fee), `oath.memo_on_chain: true`, `binds: true`, and 3 dry Confidential Intents desk quotes (shield, private transfer, unshield) with verified signatures | [judges/proofs/mistbank-payout.json](judges/proofs/mistbank-payout.json); Zcash [d0b52067…](https://testnet.cipherscan.app/tx/d0b520673362ff6acd8d4ff9eb87beda9fa89f258ed9a07a5ffc57dfbcfa6897); oath [5HG5SPJ5…](https://testnet.nearblocks.io/txns/5HG5SPJ53MhW799NjbqJGyUS1ymEiRvP9BWwLem1a3ua) |
| Mist Bank | `curl "$API/api/mistbank/verify?zats=1370000&salt=67d50c7f78cc0cfdc145392edd674f83"` | `matches: true`: the opening (read from the encrypted memo with the viewing key) hashes to the commitment the oath approved on NEAR | unit "the opening check matches the recorded commitment and rejects any other amount" |
| Mist Bank | Import the published testnet viewing key (`mistbank.disclosure.ufvk` in shared/deployments/testnet.json; commands in judges/VERIFY.md step 9) | 0.0137 TAZ received, memo names the oath tx and the salt. One payee account per payout, so this key opens this payout only | fixture `backend/test/fixtures/zec-testnet-view-list-tx.txt` |
| Mist Bank | `curl $API/api/mistbank/street/17a9a84d758b4feebea5d8fc2c556a95cd0778506cce791c7de23c4a08e0b497` | `amount_hidden: false`, reason `pool_crossing_reveals_amount`: a faucet tx that leaks its amount, for contrast | unit "a pool-crossing payment leaks its amount through the value balance" (`backend/test/unit/mistbank.test.js`) |
| Mist Bank | TESTNET_TXS row *oath memo too long denied* | The oath refuses an approval whose memo would carry more than the 64-byte commitment | [9riHoM2r…](https://testnet.nearblocks.io/txns/9riHoM2rG8nWsNCW5qtnpwcbKu1GUB7LpZB7CPgBm6Xy) |
| Ferry | UI `#ferry` → *Get dry quote* (USDC on Base → ZEC) | 3 PASS rows: 1Click ed25519 signature, echo guard, dry. The Zcash recipient is decoded as an Orchard-only unified address, so the ZEC is shielded into Zcash's Ironwood pool (NU6.3, ZIP 258). Code: `backend/src/ferry.js`, `zcash.js` | e2e "ferry: dry 1Click quote USDC (Base) -> ZEC to a shielded address passes all checks" |
| Ferry | Set the recipient to `t1Nk7gi97dKeY7WAU3ryJnSDCoqp7VDaXzC` | "public on Zcash" warning | e2e "ferry: a transparent Zcash address is flagged as public" |
| Guardhouse | UI `#guardhouse`, or `near account list-keys r11oath-82930.testnet network-config testnet now` | 0 full-access keys; one function-call key, method `propose` only | TESTNET_TXS *full access key deleted* |
| Guardhouse | TESTNET_TXS rows *block receipt denied*, *dao freeze*, *owner unfreeze refused* | The contract refuses a TEE receipt that says BLOCK; the DAO can freeze; the owner cannot unfreeze | [judges/proofs/proof-check.json](judges/proofs/proof-check.json) |
| Guardhouse | TESTNET_TXS rows *escalated owner approved*, *owner resolve approve*; read back with `get_action {"action_id":"4"}` | 0.100001 NEAR is over the 0.1 NEAR cap, so the action waits (NEP-519 yield). The owner approves, and it settles: events `escalated` → `approved` → `confirmed` | [judges/proofs/escalation-approved.json](judges/proofs/escalation-approved.json); integration "guardhouse: the owner-approved escalation settled on chain" |
| Guardhouse (TEE) | UI `#guardhouse` → *Verify NEAR AI TEE now*, or `npm run tee` | The browser makes a 32-byte nonce. The gateway and model (z-ai/glm-5.3-flash) Intel TDX quotes are checked with dcap-qvl (TCB UpToDate, debug off). report_data binds the signer and our nonce, MRCONFIGID = sha256(app_compose), RTMR3 replays from the event log, and NVIDIA NRAS approves the GPUs. Code: `backend/src/tee.js` | [judges/proofs/tee-check.json](judges/proofs/tee-check.json); tamper tests `backend/test/unit/tee.test.js` |
| Chronicle | UI `#chronicle`, or `curl $API/api/chronicle/<any testnet account>` | The latest txs with decision/reason decoded from the oath's NEP-297 events; events from failed receipts are dropped | integration "chronicle lists oath txs and decodes events from chain" |
| Town Hall | UI `#townhall` | The Sputnik DAO voted the oath FROZEN; rewards after the freeze fail with ERR_FROZEN; the agent cannot vote on its own proposal | TESTNET_TXS rows *townhall* |
| Arena | UI `#arena`, or `curl "$API/api/arena/attempts?from=0&limit=25"` | Guardian g1; every attempt committed on chain by prompt hash (20: 14 refused, 6 allowed; 1 text revealed); one NEP-245 case token per refused attack class | TESTNET_TXS rows *arena*; integration "arena corpus" |
| Toll | UI `#toll` | The oath asks `v1.signer-prod.testnet` to sign a Base Sepolia tx only for an allowlisted recipient under cap; the broadcast tx is from the MPC-derived address | TESTNET_TXS rows *toll* |
| Town | `/design/D9_world/` and `/design/D8_shops/` | The 3D town and shop interiors. Interiors read live chain data through `app/src/live/data.js` (the bank interior reads `BANK` from `/api/mistbank`) | e2e "town view loads" |

`$API` is `http://localhost:8787` after `npm start`.

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
- Mist Bank runs on Zcash testnet (TAZ) and NEAR testnet. The Confidential Intents legs are dry quotes; no real confidential deposit is made (that would be a mainnet spend). Anyone holding the viewing key learns the opening, which is intended: they are the auditor.
- The deployed API is read-only. Agent txs are sent only by `backend/scripts/guardhouse-demo.js`, `escalation-demo.js` and `mistbank-record.js` from a machine that holds the keys.
