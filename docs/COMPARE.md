# How each shop compares

Every competitor cell quotes or summarises the competitor's own page, fetched on 2026-10-28. "Not stated" means the page does not say; it does not mean the product lacks the feature. Each claim about us links to a test or a testnet tx in [judges/TESTNET_TXS.md](../judges/TESTNET_TXS.md).

## Mist Bank (privacy)

### Competitors (pages fetched 2026-10-28)
| | Amount hidden from the public | Disclosure to a chosen party | Disclosure scope | Approval rule visible and checkable on chain | Approval bound to the private payment | Agent spend limits | Testnet proof a judge can rerun |
|---|---|---|---|---|---|---|---|
| **Mist Bank** | Yes (Zcash shielded, checked per tx) | Yes: testnet UFVK published | One payout (one account per payout) | Yes: charter clause, cap, receiver, on NEAR testnet | Yes: sha256 commitment in the charter memo, opened from the encrypted Zcash memo | Yes (charter clause cap + receiver list) | Yes |
| [near.com](https://near.com) | Yes: "Balances and transactions stay confidential when you want them to" | Yes: "Choose what you reveal. Share specific activity when needed" | Specific activity (their words) | Not stated | Not stated | Not stated | No (mainnet product) |
| [NEAR Business](https://business.near.com/) | Yes: "Balances are not visible to the public" | Yes: "Auditors get everything; the chain gets nothing", "Audit-ready exports", "Confidential receipts" | The whole treasury (exports) | Yes: "Multisig approvals", "Every Treasury Contract transaction follows the rules you set" | Not stated | Not for agents | No |
| [Trezu](https://trezu.org/) | Yes: "confidential receipt … never to a block explorer" | Team and exports ("Audit-ready exports") | Team | Yes: "Multisig approvals", "Granular permissions" | Not stated | Not for agents | No |
| [NEAR Confidential Intents](https://www.near.org/blog/announcing-general-availability-of-confidential-intents) | Yes: private shard, "Order size, timing, counterparties … not publicly visible" | **Planned**: "plans to roll out a selective disclosure feature … account-level view key … time-scoped" | Account, time-scoped (planned) | Screening at ingress (operator) | — | — | Mainnet only; we use it for dry quotes |
| [Privacy Pools v2](https://privacypools.com) ([v2 blog](https://0xbow.io/blog/privacy-pools-v2-is-live)) | Inside the pool; "Shielding is public and reveals your address, asset, and amount shielded" | Yes: "share proof of individual payments or your full account history" | One payment or the account | ASP approves deposits (operator, 0xbow) | No | No | Not checked |
| [Railgun](https://docs.railgun.org/wiki/learn/wallets-and-keys) / [Railway](https://railway.xyz) | Yes (0zk) | Viewing key; "irrevocable"; block-range scoping "upcoming" | Whole account today | PPOI screens shields against lists (optional) | No | No | Not checked |
| [Zodl (ex-Zashi)](https://zodl.com) | Yes (shielded ZEC) | Zashi 3.15.0 (2026-09-23) exports incoming/full viewing keys; view-only import is still an open request (zodl-project #55) | Account | No | No | No | Wallet only |

### What we do that they do not (each checkable)
1. **The approval and the private payment are bound together.** The charter tx on NEAR holds a commitment. The Zcash memo, readable only with the viewing key, holds the opening. Nobody else we checked links a public policy decision to a private payment. `GET /api/mistbank` → `binds:true`; `GET /api/mistbank/verify?zats=1370000&salt=67d50c7f78cc0cfdc145392edd674f83` → `matches:true`.
2. **Disclosure is one payout, by construction.** A fresh ZIP-32 account per payout, so the published UFVK opens one payout. Railgun keys are irrevocable and account-wide today; Confidential Intents disclosure is still planned.
3. **A street check for any tx.** `GET /api/mistbank/street/<txid>` reports whether a Zcash testnet tx leaks its amount (transparent parts, pool crossing, coinbase). Shown on a real leaking faucet tx.
4. **The agent cannot overpay or pay a stranger**, because the charter refuses first. The recorder stops before any Zcash send unless the decision is `allowed`.

### Gaps
- Testnet ZEC (TAZ) only. The Confidential Intents desk is dry quotes. A real confidential deposit is a mainnet spend and needs the owner's OK.
- The commitment opening is in the payout memo, so any viewing-key holder learns the salt. That is intended (they are the auditor), but the commitment is not hiding against them.
- Gap closed this round: the first recorder reused one payee account. It now makes one account per payout. The current proof's account has exactly one tx (see `list-tx` in the ledger fixture).
- near.com's "share specific activity" may be finer-grained in-app; we could not test it without an account.

## Ferry

### Competitors (pages fetched 2026-10-28)
| | Quote signature checked by the client | Detects a silent privacy downgrade | Zcash recipient decoded (shielded or public) | All-in cost including the withdrawal fee | Executes the swap |
|---|---|---|---|---|---|
| **Ferry** | Yes: ed25519 against the 1Click manager key | Yes: echo guard on unsigned fields | Yes: ZIP-316 decoder, 12 official vectors | Yes, from the signed USD amounts | No: dry only (no mainnet spend) |
| [NEAR Intents app](https://app.near-intents.org) | Not stated | Not stated | Not stated | "best price from solvers" | Yes |
| [near.com](https://near.com) | Not stated | Not stated | Not stated | Shows rate, slippage, minimum received | Yes, "confidentially" |
| [Zodl (ex-Zashi)](https://zodl.com) | — | — | Wallet-side | — | Wallet (zashi.app now redirects to Zodl) |

Change to watch: the [NEAR Intents changelog](https://docs.near-intents.org/changelog/overview) (2026-10-27) says 1Click swaps "roll out as confidential only"; the API is unchanged and `nearTxHashes` lists the shield/unshield steps. Our public dry quote still echoed `public` on 2026-10-28 ~04:58 (Cairo, UTC+3). The echo guard is what will show the switch when it reaches our quotes.
Open gap: no execution (mainnet spend is not allowed). The Mist Bank desk shows the shield → transfer → unshield legs as dry confidential quotes.

## Guardhouse

### Competitors (pages fetched 2026-10-28)
| | Where the policy is enforced | Caps and allowlists | Big moves wait for the owner | Freeze | Receipt per action | TEE |
|---|---|---|---|---|---|---|
| **Guardhouse** | A NEAR contract that is the account's only door (0 full-access keys) | Yes, per clause on chain | Yes: NEP-519 yield, then `resolve_escalation`. Approved on testnet: [AxYjEL2X…](https://testnet.nearblocks.io/txns/AxYjEL2XxpDFLA1Fpkw5EiqGJK7j2sFZymNBbkiVwWkD) → [EduSJN1H…](https://testnet.nearblocks.io/txns/EduSJN1HNLhQU8kNe2nydaHxB9bd6NUDR3ry8DCZL8KE) | Yes; only the DAO can unfreeze | NEP-297 event per decision | Verifies NEAR AI TEE attestations (tee.js); a clause can require a receipt |
| [OutLayer](https://app.outlayer.ai/) | Inside Intel TDX ("spending caps and allowlists enforced in the TEE") | Yes | Yes: "large transfers wait for your approval" | Not stated | "cryptographic receipts on-chain for every action" | Yes; enclave measurements "approved on NEAR by a DAO" |
| [Shore](https://shore.markets/) | Their service | Yes: "You set the limits" | Yes: "approve the big moves" | Yes: "freeze it with one tap" | Not stated | Not stated |
| [ICME PreFlight](https://www.icme.io/) | A solver before the action runs ("SAT or UNSAT") | Your rules | Not stated | Blocks the action | Yes: a zero-knowledge proof per check, verifiable "without seeing your rules or your data" | No |
| [Emet](https://emetguard.tech/) | On chain (EVM, Robinhood Chain): "Every UserOp verified against rules before and after execution" (ERC-4337/7579) | Yes: assets, size, loss, venues, expiry | Not stated | Yes: "One call to erase() and the account freezes instantly" | Trades on chain; "Refusals are logged by the SDK" (off chain). Page: "TESTNET PREVIEW · DEMO DATA"; product "Testnet is live"; no public repo linked; has a token ($EMET) | Not stated |
| [Gleipnir](https://gleipnir.dev/) | Off chain, on your servers: "Self-hosted AI agents for ops, with limits they can't change" | Tool grants; "token and tool-call caps" | Yes: "Holds tools you mark for a person" | Not stated | Server-side records of "every trigger, tool call, result and approval decision" | No (self-hosted; BUSL-1.1 source; $250 a month at work) |

Gap closed this round: owner approval of a big move was built but never shown on chain. Now it is (0.100001 NEAR over the 0.1 NEAR cap → escalated → owner approved → settled; `judges/proofs/escalation-approved.json`, in `npm run verify` 38/38).
Open gaps:
- The agent does not run inside a TEE (OutLayer's agents do). We verify the model's TEE, not our own host.
- Our rules are public; ICME proves compliance without revealing them.

## Your House

### Competitors (pages fetched 2026-10-28)
| | Owner sees the real policy from chain | Owner approves big moves | Owner freezes | Mobile wallet |
|---|---|---|---|---|
| **Your House** | Yes: policy version, hash, freeze epoch, clauses from `r11oath-82930.testnet` | On chain yes (see Guardhouse); in the UI, read-only | DAO freeze on chain; not from the UI | No |
| [Shore](https://shore.markets/) | Their dashboard | "approve the big moves" | "freeze it with one tap" | Not stated |
| [OutLayer](https://app.outlayer.ai/) | Dashboard; policy enforced in the TEE | "large transfers wait for your approval" | Not stated | No |
| [NEAR Mobile](https://www.nearmobile.app) | — | — | — | Yes ("1M+ downloads", "120+ assets across 35+ chains through NEAR Intents") |

Open gap: approve and freeze buttons need wallet signing in the browser, which is not wired. The approval itself is proven on chain (Guardhouse).

## Chronicle (read from chain)

### Competitors (pages fetched 2026-10-28)
| | Any account | Decodes the charter's policy events (clause, decision, reason, policy hash) | Drops events from failed receipts | Testnet | Whole-chain search and analytics |
|---|---|---|---|---|---|
| **Chronicle** | Yes: `GET /api/chronicle/<account>` | Yes | Yes (`phantomEventsDropped`) | Yes | No |
| [NearBlocks](https://nearblocks.io) | Yes | Shows raw logs | Not stated | Yes (testnet.nearblocks.io; its testnet API returned `{"txns":[]}` for our accounts on 2026-10-28) | Yes ("The leading blockchain explorer dedicated to the NEAR ecosystem") |
| [Pikespeak](https://pikespeak.ai) | Yes ("NEAR Portfolio Tracker and Explorer") | Not stated | Not stated | Not stated | Yes ("Data and analytics on the NEAR Protocol") |
| [NEAR Intents Explorer](https://explorer.near-intents.org) | Swaps only | No | — | No | Volume and top swaps |

Open gap, by design: no whole-chain search. Chronicle explains one agent's actions; it is not an explorer.

## Town Hall

Pre-R11: this shop runs its own smaller contract (contracts/townhall), not the R11 `oath`. Its account still has a full-access key. The DAO freeze holds (rewards after it fail with ERR_FROZEN), but there is no policy timelock or escalation.

### Competitors (pages fetched 2026-10-28)
| | Who approves | Approves single payments or rules | Agent pays within the rules | Confidential payments | Funding rounds |
|---|---|---|---|---|---|
| **Town Hall** | A Sputnik DAO vote | Rules (caps, deny list, evidence), once | Yes; it cannot vote on its own proposal | Via [Mist Bank](#mist-bank-privacy) (Zcash testnet) | No |
| [Trezu](https://trezu.org/) | "Multisig approvals" | Single payments ("multiple approvals for every transaction") | No agent | Yes: "confidential receipt … never to a block explorer" | No |
| [NEAR Business](https://business.near.com/) | "Multisig approvals" | Payments; "Every Treasury Contract transaction follows the rules you set" | No agent | Yes: "Balances are not visible to the public" | No |
| [POTLOCK](https://www.potlock.org/) | Funders and rounds | Grants | No agent | Not stated | Yes: "quadratic funding rounds" |

Gap closed this round: confidential payments. Mist Bank pays privately under a charter clause; the commitment on NEAR binds the approval to the amount.
Open gaps: no bulk payments, no rounds.

## Vault Arena

### Competitors (pages fetched 2026-10-28)
| | Who scores an attack | Refusal enforced by | Attempt record | Anyone can play | Attack corpus | Rewards |
|---|---|---|---|---|---|---|
| **Vault Arena** | The contract (verdict codes C0–C9 / ALLOW) | The charter contract, not a model judge | On chain: sha256(prompt) committed before the answer | Yes: any testnet account calls `attempt` | On chain: every attempt's prompt hash and verdict, paged at `GET /api/arena/attempts`. The text is public only after `reveal_prompt` (checked against the hash): 1 of 20 so far | NEP-245 case badge per clause hit; bounty |
| [Gandalf (Lakera)](https://gandalf.lakera.ai/) | Lakera's game ("Test your AI hacking skills") | The model and its guards | Not stated / off chain | Yes | Not stated | Levels |
| [HackAPrompt](https://www.hackaprompt.com) | Their platform ("How are points awarded?") | The model | Off chain | Yes ("30K+ Competitors") | "open-sourced all submissions from our Pliny track" | Money: "over $100,000 in prizes" |
| [Freysa](https://www.freysa.ai/) | — | — | — | — | — | The page is now "Launch your own AI agent on its own machine"; the prize game is no longer shown |

Gap closed this round: HackAPrompt publishes its submissions. Ours were already on chain, but `/api/arena` showed only 12 of the 20 attempts. `GET /api/arena/attempts?from=&limit=` now pages all of them (20 on 2026-10-28: 14 refused, 6 allowed). Integration test: "arena corpus".
Open gaps:
- Prizes are testnet only.
- Most prompt texts are still unrevealed (1 of 20); HackAPrompt publishes full texts.

## Guardian NFT

### Competitors (pages fetched 2026-10-28)
| | What is traded | Rights move with the token | Transfer refused while a payout is in flight | Marketplace |
|---|---|---|---|---|
| **Guardian NFT** | The guardian g1 (arena contract) | Yes, under the charter | Yes: ERR_INFLIGHT_PAYOUT `3frX2Rwk…`; gift refused C7_HANDOFF `8uiZJJhc…` | No |
| [NameSky](https://www.namesky.app) | NEAR accounts ("Buy & Sell NEAR accounts as NFTs") | The whole account | Not stated | Yes |
| [Mintbase](https://www.mintbase.xyz) | NFTs (the fetch returned HTTP 402; current page not read) | — | — | — |
| [paras.id](https://paras.id) | The domain now serves "Narrative Protocol", no longer an NFT marketplace page | — | — | — |

Open gap: no marketplace listing.

## Toll

Pre-R11: this shop runs its own smaller contract (contracts/toll), not the R11 `oath`. Its account still has a full-access key, its owner can unfreeze it, and it has no policy timelock or escalation.

### Competitors (pages fetched 2026-10-28)
| | Policy checked before signing | Chains | Tokens | Settlement verified back on NEAR | Custody |
|---|---|---|---|---|---|
| **Toll** | Yes: allowlist, per-tx cap, budget, nonce, chain id, before MPC signs | Base Sepolia (testnet) | Native ETH | Yes: `verify_foreign_transaction` | Contract + NEAR MPC |
| [HOT Pay](https://pay.hot-labs.org/) | Not stated | "20+ chains" | "50+ tokens"; "Accept USDC and 140+ tokens"; auto-swaps into the merchant's currency | Not stated | "Non-custodial" |
| [near.com](https://near.com) | Not stated | "35+ networks" | "Send anything, anywhere" | Not stated | Account |
| [Chain Signatures](https://docs.near.org/chain-abstraction/chain-signatures) | The primitive we build on | — | — | — | MPC |

Open gap: one testnet chain and one asset. HOT Pay is a merchant gateway across 20+ chains.
