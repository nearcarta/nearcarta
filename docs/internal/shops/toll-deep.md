# Toll Bridge — deepen to Ferry depth (Cursor brief)

**Audience:** the Cursor chat that owns `toll` (same chat that shipped PR #43 UX fixes).  
**Repo:** `/workspace/near/tech/nearcarta` @ `0c72a47` (main).  
**Owner ask (2026-11-06):** Toll is shallow and hardcoded at 0.001 NEAR transfer to `toll.nearcarta.near`. Make it as deep as Ferry: live policy-driven amounts/routes, real chain-signature **foreign** payment, AI NL, cinema, basescan proof.  
**Do not** send mainnet txs or redeploy yourself. Prepare code + scripts; the assistant runs live tests.  
**Hard rules:** teardown to `nearcarta.near`; no stranded NEAR; no naming other projects/owner in public artifacts; small commits; secrets only in hidden fields.

---

## 0. Verdict in one paragraph

Today the city Toll room is a **fixed 0.001 NEAR board `propose` pass** plus a Proof tab that only **derives / describes** the Base address. It never calls `pay`, `pay_for`, or `sign`, never broadcasts, and never shows a basescan receipt. The live contract `toll.nearcarta.near` **can** own a Base wallet via Chain Signatures (`v1.signer`, path `base-1`), already has one MPC-signed EIP-1559 tx sitting at status `signed` (unbroadcast), but `gate` is `null`, FAKs were deleted, `allow_to` is a single hardcoded recipient that is **not** the owner's designated Base address, and the UI amount is a constant — not `policy`. That is why Toll feels shallow vs Ferry.

---

## 1. What the mainnet contract actually supports (read live)

**Account:** `toll.nearcarta.near`  
**Owner:** `nearcarta.near`  
**Wasm:** `toll.v6p86.wasm` · code_hash `9RQw6e1PL81HSQ1x6dr6dyvv9yAMMBdqChRToyHuDwDP`  
**Balance:** ~2.554 NEAR (almost all storage stake; do not drain)  
**FAKs:** 0 (deleted in `toll_delete_fak`)

### 1.1 Live `policy` (RPC view, 2026-11-06)

```json
{
  "owner": "nearcarta.near",
  "mpc": "v1.signer",
  "path": "base-1",
  "chain_id": 8453,
  "foreign_address": "0x4c07c97812098f595ff1611d8cb3465e591ee38a",
  "allow_to": ["0x1cdbf67e974a3b07b2a52ee7c2d3821c8ec7ea0f"],
  "max_per_tx": "10000000000000",
  "budget": "30000000000000",
  "spent": "1000000000000",
  "max_fee_cap": "5000000000",
  "next_nonce": 1,
  "frozen": false,
  "verify_chain": "Base",
  "asset": "native",
  "dao": null,
  "gate": null
}
```

| Field | Meaning | Human |
|---|---|---|
| `foreign_address` | Derived Base wallet for (`toll.nearcarta.near`, path `base-1`) | `0x4c07…e38a` |
| `allow_to` | Only EVM recipients `pay`/`pay_for` may send to | **one** address `0x1cdb…ea0f` — **not** owner dest `0xBDfC…0034` |
| `max_per_tx` | Cap per foreign transfer | **0.00001 ETH** |
| `budget` / `spent` | Lifetime foreign budget | 0.00003 ETH / 0.000001 spent |
| `max_fee_cap` | Max EIP-1559 maxFeePerGas | **5 gwei** |
| `gate` | Visitor `pay_for` gate | **`null` → `pay_for` panics** |
| `verify_chain` | MPC foreign proof chain | `Base` (8453) |

**Config-driven (contract init, immutable without redeploy):** path, chain_id, foreign_address, allow_to, max_per_tx, budget, max_fee_cap, verify_chain, token, dao, gate.  
**No setters** for allow_to / gate / budget / path (only `set_nonce`, `freeze`/`unfreeze`, `close`). Source: `contracts/toll/src/lib.rs` L179–189, L191–199.

### 1.2 Methods that matter

| Method | Who | What |
|---|---|---|
| `policy` | anyone (view) | live caps + destinations |
| `get_tx(nonce)` | anyone (view) | TxRec: status signing\|signed\|failed\|confirmed\|refused_proof, `raw_signed`, `tx_hash` |
| `get_visit` / `visit_nonce` | anyone (view) | gate visits (unused while gate=null) |
| `pay(to, value, fees, gas_limit)` | **owner or self (FAK on this account)** | builds EIP-1559, calls `v1.signer.sign`, `on_signed` recovers address must equal `foreign_address` |
| `pay_for(charter, action_id)` | anyone | only if `gate` set; reads factory `is_charter` + charter `get_action`; then signs **fixed** gate payout |
| `settle(nonce, block_hash)` | anyone | MPC `verify_foreign_transaction` after broadcast |
| `close()` | owner, 1 yocto | delete account → balance to owner (`nearcarta.near`) |

Cite: `contracts/toll/src/lib.rs` L207–242 (pay/pay_for), L244–269 (start_sign → `v1.signer` `sign` with 1 yocto + 50 Tgas), L281–308 (on_signed), L312–348 (settle), L183–188 (close).

Supported verify chains in wasm: Bnb, Base, Arbitrum, Polygon, Avalanche (`evm_chain` L119–127). **One chain per deployed instance.**

### 1.3 Live `get_tx(0)` — already signed, never broadcast

```json
{
  "to": "0x1cdbf67e974a3b07b2a52ee7c2d3821c8ec7ea0f",
  "value": "1000000000000",
  "nonce": 0,
  "status": "signed",
  "tx_hash": "0x096571bc0c235605f5c26f2849ba61383dbaa3f8f59fb918999963c30b0d45be",
  "raw_signed": "0x02f870…",
  "proof_payload_hash": null
}
```

- Value: **0.000001 ETH** to allowlisted `0x1cdb…`.  
- Recorded NEAR allow that produced the MPC sig: [4LKGpA5v…](https://nearblocks.io/txns/4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz).  
- README already admits: *“The derived Base address was unfunded, so the foreign tx was not broadcast.”* (`README.md` Toll section; `shared/rails/receipts.js` ~L67).  
- `next_nonce` is already **1** — a new `pay` would use nonce 1. Nonce 0 raw can still be broadcast if the foreign account still has nonce 0 and is funded.

### 1.4 Gate vs `charter_board` (architecture gap)

`pay_for` / `Gate` expect a **charter factory** (`is_charter`) and charter `get_action` with memo/fee/payee (`lib.rs` L61–73, L105–114, L214–224).  
Nearcarta visitors use **`board.nearcarta.near` `propose`**, which does **not** expose that factory/`get_action` API. So **enabling the existing `gate` as-is will not work with the city board** without a contract change that accepts a board pass (see §4).

---

## 2. What the UI hardcodes (file:line)

### 2.1 Canonical 0.001 constants

| File:line | Constant / copy |
|---|---|
| `app/src/panels/toll-room.js:13` | `export const PASS_NEAR = '0.001'` |
| `app/src/panels/toll-room.js:14` | `export const PASS_YOCTO = 10n ** 21n` |
| `app/src/panels/toll-room.js:353` | Hero `<b>0.001</b> NEAR` |
| `app/src/panels/toll-room.js:359` | Button `Pay 0.001 NEAR` |
| `app/src/panels/toll-room.js:236–239` | Agent refuses any amount ≠ 0.001 |
| `backend/src/toll-pass.js:8` | `ONE_MILLI = 1e21` yocto |
| `backend/src/toll-pass.js:52` | `amount_near: '0.001'` |
| `backend/src/shops.js:97–99` | `amount_near: '0.001'` + note |
| `app/design/D8_shops/js/shopui.js:455,518,521–522,552,597,615` | Cinema + copy + `Pay 0.001 NEAR` |
| `README.md` Toll section | Documents the fixed pass (honest, but product is shallow) |

**Room never calls `pay` / `pay_for` / `sign`.** Explicit in `README.md` Toll Bridge section and `docs/internal/shops/toll.md`. Pass path = `board.propose` → `toll.nearcarta.near` only (`shopui.js` APPS.toll + `toll-room.js` mount).

### 2.2 Proof tab Base icon = blue square (broken asset)

Proof markup uses:

```js
// app/src/panels/toll-room.js:331
const base = '<img class="ti" src="/tokens/chains/base.svg" alt="Base" width="36" height="36" …>';
```

Live file `app/src/tokens/chains/base.svg` contains **only** a `#00F` rounded-rect path — **no white Base mark**. That renders as a **solid blue square**. Compare with the correct circle mark in `app/src/tokens/base.svg` and the full `net:base` glyph in `app/design/D6_dashboards/src/tokenIcons.js` (`net:base`).  
**Fix:** replace `/tokens/chains/base.svg` with the real web3icons Base network SVG (background + white mark), or point Proof at `tokenBadge` / `base.svg` the same way Ferry does. Add a unit test that the SVG has >1 path / non-empty white fill.

### 2.3 Derived address hardcodes

`app/src/toll-derive.js:91–98` — `TOLL_KEY`, `TOLL_ADDRESS`, `TOLL_CHAINS` (only Base marked `derived: true`). Should prefer live `policy.foreign_address` / `path` / `chain_id` from `GET /api/toll/live` (already partially wired in `assembleTollLive`).

---

## 3. Track fit (judges)

**Primary track:** Autonomous Business (`audit/tracks/04-business.md`, README table, `docs/internal/shops-blueprint.md`).  
Tagline: company of one; agent treasury/sales/procurement; **cross-chain payments**; revenue share; humans set constraints. Lean on: AI agents, Intents, **Chain Signatures**. Demo loop sale → cost → payout &lt; 2 minutes; public ledger.

**Chain Signatures depth** (also Open Innovation lean-on, `audit/tracks/13-open.md`; official docs):

- https://docs.near.org/chain-abstraction/chain-signatures  
- https://docs.near.org/chain-abstraction/chain-signatures/implementation  
- https://docs.near.org/chain-abstraction/chain-signatures/getting-started  
- MPC contract mainnet: `v1.signer` · testnet `v1.signer-prod.testnet`  
- Five steps judges expect: **derive → build tx → request signature → format → relay to foreign chain**  
- Docs note Chain Signatures are **outbound-only**; “Paid on Base” only after a foreign success receipt (Toll already words this correctly in `proofWords` — keep that honesty).

**Hackathon source pack:** `/workspace/audit/near-track-sources.md` (8 tracks only; Business loop is P1 in track-gap-audit).

**What Toll must prove for judges (vs Ferry for DeFi):**

| Judge want | Ferry today | Toll must become |
|---|---|---|
| Live non-hardcoded list / policy | 1Click ~215 tokens / ~38 chains | Live `policy` routes + amounts |
| Agent under session caps, no popup | `propose_call` wrap | board pass **then** MPC sign + broadcast |
| Real on-chain delivery + explorer | 1Click SUCCESS + nearblocks | **basescan (or arbiscan) success link** |
| Public ledger | Chronicle / receipts | Chronicle line for NEAR pass **and** foreign tx |
| Cinema only on real success | boat delivered after SUCCESS | boom lifts only after foreign receipt **or** clearly separate NEAR-pass cinema from Base-paid |

---

## 4. Target product: Deep Toll (Ferry-class)

### 4.1 User story (≤2 minutes)

1. Visitor already funded in `/setup`; row allows `toll.nearcarta.near`; cap ≥ pass fee from **live policy / gate fee** (not a constant).  
2. Opens Toll from the city. Tray tabs: **Cross / Proof / Split** (rename Pass → Cross once foreign pay exists; keep Pass as the NEAR leg label if clearer).  
3. Picks a **route** from live policy (Base now; Arbitrum later via second instance). Icons = real web3icons (fix Base square). Sees fee, foreign recipient from `allow_to` / gate `evm_to`, derived address from policy.  
4. Manual CTA **or** AI (“pay the toll on Base”, “cross to Arbitrum”) under session:  
   - **Leg A:** silent `board.propose` of the policy fee to `toll.nearcarta.near` (no popup).  
   - **Leg B:** contract asks `v1.signer` to sign a tiny native transfer on Base to the allowlisted recipient.  
   - **Leg C:** backend/relayer broadcasts `raw_signed`; UI polls until receipt status=1; shows **basescan** link.  
5. Boom / cinema only after the leg the copy claims. “Paid on Base” **only** when `proofWords` claim=`paid` (receipt status 1).  
6. Chronicle records both hashes. Split tab shows live revenue / fee words from policy (not “no split” forever).

### 4.2 Contract work (redeploy required — see §5)

**Problem:** visitors cannot trigger `pay` (owner/self only; FAK deleted). `pay_for` needs gate+factory charters incompatible with `charter_board`. `allow_to` cannot change without redeploy. Owner dest `0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034` is not allowlisted.

**Recommended contract change (v7) — pick one primary path:**

**Path A (preferred for Autonomous Business):** add visitor-callable  
`cross_after_board({ board, owner })` (names flexible) that:

1. Requires attached gas ≥ current `GATE_MIN_GAS` pattern.  
2. Reads `board.get_charter({ owner })` (or equivalent) **or** accepts a recent board propose proof the API already verifies off-chain **and** a one-shot on-chain memo deposit.  
3. Verifies the visitor’s row recently paid ≥ `fee` NEAR to this toll (or use attached deposit on a `propose_call` into a new `accept_pass` method).  
4. Then calls existing `start_sign(allow_to[i], value, fees, 21000)` with value ≤ `max_per_tx` from **state**, not args the visitor chooses freely.  
5. Emits chronicle events (already `town-chronicle`).

If full board introspection is too heavy for one PR: **Path B (interim, still deep):** re-add a **method-scoped FAK** on `toll.nearcarta.near` limited to `pay` (+ maybe `settle`), held only in vault/hidden env; city flow = visitor board pass → API verifies pass → API calls `pay` with policy amounts → broadcast. Still show basescan. Document custody. Owner can rotate/delete FAK. **Do not** leave a full-access key.

Also on redeploy init:

- `allow_to`: include `0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034` (owner-designated Base recipient). Keep or drop `0x1cdb…` as needed.  
- Keep `path: "base-1"`, `chain_id: 8453`, same derivation → **same** `foreign_address` `0x4c07…e38a` if predecessor+path unchanged (critical so prior funding still applies).  
- `max_per_tx` / `budget`: tiny (≤ 0.00001 ETH class) so demos stay cheap.  
- `max_fee_cap`: ≥ realistic Base gas (policy already 5 gwei; signed sample used ~0.1 gwei — **too low to land**; new pays must use fees under cap but high enough for Base inclusion).  
- `close()` unchanged → funds to `nearcarta.near`.  
- Optional second instance later: `toll-arb.nearcarta.near` with `verify_chain: "Arbitrum"` for “cross to Arbitrum” (one chain per instance — `lib.rs` header).

**Do not claim gate revenue split until `gate` or a split field exists on-chain.** Split tab may show “all NEAR passes accrue on `toll.nearcarta.near`; foreign spends debit `spent`/`budget`” from live policy.

### 4.3 Backend / relay

Implement (or finish the commented intent in `app.js` L371):

- `POST /api/toll/cross` (or `/relay`): after visitor pass verified, trigger `pay` / `cross_after_board`, wait for `get_tx` status `signed`, then `eth_sendRawTransaction` of `raw_signed` to Base RPC.  
- `GET /api/toll/live` already reads `policy` + recent `get_tx` (`toll-views.js`) — extend with foreign receipt status via `evmFacts` (`shops.js` L121–132) and explorer URLs.  
- Never say “Paid on Base” without receipt status 1 (`proofWords` in `toll-room.js` L141–159 — keep).  
- Env: `BASE_RPC` (already referenced). Secrets for FAK only via vault/hidden fields if Path B.

### 4.4 Frontend (Ferry pattern)

- **Amounts / labels from live policy**, not `PASS_NEAR`. If policy/gate fee is X NEAR, button says `Pay {X} NEAR`, agent accepts that amount. Fallback refuse if live policy unread.  
- **Route picker:** Base (live instance) + disabled/coming Arbitrum until second instance; real icons (fix `chains/base.svg`).  
- **AI NL:** “pay the toll”, “pay the toll on Base”, “cross to Arbitrum”, “check signature”, “show my foreign address”, “show policy”. Execute Cross (both legs) when policy allows — not “fill form only”.  
- **History:** list from `get_tx` + visitor chronicle rows; each foreign success → basescan link `https://basescan.org/tx/{tx_hash}`.  
- **Cinema:** boom lift on allowed NEAR pass OK; separate “Base paid” beat only after receipt. Clear seals on next action (Ferry lesson).  
- City entry primary; `/shops/toll/` backup.

### 4.5 Acceptance checklist (assistant will live-test; you implement)

- [ ] No hardcoded `0.001` as the only possible fee in UI/agent (constants may remain as defaults only if equal to live policy fee and overridden by policy).  
- [ ] Proof Base icon is real Base mark, not blue square.  
- [ ] Live `policy` drives recipient + max foreign value shown in tray.  
- [ ] Session path: board propose (no popup) → MPC sign → broadcast → basescan success for a **tiny** Base transfer to allowlisted dest (prefer `0xBDfC…0034` after redeploy).  
- [ ] AI and manual both run that path.  
- [ ] Copy never claims Base paid without receipt.  
- [ ] Chronicle shows NEAR pass + foreign tx.  
- [ ] `npm test` green; teardown script still prints `close()` → `nearcarta.near`; README Toll section updated with placeholders for assistant-filled txs.  
- [ ] First live foreign value ≤ `max_per_tx`; NEAR pass ≤ session cap (Scholar ~0.1).

---

## 5. Costs, funding, redeploy decision

### 5.1 Is a redeploy needed?

| Goal | Redeploy? |
|---|---|
| Fix Base blue-square icon + UI copy from policy | **No** |
| Broadcast existing `get_tx(0)` raw (to `0x1cdb…`) after funding foreign addr | **No** (demo of leg C only) |
| Change `allow_to` to include `0xBDfC…0034` | **Yes** (no setter) |
| Let visitors trigger MPC `pay` without owner FAK | **Yes** (new method) **or** Path B FAK (no code change, custody tradeoff) |
| Enable stock `gate`/`pay_for` with `charter_board` | **Yes + code change** (gate incompatible as-is) |

**Recommendation:** plan a **controlled redeploy** of `toll.nearcarta.near` (or new subaccount then cut over) with v7 init: new allow_to, same path/foreign_address if possible, new `cross_after_board` (or document Path B FAK). Backup state (`policy`, all `get_tx`) to `shared/deployments/` before `close()`.

Redeploy sequence (assistant runs; you prepare scripts):

1. Snapshot `policy` + `get_tx` for nonces `0..next_nonce-1`.  
2. Optional: fund foreign addr + broadcast existing signed raw as a one-shot proof (see §5.2).  
3. Owner `close()` 1 yocto → ~2.55 NEAR returns to `nearcarta.near` (storage unlocked).  
4. Recreate account, deploy wasm, `new(...)` with allow_to including `0xBDfC…0034`, owner `nearcarta.near`, mpc `v1.signer`, path `base-1`, chain_id `8453`, foreign_address matching derivation.  
5. Verify `policy` view; update `mainnet.json`; no leftover FAKs unless Path B scoped key.  
6. Fund foreign address again with tiny ETH for gas.  
7. Teardown remains `close()` → `nearcarta.near`. **No NEAR left stranded.**

### 5.2 Foreign-chain funding (Base)

| Address | Role |
|---|---|
| `0x4c07c97812098f595ff1611d8cb3465e591ee38a` | Toll derived signer — **needs tiny ETH for gas** (README: was unfunded) |
| `0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034` | Owner-designated **recipient** for demos (update allow_to) |
| `0xf76e6b0920e9332ff4410f6dd53f01722abc71a3` | Owner wallet holding **USDC on Base** — use to buy/bridge tiny ETH for the derived address if needed; **not** the allow_to target unless policy says so |

Rough gas: 21000 gas × ~0.01–0.1 gwei on Base is still ≪ 0.00001 ETH; fund ~0.0001 ETH on `0x4c07…` to be safe for several demos. Transfer value per demo: ≤ `max_per_tx` (0.00001 ETH).

### 5.3 MPC / NEAR costs

- Contract attaches **1 yocto** to `v1.signer.sign` (`lib.rs` L267). Proven working on mainnet (tx 4LKGpA5v → status `signed`).  
- Docs often show ~0.1 NEAR attached when a **user account** calls MPC (`implementation` tutorials); this oath pattern uses the contract as predecessor with 1 yocto — keep that working pattern.  
- Visitor NEAR pass: currently UI 0.001 NEAR; after deepen, use policy/gate fee (may stay 0.001). Gas for board propose paid by session key allowance.  
- `settle` also 1 yocto to MPC verify — optional after broadcast for “confirmed” status.

### 5.4 Do **not** (this brief)

- Send mainnet txs from Cursor.  
- Force-push.  
- Claim Social Money / DAO.  
- Claim “Paid on Base” without a receipt.  
- Drain `toll.nearcarta.near` balance except via `close()` to `nearcarta.near`.

---

## 6. Implementation order (PR-sized)

1. **P0 icon + honesty:** fix `chains/base.svg`; Proof uses real Base mark; tests.  
2. **P0 live policy in tray:** replace hardcoded hero/button/agent amount with `GET /api/toll/live` fee + allow_to + foreign_address; keep refuse if unread.  
3. **P0 relay path for existing signed tx (optional demo):** fund `0x4c07…` + broadcast `get_tx(0).raw_signed` → basescan (proves leg C; recipient still `0x1cdb…`).  
4. **P1 contract v7 + redeploy plan scripts** (assistant executes): allow_to includes `0xBDfC…0034`; visitor `cross_after_board` **or** Path B FAK; fees under `max_fee_cap` but Base-viable.  
5. **P1 city Cross flow:** board pass → sign → broadcast → poll → basescan; AI + manual; cinema; Chronicle.  
6. **P2** Arbitrum instance + “cross to Arbitrum”; Split tab revenue from live state; README proofs placeholders.

PR title suggestion: `toll: deep cross-chain pass (policy + chain-sig broadcast)`.

---

## 7. Sources (open and cite in PR)

1. Live views: `policy` / `get_tx` on `toll.nearcarta.near` (this brief §1).  
2. Contract: `contracts/toll/src/lib.rs`.  
3. UI hardcodes: `app/src/panels/toll-room.js`, `backend/src/toll-pass.js`, `backend/src/shops.js`, `app/design/D8_shops/js/shopui.js`.  
4. Derive: `app/src/toll-derive.js`.  
5. Blueprint: `docs/internal/shops-blueprint.md`, `docs/internal/shops/toll.md`.  
6. Tracks: `/workspace/audit/tracks/04-business.md`, `13-open.md`; `/workspace/audit/near-track-sources.md`.  
7. Chain Signatures:  
   - https://docs.near.org/chain-abstraction/chain-signatures  
   - https://docs.near.org/chain-abstraction/chain-signatures/implementation  
   - https://docs.near.org/chain-abstraction/chain-signatures/getting-started  
   - https://github.com/near/mpc  
8. Deploy record: `shared/deployments/mainnet.json` → `toll`.  
9. Teardown script: `backend/scripts/toll-teardown.js`.  
10. Ferry depth bar (pattern to match, not copy claims): city session, live data, AI executes, cinema on real success.

---

## 8. Out of scope for this Cursor chat

- Ferry cross-chain recipient work (separate PR #44).  
- Other shops’ deepening.  
- Spending owner USDC/ETH except documenting the funding need for the assistant.  
- Renaming tracks or claiming Social Money.
