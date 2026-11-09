# The field: nfts / realworld / games / social

Internal. Not a submission doc. Measurements were taken on 2026-11-09 by cloning at `--depth 1`
and counting; README claims are only repeated when a repo, a live URL or a chain query backs them.
`NOT VERIFIED` means exactly that.

Source: `https://nearhackathon.com/api/projects?pageSize=100&page=<n>` returns **335** projects
(the brief said 308; page size is capped at 8, so 42 pages). Track counts: security 165, agents 162,
realworld 69, business 58, defi 57, open 56, privacy 54, thesis 30, swarms 29, games 27, nfts 23,
social 22, memecoins 17. 120 projects touch at least one of our four tracks.

Counting method, same for every row: `*.rs` excluding `target/` and `vendor/`; `#[test]` +
`#[tokio::test]` attributes; JS/TS/JSX/TSX/Svelte excluding `node_modules`, `dist`, `.next`, `build`.
Test lines that live inside a contract crate count toward Rust lines, so a heavy test file inflates
the total. Where that matters it is called out.

---

## Table

| project | tracks | repo? | Rust files | Rust lines | tests | mainnet tx? | live URL? | video? | primitive | does the NFT control anything real? | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Handover** | nfts | `AlphaTechini/handover` | 12 | 4,343 | 102 | no (testnet only) | yes, 200 | yes (X) | NEP-171/177/178/181 + Chain Signatures + locked account | **Yes.** The NFT is the only key to an Ethereum address; `require_owner` gates every signature | **The strongest direct rival.** Real invariant, real attack reasoning, real Sepolia proof |
| **Deed** | nfts, business, security | `ClaudeOpusPremiumAgent/deed` | 5 | 1,425 | 11 | no (testnet only) | yes, 200 | yes (X) | NEP-171 + keyless sub-account + 2 KB immutable vault + global contract by hash | **Yes.** `pay`/`ft_pay`/`nft_pay`/`call` move a keyless account's assets; `buy(expected_nonce)` aborts a drained sale | Closest to our house deed. Small but sharp; the nonce idea is better than ours |
| **Logen** | nfts | `chenn19I/Logen` | 13 | 4,928 | 42 | no (testnet only) | yes, 200 | yes (X) | NEP-171 + keyless sub-account + registry-sealed vault + NEP-413 sign-in | **Yes.** Seat = NFT + keyless sub-account; `withdraw` checks `core.owner`, vault trusts only the registry | Best evidence craft in the track: 17 recorded txs, 4 live attack txs, an Attack Lab page |
| **Outlive** | nfts, business | `itsolaph/outlive` | 33 | 4,937 | 72 | no (testnet only) | yes, 200 | yes (2 films in repo) | NEP-171 + per-token vault sub-account + worker function-call key + Intents dry quotes | **Yes.** The token owns a running paid API: treasury, price list, ledger, worker key | Best demo in the entire field. Also the most honest limits section |
| **Torch (basket)** | nfts | `0xpochita/torch` | 20 | 6,148 | 91 | no (testnet only) | yes (torch-etf), 200 | yes (X) | NEP-171 + NEP-141 + per-NFT vault, global contract by code hash, zero keys | **Yes.** Basket of NEP-141 tokens in the token's own account; vault obeys only the collection | Most code of the non-game NFT entries. Clean model, mock tokens only |
| **Phylaxtag** | realworld, nfts, open | `kangmochi/Phylaxtag` | 18 | 4,569 | 70 | no (testnet only) | yes, 200 | yes (2 videos in repo) | NEP-171 + per-token fund in contract state + issuer allowlist | **Yes, but inside the contract.** Fund lives on the token record, capped per claim, cooldown, `pay_service` holder-only | The only entry where an NFT carries an *obligation* with hard caps. Nobody can drain it, including the holder |
| **ArchivePass** | nfts | `aarash-mohsin/archivepass-near` | 5 | 633 | 21 | no (testnet only) | yes, 200 | yes (X) | NEP-171 (single token) + keyless asset account + Merkle-proof keeper payouts + `owner_epoch` | **Yes.** The token holds an upkeep fund and pays keepers only against a Merkle proof of the file | Thin code, but the only NFT that carries *recurring obligations to third parties* through a handover |
| **Writ** | nfts, open | `ELLA0VICTOR/writ` | 8 | 2,192 | **0** | no — the only `nearblocks.io` link in the repo is the literal placeholder `nearblocks.io/txns/hash` | yes, 200 | yes (mp4 in repo) | NEP-171 + keyless executor account + declarative command templates + loans | **Yes.** The NFT decides who may instruct a keyless executor to call an external role contract | Best idea (authority as a transferable, rentable object). **Zero Rust tests** and a placeholder where the proof link should be |
| **Agent NFT** | security, nfts | `neqro/near-agent-nft` | 2 | 585 | 4 | no (testnet only) | no demo site | yes (X, terminal replay) | NEP-171 + per-token wallet contract + function-call agent policy | **Yes.** `<token>.<collection>` has no keys; the wallet reads the owner from the collection on every call | Correct architecture, almost no proof. 585 lines and 4 tests |
| **Meridian** | games, nfts, social, agents, swarms | `efeaizesogie/meridian-town` | 14 | 3,807 | 62 | no (testnet only) | yes, 200 | **no video** | NEP-171 deeds + NEP-141 MERI + NEP-245 goods + Sputnik DAO + NEAR AI | **Partly.** The deed holder appoints the shop agent and takes dividends; the shop's own sub-account holds the capital | Strongest game economy. Deed is an authority object, not a vault |
| **Bazaar Sovereign** | games, nfts, swarms, agents | `Automationbot24x7/bazaar-sovereign` | 1 | 1,125 | 20 | no (testnet only) | yes, 200 | yes (mp4 in repo) | NEP-171 charter + NEAR vault inside the contract + NEP-245 goods + NEP-413 intents | **Yes.** `vault_withdraw` requires `predecessor == owner`; the charter carries net worth and absorbed houses | Best "NFT is the business" framing in games. One 1,125-line contract does all of it |
| **OneUp** | nfts, defi, agents | `ethboi/oneup` | 34 | **9,913** | **239** | no, explicitly "nothing is on mainnet" | yes, 200 | yes (X) | NEP-171 Life NFT + NEP-141 USDC claim + Intents verifier + Sputnik DAO + NEP-366 | **Yes.** Life NFT holds a USDC claim and a share of future house profit; `claim` requires `owner_by_id == caller` | Biggest build in the field by code and tests. Perps venue, NFT is a claim ticket |
| **Veridom Pay** | realworld, nfts, privacy | `khrisdidukh/veridom-pay` | 4 | 950 | 12 | only `intents.near` swaps; own contract is testnet | flaky (000 from here, README says Render free tier) | yes (X, 1:05) | NEP-171 receivable + **ed25519 TEE signature verified in the contract** | **Yes.** Escrow pays `tokens.owner_by_id` holder after the review window | The only entry that verifies a model's signature on chain. This is the one idea we do not have |
| **Torch (inheritance)** | nfts, open | `itachi-exe/torch` | 3 | 1,418 | 36 | no (testnet only) | yes (2 sites), 200 | yes (X) | NEP-171 estate + Chain Signatures BTC/ETH + check-in/grace clock | **Yes.** Estate NFT gates future MPC signatures; claim moves the NFT and the derived addresses stay | Direct overlap with our `house_set_line` heir/guardian line. Fewer moving parts than ours |
| **Heir** | realworld, open | `ZSP111/Heir` | 3 | 1,654 | 64 | no (testnet only) | yes, 200 | yes (X) | Dead-man's-switch vault (**no NFT**) + Chain Signatures ETH payouts | **No NFT at all.** Vault keyed by owner account, heirs are a list | The cleanest dead-man's-switch. No transferable asset, so it dodges the resale problem entirely |
| **Chaperone** | security, agents, realworld, defi, business | `techafreshh/chaperone` | 6 | 2,624 | 69 | **no deployment found** | yes, 200 (app) | yes (X) | Rust guard contract + purpose verdict + TEE verifier + NEP-366 relay | n/a — no NFT. Guard holds/checks/pays | Best *idea* for our Guard: amount caps are not enough, verify what the payment is FOR |

`NFT controls anything real?` is answered against the contract, not the README. The method is named
in each cell; the four-line quotes are in the per-project notes below.

---

## Per project

### 1. Handover — `AlphaTechini/handover`
An NFT that owns an Ethereum wallet. The contract derives the address from the contract account and
`handover-<token_id>`, builds every transaction itself, and asks the MPC signer to sign it. There is
no seed phrase anywhere, so "sell the wallet" stops meaning "hand over a phrase the seller kept".
The strongest idea is not the NFT — it is the **clean check**. Every issued signature is appended to
a public log with a monotonic nonce, signing freezes while listed, and a buyer compares the Sepolia
account nonce to `next_nonce` before buying. If they are equal, no unbroadcast transaction exists.
`buy(token_id, expected_next_nonce)` then does listing removal, NFT move and seller payment in one
receipt. It also refuses to build approvals, because an ERC-20 approval can survive a sale.
Evidence is unusually good: 13 testnet tx hashes in `evidence/token-run-2026-11-05.md`, a committed
`handover.wasm` whose sha256 I recomputed to base58 `D2LpdVQXds9qea4B19ba835djiwimDxQWCUgNZXz4ud8`,
which is the deployed code hash, and `view_access_key_list` on `handover-v2-alpha.testnet` returns `[]`.
Weakness: testnet only, 102 tests but 2,094 of its 4,343 Rust lines are the test file, and the
Ethereum side is Sepolia.

### 2. Deed — `ClaudeOpusPremiumAgent/deed`
The nearest thing in the field to our house deed: an NFT that owns a NEAR account. `mint` creates a
real sub-account with **no access keys** that runs a 2 KB immutable vault deployed as a global
contract by hash, so a vault costs ~0.0013 NEAR of storage. Every outflow bumps `nonce` and sets
`pending`, cleared by a callback; `buy` requires `nonce == expected_nonce` **and** `pending == 0`, and
both are checked inside a single receipt on the deed contract. That is the correct answer to
asynchronous execution, and it is the answer we do not have (see "ahead/lack" below).
It also reasons about ERC-6551's known rug: the seller withdraws between the buyer's check and the
sale. Limits are stated honestly: revenue can be faked by the seller paying their own deed, a deed
that made arbitrary `call`s is marked unsealed forever, and there is no wallet button. 11 sandbox
tests, one video, testnet only. `view_access_key_list` on both `v1.deed-hq.testnet` and
`desk-5.v1.deed-hq.testnet` returns `[]` — I checked.

### 3. Logen — `chenn19I/Logen`
A members club where each seat is an NEP-171 NFT *and* a keyless sub-account that receives a share of
ticket revenue. The insight is sharper than it looks: on NEAR a contract cannot enumerate the access
keys on its own account, so the usual "give the buyer a key, delete the seller's" transfer cannot be
made safe. Logen removes keys entirely — seats are created without `AddKey`, the parent registry is
sealed with `DeleteKey`, and control lives in contract state (`owner_id`, `rotation_seq`) that moves
in one receipt. `buy_seat(token_id, nonce, min_balance)` pins the nonce and a minimum balance, so a
seller cannot drain before settlement. `deployments/testnet.json` lists 17 transaction hashes; four
are live attack attempts (`A1`, `A2`, `A3`, `A7`) that the contract refused. There is an Attack Lab
page at `/lab`. I resolved `FDnX8akyhQJs2sMuxZt9ppwEKeQFJjqPKjaJWqUdneHS` through NearBlocks: it is
`bob-84b273.testnet → logen-84b273.testnet`, method `buy_seat`, 1.5 NEAR attached. Testnet only.

### 4. Outlive — `itsolaph/outlive`
One token = one running paid API. The vault sub-account holds the treasury, the price list, the
customer ledger and the worker key, and `withdraw` is gated by `assert_owner()` **and**
`assert_unlocked()` so a listed token cannot be drained. The pitch is the best-written in the field:
you can copy the vending machine but not the corner, so sell the corner with the machine. Evidence is
the deepest of any entry: 80 testnet transaction links, a 94-second film and a 71-second ad both
committed as mp4 with subtitles, a `hostile-seller.sh` that SIGKILLs the worker mid-sale and prints
jobs in flight / delivered / refunded / double-charged, and a `wash-reject.mjs` where the buyer agent
refuses revenue from owner-funded customers. It also publishes a `theft-proof.mjs` with six refused
unauthorised actions. Weaknesses it states itself: testnet, own demo agents, demand unproven, b-roll
is AI-generated. `outlive3.outlive.testnet` still has a `FullAccess` key — the sale logic is sound but
the deployment is not locked.

### 5. Torch (basket) — `0xpochita/torch`
Every NFT is a sub-account running an immutable vault with zero access keys, holding a basket of
NEP-141 tokens. `withdraw` is `assert_collection()` only, and the collection checks the current NFT
owner and locks; the vault refuses to be its own collection and refuses init from anything but the
collection. Sales settle royalties and fees with `nft_transfer_payout`. 91 tests, 13 Rust test files,
20 Rust files, 6,148 lines — the most contract code of any pure-NFT entry here. The honest weakness
is the whole product: the basket holds **mock** NEP-141 tokens on testnet and only prices are
off-chain, so "an index fund" is a demonstration, not a fund. It is also the cleanest statement of
the model our house deed uses: NFT → per-token account → vault that obeys only the issuer.

### 6. Phylaxtag — `kangmochi/Phylaxtag`
One physical e-bike = one NEP-171 token. The warranty fund is stored **on the token record**, funded
once by an allowlisted issuer, and the holder can never withdraw it. `pay_service` requires
`predecessor == owner`, refuses if the warranty is expired, enforces a per-claim cap and a cooldown,
and `expire` pays the remainder back after the term. So the NFT carries an obligation with hard
bounds, not a balance. That is a genuinely different design from every "NFT holds a wallet" entry:
the holder has a *right to spend on a workshop*, not a right to the money. `pay_service` is also
refused while any NEP-178 approval is active, so a listed token cannot be drained before the sale —
a detail most entries miss. Two explainer videos in-repo (124 s and 45 s), a live page that reads
the fund and the service history from testnet, and `demo.phylaxtag-jiwoo-11041950.testnet` exists with
a code hash. Testnet, and the contract retains a `FullAccess` key.

### 7. ArchivePass — `aarash-mohsin/archivepass-near`
A single-token NEP-171 whose asset account has no keys and whose fund pays hosting "keepers" only
after they answer a challenge with the right chunk and a Merkle proof. The transfer logic is the
interesting part: every owner action takes `expected_owner_epoch`, `move_owner` increments the epoch,
and `owner_action` requires both `predecessor == owner_id` and `epoch == owner_epoch`. Commitments
booked by the previous caretaker still get paid after the handover, which is exactly what an
obligation-carrying NFT should do and what most entries here get wrong. 633 Rust lines and 21 tests —
thin — but a live page that runs 14 checks in the browser from public RPC (no keys on the asset, code
hash equals the committed wasm, books balance, every keeper proof re-verified) plus 87 application
tests. This is the best *verification UX* in the field. Testnet.

### 8. Writ — `ELLA0VICTOR/writ`
Turns an on-chain role into a transferable NFT: the holder instructs a keyless executor account, and
the executor calls the external contract (a collection, a DAO, a treasury). `execute` requires
`actor == t.owner` **or** a matching unexpired loan whose method and args hash equal the request, and
the target method must be one the template declares. Two ideas worth stealing: authority can be
*lent* with an expiry (`lend` / `end_loan`), and the set of actions is a declarative template rather
than a hardcoded allowlist. The fatal weakness for judging: **zero Rust tests**, 8 Rust files and
2,192 lines with `rs_test_attrs=0`. The safety story is carried by TypeScript integration tests. It
also admits the testnet collection keeps a full-access deployment key, so keyless executors do not
remove the upgrade trust assumption. Video mp4 committed; live app 200.

### 9. Agent NFT — `neqro/near-agent-nft`
Every NFT *is* a NEAR sub-account running a tiny wallet contract, and the wallet asks the collection
who owns the token on every call (`on_owner` does a cross-contract read and rejects if
`owner != caller`). That is the correct way to do it: no mirrored owner field to desync. An agent can
spend only through `agent_call`, inside a daily limit and a method/contract allowlist, and the policy
dies with the sale. 585 Rust lines, 4 tests, 2 files, no web app, and the "demo video" is a terminal
replay of logged testnet runs. It is the smallest competent implementation of the exact architecture
we use — and small is the honest verdict.

### 10. Meridian — `efeaizesogie/meridian-town`
A market town where six AI shopkeepers each have their own NEAR account and purse, set prices from
their own stock, and post paid delivery jobs; players gather, trade and can end up owning the shops.
The deed is an NEP-171 token per shop: `set_agent` requires the caller to be `deed_owner`, and
`before_deed_transfer` clears the agent so the new holder appoints their own. Bankrupt shops forfeit
the deed to the town and it is re-auctioned with outbid refunds in the same transaction. MERI is
NEP-141 and only mints when the town hits a weekly trading target; goods are NEP-245; guilds are
Sputnik DAOs; the shopkeepers think through NEAR AI with agent keys limited to three methods. 62
tests, a `/judge` page where every action is a button that sends a real testnet tx and links to it.
**No demo video** in the X post or the repo — a real gap for a games entry. Testnet, contract keeps a
`FullAccess` key.

### 11. Bazaar Sovereign — `Automationbot24x7/bazaar-sovereign`
One 1,125-line contract runs a whole game: five merchant houses, four of them AI rivals with memories
and grudges, a magnate who sells below cost, and a charter NFT per house. The charter *is* the
business — `vault_deposit` puts NEAR in, `vault_withdraw` checks `predecessor == owner`, metadata
`extra` is rewritten every 5 game days with net worth, stance, bankruptcy and absorbed houses, and a
bankrupt charter can be taken over by another house. Deals between houses settle as paired NEP-413
intents with one-use nonces and a zero-sum check on NEAR and every good. 20 tests, 1 file, 3,455 JS
lines, mp4s in `public/video/`. The idea that lands is **dynamic metadata as a business dashboard** —
the NFT's own metadata is the P&L statement. Testnet; the game server is the contract owner.

### 12. Torch (inheritance) — `itachi-exe/torch`
An estate is an NFT. The owner names an heir, sets a check-in interval and a grace period; missing
check-ins starts the grace period, and during grace and after it becomes claimable **signature
requests are frozen**. Claim transfers the NFT to the heir and the derived BTC/ETH addresses do not
change because keys derive from the contract account and a per-estate path, not from the owner. That
freeze is the right primitive and it is the one thing our `house_set_line` line does not do: we stop
payouts on release but we do not stop outbound signing while a release is pending. 36 tests across 3
files, 1,418 Rust lines, a recorded `deployments/testnet.json` with a verified upgrade tx and a
per-workflow tx for mint/check_in/set_heir/sign/claim. Live site 200, second site 200. Testnet.

### 13. Heir — `ZSP111/Heir`
A dead-man's-switch vault with **no NFT**. `create_vault(heirs, check_in_period, grace_period)`,
`check_in`, and after silence `claim(owner)` releases NEAR; ETH heirs are paid through Chain
Signatures from an address derived per vault, with `release_eth` resolved through a signer callback.
64 tests in 3 files, 1,654 lines — better tested per line than most entries twice its size. Two
recorded testnet txs I resolved: `3UXaugtB…` is `heir-demo-bob.testnet → heir-vault.testnet`
`release_eth`, `HZwq5xN…` is `heir-relayer.testnet → heir-demo-bob.testnet` `check_in`. By not making
the vault an NFT it avoids the entire resale-attack surface — which is worth saying out loud: an NFT
is not automatically the right container for an inheritance.

### 14. OneUp — `ethboi/oneup`
Perpetuals where a losing trade mints a **Life NFT**: an NEP-171 that holds a USDC claim and a share
of the house's profit for the next 13 rounds, capped at 1.2–2× face value, with on-chain SVG art
generated from its state. `claim` requires `owner_by_id == caller` and revokes all approvals on
claim, so a listing cannot be drained before it sells. Deposits go through the official Intents
verifier unchanged, the house is owned by a Sputnik DAO running mainnet v2 code, and one-tap trading
uses a session key limited to the house's trading methods with an NEP-366 relayer paying gas.
**9,913 Rust lines and 239 tests** — the largest and best-tested build among the sixteen I profiled
(Dragons Market is bigger and better tested, but it is not judgeable; see the next tier). It is also
explicit that nothing is on mainnet and the NFTs/claims/market run on testnet with mock USDC. The
weakness is conceptual: a Life NFT is a lottery ticket on the house's future profit, not ownership of
anything the holder controls.

### 15. Veridom Pay — `khrisdidukh/veridom-pay`
Construction milestones paid on proof. Site photos go to a Qwen model in a TEE on NEAR AI Cloud; the
enclave signs `ed25519(<model>:<sha256(request)>:<sha256(response)>)`; **the contract verifies that
signature itself**, checks the request is exactly the on-chain inspection prompt for that milestone
(only photos may vary), and reads the verdict. An approved milestone mints a NEP-171 receivable; the
contractor can sell it at a discount, and after the review window `settle` pays
`tokens.owner_by_id` — the current holder, whoever that is. 950 Rust lines, 12 tests, only 430 JS
lines. This is the single most important entry in this file for us: it is the only project that
proves a model's output on chain, and our TEE story today checks an attestation without ever letting
a model verdict move value. Limits it states: escrow is testnet `vp-vpay-2158.testnet`, the live
Render URL was not reachable from here, and a dispute can be overridden by the contract owner.

### 16. Chaperone — `techafreshh/chaperone`
A guard contract for a fleet of money-handling agents. Deterministic on-chain checks first
(allowance, per-payment cap, payee allowlist, and a **purpose reference that must resolve to a real
invoice in the books**), then a signed purpose verdict, then a human decision on anything that does
not line up. The one-line thesis is the best sentence in the field: "spending limits don't make
agents safe; verifying what they pay for does." 2,624 Rust lines, 69 tests, an attack suite that is
explicitly the spec, an MCP surface, a Next.js app. The hard problem: I found **no deployed
contract** — the only account ids in the repo are placeholders (`guard.testnet`, `good.testnet`,
`attacker.testnet`), and the deploy script defaults to `--dry-run`. So the ideas are the best in the
field and the chain evidence is absent.

---

## Next tier (measured, not profiled)

| project | tracks | repo | Rust lines | tests | chain | note |
|---|---|---|---|---|---|---|
| Dragons Market | nfts, social, defi | `SHC-Labs/DragonsMarket` | **44,084** | **940** | no live trading | Biggest repo here by 4×, and its own README says integration is pending and the deployment "does not yet establish live funding, trading or withdrawals". Rules sealed before trading + Dragon-holder jury is a good mechanism. Not judgeable yet |
| Headcount | social | `saltxd/headcount` | 4,140 | 123 | none | Pays each person once across a Sputnik/Trezu list; runs the real DAO v3.2 contract in sandbox. No deployed contract, no URL, no video |
| Daykeeper | social | `memeshee/daykeeper` | 907 | 18 | testnet, live | Best small idea in social: one day of treasury power is auctioned, and the power arrives as two function-call keys the contract `add_access_key`s onto itself (`grant`, `say`) and deletes at the deadline. Neither key can attach NEAR. 10 tx links, mp4 in repo |
| Worldo | games | `Sacura1/Worldo` | 1,962 | 32 | testnet | 36k JS lines, Google/email login through NEAR Auth, mayors are NPCs with their own accounts and NEAR AI reasoning. `worldo.world` 200. Biggest front-end in games |
| Agent Undercover | games, swarms | `xiangxn/Agent-Undercover` | 1,415 | 14 | testnet | 5-player social deduction where 4 AI agents stake their own testnet NEAR with scoped keys; commit-reveal votes and escrow payouts. mp4 in repo |
| DUEL | games, social | `k58v2hbzkk-del/duel-near` | 1,557 | 49 | testnet | Friend bets, price/football settled automatically, group-chat vote otherwise, 24 tx links |
| Crucible | games, security | `1momoh/crucible` | 221 | 15 | testnet | "Con an AI guard in 3 messages for 0.5 testnet NEAR". Tiny, but the loop is the most fun in the field and it makes our Guard legible to a non-technical judge |
| VillageBill | realworld, games, nfts | `yyred-max/villagebill` | 903 | 5 | testnet | Split bills, house builds in real time, NFT badges. 5 tests |
| Presafe | realworld | `ahmardchain/presafe` | 1,922 | 40 | testnet + one real Intents mainnet tx | Business posts a USDC bond, customer sees the protected amount before paying. The only rival with an actual mainnet Intents transfer (`94gPxba…`, `intents.near`, 223,396,920) |
| OpenNear | nfts | not found | — | — | testnet claim | Brings NEAR NFTs to OpenSea via Chain Signatures. No repo found on GitHub search; NOT VERIFIED |
| Zinc / SCOGÉ / Potluck / Lantern Caravan / Kinwarden | nfts, games, social | not found | — | — | — | demo URLs are live sites with no discoverable repo. NOT VERIFIED, excluded |

---

## What they have that we might lack

Ordered by how much it would cost us in a judging round.

1. **A buyer-side proof before purchase.** Handover's clean check and Deed's `buy(expected_nonce)`
   are the same insight from two directions: a buyer must be able to verify the state they are
   buying, and the purchase must abort if the state moved. Our `house_nft` has `nft_transfer` and
   nothing else — `house_withdraw` lets the current holder empty the purse, and there is no listing
   method, no nonce, no `pending` counter. **This is our largest single gap and it is the exact
   attack Deed was built to stop.** A seller can drain a house purse and then transfer the deed.
2. **A public refusal surface a judge can click.** Logen ships an Attack Lab and four refused attack
   transactions; Outlive ships `theft-proof.mjs` and `hostile-seller.sh`. We have refused txs in
   `judges/proofs/mainnet-proof-check.json` (7 of 106 rows are expected failures) but no page that
   runs an attack and shows the chain's own sentence.
3. **Contract-verified model output.** Veridom checks an ed25519 signature over request and response
   hashes inside the contract and refuses a request that is not the exact on-chain prompt. Our TEE
   check proves an attestation exists; per our own README "the model call does not move NEAR". If a
   judge asks "can the agent's reasoning be forged", Veridom has a better answer than we do.
4. **Purpose, not just amount.** Chaperone's purpose reference must resolve to a real invoice. Our
   charter checks payee, cap and daily budget — all *how much* and *to whom*, never *for what*. This
   is a one-field idea (`purpose_ref` on a proposal, checked against an invoice record) and it is the
   cheapest meaningful upgrade available to us.
5. **Freeze outbound authority on release, not just payouts.** Torch's estate freezes MPC signing
   during grace and while a claim is pending. Our `house_release` (line 302) transfers the deed, bumps
   the epoch and hands over the purse, but nothing freezes the foreign-vault path *while* a release is
   merely pending: `house_session_prepare_send` only checks that the caller is the current holder, so
   the outgoing holder can still prepare a send inside the window. The prepared record is inert today
   (`live: false`, no Toll signer), so this is a design gap rather than an exploitable bug — but the
   gap is real and Torch closed it.
6. **Rentable authority.** Writ's `lend`/`end_loan` lets an NFT's command authority be delegated for
   a fixed method and exact args with an expiry. We have board sessions but nothing that rents a
   deed's authority with a bound.
7. **Dynamic metadata.** Bazaar rewrites the token's `extra` with net worth and stance every 5 days;
   OneUp draws its SVG from state. Our deed metadata is static, so a marketplace shows nothing about
   the purse, the cap or the line.
8. **Per-token keyless accounts as the storage unit.** Deed and Torch use a global contract by code
   hash so a vault costs ~0.0013 NEAR and cannot be upgraded. We keep the purse in contract state on
   `house.nearcarta.near`. Ours is simpler and cheaper to read; theirs is independently verifiable
   and lets anyone see `keys: []` on the asset account itself, which is a better demo beat.
9. **A committed film.** Outlive, Phylaxtag, Writ, Daykeeper, Bazaar, Agent Undercover and Torch all
   commit mp4s. We have no video file in the repo. Judges who never open a terminal will watch the
   video and nothing else.
10. **An obligation that outlives the sale.** ArchivePass pays commitments booked before a handover;
    Phylaxtag's fund can only go to a workshop. Our purse is owner-controlled by design, which is
    right for a shop but means "the deed carries obligations" is not a claim we can make.

---

## Where we are clearly ahead

All numbers measured the same way as the table; chain facts re-read live today.

1. **Nobody in these four tracks is on mainnet.** Fifteen of the sixteen have a contract on testnet and
   I confirmed each with `view_account` on `rpc.testnet.fastnear.com` (the sixteenth, Chaperone, has
   no deployment at all). The only mainnet links in the whole set point at `intents.near`
   (Veridom `8nmeStkt…` and `2fS5sb3K…` — both resolved to `intents.near → intents.near`; Presafe
   `94gPxba…`, same), not at a contract the team wrote. Writ's single `nearblocks.io` link is the
   literal string `nearblocks.io/txns/hash`. We have `board.nearcarta.near`, `house.nearcarta.near`,
   `toll.nearcarta.near`, `arena.nearcarta.near` and `townhall.nearcarta.near` live on mainnet, and
   `view_access_key_list` returns `[]` for board, house and charter today. A judge can check this in
   one curl and cannot check it for any rival.
2. **Scale.** 36 Rust files and 15,706 Rust lines across 15 contract crates (`find contracts -name
   Cargo.toml` = 15, including `charter_board_sandbox`), against a best rival of 34 files / 9,913
   lines (OneUp, a single-product perps venue) and 6,148 (Torch, one product). We have 612
   `#[test]` attributes in contracts; the best rival has 239. `npm test` today: **893 tests, 892
   pass, 1 skipped**. Their best is `cargo test` counts of a few hundred inside one product.
3. **A spending constitution, not a spending cap.** `contracts/oath` `clause_checks` refuses off
   allowlist, over per-payment cap and over daily budget on chain and returns a reason;
   `resolve_escalation` holds an over-cap payment. Every rival in the table offers a cap, an
   allowlist, or a guard — none offers a charter with escalation, freeze and a named refusal the UI
   can show. Chaperone has a purpose verdict but no deployed contract; Daykeeper has an auctioned
   one-day key but no budget logic.
4. **The agent key is scoped by the protocol, not by trust.** `shared/deployments/mainnet.json`
   records `agent_methods: ["propose","propose_batch"]` and `full_access_keys: 0`; the full-access key
   is deleted in tx `71Zio28gV3…`. Compare Agent NFT, which scopes an agent inside a wallet contract
   but leaves the collection with a full-access key, and Phylaxtag, Meridian, Outlive, Torch,
   oneupmarkets and commons.dk-dave, all of which still have a `FullAccess` key on the deployed
   account today.
5. **One receipt shape across four rails.** `shared/rails/receipts.js` gives the same keys for a NEAR
   transfer, a chain-signature toll, a dry Intents quote and a capped NEAR AI job. No rival here has
   more than one rail, and most have none: Deed explicitly says "no NEAR Intents, Chain Signatures or
   NEAR AI Cloud".
6. **A re-runnable mainnet proof checker.** `npm run verify` re-reads 106 recorded rows and writes
   `judges/proofs/mainnet-proof-check.json` (`ok: true`; 7 rows are *expected* refusals — the checker
   exits nonzero on a missing tx, not on a Failure status). `npm run check-cited` validates every
   cited file, account and hash. Rival evidence is prose plus links a human has to click one at a
   time; Writ's is a literal `nearblocks.io/txns/hash`.
7. **A whole town, not a single contract.** Eight tracks are eight buildings over 15 crates with
   shared state, versus a single-purpose contract in every row above. For a hackathon judge scoring
   "does this feel like a product", breadth is a real advantage — and for "is any of it real", the
   answer is mainnet rather than a local sandbox.

---

## Which would beat us in a judging round, and why

Blunt version: on the *NFTs That Do Something* rubric, two entries beat us on the exact axis that
track is scored on, and they beat us for the same reason.

- **Handover beats us in nfts.** The track asks for an NFT that does something. Handover's answer is
  one sentence ("the NFT is the only key to an Ethereum address"), it is true on chain, and the
  judge can verify it from a browser without a wallet. Our answer requires explaining a charter, a
  board row, a lease and an agent key before the token does anything visible. Handover also has a
  *better* security story than ours for resale: a public signature log the buyer checks. It is
  testnet only, which is our counter — but a judge who weights "NFT controls a real foreign asset"
  over "deployed on mainnet" picks Handover, and ETH is more impressive than NEAR to that judge.
- **Deed beats us in nfts and business.** It is our house deed with the bug fixed. `nonce` +
  `pending` + `buy(expected_nonce)` is a two-field mechanism that closes the drain-before-sale hole,
  and a threat model that names ERC-6551's version of the same attack. If a judge lines Deed up
  against our deed, the comparison is: Deed cannot be drained before sale; ours can. We win on
  mainnet, on the charter around the deed, and on total code — we lose on the specific property the
  project is about. **Fix this before the judging round, or do not show the deed next to Deed.**
- **Outlive beats us on presentation, and probably on realworld.** The film is better than anything we
  have, the hostile-seller script answers "what if the seller kills the worker after I pay", and the
  buyer agent refuses wash revenue. It is a weaker system than ours (testnet, one contract family, an
  unlocked deployment) but judges score what they can see. If a realworld judge opens one link per
  project, Outlive's link shows a film; ours shows a 3D town that needs a wallet and a charter first.
- **Logen beats us on judge ergonomics in nfts.** Claim-to-evidence table, 17 recorded txs, 4 refused
  attacks, an Attack Lab, and a one-curl check that the seat has no keys. Same architecture as our
  deed and less code than us, but a judge can finish its verification in two minutes.
- **Meridian and Bazaar beat us in games.** Both have a working economy loop where the deed does
  something the player can see (appoint an agent, take dividends, be taken over after bankruptcy).
  Our arena is a pot with a guardian and a cap: correct, but a judge looking for a game will not find
  a loop. Meridian's `/judge` page — every action one button, real tx, real link — is exactly what
  our Games entry needs.
- **Chaperone would beat us in realworld and security if it were deployed.** Its thesis attacks our
  Guard's core assumption: caps and allowlists do not stop a poisoned invoice paid to a real vendor
  under the limit. It has no contract on chain, so today it loses on delivery. If its team deploys
  before judging, it is the strongest argument in the field against a charter that only checks
  amounts and payees.
- **Daykeeper beats us in social.** One day of treasury power, auctioned, arriving as two function-call
  keys the contract installs on itself and deletes at the deadline. It is a smaller system but a
  cleaner social mechanism than a visitor board, and the demo is legible in one paragraph.
- **OneUp and Dragons Market do not beat us**, on different grounds: OneUp is a perps venue whose NFT
  is a claim ticket, and Dragons Market is 44k lines that its own README says has no live funding or
  trading. Neither is a threat in a head-to-head on "NFT that owns something".

**Where we win every one of these head-to-heads: mainnet.** Not one of the sixteen has a contract a
judge can query on mainnet, and we have five, with no access keys, and a checker that re-reads 106
transactions. Lead with that, and with the refusal reason on chain. Do not lead with the deed, because
Deed and Handover win that frame.

---

## Two things to fix that this field exposed

1. `contracts/house_nft` has no listing, no nonce and no `pending` guard. `house_withdraw` and
   `house_pay` let the current holder empty the purse, and `nft_transfer` moves the deed with no
   state check. Deed's `buy(token_id, expected_nonce)` plus `pending == 0` is the fix, and it is
   about 60 lines. Until then we should not describe the house deed as "safe to buy".
2. Our TEE check proves an attestation; it does not verify a model's signature over a specific
   request inside a contract. Veridom does. The gap is visible as soon as a judge asks what the
   attested model is allowed to authorise.

Both are honest weaknesses in an internal doc. Neither is in the public README.
