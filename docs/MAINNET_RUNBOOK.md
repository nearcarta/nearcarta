# Mainnet runbook: charter + toll core

Status: **deployed**. Accounts and txs are in `shared/deployments/mainnet.json`. The live run is recorded under "Mainnet run (live)" below. The command lines name scripts that are not in this repo; the API does not sign.

## Layout

A 64-hex implicit account can't hold sub-accounts, so the funds move once into a named root made by the `near` registrar. The name itself only locks about 182 B.

| Account | Code | Keys after deploy |
|---|---|---|
| `nearcarta.near` (root, owner) | none | full access (owner) |
| `charter.nearcarta.near` | `contracts/artifacts/oath.r18.wasm` | agent function-call key only (`propose`, `propose_batch`), allowance 0.25 NEAR |
| `toll.nearcarta.near` | `contracts/artifacts/toll.v6.wasm` | agent function-call key only (`pay`, `settle`), allowance 0.25 NEAR |

The agent keys have a **finite** allowance (`AGENT_ALLOWANCE`, default 0.25). When it runs out, the owner rotates the key with `set_agent_key`; r18 adds the new key and deletes the old one in one batch.

Arena, house deed and Town Hall are covered in `docs/MAINNET_CONSOLIDATION.md`.

### Step 0: create the named root

The named-root helper is not in this repo. The live root is already `nearcarta.near` in `shared/deployments/mainnet.json`. Do not recreate it.

The new root's key is saved with mode 0600 in `~/.near-credentials/mainnet/nearcarta.near.json`.

## Exact init args

- **charter `new`:** `owner=<root>`, `dao=null`, `policy_delay_ns=90000000000`, `storage_reserve=0.02 NEAR`, `setup_window=true`.
- **charter `set_clause` (pay):** `receiver=<root>`, cap 0.002, daily 0.005, min 0.001, 3 per day.
- **charter `set_agent_key`:** agent public key with allowance 0.25 NEAR (finite).
- **toll `new`:**
  - `mpc=v1.signer`, domain 3, path `base-1`, `chain_id=8453`.
  - `foreign_address = keccak(derived key)[12..]`.
  - `allow_to=[0x1cdbf67e974a3b07b2a52ee7c2d3821c8ec7ea0f]`, `max_per_tx=1e13 wei`, `budget=3e13 wei`, `max_fee_cap=5e9`, `verify_chain=Base`.
  - Each sign attaches 1 yocto.

## Run

The deploy helper is not in this repo. The live charter and toll are already recorded in `shared/deployments/mainnet.json`. This API does not sign.

The script is resumable: it skips any step already recorded in `OUT`. It runs these steps in order:

1. Fund the charter with 4.2.
2. Deploy and init the charter.
3. **Sweep the charter surplus back to root**, keeping 0.1 above storage.
4. Set the pay clause and the agent key.
5. Fund the toll with 2.4.
6. Deploy and init the toll, and add the agent key.
7. **Sweep the toll surplus**, keeping 0.02.
8. Real tests:
   - agent proposes 0.001 (allowed);
   - agent proposes 0.003 (denied, over cap);
   - owner pays an allowlisted address through the toll (real MPC signature);
   - owner pays a non-allowlisted address (refused).
9. Delete the full-access keys on both contracts.

Both sweeps matter. A deploy tx reserves its prepaid gas from the contract account itself, so the account briefly needs about 0.08–0.12 NEAR above its final storage. With the sweeps, the root never has to hold both fundings at once.

On mainnet the derived Base address is unfunded, so the MPC-signed payout is real but is **not broadcast**.

## Cost (from rehearsal 3, named layout, final defaults)

The read-only mainnet dry run (`DRY_RUN=1`) resolved every id, the MPC keys and the derived Base address. It found `nearcarta.near`, `charter.` and `toll.` free.

| | NEAR |
|---|---|
| charter locked (402,392 B) | 4.024 |
| toll locked (227,811 B) | 2.278 |
| root spent in the deploy (locks + float + gas) | 6.437 |
| left on the root after deploy | 0.263 (of 6.7) |
| full deploy + teardown cycle, net | ~0.024 |

Exact mainnet budget: 6.7 on the implicit account. Suggested split: `DEPOSIT=6.6` to `nearcarta.near`, with the rest left on the implicit account for the registrar tx gas. About 6.44 is locked while live, and all of it except about 0.025 comes back through teardown.

### Older figures (rehearsal 2, implicit layout)

| | NEAR |
|---|---|
| charter locked (402,413 B) | 4.024 |
| toll locked (227,833 B) | 2.283 |
| float left on contracts | ~0.11 |
| gas burnt, whole deploy | ~0.022 |
| peak root balance needed | ~6.45 |

Net cost of the full deploy plus teardown cycle was about 0.03 NEAR. Everything else came back.

## Recovery: why the full-access key deletion is safe

- **toll:** `close()` is owner only and needs 1 yocto. It calls `delete_account(owner)`, which returns the full balance.
- **charter:** the owner can swap in `contracts/artifacts/reaper.wasm` through the charter's own timelocked upgrade path. The reaper reads the owner from the STATE first field, and its `reap()` (owner, 1 yocto) calls `delete_account(owner)`.

## TEARDOWN

The teardown helper is not in this repo. Do not delete the live accounts from this API.

1. On the toll, call `close()` with 1 yocto.
2. On the charter, call `queue_upgrade(sha256(reaper.wasm))`.
3. Wait at least 90 s (the policy delay).
4. Call `execute_change(change_id)`.
5. Call `upgrade` with the raw reaper wasm as input.
6. Call `reap()` with 1 yocto. The account is deleted and its balance goes to the root.
7. Check that `view_account` errors for both accounts. Read the root balance a few seconds later, because the delete refund lands one receipt after the tx.

### Proven on earlier network

**Rehearsal 3 (named layout, `nearcarta-core.near`, finite allowance)**
- **Deploy:** fund `Ch6z1nMKQcnreHnJPxqMJWN52ihSNm77pa5T3tuKoTSi`, charter `D1CP9Jfie8j6jN8XEU7tmLUAMmus2eJ3akP6YNddToaG`, sweep `Hi8qcXky8wuRy4HcS6aqhT41GAL2ELYT6TmXX4AjLLzq`, agent key `7WA6iT98gRGgQc7rVBWDtaJbdDmjRpQW6e12Sg1pLF1e`, toll fund `2vAzzTryDbnDro2DfWU6NJ2sf2p7gRinVLHS8aZ5Kd5M`, toll `FFsvE2UXSYwahjaxJnWMfDxthAEisQM9F32Kdnk6TM33`, toll sweep `Fb8LbX799rF7GvCWd4geC5Lt8V8UzrWnFmrxCDhdQ9PW`.
- **Tests:** allowed propose `CbdezdftGQXMAC9dFgC6R8uJooqHDa4wAXJ3CTZuPcVk`; over-cap refused `8iaFJmBxXkD6Ywxp6eRKRsmd5gy5WbL4Rncc9jMZ972Z`; allowlisted toll pay `3LQyZThHD3GnnDDg5fjFznS33dLZV4Vf5NSYaAreTfPh`; non-allowlisted refused `EfaAQY4dBXeb4Me4UmLaa2e9jbJhqL4iRePZkZXVPhZZ`. Full-access keys deleted: `AKVHcbmEH2SFouZZLVVtrdWNiChRiu4Evm9s5uhicBku` and `FETTVx7f7GoF7DG1dqZz9cyVX5LeU8Gy8s95BSXA52md`.
- **Teardown:** close `2EreUTbe9AHzKp6Md1aR4sMFgVmCawFnGKjP34GfGavr`, queue `BXFJAaAhHA3XMpo3AER8qxhHb6kAJwQR9bdinCCdatrJ`, execute `3o6Lzt8wB9VqzzpJxH3bdK6FDRkS83ypUzFj6bipUvQ2`, upgrade `7JhtCfUqk516zv7aPjeUiTkVu3j6Uf8pyFzTB7SrVAqZ`, reap `25eS4kfnFXTavHx3t4X2JP8iUsdX5nSUNFnQyqURkVue`.
- **Result:** both accounts deleted; root gained 6.413.


**Rehearsal 1**
- **Txs:** toll_close `5L1mwLFobYRT8bzd2wxMdGC4BTmJ34FvDS6Pn1mhovB2`, queue `FqXAk3KuYaE5tJCiW5jXsrC2cnVbSyTZM74tnFwMbBh5`, execute `dac1wVkRk9iFUYW9ux2SKkpXY3kofwrzBqqH2KXLwUD`, upgrade `GBQ2Duz6vdHWfjPpVtzjD3uzbCcDRdqAAd2LRmDfhmTK`, reap `A3sM6jiu7dxJQMeMJz687UPQd3hDAtF2pwHWdEZJWCZh`.
- **Result:** both accounts deleted; 6.659 of 6.661 NEAR returned.

**Rehearsal 2 (final defaults)**
- **Deploy txs:** fund `GGWumuJ8shTCFuv5HjPYnfVQh38ay1wUQofjaxpY6EfG`, charter deploy `6wqzv5Bm8ZkxR5sGjLHGo7DstR1t3wB33mbS4ckqcS4j`, sweep `FmKFRMWBHEPYCtPzUPQG4fy8k4r9qYQmcEPcsBfi9rAe`, toll deploy `8BkygECnztHNvpJQCSm2rQmZuHdSWBAYfrY9xFKodaz6`, MPC pay `4d5YsK1Hmso6ke6K8bcGtD4U4vo1WWLhZJrZW2T4PcTF`, refused pay `8kdHfrcok4oUuxLCiVqogpbLsbjKffRan4jPDYry4fk3`, full-access key deletes `H6XDMHNEVnNAsnw2ftvBJM8NzpVkQ7kyi9exdYAc56oz` and `6MZbVBFMMsYHuxcfPN8wBxWZ94XvvA6rxuCLn1eigMrQ`.
- **Teardown txs:** close `5QUcCBa1gYhjxm8XE2W9dgWD1v5KByvGD4TEnuiAjd3M`, queue `37o4wuJTWe2NkmctH1sEQ8PBqWJKJDRTvni5K21Nip98`, execute `EC7wjKScixkoC8emvPcdqS5NDtr4v2EWba1Dzmwq2Qae`, upgrade `HfFdJEBjgUe1a5fDU1vxnsikPTQVceeVHw6LuRAVRNqh`, reap `8fAaYjgHkBJ2cWC175yTKtS6xQJSQ5M6MMZ7Hs4xLB9c`.
- **Result:** both accounts deleted; root gained 6.414.

## Mainnet run (live)

Mainnet runs protocol 86. Builds with near-sdk 5.28 or newer import host functions protocol 86 does not have (gas keys, `universal_state_init`), and the first charter deploy failed at `new` with a link error (tx `Eeq1XVYxsW3ieZNakdxC87rZfKGpLSxvHRq7Gx2vomam`, about 0.003 NEAR gas). All three contracts are now built with near-sdk 5.27.0 and rustc 1.86:

| artifact | bytes | sha256 |
|---|---|---|
| `oath.r18p86.wasm` | 425,406 | `542ae4dad007edae2ded336ec3b9321ada00af208b4c82814ff06b80f29665cf` |
| `toll.v6p86.wasm` | 251,969 | `7d1e7ee1a619987c00de5a42c881e006f52dda38ccd423d54540aa51d5e42686` |
| `reaper.p86.wasm` | 24,864 | `afe81ba2a0f07af4de3b849aac4f62db9e22d777ef445077a215209eea0ac199` |

1. Reaper link check on mainnet (`wasm-link-check.js`): `6mdu5icACvP7F5zRE38Dfe7GyqBKtYfYZzehUMhQC2RR`. The view call reached the code (WasmTrap, no link error).
2. The same three files were checked before the mainnet run recorded in `judges/proofs/core-mainnet-deploy.json`.
3. Mainnet charter (`CHARTER_ONLY=1`, proof `judges/proofs/core-mainnet-deploy.json`):
   - create `nearcarta.near`: `AFFEjpLXiA3jREsGwpUBs8Pj3EBwWKnSv2vLe6HircNF`
   - fund charter: `3fTm5K9DW8ccACNA34CXLF8J1pirzbuAYqDYefsr5ZMd`, top up 0.25: `6KByv67b6F1NhHyqk7m87KnSzdN4vdDjiXj2XvD6hbcd`
   - deploy + init: `DNDNMtRXRiPP1bHoSUtttdYgnwYSfXARpPWJwaedzvma`, sweep: `7hvd6krDjboxz8CxnNNWMBeWvAWhCYpYeddGo2uEHjbM`
   - clause `pay`: `7s3X1DuBWu1XN3oTWYnyNiduuAjTrPoyT1ETCJesyHpP`, agent key (0.25 NEAR allowance): `Frp44yFGSAh9vi2w4dmV4wnDH5MBktvX7N2xyAcPRJDP`
   - agent propose 0.001 allowed: `JChWxmANwWiUqh7au1VrjCzPp8pdjHP46EnadmJsrdTy`; 0.003 denied `over_per_action_cap`: `BvDNZk6F5mAH2fqDCkLgf61hCmHJcJTbcQYnRc7reKbH`
   - full-access key deleted: `71Zio28gV3yubD5DecGtkguWzWdfix8brcKFy13d3zzt`
   - final: 426,432 bytes (4.264 NEAR locked), balance 4.360, one key (function call, `propose`/`propose_batch`).
4. Toll (same command without `CHARTER_ONLY`, after the 10 NEAR were moved to `nearcarta.near` in `6afg8RZ5b1hdqZQ5CHdsg46dgBT8zrcvnioAckFse3Xi`):
   - fund `64HuNHJ8jKA4zBJyKNDdQkXasyvmgizbGT5wYBWVb2Fa`; deploy + init + agent key `6KgwM4Q1VmLfvgK8vDBkWg92S65ZLcFsUb6NNXsAEWXc`; sweep `DVFgzmAx2My6cki1q6wXyNsm2VHQ3HzZo1KZHKwQtqEd`
   - allowlisted pay, MPC-signed (signed only, not broadcast on Base): `4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz`; non-allowlisted refused: `B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR`
   - full-access key deleted: `6C1rLPtYKpxQgX5ZYFYSyGsbQEify9AVQ23fdXKAskxY`
   - final: 253,139 bytes, code hash `9RQw6e1PL81HSQ1x6dr6dyvv9yAMMBdqChRToyHuDwDP`.
5. Arena, house deed and Town Hall: see Part C in `docs/MAINNET_CONSOLIDATION.md`.

## Reproducible builds

Not yet reproducible. `cargo near build reproducible-wasm` fails on this box because Docker's bridge network has no DNS. The pinned artifacts are the hashes in `shared/deployments/mainnet.json`.

## Config

- `shared/deployments/mainnet.json` is the only deployment record (`status: deployed`).
- `/api/mainnet` serves it read-only.
- The API reads that file. There is no second network overlay.
