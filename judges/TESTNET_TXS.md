# Testnet transactions

Every row was read back from chain by `npm run verify` (backend/scripts/verify-proofs.js) at 2026-10-28T02:04:44.762Z (UTC); this file is written from that output by backend/scripts/txs-table.js. Raw output: judges/proofs/proof-check.json.

**38/38 found.**

| shop | what it proves | method | on-chain result | tx |
|---|---|---|---|---|
| guardhouse | deploy init fc key | DeployContract,new,AddKey | "ok" | [CasiK1id64…](https://testnet.nearblocks.io/txns/CasiK1id64Fage1wUNobGBuK6j86xav6BSVdm1pWQZ3p) |
| guardhouse | full access key deleted | DeleteKey | "ok" | [2WyiCazxV1…](https://testnet.nearblocks.io/txns/2WyiCazxV1JTLYKRz6QzU7YaFh4etp3WwQqv5Z8Le3TL) |
| guardhouse | valid receipt paid | propose | {"action_id":"0","decision":"allowed","status":"confirmed","reason":"ok"} | [9zQenpg2yj…](https://testnet.nearblocks.io/txns/9zQenpg2yjs3xYd6SQ3UMHqW72ppNB1SW25xXUf7Y6ff) |
| guardhouse | block receipt denied | propose | {"action_id":null,"decision":"denied","status":"denied","reason":"receipt_verdict_not_allow"} | [DUhFvCq15n…](https://testnet.nearblocks.io/txns/DUhFvCq15nV9cMa5hzLeFWUPs1uF2sZjYD2CZd4BTB7F) |
| guardhouse | escalated over cap | propose | {"action_id":"1","decision":"escalated","status":"escalated","reason":"over_cap_waiting_owner"} | [8aJZ3rjbL5…](https://testnet.nearblocks.io/txns/8aJZ3rjbL5m8KGmRjhrtm8NYuzUhWUuP1C1LgGa2SiTa) |
| guardhouse | timelock not ready | execute_change | "Smart contract panicked: ERR_TIMELOCK_NOT_READY" | [rpvix4gCgN…](https://testnet.nearblocks.io/txns/rpvix4gCgNzJmDSLLgGWtN1tvkk7BU7uyWhyYGwni4V) |
| guardhouse | queued widening denied | propose | {"action_id":null,"decision":"denied","status":"denied","reason":"receiver_not_allowlisted"} | [573gVwsp2F…](https://testnet.nearblocks.io/txns/573gVwsp2Fbyzmffbo6CbZ8C9TwPaKpAHHeF8ym5jJii) |
| guardhouse | dao freeze | freeze | "ok" | [7xkk5cPxNw…](https://testnet.nearblocks.io/txns/7xkk5cPxNwttBAYrk6EZRuxyuajGKTmdeddtiYVdTgLX) |
| guardhouse | owner unfreeze refused | unfreeze | "Smart contract panicked: ERR_DAO_ONLY_UNFREEZE" | [9a2AqaPVuF…](https://testnet.nearblocks.io/txns/9a2AqaPVuFcPegRue67ycdfEuwz4k6RaWJaogDpQiak7) |
| guardhouse | escalated owner approved | propose | {"action_id":"4","decision":"escalated","status":"escalated","reason":"over_cap_waiting_owner"} | [AxYjEL2Xxp…](https://testnet.nearblocks.io/txns/AxYjEL2XxpDFLA1Fpkw5EiqGJK7j2sFZymNBbkiVwWkD) |
| guardhouse | owner resolve approve | resolve_escalation | true | [EduSJN1HNL…](https://testnet.nearblocks.io/txns/EduSJN1HNLhQU8kNe2nydaHxB9bd6NUDR3ry8DCZL8KE) |
| townhall | create dao | create | "ok" | [3Pd1KauqoG…](https://testnet.nearblocks.io/txns/3Pd1KauqoGDCDqt8ZLuXqi1gAm6LQcBzuSb6piqUwHk7) |
| townhall | agent paid v1 | agent_reward | "ok" | [4stGNNjVP2…](https://testnet.nearblocks.io/txns/4stGNNjVP2e5jQ944xWv58SiqCk26KbZJd6bk492b51i) |
| townhall | oath v2 proposal | add_proposal | 1 | [33ZBFx5ATQ…](https://testnet.nearblocks.io/txns/33ZBFx5ATQd4e3uF3a1NVC9UB5t6gp4VB4g3nvYdxzMA) |
| townhall | over cap refused | agent_reward | "Smart contract panicked: ERR_OATH_PER_REWARD_CAP" | [71Y4a3a1Lb…](https://testnet.nearblocks.io/txns/71Y4a3a1Lb8UDJnJgmuk8NPUUoSA8Z8cSCZ2o4K57rw7) |
| townhall | denied newcomer | agent_reward | "Smart contract panicked: ERR_OATH_DENY" | [8T7octBPa5…](https://testnet.nearblocks.io/txns/8T7octBPa5cWSXdLR7p1ycs7FjX4bSChuPy4KhceMHqT) |
| townhall | fake evidence | agent_reward | "Smart contract panicked: ERR_NO_EVIDENCE" | [2ycXdfvEx3…](https://testnet.nearblocks.io/txns/2ycXdfvEx37s5ykTNHnZvhaVWbBU6BKZc5RBynaZhmTK) |
| townhall | replay refused | agent_reward | "Smart contract panicked: ERR_ALREADY_CLAIMED" | [7RGcNseeST…](https://testnet.nearblocks.io/txns/7RGcNseeSTXq6xgzqBd88TgbWPueQhDfCUafaC1Yzhis) |
| townhall | agent votes own refused | act_proposal | "Smart contract panicked: panicked at 'ERR_PERMISSION_DENIED', sputnikdao2/src/proposals.rs:546:9" | [Vgop8whFzJ…](https://testnet.nearblocks.io/txns/Vgop8whFzJezu3ddCj3ZNzjTJPHQs78pA2muGWAPncY) |
| townhall | freeze proposal | add_proposal | 3 | [HQFV3C34a9…](https://testnet.nearblocks.io/txns/HQFV3C34a9ym4oZiU28JQYBPZCmmLEawzxHvLSnnDmyU) |
| townhall | reward after freeze refused | agent_reward | "Smart contract panicked: ERR_FROZEN" | [9X2Yza6z2K…](https://testnet.nearblocks.io/txns/9X2Yza6z2KCJ7qKh4qLN993ztpRVNKxJekbzRKvJuxhA) |
| arena | deploy | DeployContract | "ok" | [7gsEXZAHxc…](https://testnet.nearblocks.io/txns/7gsEXZAHxckdX1iz6EkweyEFcAZpCvbngCV8VBihkuvK) |
| arena | jailbreak cap refused | agent_act | "C1_CAP" | [7ci2TXx5Um…](https://testnet.nearblocks.io/txns/7ci2TXx5Um6AWqpsNWq23wLnyvAoJJCsGis4oV8oekdn) |
| arena | new phone allowlist refused | agent_act | "C3_ALLOWLIST" | [4apPdjCPLu…](https://testnet.nearblocks.io/txns/4apPdjCPLux3xFPQBK328D4j1YSjQFj1viVxaMkShqCb) |
| arena | fake password refused | agent_act | "C6_BAD_PROOF" | [FabRj9boXt…](https://testnet.nearblocks.io/txns/FabRj9boXtMj6rMiPD4Z7Y5JHTYCVnJNcw2MENTPc1G4) |
| arena | gift nft refused | agent_act | "C7_HANDOFF" | [8uiZJJhcnP…](https://testnet.nearblocks.io/txns/8uiZJJhcnPvpYz289ZdFDYuQxv3sGvjMGFbrXKUVRnBR) |
| arena | bounty solved | agent_act | "ALLOW" | [Gt4AaoqmpP…](https://testnet.nearblocks.io/txns/Gt4AaoqmpPWwd9kgLEdhsFtxAJ45CXoHsspCdcWdvAGY) |
| arena | sell mid payout refused | nft_transfer | "Smart contract panicked: ERR_INFLIGHT_PAYOUT" | [3frX2Rwkuq…](https://testnet.nearblocks.io/txns/3frX2RwkuqQb4BY9ka9C3436xXCam72euNLK3fmhV1en) |
| arena | season close | season_close | "ok" | [614BiQmKEj…](https://testnet.nearblocks.io/txns/614BiQmKEjnamR1ZJMkfgwPEn9e7jAxUa3XgvNv7srq5) |
| toll | deploy | 0,Transfer,AddKey,DeployContract,new | "ok" | [5o4Mk8bLbi…](https://testnet.nearblocks.io/txns/5o4Mk8bLbiU9GhZvTSzAecXkgLFGYxMd2PTP8vzm5syL) |
| toll | signed allowlisted | pay | {"to":"0x552ad18e18a49ddad1e7d96b7ddf813b04a9cfb5","value":"10000000000000","nonce":0,"status":"signed","unsig | [ErwqgHH5br…](https://testnet.nearblocks.io/txns/ErwqgHH5br68jK1qz2ZAsfQpankMHke4CMUjruEtbt3s) |
| toll | refused not allowlisted | pay | "Smart contract panicked: REFUSED: recipient not in oath allowlist" | [88tRkqz9RL…](https://testnet.nearblocks.io/txns/88tRkqz9RLMEXd7kAegyQZsozfGMs4CYDrgMjpDCPnCE) |
| toll | refused over cap | pay | "Smart contract panicked: REFUSED: value over per-tx cap" | [Crd3jTD5Fm…](https://testnet.nearblocks.io/txns/Crd3jTD5FmY8VX4q3sc1AXywsHywJHnFnGKTntBJvGtT) |
| toll | finalized proof | verify_foreign_transaction | {"payload_hash":"2473efe1fd9e552ef5769cb0f5526e4f84d75dcfc196168ce004df53961b647d","signature":{"scheme":"Secp | [GHFJoQdSKT…](https://testnet.nearblocks.io/txns/GHFJoQdSKTK9Q9pUYEepeViMKhbyrmY7J4bMhuEw5fEV) |
| mistbank | oath allowed commitment | propose | {"action_id":"3","decision":"allowed","status":"confirmed","reason":"ok"} | [5HG5SPJ53M…](https://testnet.nearblocks.io/txns/5HG5SPJ53MhW799NjbqJGyUS1ymEiRvP9BWwLem1a3ua) |
| mistbank | oath memo too long denied | propose | {"action_id":null,"decision":"denied","status":"denied","reason":"memo_too_long"} | [9riHoM2rG8…](https://testnet.nearblocks.io/txns/9riHoM2rG8nWsNCW5qtnpwcbKu1GUB7LpZB7CPgBm6Xy) |
| toll | base sepolia broadcast | eth tx | status 1 on Base Sepolia, sent from the MPC-derived address | [0xf7ed6482…](https://sepolia.basescan.org/tx/0xf7ed6482a8380c1fe84be32973256d00960f522cd0d70fe9fe16165190dbc43b) |
| mistbank | zcash payout amount hidden | zcash tx | mined at height 4549357; amount hidden: true | [d0b5206733…](https://testnet.cipherscan.app/tx/d0b520673362ff6acd8d4ff9eb87beda9fa89f258ed9a07a5ffc57dfbcfa6897) |

## Other recorded runs

- Fresh Guardhouse run (backend/scripts/guardhouse-demo.js): allowed [4dxGpv8Y…](https://testnet.nearblocks.io/txns/4dxGpv8YkmTW79vcMDg7bXPmNN3JFrNBFLEKDXDXN6R3), denied receiver_not_allowlisted [AHhGaJCp…](https://testnet.nearblocks.io/txns/AHhGaJCpW5erBFWpWuNkNhPzKiR4BeigJyWvqV1Uzzpf).
- Owner approves a big move (backend/scripts/escalation-demo.js, judges/proofs/escalation-approved.json): 0.100001 NEAR over the 0.1 NEAR cap → `escalated` → owner `resolve_escalation(approve)` → `settle:approved`, `settle:confirmed`.
- Mist Bank (backend/scripts/mistbank-record.js, judges/proofs/mistbank-payout.json): the Zcash testnet faucet tx [17a9a84d…](https://testnet.cipherscan.app/tx/17a9a84d758b4feebea5d8fc2c556a95cd0778506cce791c7de23c4a08e0b497) is the counter-example. It crosses pools, so its amount is public, and `GET /api/mistbank/street/<txid>` flags it.
