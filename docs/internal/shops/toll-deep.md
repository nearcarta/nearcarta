# Toll Bridge — deep brief v2 (Autonomous Business)

**Audience:** the Cursor chat that owns `toll` (PR #33 merged, PR #43 UX fixes merged).
**Repo:** `/workspace/near/tech/nearcarta` @ `08051dd`+. **Do not** send mainnet txs or deploy. The assistant runs live tests.
**Owner correction (2026-11-06) built in:** no recipient allowlist fixed at deploy. The visitor types any recipient. Safety = the visitor's own `/setup` row caps + contract-wide sanity caps. The contract is upgradeable (`upgrade` + `migrate`) so this is the **last** redeploy, never one per user or wallet.

## Read first
1. `docs/internal/source-pack.md` §1 (Kain "revenue", Eddy "any address on a supported network"), §2 ThePiVortex list (wallet connector producing chain signatures + 1Click; cross-chain micropayments), §3 Business row, §4 Chain Signatures — especially the **proxy-path tutorial** (one contract, one foreign address per user), §5 near-multichain, §8 P1, **§12 P0 #1** (board must forward the row owner).
2. `docs/internal/research/tracks/04-business.md`, `13-open.md`; `docs/internal/research/winners-patterns.md` (P1 is the strongest past-winner pattern and it is exactly this shop).
3. Code: `contracts/toll/src/lib.rs`, `app/src/panels/toll-room.js`, `app/src/panels/toll-dock.js`, `app/src/toll-derive.js`, `backend/src/toll-pass.js`, `backend/src/toll-views.js`, `backend/src/tollgate.js`, `backend/src/shops.js` L90–132, `app/design/D8_shops/js/shopui.js` (APPS.toll), `shared/deployments/mainnet.json` → `toll`, `backend/scripts/toll-teardown.js`.

---

## 1. Attack the idea (before any design)

| Question | Today's honest answer |
|---|---|
| 1. Real problem solved? What does the user gain? | **None.** The visitor pays 0.001 NEAR to `toll.nearcarta.near` and a boom lifts. No service is bought. The Proof tab shows one old Base signature that was never broadcast. |
| 2. Who receives the money and why does it make sense? | Our own contract, for nothing. Meaningless. |
| 3. What is new vs the ecosystem / past winners? | Nothing. A NEAR transfer is not new; the chain-signature part is a static record. |
| 4. Why would these judges love it? | They would not. It fails the "distinctive NEAR capability" test (`winners-patterns.md`). |
| 5. Works for any user, nothing hardcoded? | No. `0.001` is a constant in 10+ places; `allow_to` is one fixed address set at init; only the owner can call `pay`. |

**Idea score today: 2/10. Implementation score: 5/10** (UX polished in PR #43, two no-popup mainnet passes proven).
**Verdict: replace the idea, keep the slot, the track and the contract account.**

## 2. Replacement concept: "Toll Bridge = your agent's wallet on every EVM chain"

**One line:** the visitor's NEAR session row gets its **own** Base / Arbitrum / Ethereum address (Chain Signatures, path derived from the visitor's account), and their agent pays **anyone** on that chain in plain words — "pay 2 USDC to 0xabc on Base" — with no MetaMask, no seed phrase, no bridge, and no popup, under the same caps they set once in `/setup`. The Toll is a real business: it charges a published fee per crossing that pays the relayer's foreign gas, and its earnings are public in Chronicle.

| Question | New answer |
|---|---|
| 1. Problem / gain | Agents (and people) on NEAR who must pay a vendor, an API, a freelancer, or their own MetaMask on Base/Arbitrum today need a second wallet, ETH for gas and a bridge. Here the NEAR row **is** the EVM wallet. Gain: time (one sentence), safety (caps the agent cannot edit, on chain), capability (an AI agent with spending power on 5 EVM chains without ever holding a private key). |
| 2. Who gets the money | The **recipient the visitor names** (a vendor, a friend, their own wallet). The toll fee (e.g. 0.002 NEAR, read from `policy`) goes to `toll.nearcarta.near` and pays a real cost: the relayer's broadcast + the MPC call. Revenue is visible on chain. |
| 3. What is new | Chain-signature wallets exist; session caps exist; **a per-visitor foreign address whose spending policy is the visitor's own NEAR session row, driven by an AI agent in natural language** does not exist in the ecosystem or among past winners (P1 winners used the user's full-access key or a single shared path). Gas top-up is solved by composing with Ferry: 1Click delivers ETH straight to the visitor's derived Base address. |
| 4. Why judges love it | Illia/official stack: chain signatures + function-call keys + agents (source-pack §1). Eddy: "your counterparty only needs an address on a network supported…". Kain: "chain abstraction, AI and revenue". Past-winner P1 is exactly "one NEAR account controls money on other chains". The 2-minute demo ends on a **basescan** receipt. |
| 5. Any user, nothing hardcoded | Yes: recipient, chain, amount and asset come from the visitor; the foreign address is derived from the visitor's account; fee and limits come from `policy` view. No contract change per user. |

**Idea score after replacement: 9/10.**

## 3. What exists today (main @ 08051dd)

- **Contract** `toll.nearcarta.near` (`contracts/toll/src/lib.rs`): `new` L143, `freeze/unfreeze` L170–178, `set_nonce` L179, `close` L184 (owner, 1 yocto → `nearcarta.near`), `policy` L191, `get_visit` L201, `get_tx` L204, `pay` L207 (owner or self only), `pay_for` L214 (needs `gate`, which is null → panics), `on_signed` L282, `settle` L312, `on_verified` L326. One chain per instance (`evm_chain` L119). Signs with `v1.signer`, 1 yocto, path `base-1` — **one shared foreign address for everyone**.
- **City room**: `toll-room.js` — Pass tab does a board `propose` of 0.001 NEAR to `toll.nearcarta.near` (no popup, works). Proof tab only shows/derives the shared address. AI dock (`toll-dock.js`) accepts only "pay the toll" at 0.001.
- **Proven:** manual pass `6MteELyR…`, agent pass `3Ep1pJrV…`, earlier `3frACAL1…`, `CwcBGcw9…`. MPC sign `4LKGpA5v…` (status `signed`, never broadcast).

## 4. Hardcoded and per-user limits (file:line)

| Where | What |
|---|---|
| `app/src/panels/toll-room.js:13–14` | `PASS_NEAR = '0.001'`, `PASS_YOCTO` |
| `app/src/panels/toll-room.js:353,359` | Hero `0.001 NEAR`, button `Pay 0.001 NEAR` |
| `app/src/panels/toll-room.js:236–239` | Agent refuses any amount ≠ 0.001 |
| `backend/src/toll-pass.js:8,52` | `ONE_MILLI`, `amount_near: '0.001'` |
| `backend/src/shops.js:97–99` | `amount_near: '0.001'` |
| `app/design/D8_shops/js/shopui.js:455,518,521–522,552,597,615` | Copy + cinema at 0.001 |
| `app/src/toll-derive.js:91–98` | `TOLL_KEY`, `TOLL_ADDRESS`, `TOLL_CHAINS` constants (should come from `policy`) |
| `app/src/panels/toll-room.js:331` + `app/src/tokens/chains/base.svg` | Base icon is a plain blue square (no mark) |
| Contract init | `allow_to` = one fixed address; `path` = one shared path; `pay` owner/self only → **a new visitor can never send anything foreign** |
| Contract | No `upgrade`/`migrate`; no setter for limits; `gate` incompatible with `charter_board` (expects a charter factory `is_charter` + `get_action`, `lib.rs` L61–73, L105–114) |

## 5. Live mainnet views (fastnear RPC, 2026-11-06 06:25 Cairo)

- Account: 2.5542 NEAR, storage 253,139 B, code_hash `9RQw6e1PL81HSQ1x6dr6dyvv9yAMMBdqChRToyHuDwDP`.
- **Access keys: 1 function-call key** (`ed25519:GB83bZDd…`, receiver `toll.nearcarta.near`, methods `pay`, `settle`, allowance 0.25 NEAR). The old brief said 0 keys; that is outdated. This key is the interim "Path B" relayer; it is owner custody, not per-user.
- `policy`: owner `nearcarta.near`, mpc `v1.signer`, path `base-1`, chain_id 8453, foreign `0x4c07…e38a`, `allow_to ["0x1cdb…ea0f"]`, max_per_tx 0.00001 ETH, budget 0.00003 ETH, spent 0.000001, max_fee_cap 5 gwei, next_nonce 1, gate null.
- `get_tx(0)`: status `signed`, never broadcast (the derived address had no ETH).

## 6. Deep design

### 6.1 Contract `toll` v7 (one last redeploy, then upgradeable)
- **Identity:** accept calls only from `board.nearcarta.near` via the new board `propose_call_as` (source-pack §12 P0 #1). The board overwrites `row_owner` in args with the verified owner. The toll trusts `row_owner` only when `predecessor == board`.
- **Per-visitor path:** `path = "row:{row_owner}:{chain_key}"` (proxy-path pattern from the NEAR tutorial, source-pack §4). Each visitor gets a distinct address per EVM chain; all share secp256k1 domain 0. Add view `address_of(row_owner, chain)` returning the derived public key (frontend derives the address, same as `toll-derive.js`).
- **`cross(row_owner, chain, to, asset, amount, nonce, max_fee_per_gas, max_priority_fee, gas_limit)`**, `#[payable]`: requires attached deposit ≥ `policy.fee` (paid from the row by the board), checks `chain` ∈ `policy.chains` (Base 8453, Arbitrum 42161, Ethereum 1, Polygon 137, BNB 56 — data in state, editable by owner), `amount ≤ chain.max_per_tx` (sanity cap; the real cap is the board row), `max_fee_per_gas ≤ chain.max_fee_cap`, `to` is a 20-byte hex. Builds EIP-1559 (native) or ERC-20 `transfer` (asset = USDC address from `policy.assets[chain]`), calls `v1.signer.sign`, stores `TxRec{owner, chain, to, amount, status, raw_signed, tx_hash}` keyed by global id; emits `town-chronicle` events. **No `allow_to`.** The value comes from the visitor's own derived address, never from a shared pot.
- **Remove** owner-only `pay`; keep `settle` (anyone) for MPC verify-foreign-tx.
- **Admin:** `set_policy` (owner), `freeze`, `upgrade(code)` + `migrate()` (owner, per docs.near.org upgrade page), `close()` → `nearcarta.near` 1 yocto. `withdraw_fees(amount)` → `nearcarta.near` only.
- **Revenue split (Autonomous Business "fixed share to contributors"):** `policy.split = [(account, bps)]`; `withdraw_fees` pays the split. Shows real revenue in the Split tab.

### 6.2 Backend relayer
- `POST /api/toll/relay {id}`: reads `get_tx(id)`, broadcasts `raw_signed` to the chain RPC (`BASE_RPC`, `ARB_RPC`…), polls receipt, returns explorer link. It holds **no** key; anyone could relay. Remove the `pay`/`settle` FAK after v7 (or keep only `settle`).
- `GET /api/toll/wallet/:owner` → derived address per chain + live native/USDC balance + nonce (`eth_getTransactionCount`).

### 6.3 Gas top-up through Ferry (no ETH needed from the visitor)
- If the derived address has < 2× estimated gas, the room offers "Fill gas": a Ferry 1Click quote wNEAR → ETH on Base with `recipient = derived address`, `recipientType = DESTINATION_CHAIN`, settled by the same session `propose_call` path Ferry already proved. Corridor minimum: assistant checks live before claiming (Ferry lesson: bridge minimum).

### 6.4 City UX (Ferry pattern)
- Tabs **Pay / Wallet / Ledger** (rename Pass→Pay, Proof→Wallet). Opaque spacious tray, raised gold CTAs.
- **Pay:** chain picker with real web3icons (Base mark, not the blue square), asset (native ETH / USDC), amount, recipient field validated per chain (EIP-55), fee line from `policy.fee`, "your cap left today" from the row. Button: `Pay {amount} {asset} on {chain}`.
- **Wallet:** the visitor's derived addresses per chain with balances and explorer links; "Fill gas" button.
- **Ledger:** `get_tx` rows for this owner + basescan links; toll revenue total.
- **Cinema:** boom lifts when the NEAR leg (cross) succeeds; the far-shore lantern lights only when the foreign receipt status = 1. Copy never says "Paid on Base" before that (`proofWords` L141–159 — keep).

### 6.5 AI agent (executes under the session, no popup)
| Command | Action |
|---|---|
| "pay 0.5 USDC to 0xabc… on Base" | cross → relay → receipt |
| "send 0.00002 ETH to 0xabc on Arbitrum" | same, native |
| "what's my Base address?" / "my balances" | Wallet tab data |
| "fill gas on Base" | Ferry 1Click to derived address |
| "show my crossings" | Ledger |
| missing recipient | asks for it; never fills a default address |

### 6.6 Chronicle
Two entries per crossing: NEAR leg (board tx) and foreign leg (basescan hash). Toll fee entries count as revenue.

## 7. Costs and redeploy

| Item | Cost |
|---|---|
| Board v2 (`propose_call_as`) | One board redeploy (cross-shop, see §12). ≈1.1 NEAR storage recycled; open rows must close/reopen (Scholar row ≈0.41 NEAR returns to Scholar). |
| Toll v7 | `close()` returns ≈2.55 NEAR to `nearcarta.near`; recreate + deploy needs ≈2.6 NEAR stake (net ≈0.05 NEAR incl. gas). Snapshot `policy` + `get_tx(0..)` first. |
| Per crossing | Board fee to toll `policy.fee` (suggest 0.002 NEAR) + ≈0.003 NEAR gas from the session allowance; MPC deposit 1 yocto (proven on `4LKGpA5v`; re-check `v1.signer` current fee before live). |
| Base gas | ≈0.000001–0.00001 ETH per transfer. Fund each derived address once with ≈0.00005 ETH via Ferry (≈0.05 wNEAR swap, check corridor min). |
| First live test | 1 gas fill (≈0.05 NEAR) + 1 crossing of 0.1 USDC or 0.00001 ETH to the test address the assistant types in (never in code). |

## 8. Acceptance checklist (assistant live-tests)
- [ ] No `0.001` constant anywhere; fee and limits read from `policy`; agent accepts any amount ≤ row cap.
- [ ] No address constant in code or init; recipient typed by the visitor or said to the agent.
- [ ] Two different visitor rows show two different derived Base addresses.
- [ ] Manual and AI both: session `cross` (no popup) → MPC signed → relayed → basescan status 1.
- [ ] ERC-20 USDC on Base works, not only native ETH.
- [ ] Over-cap amount refused on chain by the board, seal shown, nothing signed foreign.
- [ ] "Fill gas" lands ETH on the derived address via 1Click.
- [ ] Real Base/Arbitrum icons; no blue square.
- [ ] Chronicle shows both legs; Split tab shows real fee revenue.
- [ ] `upgrade` + `migrate` tested in sandbox; `close()` → `nearcarta.near` still works; no stranded NEAR.
- [ ] `npm test` green; README Toll section rewritten with do-X-see-Y steps and placeholders for the assistant's tx links.

## 9. PR plan
1. Board v2 `propose_call_as` (shared; one chat owns it, see summary).
2. Toll v7 contract + sandbox tests + deploy script (assistant deploys).
3. Relayer + wallet API.
4. Room: Pay / Wallet / Ledger + icons + AI commands.
5. Ferry gas-fill composition.
