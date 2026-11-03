# Mainnet runbook: charter + toll core

Status: **not deployed**. Every step below was rehearsed end to end on testnet (deploy, real tests, teardown, refund). Proofs are in `judges/proofs/core-rehearsal*-testnet.json`.

## Layout

A 64-hex implicit root can't hold sub-accounts (`charter.<64hex>` is over 64 chars). Each contract gets a fresh **implicit account**, created for free by a plain transfer. Its key lives in `~/.near-credentials/<net>/<id>.json` (mode 0600).

| Account | Code | Keys after deploy |
|---|---|---|
| root (implicit, owner) | none | full access (owner) |
| charter (implicit) | `contracts/artifacts/oath.r18.wasm` | agent function-call key only (`propose`, `propose_batch`) |
| toll (implicit) | `contracts/artifacts/toll.v6.wasm` | agent function-call key only (`pay`, `settle`) |

Arena, house deed and Town Hall **stay on testnet**. On mainnet they would lock about 3.45, 2.09 and 5.48 NEAR, which is over budget.

## Exact init args

- **charter `new`:** `owner=<root>`, `dao=null`, `policy_delay_ns=90000000000`, `storage_reserve=0.02 NEAR`, `setup_window=true`.
- **charter `set_clause` (pay):** `receiver=<root>`, cap 0.002, daily 0.005, min 0.001, 3 per day.
- **charter `set_agent_key`:** agent public key with allowance `null`.
- **toll `new`:**
  - `mpc=v1.signer`, domain 3, path `base-1`, `chain_id=8453` (testnet uses `v1.signer-prod.testnet` and 84532).
  - `foreign_address = keccak(derived key)[12..]`.
  - `allow_to=[0x1cdbf67e974a3b07b2a52ee7c2d3821c8ec7ea0f]`, `max_per_tx=1e13 wei`, `budget=3e13 wei`, `max_fee_cap=5e9`, `verify_chain=Base`.
  - Each sign attaches 1 yocto.

## Run

```
NET=mainnet ROOT_KEY=~/.near-credentials/mainnet/<root>.json \
AGENT_OUT=<0600 file> OUT=<deploy.json> node backend/scripts/core-deploy.js
```

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

## Cost (from rehearsal 2, final defaults)

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

```
NET=mainnet ROOT_KEY=... DEPLOY=<deploy.json> OUT=<teardown.json> node backend/scripts/core-teardown.js
```

1. On the toll, call `close()` with 1 yocto.
2. On the charter, call `queue_upgrade(sha256(reaper.wasm))`.
3. Wait at least 90 s (the policy delay).
4. Call `execute_change(change_id)`.
5. Call `upgrade` with the raw reaper wasm as input.
6. Call `reap()` with 1 yocto. The account is deleted and its balance goes to the root.
7. Check that `view_account` errors for both accounts. Read the root balance a few seconds later, because the delete refund lands one receipt after the tx.

### Proven on testnet

**Rehearsal 1**
- **Txs:** toll_close `5L1mwLFobYRT8bzd2wxMdGC4BTmJ34FvDS6Pn1mhovB2`, queue `FqXAk3KuYaE5tJCiW5jXsrC2cnVbSyTZM74tnFwMbBh5`, execute `dac1wVkRk9iFUYW9ux2SKkpXY3kofwrzBqqH2KXLwUD`, upgrade `GBQ2Duz6vdHWfjPpVtzjD3uzbCcDRdqAAd2LRmDfhmTK`, reap `A3sM6jiu7dxJQMeMJz687UPQd3hDAtF2pwHWdEZJWCZh`.
- **Result:** both accounts deleted; 6.659 of 6.661 NEAR returned.

**Rehearsal 2 (final defaults)**
- **Deploy txs:** fund `GGWumuJ8shTCFuv5HjPYnfVQh38ay1wUQofjaxpY6EfG`, charter deploy `6wqzv5Bm8ZkxR5sGjLHGo7DstR1t3wB33mbS4ckqcS4j`, sweep `FmKFRMWBHEPYCtPzUPQG4fy8k4r9qYQmcEPcsBfi9rAe`, toll deploy `8BkygECnztHNvpJQCSm2rQmZuHdSWBAYfrY9xFKodaz6`, MPC pay `4d5YsK1Hmso6ke6K8bcGtD4U4vo1WWLhZJrZW2T4PcTF`, refused pay `8kdHfrcok4oUuxLCiVqogpbLsbjKffRan4jPDYry4fk3`, full-access key deletes `H6XDMHNEVnNAsnw2ftvBJM8NzpVkQ7kyi9exdYAc56oz` and `6MZbVBFMMsYHuxcfPN8wBxWZ94XvvA6rxuCLn1eigMrQ`.
- **Teardown txs:** close `5QUcCBa1gYhjxm8XE2W9dgWD1v5KByvGD4TEnuiAjd3M`, queue `37o4wuJTWe2NkmctH1sEQ8PBqWJKJDRTvni5K21Nip98`, execute `EC7wjKScixkoC8emvPcdqS5NDtr4v2EWba1Dzmwq2Qae`, upgrade `HfFdJEBjgUe1a5fDU1vxnsikPTQVceeVHw6LuRAVRNqh`, reap `8fAaYjgHkBJ2cWC175yTKtS6xQJSQ5M6MMZ7Hs4xLB9c`.
- **Result:** both accounts deleted; root gained 6.414.

## Config switch

- `shared/deployments/mainnet.json` holds the mainnet record (`status: not_deployed` until the run).
- `/api/mainnet` serves it read-only.
- `NEAR_NET=mainnet` overlays the deployed mainnet ids on the testnet set, and only once the status is `deployed`.
- The default stays testnet.
