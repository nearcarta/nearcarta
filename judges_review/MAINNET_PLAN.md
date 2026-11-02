# Nearcarta mainnet move: the true minimum (plan only, nothing spent)

Revised 2026-11-03 01:00 Cairo (UTC+2). Changes from the last draft:
- the charter is now **oath.r18** (agent key allowance optional);
- sizes are the shipped artifact bytes;
- the r18 factory path is costed;
- the Town Hall DAO line is corrected. `dao.globals.primitives.near` does not exist on mainnet (RPC UNKNOWN_ACCOUNT, checked 2026-11-03), so a DAO is a full Sputnik v2 instance.

## Rules the numbers rest on
- **Regular deploy:** locks 1 NEAR per 100 kB (1e19 yocto/byte) of code and state. The stake is refundable when the code or state is removed (docs.near.org storage staking).
- **Global contract:** 10 NEAR per 100 kB, **burned**. It only pays off at about 10 or more copies (docs.near.org global contracts).
- **Gas:** floor of 1 Tgas = 0.0001 NEAR. A deploy costs about 0.58 + 0.13 × kB Tgas. Creating an account costs about 0.007 NEAR.
- **r18:** `set_agent_key` takes `allowance: None`, meaning no gas cap, so the key never locks out. Its scope is the receiver plus `propose`.

## Core launch (true minimum): one shared charter + toll gate, NO factory
| # | Step | Locked (refundable) | Burned |
|---|---|---|---|
| 1 | Funder: an existing mainnet wallet | 0 | 0 |
| 2 | Create `charter.<root>.near` + `toll.<root>.near` | 0.002 | 0.015 |
| 3 | Deploy oath.r18 (401,334 B) regular on the charter + init | 4.013 | 0.005 |
| 4 | Charter state: policy, clauses for the shops, allowlists | 0.050 | 0.003 |
| 5 | Deploy toll.v5 (226,463 B) regular on the gate + init | 2.265 | 0.003 |
| 6 | Toll state: policy, path | 0.010 | 0.002 |
| 7 | Agent propose-only FC key, **no allowance** (r18) | 0.001 | 0.00004 |
| 8 | Delete the full-access keys (0 FAK, as on testnet) | 0 | 0.0001 |
| | **Core total** | **6.341 NEAR** | **≈0.028 NEAR** |
| 9 | Agent gas float, ~1,000 proposals × ~0.0003 | stays in the account | ≈0.3 over time |

**Cash to start the core: ≈6.67 NEAR** (6.341 + 0.028 + 0.3 float). About 95% is refundable stake.

## r18 factory path (only for per-user self-owned charters; not needed for launch)
The factory (`charter_factory.r15.wasm`, unchanged source) pins the charter code hash at `new()`. The R17 factory pins the old hash, so r18 needs a new factory, the same way R17 was made.

| # | Step | Locked | Burned |
|---|---|---|---|
| F1 | Publish oath.r18 as a global contract by hash (401,334 B) | 0 | 40.133 + 0.005 gas |
| F2 | Factory account: creation + 201,539 B measured (code 175,073 B + state) | 2.022 | 0.003 |
| F3 | `new(code_hash = r18)` + delete the factory FAK | 0 | 0.002 |
| F4 | Each user charter: 833 B + 0.01 registry fee + creation + ~30 Tgas | 0.018 | 0.010 |
| | **Factory setup** | **2.022** | **≈40.14** |

- **Break-even:** a regular r18 per user is 4.013 locked, against 0.028 through the factory. The factory wins after about 10 users.
- **Testnet:** the same path costs the same in testnet NEAR, about 42.2. This is why r18 is built (sha256 04377fc3…) but not yet deployed on testnet.

## Optional shops (add later, each independent)
| Step | Locked | Burned |
|---|---|---|
| Arena v2 (345,020 B) regular | 3.450 | 0.005 |
| House deed NFT (208,519 B) regular | 2.085 | 0.005 |
| Town Hall: own Sputnik v2 DAO (546,780 B measured on testnet) | 5.475 | 0.003 |
| Town Hall proposal bond (refunded on approval) | 0.1 | 0.006 |

- **Core + all optional, no factory:** 17.45 NEAR locked, ≈0.05 burned.
- **With the factory:** add 2.02 locked and ≈40.14 burned.

## Off-NEAR (real spend, small)
- **Base:** ETH gas for each Toll payout (cents) plus the payout itself.
- **MPC `v1.signer`:** a deposit per sign. Confirm the mainnet fee before launch.
- **NEAR AI:** per token, cents per day.
- **Hosting:** unchanged.

## Before any spend (owner approval each)
1. Run `bash scripts/fresh-deploy.sh` (dry run) green on the mainnet config, with r18 added to its artifact list.
2. Review security on the no-allowance propose-only key and the caps.
3. Confirm the MPC mainnet fee and the Base payout address.
4. Deploy steps 2 → 8, verify, then delete the FAKs.
