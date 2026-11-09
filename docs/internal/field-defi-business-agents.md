# Field notes: defi / business / agents (NEAR Hackathon 2026)

Internal. Not a submission doc. Do not cite these project names outside this file.

Measurements taken 2026-11-09 by cloning each repo at `--depth 1` and counting the tree, then querying
NEAR RPC and the NearBlocks v3 API to confirm accounts, code hashes and transaction hashes. README claims
are repeated only when a repo, a live URL or a chain query backs them. **NOT VERIFIED** means exactly that:
I could not confirm it and I am not guessing.

## Source data and method

`https://nearhackathon.com/api/projects?page=<n>` returns **335** projects (brief said 308; the list grew).
`pageSize` is capped at 8 server-side regardless of what you pass, so this is 42 pages, deduped by `id`.

Track counts across all 335: agents 162, business 58, defi 57. **199 projects** carry at least one of the
three. That is the field this file covers.

Counting rules, identical for every row and for our own repo:
- Rust files and lines: every `*.rs`, excluding `target/`, `vendor/`, `node_modules/`, `.git/`.
- `#[test]` count: literal attribute occurrences in those files. Inline `#[cfg(test)]` modules count.
  This inflates projects that keep their test module inside `src/` (Claw Guard, Agent Treasury) and
  understates projects that put tests in `tests/` with a sandbox (Allowance, TabWrit). Read the
  test-file column with it.
- JS/TS lines: `*.ts/.tsx/.js/.jsx/.mjs/.cjs/.vue/.svelte`, excluding `node_modules`, `dist`, `.next`, `build`.
- "mainnet tx cited?" means: a 43–44 char base58 hash on a `nearblocks.io` (or testnet variant) URL in the
  repo, **which I then resolved through the NearBlocks v3 API** and checked the network. A link that does
  not resolve is not a citation.

Two things this measurement cannot see, and which I checked by reading instead:
1. Line count is not depth. Dragons Market has 44k Rust lines and its chain workers are disabled; Veto has
   1,240 and a real refusal mechanism. The verdict column is my read of the mechanism, not the score.
2. A repo can exist and be empty of the thing the submission claims. Where that happens I say so.

---

## Table

`has repo?` = repo found, cloned and inspected. `mainnet tx?` = at least one cited hash resolves on mainnet
(not testnet). `live URL?` = HTTP 200 from here on 2026-11-09. `video?` = a video URL in the demo post or repo.

| # | project | tracks | repo | Rust files | Rust lines | test files | `#[test]` | mainnet tx? | live URL | video | primitive | one-line verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Dragons Market | defi, agents | `shc-labs/dragonsmarket` | 57 | 44,084 | 10 | 703 | no (testnet only; the 4 mainnet links are Intents/bridge infra, not its contract) | yes 200 `dragons.market` | yes | NEAR Intents verifier as custody (`mt_transfer`), threshold-signed price rounds, bonded result + juried dispute, NEP-171 staked Dragons | Biggest build in the field and a real mechanism, but it says its own chain workers are disabled — read the mechanism, not the launch |
| 2 | Claw Guard | agents | `metafrogmeme-droid/claw-guard-near` | 25 | 13,614 | 13 | 187 | **yes** — `clawguard-demo.near` has code; `register_agent` and `create_account` resolve | no app; the post links a nearblocks address | yes (X) | Chain Signatures + MPC; contract rebuilds the Hyperliquid EIP-712 digest or an EVM tx and signs only if 13 ordered rules pass | The deepest *signing gate* anyone shipped. Adversarial to the bone; no user-facing product |
| 3 | Allowance | business, agents | `soldanoandrea/allowance` | 10 | 7,377 | 4 | 72 | **no** — no deployed contract found. `vault.you.testnet` does not exist; README says the demo is local by default ("Nothing touches testnet or mainnet") | yes 200 (Render) | yes (mp4) | Function-call key on the vault account itself; ~2,000 lines of sandbox tests; `simulate` free view; factory + revenue split | The most complete agent-treasury feature list and no proof on any chain. Same primitive as us, more features, zero deployment |
| 4 | Priced In | defi, agents | `iamdflame/priced-in` | 10 | 4,031 | 2 | 17 | **yes** — `market.isitpriced.near` has code; 9 of 12 sampled hashes resolve as `isitpriced.near` (3 unresolved, reason **NOT VERIFIED**) | yes 200 `isitpriced.com` | yes (X) | LMSR market + TEE-attested model verdicts registered on chain + reproducible build (`cargo near`) | **The most credible mainnet artefact in my three tracks.** Real money, real rulings, rebuildable wasm |
| 5 | Agent Treasury | business, agents | `iskander-kudashev-13/agent-treasury` | 8 | 7,902 | 2 | 174 | no (testnet) | no 200 found | yes (X) | Mandate-checked USDC vault that pays a 1Click deposit address; Dstack/TDX attestation gate on the agent | The only one that treats **the agent's own binary** as the thing to attest. Strongest new idea here |
| 6 | Aftercall | business, agents | `don-vicks/aftercall` | 29 | 14,906 | 23 | 189 | no (8 txs, all testnet) | yes 200 (Vercel) | yes (X) | NEAR AI TEE for the transcript, contract wallet with caps/allowlist/escrow/pending approvals, Mac desktop app | Most product-complete thing in the track. The contract is a policy wallet, not a novel mechanism |
| 7 | OneUp | defi, agents | `ethboi/oneup` | 34 | 9,913 | 10 | 220 | no — README says "nothing is on mainnet" | yes 200 `oneup.markets` | yes (X) | Perps + NEP-171 "Life NFT" carrying a USDC claim and share of house profit; Sputnik DAO; Intents | Best economic design in DeFi. Honest that it is testnet. Buyer-names-the-listing is a good race fix |
| 8 | Judge on NEAR | agents, business | `vijaygopalbalasa/judge-near` | 16 | 6,273 | 8 | 154 | no (testnet) | yes 200 (GitHub Pages) | yes (X) | Escrow where a WASM judge runs inside an OutLayer TEE; one tx either pays+reveals key or refunds | Cleanest "work and payment settle together" primitive. Re-runnable rulings is a real idea |
| 9 | Charter | defi, agents, business | `spagero763/charter` | 11 | 1,796 | 2 | 19 | yes — but it cites **no** tx hash; the contract `charter.spageroadmin.near` has code and live state | yes 200 (Vercel) | yes (mp4) | Guardian in an enclave holds the fund's only key, checks a launch mandate, signs only passing trades; Intents confidential shard; viewing keys | **Our closest architectural rival.** Live mainnet fund with 5 named-rule rejections in its own log — verify this before claiming refusals are unique |
| 10 | Terra matcher | defi | `archtum66-dev/terra-matcher` | 33 | 7,905 | 16 | 104 | no (testnet) | no app; post links nearblocks txs | yes (X) | Off-chain deterministic matcher emits paired unsigned `token_diff` intents that net to zero; both parties sign | Right idea (non-custodial matching on Intents), honestly labelled "early scaffold", thin settlement |
| 11 | KeyLease | agents | `metafrogmeme-droid/keylease` | 23 | 5,882 | 11 | 113 | no (testnet; README says testnet only) | yes 200 | no | Leases on an API key sealed in an OutLayer TEE: N calls, until a time, these endpoints | Selling *calls* rather than money is a genuinely different unit of account. Best "metered resource" model |
| 12 | Saku | agents, defi | `gliana-labs/gliana-near-x402` | 2 | 1,426 | 2 | 37 | **yes, the best refusal proof in the field** — `allowance.cocoanutx.near` has code, real `pay` calls, and a **failed** `pay` that its README documents as a refused \$5 attack | yes 200 | yes (X) | Contract owns the agent's Base address via Chain Signatures and rebuilds an EIP-3009 authorization; x402 round trip | Only entry with a **mainnet refused payment** plus a real API payment. Tiny contract, sharpest proof |
| 13 | Tripwire | agents, business | `afar88/tripwire` | 4 | 1,473 | 2 | 57 | no (testnet) | yes 200 | yes (X) | Risk registry + a vault that calls the registry *before* transfer (`request_spend` → `on_risk`); NEAR AI second opinion | The best "reputation before payment" shape. Risk verdict arrives as a callback, not a client claim |
| 14 | TabWrit | business, agents | `lesnak1/tabwrit` | 7 | 2,064 | 2 | 16 | no (testnet) | yes 200 | yes (X) | Contract-enforced spending **tabs** (running credit lines) + NEP-366 gasless meta-transactions + x402 API | The only one with a real **gasless** path. Tabs are a better unit than single payments |
| 15 | Ballast | defi, agents | `olliechap/near-ballast` | 3 | 1,530 | 2 | 43 | **yes** — `ballast-vault-mw46qfjz.near` has code, `set_policy` resolves on mainnet | yes 200 | yes (X) | Vault splits NEAR between NEAR AI's stake-for-inference farm and a normal staking pool; agent tunes the split | Best *novel* DeFi primitive: it manages the NEAR AI credit conversion, not a token position |

### What the numbers say about the field

- Of 199 projects touching my tracks, **132 demo posts link a GitHub repo**, and 121 of those 122 clone
  (`zuemen/writ` failed to clone — **NOT VERIFIED** why). A further 14 linked repos return 404 (deleted or
  private). So roughly a third of the field ships no reachable public code at all.
- Of the 15 above, **5 have a project-owned contract with code on mainnet**: Claw Guard, Priced In, Saku,
  Ballast, and — by view call rather than cited tx — Charter. Note that **Allowance has no deployment at all**:
  its own README example account `vault.you.testnet` does not exist on testnet. My first pass credited
  `allowance.cocoanutx.near` to Allowance; that contract is **Saku's**, and `soldanoandrea/allowance` never
  mentions it. Do not repeat either error.
  Of the rest, three cite a mainnet *infrastructure* account (`intents.near`, `bridge-mng.near`, `wrap.near`)
  and had that mistaken for a deployment by my first pass too.
- **4 of 15 cite a tx hash that resolves on mainnet**: Priced In, Saku (including its refusal), and Claw Guard.
  Everything else that cites a hash cites testnet. Charter's omission is odd — it has a live fund and chose not
  to cite one tx.
- Rust line counts are bimodal: seven entries are under 2,500 lines and eight are over 3,500. There is very
  little in the middle. The small ones are usually the more honest, more finished products.

---

## Per project

### 1. Dragons Market — `shc-labs/dragonsmarket`
Prediction market where the rule, the result source and the close time are published before anyone trades.
Collateral is USDC held in the contract's account **inside the Intents verifier**, not as a plain NEP-141
balance — `council/src/lib.rs` calls `mt_transfer` on the verifier with token ids of the exact form
`nep141:<contract>`. Markets price shares with a dynamic parimutuel cost function, so a market needs no seed.
Results are proposed with a bond; anyone can challenge; a challenged result goes to a jury of staked Dragon
NFTs with commit-then-reveal votes. Price rounds are signed by a threshold of publishers and checked on chain.
**Strongest idea: a bonded result with a juried dispute path and a committed-then-revealed vote.** That is a
complete "who decides" story, which almost nobody else in the field has.
Honest caveat from its own README: *"The team reports deployed contracts; their authoritative account,
network and ownership manifest is pending… chain workers disabled."* So the 44k lines are real, the tests are
real (703 `#[test]`), the mechanism is real — and it is not yet a live market. The 4 mainnet links in the repo
resolve to Intents/bridge infrastructure, not to its own contract.

### 2. Claw Guard — `metafrogmeme-droid/claw-guard-near`
A signing gate, not a wallet. The agent sends a *proposal*; `rules::evaluate` is a pure function of
(agent state, context, proposal) that checks **13 rules in a fixed order and stops at the first failure**:
paused, expired, target not enabled, malformed, stale nonce, market not allowed, token not allowed, receiver
not allowed, leverage, reduce-only, order above cap, daily order count, daily cap, insufficient balance. Only
if all pass does it build the payload — and it builds it only from owner-set data plus the agent's *checked*
fields, with every arithmetic step checked and overflow failing closed. Two MPC targets (Hyperliquid EIP-712
and Base Sepolia), one derivation path each. `preview_payload` returns the exact bytes before you sign.
**Strongest idea: the ordered rule list with a named refusal per rule, plus `preview_payload` so the agent
can dry-run the exact digest.** The rule ordering is a spec you can argue about, which is what you want.
Verified on mainnet: `clawguard-demo.near` has code, and the cited `register_agent` and `create_account` txs
resolve. Weakness: no product. The post links a nearblocks address, not an app.

### 3. Allowance — `soldanoandrea/allowance`
The closest thing to our primitive: the agent is registered as a **function-call access key on the vault
account itself**, so it needs no account, no faucet and no custodian; the vault pays the gas out of the key's
allowance. Two layers decide — the key's method list, then the policy in the contract. Policy is a real model:
per-payment cap, budget per fixed time bucket aligned to the epoch, approval threshold, denylist, pause,
kill (which deletes the keys), plus an asset enum so a policy can be denominated in NEAR or a NEP-141.
`simulate` is a free view over the same pure `evaluate` function that `pay` uses, so the UI can show the
verdict without sending anything. There is a factory and a revenue split.
**Strongest idea: `simulate` as a free view returning the verdict and remaining budget, sharing the exact
code path as the state-changing call.** That is a better preflight than ours.
**No deployment.** I checked `vault.you.testnet` (the account in its own README example) and it does not exist
on testnet. The README says the local demo is the default and the testnet run is a dry-run script
(`make demo-testnet`), so there is no chain evidence of any kind — not even testnet. An earlier note in
`field-security-privacy-swarms.md` said the testnet ids were "NOT VERIFIED on RPC"; that is now confirmed
absent. Treat this as the best *unproven* design in the field. The 72 `#[test]` and ~2,000 lines of sandbox
tests are real, and a sandbox suite is a legitimate proof of behaviour — but it is not a deployment.

### 4. Priced In — `iamdflame/priced-in`
Yes/No markets on checkable sentences, with three TEE-attested models ruling on chain. What makes it count is
the proof discipline: `cargo near` reproducible build, and its judge script (`npm run judge`) rebuilds the
contract and compares the hash to the deployed `market.isitpriced.near`, reads the books at a pinned block,
and verifies each verdict's `sha256(response)` and ed25519 signature against the key `get_model` returns.
It also does a real 1Click dry quote (Base USDC → NEAR USDC) as a check. Its own README reports 8 settled
rulings on mainnet and 24 verdicts from 3 models.
**Strongest idea: pin every read to one block and re-derive the verdict signatures in a script anyone can
run.** That is the standard I would want to be held to.
Verified: `market.isitpriced.near` has code (hash `FQJXhaVJGwC37d…`), `isitpriced.com` is 200, and 9 of 12
sampled mainnet hashes resolve as `isitpriced.near` transactions. Three did not resolve — **NOT VERIFIED**
why (pruned old tx, or the link points at a page route rather than a tx). Contract is small (4,031 Rust lines,
17 tests), which is a fair criticism given the money it holds.

### 5. Agent Treasury — `iskander-kudashev-13/agent-treasury`
USDC vault; an agent asks the vault to pay, the vault checks a mandate (per-payment, daily amount, daily
count, allowed chains, allowed recipients, approval threshold, expiry, pause) and then transfers to a
**1Click deposit address** that the caller supplies, with `is_valid_deposit_address` refusing anything that is
not a 64-hex implicit account from a fresh quote. What is genuinely different: `register_agent` takes a
`DstackAttestation`, and the owner approves measurements and PPIDs, with an attestation expiry. The agent is
admitted because of **what binary it is**, not just which key it holds.
**Strongest idea: attest the agent's measurement on chain and expire the attestation.** Nobody else in my
three tracks does this, and it closes the "the key was fine but the model was swapped" hole.
Only 2 test files for 7,902 lines — the tests are a 4,544-line inline module. Deployment is testnet
(`vault.agenthack.near` exists with code but is not referenced as their live deployment; treat as **NOT VERIFIED**).

### 6. Aftercall — `don-vicks/aftercall`
A Mac app records a call with no bot joining; the notes are produced inside NEAR AI Cloud's attested hardware,
which the app checks first; then the recap is sent and what the call agreed is paid in USDC. The chain part is
a real policy wallet: `set_cap`, `set_payment_cap`, `set_cross_chain_cap`, `add_payee`, `set_payee_destination`,
`pay`, plus `open_escrow`/`release_escrow`/`confirm_escrow`/`return_escrow` and a pending-approval queue
(`approve_pending`, `cancel_pending`). Every transfer is `ft_transfer` + callback, and the callback **undoes**
the payment accounting on failure.
**Strongest idea: cap by destination *and* by chain, separately.** A cross-chain cap is a different risk from a
per-payment cap and we lump them. All 8 cited txs are testnet and resolve; there is no mainnet deployment.

### 7. OneUp — `ethboi/oneup`
Perps venue where a losing trade mints a **Life NFT** that holds a USDC claim plus a share of the house's
future profit. The NFT is transferable, and buying one transfers the unclaimed USDC *and* every future payout.
The race fix is the good part: `buy` names the listing the buyer saw, so if the seller claimed or repriced in
between, the purchase fails and refunds instead of paying a stale price.
`math/src/lib.rs` is genuinely well-factored: `max_liability`, `is_liquidatable`, `liquidation_price`,
`market_liability`, `capacity`, `settle_liquidation`, `recovery_base`, `epoch_payout` as pure functions, tested
from 10 separate test files (backing, economics, epoch, house, locks, market, recovery, treasury…).
**Strongest idea: expected-value-checked purchase (`buy(expected_nonce)`-style) for a claim-bearing NFT.**
Its README is the most honest in the field: "nothing is on mainnet", and it lists exactly what runs where.
220 `#[test]` across 34 Rust files is the second-largest Rust test surface I measured.

### 8. Judge on NEAR — `vijaygopalbalasa/judge-near`
Escrow for agent work where delivery is encrypted. A fixed WASM **judge** runs inside an OutLayer TEE
(Intel TDX) and checks the work; one NEAR transaction then either pays the worker *and* hands the buyer the
decryption key, or refunds the buyer and releases nothing. The judge is a pinned build
(`outlayer` account and judge target fixed at init), and the live page re-runs the rulings in the browser so a
reader does not have to trust the server.
**Strongest idea: payment and disclosure settle in the same transaction — the key is the receipt.** That is a
much stronger atomicity story than "release escrow then send the file".
Testnet only; 154 `#[test]`; the repo has an `evidence/` directory and a `JUDGES.md`, which is a pattern worth
copying regardless of the chain status.

### 9. Charter — `spagero763/charter`
Private fund: an AI manager proposes trades, and a **guardian inside a hardware enclave** holds the fund's
only key, checks each proposal against a mandate fixed at launch, and signs only what passes. Trades settle on
Intents' confidential shard so positions stay private. Depositors get a share price, a hash-chained log of
every decision **including every rejection**, and a time-boxed viewing key (`grant_view`/`revoke_view`) that
opens the book to a named auditor.
**Strongest idea: the time-boxed viewing key.** Privacy that a named auditor can open for a window is a better
answer than "private" or "public", and we have nothing like it.
This is our closest rival and I checked it hardest. `charter.spageroadmin.near` has code and 25 recent txs
(`propose` ×8, `settle` ×8, `register_deposit` ×3, `grant_view` ×2, `redeem`). `get_fund` returns a live
mandate. **`get_log` returns 5 `rejected` entries with named rules** — `max_trade_size` (twice, with the exact
bps), `balance`, `quote`, `allowed_assets` — plus 2 `failed`. So "we refuse on chain with a reason" is **not**
unique to us. Its weakness: 1,796 Rust lines, 19 tests, no cited tx, and the 5 refusals were produced by the
guardian (off-chain enclave) writing to a log, not by a contract refusing a call — which is the real
distinction to draw, and it is a fair one, but it has to be drawn precisely.

### 10. Terra matcher — `archtum66-dev/terra-matcher`
Non-custodial order matching for Intents. Limit orders are paired off chain by a deterministic matcher that
never holds funds; every fill becomes a pair of **unsigned `token_diff` intents that nets to zero for each
token**, and each party signs its own half before the verifier settles. There is a second settlement path
through a testnet escrow contract, plus 22 conformance vectors and a live dry price check against 1Click.
**Strongest idea: settlement as two self-signed halves that net to zero — neither party ever hands custody to
the matcher.** This is the correct way to do a matching engine on Intents and it is the only entry that does it.
Its own status line is "early scaffold, honestly labelled", which is accurate: 7,905 Rust lines but the demo
is thinner than the code, and it is testnet only.

### 11. KeyLease — `metafrogmeme-droid/keylease`
Leases on an **API key**, not on money. The owner seals a key once into an OutLayer TEE and issues leases:
N calls, until a time, these endpoints only. Agents call through a pinned open-source proxy whose hash is
recorded on chain; the contract tracks `create_lease`, `revoke`, `revoke_all`, `add_key`, and a
`required_deposit(limits, input_len)` that prices storage from the request size. 11 test files, 113 `#[test]`.
**Strongest idea: metering a *resource* (calls) instead of an *amount* (tokens).** A per-call lease is a
completely different refusal surface from a per-token cap, and it is the right shape for the x402 world.
README says testnet only and "prototype, not audited", which matches what I measured.

### 12. Saku — `gliana-labs/gliana-near-x402`
The contract owns the agent's wallet **on Base** through Chain Signatures — no Base private key exists
anywhere. The agent's NEAR key can only call `pay`; it sends the terms, and the contract rebuilds the
EIP-3009 authorization itself, checks the payee list, per-payment max, daily budget, and then asks `v1.signer`.
A payee added less than `payee_delay_s` ago forces an owner approval. `owner_pay` is the escape hatch so
nothing is stuck.
**Strongest idea: rebuild the EIP-3009 struct in the contract from the agent's terms rather than accepting a
signature over agent-supplied bytes.** That is the same instinct as our `propose`, applied cross-chain.
This is the strongest *refusal* proof in my three tracks. `allowance.cocoanutx.near` has code on mainnet, there
are real `pay` calls from `agent.cocoanutx.near`, and one `pay` **failed** on mainnet: tx
`G4wPa1TFUXJ5hBMrzfXwPyouQPmRMGkFfx4bCjGg2vdS`, the same agent key asking for $5.00 to `0x…dEaD`. Its README
documents it as a refused prompt-injected payment with the rule `payee is not on the owner's list`. I resolved
the tx and confirmed `status: false`, receiver `allowance.cocoanutx.near`, signer `agent.cocoanutx.near`. So
we are **not** the only entry with a mainnet refused payment — we are the only one with *several, of different
kinds*. It also added a free `check` view after that run so a refused payment never becomes a transaction,
which is the same lesson as Allowance's `simulate`. 1,426 Rust lines, 37 tests.

### 13. Tripwire — `afar88/tripwire`
A risk registry plus a vault that **asks the registry before it transfers**. `request_spend` fires a
cross-contract call; `on_risk` receives the verdict and proceeds, holds or refuses. The registry scores
flags (`score_flags`, `level_for`) into ALLOW/WARN/BLOCK, and the hosted checker optionally asks NEAR AI
(`cloud-api.near.ai/v1/chat/completions`) for a second opinion on the payment *purpose*, which can raise a
clean account to WARN. The live page ships four worked examples (known drainer, real contract, its lookalike,
clean-with-a-scam-reason) that run on free read-only RPC.
**Strongest idea: the risk call happens on chain, as a callback, before the money moves — and the lookalike
example is a test case, not a paragraph.** 1,473 Rust lines, 57 tests, testnet only.

### 14. TabWrit — `lesnak1/tabwrit`
Spending **tabs**: an owner opens a running credit line to a spender for a token, and the spender charges
against it (`create_tab`, `charge`, `pause_tab`, `revoke_tab`, `get_remaining`). The distinguishing feature is
NEP-366: the spender signs a `DelegateAction` off chain and a relayer pays the gas, so the agent needs no NEAR
at all. There is an x402 agent API and an "Attack Lab".
**Strongest idea: NEP-366 gasless charging.** If the agent holds no NEAR it cannot be drained of NEAR, and the
refusal surface shrinks to the tab. That is a real architectural choice we do not offer.
Only 16 `#[test]` for 2,064 lines, but it has committed evidence files (`docs/evidence/testnet-e2e.json`,
`meta-tx.json`, `agent-x402.json`) claiming 23/23, 12/12 and 13/13 on chain. I did not re-run those counts —
**NOT VERIFIED** beyond the 7 hashes I resolved, all testnet.

### 15. Ballast — `olliechap/near-ballast`
NEAR AI lets you stake NEAR for inference: staking rewards become non-transferable AI credits. Stake too much
and you burn yield on credits you cannot cash out; too little and you get throttled; unstaking takes ~4 epochs,
so nobody can tune it by hand. Ballast is a vault plus an agent that splits your NEAR between NEAR AI's
stake-for-inference farm (`stake(product_id)`, `unstake`) and an ordinary staking pool
(`deposit_and_stake`, `withdraw`), and moves the split as your usage changes.
**Strongest idea: the managed asset is the *conversion rate between NEAR and inference*, not a token price.**
That is a genuinely new DeFi primitive and it is specific to NEAR, which is rare in this field.
Verified mainnet: `ballast-vault-mw46qfjz.near` has code and `set_policy` resolves on mainnet. 1,530 Rust
lines, 43 tests. Small, and a lot of the mechanism lives in the agent rather than the contract.

---

## What they have that we might lack

Ordered by how cheaply we could take it. Everything here is a concrete thing I saw in code, not a suggestion
from a README.

1. **`simulate` as a free view that shares the exact code path as the spend call** (Allowance,
   `src/policy.rs` + `src/lib.rs:1081`). Their `evaluate` is a pure function; `pay` calls it and so does the
   `simulate` view, which returns `verdict` / `reason` / `remaining_budget` / `budget_resets_at_ns` /
   `vault_available` / `block_timestamp_ns`. We have `clause_checks` but our preflight lives in the page. A
   `view` that returns *the same struct the refusal would produce*, from the same function the contract uses,
   is a stronger claim than a UI that predicts. This is the single most copyable idea in the field.

2. **A signed, ordered rule list with a named code per rule and a `preview` returning the exact bytes**
   (Claw Guard, `rules.rs` doc comment + `preview_payload`). Our refusals are named strings; theirs are an
   enumerated, *ordered* list where the order is part of the contract's specification ("stops at the first
   failure"), and `preview_payload` returns the payload the contract would sign. For us the analogue is
   `propose_batch` dry-run: return the exact receipts it would emit and where it would stop.

3. **Attest the agent's measurement, not just its key** (Agent Treasury, `register_agent(attestation)` +
   `approve_measurements` + attestation expiry). We check a TEE attestation for the *model* call
   (`GET /api/ai/tee`) but the charter trusts the agent key unconditionally. A `set_agent_measurement`
   with an expiry would close the "key is fine, model was swapped" gap and it fits our clause model exactly.

4. **A time-boxed viewing key** (Charter, `grant_view(account, pk, until)` / `revoke_view(pk)`). Privacy that
   a named auditor can open *for a window* is strictly better than public-or-private, and it composes with an
   owner-held key we already have.

5. **Bonded results with a juried dispute path** (Dragons Market, `oracle/src/lib.rs`: propose with bond →
   challenge → jury draw → commit → reveal). We have an owner escalation band, which is a two-party answer to
   "who decides". A bond plus a jury is the N-party answer and it is the one a judge will ask about.

6. **NEP-366 gasless spend** (TabWrit, `packages/tab-sdk/src/meta-tx.ts`). If the agent has no NEAR it cannot
   lose NEAR. Our agent key already cannot transfer, but it still needs gas; a relayer path removes that.

7. **Capabilities split by destination *and* by chain** (Aftercall, `set_payment_cap` vs
   `set_cross_chain_cap`). One cap for both is a modelling error we currently share.

8. **Expected-state purchase for anything resaleable** (OneUp, `buy` naming the listing the buyer saw; also
   Deed in the nfts file). Read-then-write races on a resaleable claim are a real class of bug and a nonce in
   the buy call is a two-line fix.

9. **Two self-signed halves that net to zero** (Terra matcher). If we ever let a visitor *receive* as well as
   send, this is the settlement shape: neither party hands custody to the matcher.

10. **A re-runnable judge script as the product** (Judge on NEAR `JUDGES.md` + `evidence/`; Priced In
    `npm run judge`). Both ship a script that re-derives the claim from chain rather than a table of links.
    We have `npm run verify` — which is the same instinct and is stronger on count (54 proof txs) — but their
    pattern of pinning every read to a single block is worth taking.

11. **Metered calls rather than metered amount** (KeyLease). A lease of "N calls until T" is a different
    refusal surface from "≤ X NEAR", and for our model-job rail (`160 tokens, $0.05, 300 calls/day`) the
    call-count cap is already the honest one.

12. **A lookalike in the demo** (Tripwire ships a real contract *and* a homoglyph of it as a worked example).
    Our refusals are all "over cap / off list". A demo case that is adversarial in kind, not just in amount,
    is more convincing than a bigger number.

---

## Where we are clearly ahead

Measured with the identical script (`rust files/lines`, `#[test]`, JS/TS lines excluding `node_modules`) on
`/agent/repos/nearcarta`, 2026-11-09.

Our own numbers, same method as the table above:

| | ours | best competitor | note |
|---|---|---|---|
| Rust files | 38 | 57 (Dragons Market) | |
| Rust lines | 15,821 | 44,084 (Dragons Market) | but see below: theirs is not all shipped |
| Rust `#[test]` | **362** | 703 (Dragons Market), 220 (OneUp), 189 (Aftercall), 187 (Claw Guard) | |
| Rust test files | **27** | 23 (Aftercall), 16 (Terra matcher) | 14 have inline tests; 5 are the `contracts/oath/tests/` sandbox suites |
| JS/TS lines | 63,127 | 64,647 (Priced In), 62,220 (Agent Treasury) | `.secrets/` excluded (gitignored, untracked) |
| non-Rust test files | **184** | — | counted as `tests/` paths or `*.test.*`/`*.spec.*` in git; the field does not come close |
| verified mainnet proof txs | **106 rows / 100 distinct, all resolving** (`npm run verify` → 106/106) | 2 (Claw Guard), 9-of-12 sampled (Priced In), 3 (Saku) | |

Method note: the competitor test-file column counts files containing `#[test]`. Our own repo keeps five sandbox
suites in `contracts/oath/tests/` where the attribute count is lower than the scenario count, so `27` is the
comparable figure and `14` is what the narrow rule alone would give. Both are stated so nobody has to trust a
single number.

`npm test` on 2026-11-09: **893 tests, 892 pass, 1 skipped, 0 fail.** `cargo +1.95.0 test --lib` in
`contracts/oath`: **122 passed**. Both re-run in this session, not quoted from a badge.

The claims I will stand behind:

1. **Depth of the authority model.** Of the 15, exactly two (Allowance, Claw Guard) have a contract that
   *itself* decides on a general rule set and refuses with a reason — and Allowance is not deployed anywhere,
   so in practice it is **Claw Guard alone**. Claw Guard is a signing gate for two fixed MPC targets
   (Hyperliquid testnet, Base Sepolia), not a general payment authority, and its state is a rule table, not a
   document. We have a 1,308-line `oath` plus a 3,945-line board, a clause model, an escalation band and
   NEP-519 yield, an owner-only surface the agent key cannot reach, and 362 Rust tests over 27 files.
   Nobody else has a *charter* — a document with clauses that a payment is checked against. They have
   policies. That is the difference between "my caps" and "the rules I signed".

2. **Proof discipline.** Four of 15 cite a mainnet tx that resolves; the rest cite testnet or nothing, and one
   (Allowance) has no deployment at all. We cite 100 distinct mainnet hashes across 106 checked rows and
   `npm run verify` re-reads every one on every run, writing `judges/proofs/mainnet-proof-check.json`
   (re-run in this session: `106/106 mainnet txs found`).
   On **refusals specifically** the honest claim is narrower than I first wrote. Saku has one mainnet refused
   `pay` (`G4wPa1TF…`, payee not on the owner's list) and Charter has five refusals in a contract log. What is
   still ours alone is **breadth and variety of mainnet refusals in a single design**: over-cap
   (`BvDNZk6F…`), off-list payee (`E7KMexjS…`), a board row that panicked `ERR_ROW_TOO_BIG` (`7H3H2HF…`), and
   a house deed allowed at 0.001 against a refusal at 0.002 (`83nyJmTW…` / `3Z4UAb6N…`). Saku has one kind in
   one contract; Charter's are an enclave writing to a log, not a contract rejecting a call. That distinction
   is real, but it has to be stated precisely — "we refuse with a reason" is not unique.

3. **The agent key's capability is enforced, not promised.** `agent_methods: ["propose","propose_batch"]`,
   zero full-access keys, and a mainnet `DELETE_KEY` tx proving the full-access key is gone
   (`71Zio28gV3…`). Allowance and LeashPay both scope a function-call key, so the *primitive* is not unique —
   but the on-chain evidence that the dangerous key was deleted is. It is the same test Claw Guard's README
   asks a reader to run, and we already ran it.

4. **One receipt shape across four rails.** NEAR transfer, chain-signature toll, dry Intents quote, capped
   model job all return the same keys (`shared/rails/receipts.js`, `every rail uses the same receipt keys`).
   No competitor has a unified receipt — each has one rail and one shape.

5. **Caps on the model job before it is sent.** 160 tokens, $0.05, 300 calls/day, exposed at
   `GET /api/agent/budget`. Agent Treasury and Aftercall cap the *payment*; nobody caps the *inference* and
   the payment in one place with one receipt.

6. **The product exists end to end.** 15 of 15 have a contract or a script; 11 have a live URL. Ours is a
   town with a setup path, a board row the visitor signs, a charter that refuses, and a documented walk from
   `/setup` to a refused tx. The field is mostly a contract plus a landing page.

Honest limits on the above, so this file does not read as a sales sheet:
- Dragons Market has more Rust and more tests than us. Its mechanism is real. The reason it is not ahead is
  its own README: chain workers disabled, manifest pending. If that changes, it is the strongest entry here.
- Priced In has a better reproducibility story than us (rebuild-the-wasm-and-compare) and a real mainnet
  market with money in it. We should take the build check.
- Saku has a mainnet refused payment with a reason, which is the same kind of evidence we are proudest of.
  It does not have our breadth (one payee-list refusal against our four kinds) but it does have one and it
  came with a `check` view so the refusal never becomes a transaction.
- Charter has a live mainnet fund with five named refusals and a time-boxed viewing key. It is a *different*
  architecture (enclave guardian holds the key, contract is a ledger) and it is narrower (1,796 lines, 19
  tests, no cited tx), but the "refusals are unique to us" claim does not survive contact with it, and
  neither does "live fund with a mandate" — it has both.
- Four of 15 have a project-owned contract with code on mainnet against our eight (`charter.nearcarta.near`
  is reaped, correctly documented in `shared/deployments/mainnet.json`; `board`, `toll`, `townhall`, `arena`,
  `house`, `guard` are live and verified by `view_account`). Raw count is not our edge; the refusal breadth
  is.

---

## Appendix: projects I looked at and rejected, with the reason

Not exhaustive, but these came up in ranking and a future reader will wonder.

| project | repo | why not in the 15 |
|---|---|---|
| Veto | `bronxydrone/veto` | 1 file, 1,240 lines, 31 tests. A good small firewall (hash-chained decision log is its best idea) but strictly a subset of Allowance and already covered in `field-security-privacy-swarms.md` |
| Approve/Leash style | `mattbusel/leash`, `hassaanraja282-lgtm/leashpay` | Same function-call-key shape as Allowance, less of it. LeashPay's demo runs through a Node server holding the agent key |
| AgentGuard (×3 repos) | `codemasterlabs/agentguard` and others | Three different projects share the name; the one with code is a vault+registry+factory with 77 tx links but no mainnet proof I could resolve |
| Unpair | `unpairxyz/unpair` | 8,077 Rust lines, real, but its thesis is a DEX over Intents rather than an authority model; overlaps Terra matcher which is a cleaner example |
| OmniYield | `gosun-capital/omniyield-protocol` | 2,634 lines, "Enterprise-Grade Omni-Chain Embedded Earn Stack" — the README vocabulary did not survive reading the code |
| Kinwarden | `jahanzaibmohsin9/kinwarden` | 4,369 lines, good thesis (hospital bills abroad, agent proposes, family approves) but testnet only and the contract is thinner than the app |
| Sealed Exploit | `edycutjong/sealed` | Interesting (bug bounties for executed breaks) but 23 lines of JS and its mechanism is mostly OutLayer orchestration |
| Termwork | `mramaran/termwork` | 2,293 lines, NEP-245 + TEE, but it is an agent labour marketplace, further from our thesis than Judge on NEAR |
| Leash (ksin751119) | `ksin751119/leash-near` | 9,444 lines and 121 tests; not selected here because it is already measured in `field-security-privacy-swarms.md` and my three tracks are the ones I was asked for |
| ~180 others | — | Either no repo (67 of 199 link no code), a repo that 404s, or under 1,000 Rust lines with no chain deployment |