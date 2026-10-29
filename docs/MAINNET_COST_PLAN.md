# Mainnet cost plan: the absolute minimum to move every piece

Status: plan only. Nothing here has been spent or signed on mainnet. Each piece moves only after it is verified working on testnet (see `judges/VERIFY.md`). Prices are from today, 2026-10-29: NEAR $4.74, ETH $2358.56, ZEC $1311.95, USDC $0.999532 [PX].

Rules used: storage is locked, not spent (it comes back when state or the account is deleted). Gas, the account creation charge, global contract publishing, fees and swap spread are burned. Gas is priced at the protocol floor (1 Tgas = 0.0001 NEAR) and attached gas is an upper bound; unused gas is refunded.

Kind: **burn** = gone; **lock** = storage stake, recoverable; **move** = working capital that returns to our own accounts; **spend** = paid to another chain as gas.

## Items

| # | Piece | What | NEAR | ETH | ZEC | USDC/USD | Kind | Required? | Source |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Root account | named `<root>.near` via registrar: creation charge + gas | 0.008 |  |  |  | burn | required | G,A |
| 2 | Charters (global code) | publish main `oath` (R16.1 propose_batch + C5, reproducible build-3709807) 401,313 B as global contract by hash, as on the testnet R17 factory `nccharters-53836`: 10 NEAR/100 KB, burned | 40.1313 |  |  |  | burn | required | GC |
| 3 | Charters (global code) | gas to upload 401 KB (0.58+0.13*X Tgas) | 0.00527 |  |  |  | burn | required | G |
| 4 | Factory | `charter_factory` account: creation + 201,539 B storage (measured) | 2.02239 |  |  |  | lock | required | S,M |
| 5 | Factory | deploy gas 175 KB + init + delete full-access key | 0.00337 |  |  |  | burn | required | G |
| 6 | Charters x4 | Guardhouse/Mist Bank, House, Town Hall, shared Vault/Arena charter: each 833 B (measured, >770 so all bytes) + 0.01 registry fee | 0.07332 |  |  |  | lock | required | S,M |
| 7 | Charters x4 | creation charge + create/init gas (~30 Tgas each) | 0.04 |  |  |  | burn | required | G |
| 8 | Charters x4 | set clause + add agent FC key + delete FAK (3 calls x ~10 Tgas each) | 0.012 |  |  |  | burn | required | G |
| 9 | Shops / merchants | 6 plain receiver accounts (cafe, books, bakery, ...): creation only, <770 B | 0.045 |  |  |  | burn | required | A |
| 10 | Guardhouse | DAO role = plain account (testnet one is 182 B): creation only | 0.0075 |  |  |  | burn | required | A,M |
| 11 | Guardhouse | demo txs: paid, denied, escalated (yield/resume), approve, freeze: 6 calls x <=60 Tgas | 0.036 |  |  |  | burn | required | G |
| 12 | Guardhouse | smallest payout amounts: cap 0.0001 NEAR, 2 paid moves (go to own accounts, recoverable) | 0.0002 |  |  |  | move | required | - |
| 13 | Town Hall DAO | Sputnik v2 DAO: 546,780 B storage (measured) + creation | 5.4748 |  |  |  | lock | required | S,M |
| 14 | Town Hall DAO | proposal bond (refunded) + 3 proposal/vote calls | 0.106 |  |  |  | lock | required | M |
| 15 | Arena | `arena` contract: 340,244 B storage (measured, incl. 32 attempts) + creation | 3.40944 |  |  |  | lock | required | S,M |
| 16 | Arena | deploy gas 329 KB + init + 32 commits + 13 reveals (~10 Tgas each) | 0.04934 |  |  |  | burn | required | G |
| 17 | Vault | shared charter is row 6; runner `propose` calls x 20 at ~25 Tgas | 0.05 |  |  |  | burn | required | G |
| 18 | House deed (NEP-171) | `house_nft` 209,633 B storage (measured) + creation + 1 mint | 2.11333 |  |  |  | lock | optional | S,M |
| 19 | Toll (Base) | `toll` v3 instance: 190,195 B storage (measured toll-usdc) + creation; native ETH and USDC rules in one instance | 1.90895 |  |  |  | lock | required | S,M |
| 20 | Toll (Base) | MPC `sign` (1 yocto) + `verify_foreign_transaction` (1 yocto): 2 x (50+30) Tgas attached, upper bound | 0.016 |  |  |  | burn | required | MPC,G |
| 21 | Toll (Arbitrum) | second `toll` instance: 186,207 B (measured toll-arb) + creation + 1 sign | 1.87707 |  |  |  | lock | optional | S,M,MPC |
| 22 | Chronicle | read-only from RPC/indexer: no on-chain cost |  |  |  |  | burn | required | - |
| 23 | NEAR AI agent stake | 50 NEAR mainnet stake for a NEAR AI hosted agent: NOT needed (API key use only) |  |  |  |  | burn | optional (skip) | - |
| 30 | Toll (Base) | fund derived address: 1 native tx 21k gas + 1 USDC tx 65k gas at 0.01 gwei, x3 headroom + 1e12 wei test value |  | 0.00000358 |  | 0.01 | spend | required | BASE |
| 31 | Toll (Arbitrum) | 1 native tx 21k gas at 0.04 gwei, x3 headroom + 1e12 wei test value |  | 0.00000352 |  |  | spend | optional | ARB |
| 32 | Ferry / 1Click leg A | Base USDC -> ZEC: minimum 1.750123 USDC, use 2.50 USDC; Base deposit tx 65k gas |  | 0.00000195 |  | 2.5 | move | required | 1C,BASE |
| 33 | Ferry / 1Click legs A+B | expected round-trip loss (withdraw fees 32,000 zats + 0.0024 USDC, spread); rest returns as USDC |  |  |  | 0.57 | burn | required | 1C |
| 40 | Mist Bank Zcash | 2 shielded sends (in, out) at ZIP-317 10,000 zats each + leg B send to 1Click |  |  | 0.0003 |  | burn | required | Z |
| 41 | Mist Bank Zcash | working notes come from leg A output (>=132,000 zats needed for leg B); no extra ZEC buy |  |  |  |  | move | required | 1C |
| 50 | NEAR AI (glm-5.3-flash) | ~500 calls x 2,000 in / 400 out = 1M in, 0.2M out at $0.08/$0.50 per 1M |  |  |  | 0.18 | burn | required | AI |

## Totals

| Set | NEAR | ETH | ZEC | USDC | USD |
|---|---|---|---|---|---|
| Required, all kinds (cash to hold) | 53.3989 | 0.00000553 | 0.0003 | 3.26 | **$256.78** |
| Required, burned or spent only | 40.4038 | 0.00000358 | 0.0003 | 0.76 | **$192.68** |
| Required, locked (recoverable) | 12.9949 | 0 | 0 | 0 | **$61.60** |
| Optional items | 3.9904 | 0.00000352 | 0 | 0 | **$18.92** |
| Everything incl. optional | 57.3893 | 0.00000905 | 0.0003 | 3.26 | **$275.70** |
| Floor: required, factory deferred, 4 charters deployed as regular contracts (path 2 below) | 27.4015 | 0.00000553 | 0.0003 | 3.26 | **$133.55** |

The biggest single item is row 2, publishing the charter code as a global contract (40.13 NEAR, about $190, burned). It is needed only because the public factory lets anyone create a charter with no code of their own.

## Cheapest path

1. **Shrunk wasm.** The testnet R17 factory publishes the reproducible 401,313 B build unchanged (40.13 NEAR of testnet burn). On R16 a `wasm-opt -Oz` pass cut 10.1% (367,202 to 330,006 B); on this build that would save about 4.07 NEAR of burn. Each 10 KB cut saves 1 NEAR. Rebuild it reproducibly and re-verify on testnet first.
2. **Global code only for the factory.** If the public factory waits, deploy the 4 house charters as regular contracts instead: 4 x ~405,731 B = 16.28 NEAR, all locked and recoverable, against 42.28 NEAR for the global path (mostly burned). The global path pays off at 10 or more charters [GC].
3. **Charters through the factory.** Each one is 833 B (it holds a reference to the code, not the code), so initialise the mainnet factory with `min_deposit` 0.02 NEAR, not the testnet 0.3 NEAR (the contract only requires more than the 0.01 registry fee).
4. **One Toll instance for Base** covers both native ETH and USDC rules. Arbitrum is a second instance and is optional.
5. **DAO.** Guardhouse uses a plain account as its DAO role (182 B on testnet). Only Town Hall needs the Sputnik DAO, and Guardhouse can point at the same one.
6. **Smallest amounts.** Use a 0.0001 NEAR cap, a 1e12 wei EVM test value and 0.01 USDC. Leg A needs 1.750123 USDC at minimum and leg B 132,000 zats, so ZEC comes from leg A and none is bought.
7. **No full-access keys** after deploy (as on testnet). Deleting each key costs 0.41 Tgas (0.000041 NEAR).
8. **Skip:** the NEAR AI 50 NEAR agent stake (API-key inference is enough), `mock_ft` (mainnet uses real USDC), Chronicle (read-only, free), and Vercel/Render (free plans).

## Order (each step only after its testnet check passes)

1. Root account and factory, with the global code published (rows 1-5). 2. Charters (6-8). 3. Shops and Guardhouse (9-12). 4. Town Hall DAO (13-14). 5. Arena and Vault (15-17). 6. Toll Base (19-20, 30). 7. Ferry, 1Click and Mist Bank, using the phase-2 scripts with `--live` only after the owner approves (32-33, 40-41). 8. Optional: House deed, Toll Arbitrum (18, 21, 31).

## Sources

- [S] https://docs.near.org/protocol/storage/storage-staking (1e19 yocto/byte = 1 NEAR per 100 KB)
- [A] https://docs.near.org/integrations/accounts (0.007 NEAR creation charge; >770 B accounts reserve all bytes)
- [G] https://docs.near.org/protocol/transactions/gas (floor 1 Tgas = 0.0001 NEAR; deploy 0.58+0.13X Tgas; FAK/DeleteKey 0.41-0.42 Tgas)
- [GC] https://docs.near.org/smart-contracts/global-contracts (10 NEAR per 100 KB, burned; worth it at ~10+ accounts)
- [MPC] https://github.com/near/mpc/blob/main/crates/contract/README.md (`sign` and `verify_foreign_transaction` need 1 yoctoNEAR; mainnet contract `v1.signer` per https://docs.near.org/chain-abstraction/chain-signatures/implementation)
- [BASE] https://base.blockscout.com/api/v2/stats (gas avg 0.01 gwei, fetched 2026-10-29 02:00 Cairo)
- [ARB] https://arbitrum.blockscout.com/api/v2/stats (gas avg 0.04 gwei, fetched 2026-10-29 02:00 Cairo)
- [1C] 1Click API dry quotes 2026-10-28 (https://1click.chaindefuser.com/v0/quote, dry:true): leg A error "try at least 1750123" (1.750123 USDC); leg B min 132,000 zats; withdraw fee 32,000 zats / 0.0024 USDC
- [Z] https://zips.z.cash/zip-0317 (marginal fee 5,000 zats x 2 grace actions = 10,000 zats minimum)
- [AI] https://cloud-api.near.ai/v1/model/list (z-ai/glm-5.3-flash: input 80e-9, output 500e-9 USD per token)
- [M] measured testnet `storage_bytes` via https://test.api.fastnear.com/v1/account/<id>/full on 2026-10-29; mainnet uses the same wasm and the same price
- [PX] https://api.coingecko.com/api/v3/simple/price?ids=near,ethereum,zcash,usd-coin&vs_currencies=usd (2026-10-29)

The calculator that produced this table is `scripts/mainnet_cost.py`; rerun it with new prices.
