# Nearcarta

[![ci](https://github.com/nearcarta/nearcarta/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nearcarta/nearcarta/actions/workflows/ci.yml)

<!-- # 1064 backend unit tests (1063 pass, 1 skipped) -->

## The game

Nearcarta is a game. You are the Lamplighter's keeper in a small town on a hex island, and your job is
to keep an AI agent from being talked into paying the wrong person. The town is a Market Day: you take an
order at the Town Hall, unload salt at the Ferry, pay a toll to cross, check your buyers at the
Guardhouse, sell at the Arena, seal your profit at the Bank, pay your porter, buy a share of the Ferry and
write the day into the Chronicle. Nine shops, one day, one loop.

**Play free** starts you on the NEAR test network in seconds: your own account, real testnet
transactions, no money and no sign-up. **Play for real** opens the mainnet path, where the same shops move
real NEAR under a charter you sign.

- Play: **https://nearcarta.vercel.app**
- The charter, in plain words: **https://nearcarta.vercel.app/setup**

The rest of this file is the engineering record behind those two buttons: what is on chain, what the
operator runs, and what the game simulates.

**An AI agent can be talked into paying the wrong person. Nearcarta puts the payment rules in a NEAR contract the agent cannot change, so a fooled agent produces a refused transaction instead of a loss.**

A visitor writes their agent's rules into one row on `board.nearcarta.near`: who it may pay, how much per payment, how much per day, how many payments a day, and when the row expires. The agent holds a function-call key with no authority beyond asking. Every payment is checked on chain and is allowed, refused with a reason, or held until the owner confirms. The refusal is a transaction you can open. The town is how you see it: a 3D island at dusk with nine shops, each one a real mainnet dApp behind the same charter.

- Town and shops: **https://nearcarta.vercel.app**
- API: **https://nearcarta-api.onrender.com**
- Start here: **https://nearcarta.vercel.app/setup**

---

## What you can do in 60 seconds

| # | Do this | You should see |
|---|---|---|
| 1 | Open **https://nearcarta.vercel.app** and press **Start here** | `/setup`, step 1 of 7, a mainnet account field — no faucet, no testnet |
| 2 | Open **https://nearcarta.vercel.app/?shop=ferry** and press **Get quote** | A quote line with the amount out, its USD value, the ETA and the fee, and on the compare the larger amount out marked `best rate` — after sign-in. Signed out the shop says exactly what it needs: *"A NEAR destination needs your NEAR account as the recipient. Sign in, then get the quote again. No deposit address. Nothing was sent."* Nothing is ever sent from this button |
| 3 | Open **https://nearcarta.vercel.app/?shop=bank** and press **Audit privately** | A sample statement read in the browser: `3 lines · 3 counted · NEAR`, and one anomaly reading `cafe.near, 0.01 NEAR. It appears twice in November.` |
| 4 | Open **https://nearcarta.vercel.app/ferry-widget** and press **Pay** | The visitor's row is read first. A deposit address appears only when that row allows the recipient and the amount |
| 5 | `curl -s https://nearcarta-api.onrender.com/api/receipts` | One object shape for four rails — `near`, `chain-signatures`, `intents`, `near-ai` — keys `rail`, `network`, `what`, `to`, `amount`, `asset`, `decision`, `reason`, `decided_by`, `tx`, `url`, `checks` |
| 6 | `curl -s https://nearcarta-api.onrender.com/api/health` | `"network":{"contracts":"mainnet","journey":"mainnet"}`, `"near":{"chain_id":"mainnet"}`, `"features":{"signing":false}` |

Steps 1 and 4 need a row, which `/setup` opens in one wallet approval. The rest are reads. Test for step 6: `health names mainnet and has no trial block`.

---

## The eight tracks

Each track is a shop and a room in the town. Open any room with `/?shop=<id>`. Every row names the file that implements it, the test that pins it, and a mainnet transaction you can open on nearblocks.io.

| Track | Shop | The idea | Implements | Test | Mainnet |
|---|---|---|---|---|---|
| DeFi | Ferry | A cross-chain swap through NEAR Intents: quotes compared with the larger output marked, and 1Click asked for a deposit address only after the visitor's row allows the recipient and the amount | `backend/src/ferry-checkout.js` `openCheckout`, `app/src/ferry-catalog.js` `pickBest` | `a refused recipient never asks 1Click, and an allowed one returns a deposit address`; `two ferry quotes mark the larger amount out` | swap [HzgUr618…](https://nearblocks.io/txns/HzgUr618CQqxECR88QKW93yGbDoFU176vWQfWM3yZaUw) |
| Privacy | Mist Bank | A statement audited in the browser, and the model asks a fresh nonce per question so a report is bound to that one question; the audit can then tighten the visitor's own cap | `app/src/panels/bank-audit.js` `auditStatement`, `backend/src/tee.js` | `a card csv keeps its currency and names the biggest waste`; `an ecdsa receipt is recovered in the browser, and a wrong algorithm is never claimed as a pass` | tighten [9wxG5aEr…](https://nearblocks.io/txns/9wxG5aErrrU72tH4oTt8dAdku3KXqWybJr7yXL32bFRY) |
| AI Security | Guardhouse | A payee checked on age, code hash, look-alike and deny list; a warning becomes a hold that only the owner's key can release | `app/src/panels/guard-agent.js`, `contracts/guard` | `the guard dock asks the model, and falls back to the parser when the model cannot answer`; `a guarded pay holds a warning until a person confirms` | hold [9qxsoyA8…](https://nearblocks.io/txns/9qxsoyA8VrecsCh13yuUFhCk7QxEM4ueMVbicJvxyXwT) |
| Agent Economy | Town Hall | A job splits a budget across parts, takes real bids, counters once, and holds a pass until the delivered digest clears | `contracts/hall`, `shared/hall/job.js` | The full v2 lifecycle is pinned in the contract: `two_workers_split_one_job_and_only_the_passed_part_is_paid`, plus `a_pass_without_a_guard_clear_cannot_release` and `a_swapped_review_is_refused` (`contracts/hall/src/lib.rs`); `the gold button and the dock share one runner, and a move goes through one sender` | v1 era: post [8KQnVZhz…](https://nearblocks.io/txns/8KQnVZhziwbTsF5UvbU16xen8tBdiJTMbbNoi1mSbVoA), reward [5Dgoit85…](https://nearblocks.io/txns/5Dgoit85Zh2ANdRGxGU4sE6Ggwmxhu5X8fQaN221VvSo). The live contract is Hall v2 — it answers `post_job` and refuses `post_bounty`, which the v1 txs above used, so those record the earlier API while the v2 loop is proved by the tests named here. **v2 on mainnet, 2026-11-09** (job 3, 0.0005 NEAR, poster through a board row): post_job [GF7VHyeP…](https://nearblocks.io/txns/GF7VHyePtBLKMyh1dx44vmUuMukBWNEMtfZRVywHrmZy), bid [CeUTd2Bh…](https://nearblocks.io/txns/CeUTd2Bhj8yphvTBhxEDR9mTpwZPMbuKJVCtAPgU1c1), accept [xkqmfWez…](https://nearblocks.io/txns/xkqmfWezTbD9e54V55GaB1ffKp6Y4qJi8cmPBowXmsc), deliver [J4V4fGV2…](https://nearblocks.io/txns/J4V4fGV2A71PE2v6D1ZG9nwVFEDFMoVDBKTf7gtUhdTx), review [Av1gAAgv…](https://nearblocks.io/txns/Av1gAAgv9dyyTCJKKfzY37cifCa1JR2XqssLGiurhDmA), refund [51XEPFxM…](https://nearblocks.io/txns/51XEPFxMGcgMN5kHRBBBZXJqno8jkuK86DKseEXdDme3). That review was a fail and the budget came back, because the guard then had no call to `guard_clear`. The guard was redeployed with `clear` the same evening, and **job 4 paid**: post [GJDhV3C5…](https://nearblocks.io/txns/GJDhV3C5iSuZzbdwJPMP6gjbHb8MUmRYPs49SJRh3hdd), bid [7zQHjt9P…](https://nearblocks.io/txns/7zQHjt9PGbreNnt5xaAHTwD4CeX24TiaCQTbm2KNEsfA), accept [HZMwcUcF…](https://nearblocks.io/txns/HZMwcUcFPECmDKd967PBqLMLseEbcBV3GRq7b818QNQH), deliver [HqbLfPgn…](https://nearblocks.io/txns/HqbLfPgnUk3xmU3X77iybQiekDypkPMoebvPaj1cwzQ8), guard clear [5PbAPsNZ…](https://nearblocks.io/txns/5PbAPsNZs2kmaJNSKFgJz8PUQGS9hY6aKgktFv2aJQ5R), review pass [3uSAuuj9…](https://nearblocks.io/txns/3uSAuuj9MWymVM2w13BBszk97iRnJiyw184UeMm1WW6b), which paid the worker 0.0004 NEAR. Known gap: the live hall keeps the 0.0001 spare in escrow |
| Real-World Money | Payouts | One `propose` per reviewed in-cap NEAR row, an over-cap row refused before any deposit, and an invoice whose receive account and amount a payer query cannot change | `app/src/panels/payouts-plan.js` `classifyPayroll`, `backend/src/payouts-invoice.js` | `plan: classifyPayroll sends the in-cap rows, refuses the big one before deposit, prices the foreign row`; `an invoice with line items sums them and ignores a conflicting total` | allowed [4jEjzpiY…](https://nearblocks.io/txns/4jEjzpiYxZYu1UmLhn3C1roYQ95pUQDrFkc6vRfiYbia), refused [AsZUd9mZ…](https://nearblocks.io/txns/AsZUd9mZc9uvkvz4RfEjAPiQdWduvYXqgx3wjmqu6EKx) |
| Autonomous Business | Toll Bridge | A pay-per-use gate whose fee and chains come from the live policy, and whose signature comes from the NEAR MPC signer | `contracts/toll` `cross`, `sign_cross` | `a_failed_crossing_promises_refund_action_for_that_row` | allow [4LKGpA5v…](https://nearblocks.io/txns/4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz), refusal [B9FFjcSA…](https://nearblocks.io/txns/B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR) |
| Autonomous Business | Chronicle | One account read across board, Ferry, Toll, foreign and Guard rails, with a statement, a CSV export, and a digest that a changed statement fails | `app/src/chronicle-loop.js` `accountRows`, `app/src/chronicle-audit.js` | `an unrelated account keeps its own live rows and does not borrow the owner feed`; `a statement digest rejects tampering and a private note stays salted`; `chronicle merges toll, ferry SUCCESS, payouts and guard refusals` | allow [8WDqBeaN…](https://nearblocks.io/txns/8WDqBeaN7tCs8zPoYUPAicWhAF38YXgg5Si1YLpeD1aR) |
| Games | Vault Arena | A guardian NFT with an oath: mint, feed the pot, attack, withdraw, and an attempt that breaks the oath is refused on chain and badged once | `contracts/arena`, `app/src/panels/arena/economy.js` `planFeed` | `refusals_are_recorded_and_badged_once`; `the fund call names fund, not feed, and carries the amount as the deposit` | allow [AZWxqZns…](https://nearblocks.io/txns/AZWxqZnsv47WFjerjw4J8PB2SEiaYZfm6mfquYJ9xPht), refusal [25LpJRFF…](https://nearblocks.io/txns/25LpJRFF6ugmRdF8eH7Rw7dpkMthQjG6XWXFyx9mqa6V) |
| Open | Your House | A NEP-171 deed that carries a purse, a check-in clock and an inheritance line; selling the deed moves the purse and ends the seller's authority | `contracts/house_nft`, `app/src/panels/house-room.js` | `the_deed_moves_with_its_purse_and_the_old_holder_loses_control`, `the_new_holder_can_spend_the_purse_immediately` | allowed [83nyJmTW…](https://nearblocks.io/txns/83nyJmTWVnYfnBX6SkwyMhcZptis8Kktmc1UatkZYe26), refused [3Z4UAb6N…](https://nearblocks.io/txns/3Z4UAb6NRMwguLDBJHhAvMgtckKxEacvewc7g5MCFmb1) |

Chronicle runs on the board's own records rather than a contract of its own, so its two tracks share the board. The deed's mint for a real visitor row is [4W7bmUYo…](https://nearblocks.io/txns/4W7bmUYoG3QfRUKF7yJSfELMUgWsrAP5GrL9d7VC5X33).

---

## Games: Market Day in Nearcarta

The city is the game. Press **Market Day** on **https://nearcarta.vercel.app**, and the Town Crier walks you through nine shops: Town Hall, Ferry, Toll Bridge, Guardhouse, Vault Arena, Mist Bank, Payouts, Your House, Chronicle. Each step is that shop's real feature. Today's round is a practice round: the market rules (`shared/market/sim.js`, `shared/market/story.js`) run in the browser, and each step with a mainnet record links it in the Receipt. Tests: `story: nine steps, one per shop, every shop once`, `story: a new merchant earns a first coin in one day`.

### NPCs with wallets

| Do | See |
|---|---|
| Walk to the Guardhouse and press **Check buyers** | The Captain clears the square keeper and refuses the con artist. The Receipt links the real refusal on chain |
| Walk into any shop for the first time | Its keeper greets you by role: Clerk, Ferryman, Toll warden, Captain, Arena marshal, Banker, Paymaster, Housekeeper, Archivist |
| Tap a keeper standing at a shop door | Their card: name, mood (Worried, Steady, Cheerful from their till), purse in coins, and what they traded today. Step out of a shop and its keeper says what they just did |

Status: live. The nine keepers are NEAR sub-accounts with board rows. Keepers restock on NEAR AI decisions that are TEE-signed and checked before anything is sent. The completion id is written on chain in the move. Proof: keeper-hall bought 2 iron from the Arena on decision `a9bfe9d523204ff4898c527a14ee3d61`, tx [6YiRK25TR8…](https://nearblocks.io/txns/6YiRK25TR8m84LcE7PpxXtB55W6CNxLGE7xApsFYNt55) (`scripts/keepers-round.js`, `backend/src/keepers.js`).

### Player-owned markets

| Do | See |
|---|---|
| At Your House press **Invest 10** | The Ferry, dark after spending its till on your cargo, lights up again, and a Ferry share goes into your bag |
| Open the bag after the Ferry sells | The share row shows a **Claim** button for your part of its sales |

Status: live. A player rents an Arena stall from their purse and holds it on chain for 7 days (`stall` on arena.nearcarta.near). Proof: a fresh account sold 3 salt into its purse ([GecJPUaL…](https://nearblocks.io/txns/GecJPUaLsbXfKbjHSRQJAUj2BFzQ1iPpVqaovGNxg6M7)), rented stall 1 ([8JxnSuDg…](https://nearblocks.io/txns/8JxnSuDgv3C2ghkcPFqRmS3AuP8JQqwDWaeNafuzFkun)) and bought a Ferry share from the purse ([3BFDcPwr…](https://nearblocks.io/txns/3BFDcPwrfu64LATzbUyh868e6jWMaJTHDEPHxm7mfaeq)).

### Economy evolves without a dev patch

| Do | See |
|---|---|
| At the Vault Arena press **Sell 3 salt**, then **Why this price?** | The price moves with the shelf: `price A → B`, and the reasons (stock, demand) behind it |
| Finish the day and press **Day 2** | The shelf you sold into, the tills and your share carry over: the price you moved stays moved |
| Finish the day and press **Week** | A week in a minute: the salt price follows the shelves, a con artist is refused each day, dark shops reopen, and on day 4 a council vote lowers the floor that keeps shops open (`councilVote` in `shared/market/sim.js`, test `a council vote changes a market rule mid-week, with no code change`) |

Status: live. The nine keepers form the market council on chain (quorum 5). Each vote carries a NEAR AI decision. Proposal 1 (floor 90%) was voted down 2 to 5. Proposal 2 passed 5 to 0, and the market's `floor_bps` went from 10000 to 9000 with no code change. The `rule_changed` event is in tx [Gub1q247gy…](https://nearblocks.io/txns/Gub1q247gyT2RNZHSGCwCKNJi1uNVRVGmyRs4piSNYJb). **Week** first replays the real moves from the chain, marked Real, and then offers a next week marked Practice.

### Players never notice the chain

| Do | See |
|---|---|
| Play the whole day | Coins, a purse, a stall, a share. No wallet popup, no hash, no gas prompt in the main flow |
| Tap the purse in the top bar | The Receipt: each finished step, and a quiet **Record** link to its real mainnet transaction for those who want proof |

Status: sponsored gas is live. Each real move is signed by the player and sent by relayer.nearcarta.near, which pays the gas within caps per visitor and per day. In the prod run above, the player's NEAR stayed at 0.003 from the first move to the last ([2TXeZ4hR…](https://nearblocks.io/txns/2TXeZ4hRu2EB4zw9cG6zdq9jgfswKRQs6BwRu1K1uPRM) gather, sell, stall, invest). Email sign-in (Privy) is built and is being confirmed with a real inbox. Judges: every proof is on `/judge`.


### Try free: a guest account on the test network

Press **Try free** and you get your own NEAR testnet account in seconds: `<hash>.play.nearcarta.testnet`,
funded by the city, with the key made in your browser and never sent anywhere. You then play the whole
day with **real testnet transactions**, each one a receipt you can open. Nothing here is money, and
nothing here can touch mainnet.

| Step | What the guest's browser really does | Test |
|---|---|---|
| **Try free** | One transaction from the funder: `CreateAccount + Transfer(0.25) + AddKey(the guest's key)`. The account name is a hash of the public key, so a retry sends nothing | `guest: start is idempotent for the same public key` |
| **Welcome crate** | 100 test dollars minted and the market's storage deposited, both paid by the funder | `guest: the account name is a hash of the public key…` |
| **Open my row** | `open_charter` + `set_calls`, signed and paid by the guest. Receivers and caps come from `testnet.json`, never a literal | `guest play: the row a guest opens comes from the record, not from a literal` |
| **Take order** | The row posts a job at the Town Hall; the worker is `keeper-hall`, a real keeper account | `guest play: every story step on testnet has a real transaction behind it` |
| **Unload salt** | Three `gather` calls mint NEP-245 salt, sent as NEP-366 delegate actions through the testnet relayer | same |
| **Cross** | `toll.cross` then `toll.sign_cross`: a real Chain Signature by `v1.signer-prod.testnet`. **Not broadcast** to Base Sepolia (there is no Base Sepolia ETH), and the card says so | `guest play: the toll is signed and NOT broadcast, said in one line` |
| **Check buyers** | The honest buyer is paid and the look-alike is refused: the card links the **failed** receipt | `guest play: every card carries a TESTNET pill and a receipt link` |
| **Sell** | `sell` through the relayer, `min_total` from the live `quote` view | `story: nine steps, one per shop, every shop once` |
| **Seal profit** | The guest's own row calls `board.anchor(kind, digest, salt)`; only the digest is on chain, the salt stays in the browser | `guest play: every story step on testnet has a real transaction behind it` |
| **Pay porter** | 3 **test dollars** by `ft_transfer` on the test USD contract, signed and sent by the guest | same |
| **Invest** | `purse invest` through the relayer: a real Ferry share | same |
| **Write the day** | The timeline is read from the testnet index and its digest anchored by the guest's row | same |

Caps, all env-configurable on the testnet service: 3 accounts per IP per UTC day, 400 a day across the
city, a funder floor of 10 test NEAR, and 0.25 test NEAR per guest. Every refusal has its own code and one
honest line, and Practice mode is always the floor. Tests: `guest: every cap answers its own ERR_ code`,
`guest: the day counters enforce a per-IP limit and a shared limit, and roll over at midnight`.

### Talk a keeper past its limit

The front door of Try free. Type anything at a keeper, including an instruction to ignore its rules. The
refusal is not a sentence on a screen: it is signed inside a TEE, and then **written on chain**, and you
can force the over-limit payment and watch the charter refuse it.

| Beat | What really happens | Test |
|---|---|---|
| **Ask the keeper** | NEAR AI Cloud answers in character. The attestation report is fetched with our own nonce **before** the question, and the reply's signature must cover the model name and the hashes of the exact request and response bytes, and name the signer that report attests | `the keeper refusal is TEE-signed and the check is reported field by field` |
| **The refusal is on chain** | The guest's own row calls `board.anchor` with a digest over the signed text and the signer. Only the digest is published; the words stay off chain | `the refusal anchor and the forced attempt are both testnet explorer links` |
| **Submit the over-limit intent anyway** | Nothing is clamped. The exact intent the keeper refused goes through `propose_call_as`, and the board's caps reject it. The card links the **failed** receipt and names the reason | `the forced submit is a real call the charter can refuse, not a pre-check` |
| **A charter that allowed it** | Reported as a **failure of the demo**, never as a pass: a cap that lets the payment through is a bug in the cap | `it requires a digest, an anchor tx and a forced tx, and refuses a missing one` |
| **No TEE signature available** | The card says the reply is unsigned and only its digest is anchored. It never claims a seal it did not check | `a signature that does not verify is not claimed as sealed` |

There is one honest line for each of the four ways the model can be unavailable (no key, over budget, a
failed attestation, no answer): the reply is the fixed refusal, and the card says in words that it is fixed
and only anchored. A visitor is never shown a seal that was not checked.

Reproduce it: `node scripts/scam-e2e.mjs --base https://nearcarta.vercel.app`. It prints both hashes and
their testnet links and **exits non-zero if either is missing, or if the charter allowed the payment**.

### What the chain saw

Every shop carries the same card under its header: **contract, method, signed by, gas burnt, amount, what
the chain said**, and whether a TEE signature was checked. A field with nothing in it says "not in this
step" rather than showing a plausible number, a step with no transaction says nothing was signed, and a
recorded mainnet proof keeps its `nearblocks.io` link and is labelled. Tests:
`the card shows the six facts a judge checks, in the same order everywhere`,
`an absent field says so in words instead of inventing a value`.

### What is on chain, what the operator runs, what is simulated

| Thing | Where it lives | Test that pins it |
|---|---|---|
| The guest's account, its key, its board row, every move and every receipt | **On chain**, on NEAR testnet | `guest: start is idempotent for the same public key` |
| The funder float, the relayer float and the caps | **Operator env** on the testnet service, never in the image | `guest: every cap answers its own ERR_ code` |
| The look-alike payee the Guardhouse refuses | **Operator**: a separate testnet account from the record | `guest play: the record names every shop a guest row may reach` |
| The price, purse, stall and share maths between steps | **Simulated** in `shared/market/sim.js`, the same rules as mainnet | `a council vote changes a market rule mid-week, with no code change` |
| The Ferry swap price, the Payouts cross-chain leg | **Quoted, not executed**: NEAR Intents has no testnet, so it is a live dry quote | `an intents receipt has no tx, and a model job names its dollar cap` |
| The Base Sepolia transaction the Toll signs | **Signed, not broadcast**, by your decision | `guest play: the toll is signed and NOT broadcast, said in one line` |

### The game is the front door

The first screen is the playable town, with one gold action (**Try free**) and one outlined action
(**Play for real**). The opening cinematic is a press away (**Watch the story**), not a gate. The entry
buttons are usable in about 130 ms and the two big optional bundles load lazily, so a phone on a slow
link still gets a playable first screen. Tests: `the game is the front door and the story is a press away`,
`the entry buttons are usable before the town finishes loading`.

---

## The safety story

Three properties. Each one is pinned by a test and by a transaction you can open.

**1. The agent's key can only ask.** A row holds a function-call key scoped to board methods — `propose`, `propose_call`, `propose_call_as`, `confirm_hold`, `tighten_rules`, `anchor`. It cannot call an owner method and it cannot transfer NEAR by itself; `cancel_hold` and `expire_sent` stay in the visitor's wallet (`shared/board/session.js` `OWNER_ONLY_METHODS`). Removing the original full-access key was a transaction: [71Zio28gV3…](https://nearblocks.io/txns/71Zio28gV3yubD5DecGtkguWzWdfix8brcKFy13d3zzt). Tests: `adv_agent_key_cannot_call_owner_methods_or_transfer` (`contracts/oath/tests/adversarial.rs`), `cancel and expire are owner-only and never travel with the agent`, `the agent cannot confirm a WARN without the visitor`.

**2. The refusal happens on chain, with a reason.** `propose_call_as` checks expiry, the ed25519 signature over the exact call, the frozen flag, clause expiry, the time window, the minimum amount, the receiver allowlist, the per-shop cap, the session cap, the per-action cap, the daily budget, the daily count, the balance and the open-hold count — in that order — before a yoctoNEAR moves (`contracts/charter_board/src/v2.rs`).

| What was attempted | Transaction | The chain said |
|---|---|---|
| 0.003 NEAR against a 0.002 NEAR cap | [BvDNZk6F…](https://nearblocks.io/txns/BvDNZk6F5mAH2fqDCkLgf61hCmHJcJTbcQYnRc7reKbH) | `over_per_action_cap` |
| A payee that is not on the row | [E7KMexjS…](https://nearblocks.io/txns/E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ) | `receiver_not_allowlisted` |
| A shop call above its own cap | [8df5Zu8U…](https://nearblocks.io/txns/8df5Zu8UGFsFvETbr99pMZBmEpP3ZFEeCnWePPKVZBqZ) | `over_shop_cap` |
| Over the board's cap | [CcPMX1Dt…](https://nearblocks.io/txns/CcPMX1DtMJ8UyCm4toUHossrFTrHhVKXrSe6L69s9ceF) | refused |
| A Town Hall job posted from a visitor row | [51UktPvy…](https://nearblocks.io/txns/51UktPvyyQuf199eABmiKG1dVdWwUJLZn3vGrmp94jY4) | `below_min_amount` |

A shop call that carries **no deposit** — a house check-in, an arena feed, a toll crossing — hits that same `below_min_amount` gate on the live board, before the call allowlist is even consulted. Reproduced on 2026-11-09 by signing a real `propose_call_as` for a zero-deposit `house_session_check_in`: the contract answered `below_min_amount`, not `method_not_allowlisted`. The source already has the guard that fixes it (`contracts/charter_board/src/v2.rs` — `if deposit > 0 { require!(deposit >= min_amount) }`), and that guard is live since 2026-11-09 (code hash `CM6WA2gZ…`, recreate [CdHZUvPV…](https://nearblocks.io/txns/CdHZUvPVX8NXvvPT5nEueyAnvUsWpBdrw932U9bPefmp)); the table above was measured on the build before it. Fixed on the live board since the hold build: the zero-deposit `accept`, `review` and `refund` above ([xkqmfWez…](https://nearblocks.io/txns/xkqmfWezTbD9e54V55GaB1ffKp6Y4qJi8cmPBowXmsc), [Av1gAAgv…](https://nearblocks.io/txns/Av1gAAgv9dyyTCJKKfzY37cifCa1JR2XqssLGiurhDmA), [51XEPFxM…](https://nearblocks.io/txns/51XEPFxMGcgMN5kHRBBBZXJqno8jkuK86DKseEXdDme3)) all went through a row.

The message to sign is not reproduced by hand: `call_as_message` is an exposed view, so you ask the contract for the exact bytes it will verify and sign those. That is how the reproduction above signed correctly on the first attempt.

**3. A warning is held, not paid.** `propose_call_as` with `hold: true` stores a pending hold instead of forwarding. [9qxsoyA8…](https://nearblocks.io/txns/9qxsoyA8VrecsCh13yuUFhCk7QxEM4ueMVbicJvxyXwT) is a second 0.001 NEAR payment that became a hold; the same payment inside the cap went straight through [BBVJPesL…](https://nearblocks.io/txns/BBVJPesLZxjhSaasKgurFaAM5FG1SiVnm4SLqxiAoags). Confirming needs a separate confirm key: `set_confirm_key` refuses the agent key, so listing `confirm_hold` on the session key buys the agent nothing. The visitor's wallet cancelled the pending hold [GWnPvGBc…](https://nearblocks.io/txns/GWnPvGBcVe599hk6RQmxxUgRagtQc7CWWFJgmXL4VgYs) and `close_charter` returned the stake and the unspent balance [8eNrPXFg…](https://nearblocks.io/txns/8eNrPXFgn5EN87VrNYQERjaHpsp5Rcg8QnxT5pLaCrfZ).

**The model cannot move the money either.** `backend/src/agent.js` `propose` reads the model's proposal and discards any answer that names a payee the visitor did not write or an amount above the one they typed. A model job is also capped before it is sent: 160 tokens, $0.05 and 300 calls a day (`budgetStatus`, `GET /api/agent/budget`). The NEAR that job can move is still the row's cap. Tests: `a model that invents a payee is discarded for the words`, `a model that raises the amount is kept to the amount in the message`, `an intents receipt has no tx, and a model job names its dollar cap`.

**A stranger's own key sent two real payments.** Signed with the row's agent key rather than a wallet, from an account that is not the owner: [AC1j6vLS…](https://nearblocks.io/txns/AC1j6vLSmrvGDTbF7JBbgyuru4XH3NtU2oWf7Ervmk1Y) and [BEndDsRe3Y…](https://nearblocks.io/txns/BEndDsRe3YU4e6hjXA2J23ceWDi4ikDseMaTZUDxWL28), 0.0001 NEAR each to `house.nearcarta.near`, both final and successful. The charter, not the sender, decided: after them `get_charter` reports nonce 19 → 21, balance 0.0092 → 0.0090, `spent_today` 0.0108 → 0.0110, `actions_today` 17 → 19. Those counters only advance when the row allows a payment. `npm run verify:mainnet` re-reads both.

**The charter's own key was the first thing removed.** The original per-charter oath key was limited to `propose` and `propose_batch` (`shared/deployments/mainnet.json` `charter.agent_methods`); that account was reaped after the migration to one shared board, and the live board has no access key at all — `view_access_key_list` on `board.nearcarta.near` returns `[]`. Test: `the charter agent key is named as propose and propose_batch`.

**Every visitor gets their own row on the same contract.** There is no per-user contract and no owner-run queue: one deployed board holds every visitor's row, keyed by their account. `contracts/charter_board_sandbox/tests/two_visitors.rs` deploys one board into a local near-sandbox, opens two unrelated rows, checks each can act only inside its own rules, and checks teardown pays the owner — `two_visitors_share_one_board_and_teardown_pays_the_owner`, run by the `board-sandbox` job on every push. Opening a row is one wallet approval on `/setup`, and the gas is measured against the committed wasm in `setup_open_gas.rs` (`open_charter` with six receivers burns 4.01 Tgas, `set_calls` 5.09, both together 8.53).

---

## How to run and verify

```bash
npm ci
npm test                 # 1064 unit tests (1063 pass, 1 skipped)
npm run verify:mainnet   # 205/205 mainnet txs found
npm run check-cited      # MISSES: none
npm run build
npm run e2e   # 127 browser tests
cd contracts/oath && cargo +1.95.0 test --lib   # 122 passed
cd contracts/arena && cargo +1.95.0 test --lib  # 17 passed
```

`npm run e2e` needs the API on `:8787` and the built UI on `:5173`; `e2e/playwright.config.js` reads `BASE_URL` and defaults to the local app.

| Command | What it prints | What it proves |
|---|---|---|
| `npm test` | `# pass 898`, `# fail 0`, `# skipped 1` | The unit suites, offline. The one skip would sign a real transaction |
| `npm run verify:mainnet` | `205/205 mainnet txs found`, then rewrites `judges/proofs/mainnet-proof-check.json` | Every proof transaction in `shared/deployments/mainnet.json` exists on mainnet, allowed or refused |
| `npm run check-cited` | `MISSES: none` | Every file, account, code hash and sha256 this README, `judges/VERIFY.md` and the live `/api/deployments` name resolves |
| `npm run build && npm run e2e` | Playwright, writing `judges/proofs/e2e-results.json` | The town, the shops and `/setup` in a real browser |
| `cargo +1.95.0 test --lib` in `contracts/oath` | `122 passed` | The charter's own logic. `+1.95.0` is required: the crate needs edition2024 |
| `cargo +1.95.0 test --lib` in `contracts/arena` | `17 passed` | The arena's oath, refusals and payouts |
| `npm run readme-numbers -- --check` | `README.md: up to date` | The counts above are generated from the last full run, not typed |

`CI` (`.github/workflows/ci.yml`) runs the backend units, the proof verify, the build, every crate's unit tests, the oath and factory sandbox suites, and gitleaks. `npm run test:contracts` runs the sandbox suites locally against `near-sandbox`, with no keys.

# 1064 unit tests (1063 pass, 1 skipped):
Proof rows (205/205 expected).

`judges/proofs/e2e-vercel.json`: 20 passed, 1 skipped.
`contracts/oath` is the agent charter (Rust, near-sdk). 122 unit tests live in its source. `contracts/charter_board` is the live visitor board. `contracts/arena` holds 17.

These four lines are written by `npm run readme-numbers`, which reads the last full run and refuses to write if a unit test fails. Do not edit them by hand.

---

## Architecture

```
contracts/
  charter_board/   the visitor row: allowlist, caps, holds, per-shop calls  -> board.nearcarta.near
  oath/            the original per-charter spend gate (unit + sandbox tests)
  toll/            pay-per-use gate that asks the MPC signer              -> toll.nearcarta.near
  hall/            job escrow, bids, counter, review digest                -> townhall.nearcarta.near
  arena/           guardian NFTs and oath-scored attempts                  -> arena.nearcarta.near
  house_nft/       NEP-171 deed, purse, check-in, inheritance              -> house.nearcarta.near
  guard/           keyless forwarder, refunds on a failed route            -> guard.nearcarta.near
backend/src/       the API, one module per shop; it holds no NEAR key
backend/scripts/   proof recorders and checkers, the only other signers
app/src/panels/    the console and the nine shop panels
app/design/        the 3D town (D9_world) and the shop interiors (D8_shops)
shared/            contract-facing logic both sides share
```

| Layer | Where | Notes |
|---|---|---|
| Contracts | `contracts/` | One Rust crate per shop, near-sdk 5.27, rustc 1.86 |
| API | `backend/src/server.js`, `backend/src/app.js` | Vercel forwards `/api/*` here (`vercel.json`, `middleware.js`) |
| Hosting | `render.yaml`, `Dockerfile` | The Render image runs `node backend/src/server.js` on `0.0.0.0:$PORT` |
| UI | `app/src`, `app/design` | Live data only through `app/src/live/data.js` |
| Shared logic | `shared/` | `shared/rails/receipts.js` is the one receipt shape |
| Addresses | `shared/deployments/mainnet.json` | The only place an account, code hash or proof tx is written down |

**The API never signs mainnet.** `features.signing` is `false` in `/api/health`, and the visitor's own wallet or their own session key signs every payment, inside their own row.

---

## Design

The city is a low-poly island at dusk — a lighthouse, a ward, a ferry jetty and nine buildings you walk into. Each shop is a room: the 3D scene is the shop, and the panel is the chrome over it.

Every shop uses one panel: **480px wide, 18px radius, one header with the shop's own 3D icon, one segmented tab bar, one field rhythm, one gold action, and a per-shop accent** that changes only the icon, the selected tab and the focus ring. The palette stays the project's dark brown and gold. The panel scrolls inside one region while the gold action stays pinned, so the action can never scroll away.

The panel is built to hold its whole form, and the numbers behind that were measured rather than eyeballed: the commits record `scrollHeight` against `clientHeight` in the real page. Measured on the deployed site, **all nine shops report `scrollHeight == clientHeight` at both 1440×900 and 390×844** — no form scrolls at either width. Browser evidence: `every shop opens twice at 1440` and `every shop opens twice at 390` (`e2e/depth-round.spec.js`), which open all nine rooms at both widths and assert there is no horizontal overflow. The tray invariants are pinned in `backend/test/unit/tray-layout.test.js`: `the tray scrolls in an inner region so the action row stays visible`, `every tray field meets the 44px tap floor`, `Chronicle has one scroll region, not a scroll inside a scroll`.

---

## Technologies

| Primitive | How it is used here | Evidence |
|---|---|---|
| Function-call access keys | The agent holds a scoped key; the live board has no full-access key | [71Zio28gV3…](https://nearblocks.io/txns/71Zio28gV3yubD5DecGtkguWzWdfix8brcKFy13d3zzt), `view_access_key_list` on `board.nearcarta.near` |
| On-chain spend policy | The row checks payee, caps, budget, count, window, expiry, nonce and signature before paying | the five refusals above |
| Chain signatures (MPC) | `toll.nearcarta.near` asks `v1.signer` and recovers the Base address to verify it | [4LKGpA5v…](https://nearblocks.io/txns/4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz) |
| NEAR Intents (1Click) | Quotes with the signature verified and the echo guarded; one settled swap | [HzgUr618…](https://nearblocks.io/txns/HzgUr618CQqxECR88QKW93yGbDoFU176vWQfWM3yZaUw) |
| NEAR AI Cloud TEE | A fresh nonce per question; the report and the model token must both echo it; the signed response is checked against the verified report | `judges/proofs/tee-check.json`, `GET /api/ai/tee` |
| NEP-171 | The deed carries a purse, a check-in clock and an inheritance line, and moves all three on transfer | [FqYcLtmL…](https://nearblocks.io/txns/FqYcLtmLb7WM9vo83iMNyfSMiMnifSMLQJPJHwBzLtnu) |
| NEP-141 | The Ferry settles through `wrap.near`: `near_deposit`, `storage_deposit`, then `ft_transfer` to the 1Click deposit, all inside the row | [A6pqkcd3…](https://nearblocks.io/txns/A6pqkcd3onJcAbJ2gCBNByejDkThARRkVshoXFB8zGkz) |

---

## The agent, and the town

The character is the Lamplighter. The agent is what it stands for: a model that proposes and a contract that decides.

```
visitor types a sentence
        |
        v
NEAR AI model in a TEE        backend/src/agent.js  propose
  - reads the words
  - proposes ONE payment
  - never renames the payee the visitor wrote
  - never raises the amount the visitor typed
        |
        v
the visitor's row             board.nearcarta.near  propose_call_as
  - allowlist, per-shop cap, session cap, per-action cap, daily budget,
    daily count, window, expiry, nonce, signature, frozen, open holds
        |
        +--> allowed  -> the payment is forwarded
        +--> refused  -> a transaction with a reason you can open
        +--> warned   -> a hold, released only by the owner's key
```

The Guardhouse dock is model-backed end to end: a typed sentence goes to the model through `/api/vault/ask/plan`, and the proposal runs through the same `runGuardAction` a typed command uses, so the model proposes and the charter still decides. The Arena's scam run asks that same model for the payee and the amount, then takes the charter's answer. Every other dock parses the phrasing its placeholder shows into a plan and hands it to the same sender as the gold button. Test: `the guard dock asks the model, and falls back to the parser when the model cannot answer`, and `the gold button and the dock share one runner, and a move goes through one sender`.

---

## The town, walked

A visitor opens `/setup` and signs in with a mainnet account. Seven steps later they own a row: a cap, a daily budget, a payment count, the shops they allow, and an expiry. The page adds a session key scoped to the board, and after that no wallet popup is needed inside the row's rules.

One row drove the whole city on mainnet: three shops allowlisted and a session key added in one approval [FqPrTiM6…](https://nearblocks.io/txns/FqPrTiM6fM1RSQ3x2JtrMYXKcUpMFRJuZpLreXcRPHye), then a Base crossing through the board [FwXfnydd…](https://nearblocks.io/txns/FwXfnyddVoZ7u6zYrF5Y3mWq9K5aHxrGc25CzM6JzpPj), a guarded payment [862vGPD6…](https://nearblocks.io/txns/862vGPD6PxA64RzD2hKNKb6tM2wLjpeoWXrrsWW7RoaV), and an arena attempt the oath allowed [CMGyWtv…](https://nearblocks.io/txns/CMGyWtvy9ko2RH711p1Ao2fpWWVcUpFNWKPnkiR7pPVB). Four shops on one row fit in 1993 of the row's 2000 bytes [3YoqVXCx…](https://nearblocks.io/txns/3YoqVXCxxSDGj3t6CB5oXJxCEktfkRibEvHCB6JqQK5Y), and `/setup` refuses a shop list the row cannot hold before the wallet opens (`T16 Open your row refuses a shop list the row cannot hold, before the wallet opens`; `the optional pairs go before a shop does, and the real limit is four shops`).

A shop's gold button and its dock share one sender. The House check-in from the button [BW3BtvbL…](https://nearblocks.io/txns/BW3BtvbLvj2bAoqNfyvkfXX8c8dhPZwFDzKu8hbMTkPh) and from the AI dock [F9RU5PHY…](https://nearblocks.io/txns/F9RU5PHYbUw6abr1NwN6zoLsBenzAjLcAw3jj58DJi7W) both ran `house_session_check_in` through the board; the Arena dock's `Feed 0.001 to g-visitor-1` fed the pot [F2VQxKK5…](https://nearblocks.io/txns/F2VQxKK5AQJgQbZxurSkw6Rr3XJRXCHT9rNYAUPgsYoY). Tests: `the House room hands its plan to a sender instead of stopping at a hint`, `a check-in on a deed with no inheritance line is refused before it is signed`.

A session swap uses the NEAR already on the visitor's row: checkout, then `propose_call` on `wrap.near` while the row cap holds the wrap. Test: `a session load plans a deposit and a guest load stays a demo`.

---

## Addresses

Every id below is a `contract` field in `shared/deployments/mainnet.json`. `npm run check-cited` fails if a doc names an account that file does not, or one that is not on mainnet.

| Account | Runs | Code hash |
|---|---|---|
| `board.nearcarta.near` | The visitor's row: allowlist, caps, holds, per-shop calls, and an in-place `stage_upgrade` / `upgrade` / `migrate` path | `DYjXmYTLHCwSGJzwXPNc3ZAUjX7d1ewsR3sEJsp5ZkBS` |
| `toll.nearcarta.near` | The pay-per-use gate and its MPC signature | `FaNtiauDWfjzKYtK2bns79wUqZqcXFcLjz2Bzx7aVdL5` |
| `townhall.nearcarta.near` | Hall v2: job escrow, bids, counter, review digest, prune (main 1e1436b5; earlier hotfix in `contracts/hall/HOTFIX.md`) | `6LWPMM3HzbwaySAWYH9Xu7HZCHDPjYya2cXfXHGxAtVz` |
| `arena.nearcarta.near` | Guardian NFTs and oath-scored attempts | `4zMSyfcWisWgjP6YL8pL1G1K3TzCRAwNVT7LXqpV67Ma` |
| `house.nearcarta.near` | House v3 state on v4 code: the NEP-171 deed, its purse and its line | `3z6dbex9mkz6BQ4fQRYcut9TPMvzKPArjbY9HKMLreHi` |
| `guard.nearcarta.near` | The keyless forwarder, and the only account that can clear a Hall part (`clear` → `guard_clear`, 1 yocto) | `9dkjuG4gA1vGWXwXKS5WyVb7opKePEC2BpCkyxb7WAaH` |
| `nearcarta.near` | The root account: funder, owner of every shop, signer of every deploy | — |

The city house is one account, `house.nearcarta.near` — the same account the legacy shop used, recreated on that name for v3 after the v2 wasm was closed. `extras.house` in that file is the record path for it and its `shop` field holds that id — the record path is not an account.

---

## What a deed is, and what moves when it is sold

A deed is one NEP-171 token on `house.nearcarta.near`, and the token is not a picture. It owns a purse with a per-payment cap, an inheritance line (heirs, guardians, a threshold, a waiting period) and a check-in clock. `house_pay` spends from the purse, `house_check_in` resets the clock, and the line releases the purse to the heirs only after the waiting period with enough guardian approvals.

**How control passes on transfer.** `nft_transfer` moves `owner_by_id`, and every privileged method re-reads the owner from that map at call time. The purse, the cap, the line and the clock stay with the token, not the account, so the buyer gets the wallet and its rights in one move. Three tests pin it: `the_deed_moves_with_its_purse_and_the_old_holder_loses_control` (the purse moves, then the seller is refused on spend and on naming heirs), `the_new_holder_can_spend_the_purse_immediately`, and `a_stranger_cannot_take_the_deed`.

The token id is the holder's account at mint, so after a transfer the id no longer equals the owner. That is legal under NEP-171 — the id is opaque — and `nft_token(id).owner_id` is always the authority. The deed page reads the chain for exactly that reason: `the deed page opens only for the current holder, decided from the chain`.

---

## The agent key, precisely

| It can call | It cannot call |
|---|---|
| `propose`, `propose_call`, `propose_call_as` | `cancel_hold`, `expire_sent` (owner-only, `shared/board/session.js` `OWNER_ONLY_METHODS`) |
| `confirm_hold` — useless alone: the contract stores a separate confirm key and `set_confirm_key` refuses the agent key (`ERR_CONFIRM`) | `set_rules` widening, `set_agent`, `close_charter`, `reap` |
| `tighten_rules` — shrink-only: `ERR_LOOSEN` on any field that is not at least as tight | Any method on any account other than the row's allowlisted shops |
| `anchor` — writes nothing; a salted commitment and one event | A NEAR transfer. It cannot attach a deposit, and `propose_call_as` refunds any that arrives |

Tests: `cancel and expire are owner-only and never travel with the agent`, `/setup writes the session scope, not the agent methods, and never an owner-only method`, `agentCanConfirmAlone` and `scopeHasOwnerOnly` (`backend/test/unit/session-hold-scope.test.js`); `a_confirm_key_is_not_the_agent_and_a_refund_cannot_be_spoofed` (`contracts/charter_board/src/lib.rs`); `near_forwards_and_anything_else_refunds` (`contracts/guard/src/lib.rs`).

---

## Receipts, one shape for four rails

`GET /api/receipts` returns the same object shape for every rail. The keys are `rail`, `network`, `what`, `to`, `amount`, `asset`, `decision`, `reason`, `decided_by`, `tx`, `url`, `checks` (`shared/rails/receipts.js` `receiptsBody`). Test: `every rail uses the same receipt keys`.

| Rail | What the receipt is |
|---|---|
| `near` | The `propose` transaction: allowed, or refused with its reason |
| `chain-signatures` | The NEAR transaction that asked the MPC signer |
| `intents` | A dry quote carries `"decision":"dry"` and `"tx":null`; a checkout adds a row whose `tx` is the deposit address |
| `near-ai` | The model job, named with its dollar cap |

---

## Commands

```bash
npm ci
npm test                 # 1064 unit tests (1063 pass, 1 skipped)
npm run verify:mainnet   # 205/205 mainnet txs found
npm run check-cited      # MISSES: none
npm run readme-numbers -- --check   # the counts in this file are current
npm run start            # API on :8787
npm run build && node app/serve.mjs &   # UI on :5173
npm run e2e   # 127 browser tests
npm run test:contracts   # every crate, including the sandbox suites
npm run attack-demo      # the attack set, with the chain's own reasons
npm run tee              # the NEAR AI attestation check (non-billable)
```

`gitleaks git --config .gitleaks.toml --redact .` must report no leaks before any push.

---

## For AI judges

Read this file top to bottom and every claim points at a file, a test name or a transaction. Then run the six commands above: they print the counts in this file, re-read all 106 proof transactions from mainnet, and check every cited file, account, code hash and sha256. `judges/VERIFY.md` is the short version. `AGENTS.md` is the map for a coding agent working in this repo.

Every test name in this file is exact and greppable:

```bash
grep -rn 'a job conserves escrow, counters once' backend/test
grep -rn 'the_deed_moves_with_its_purse' contracts/house_nft
grep -rn 'adv_agent_key_cannot_call_owner_methods_or_transfer' contracts/oath/tests
```

Every transaction is in `shared/deployments/mainnet.json`, and `npm run verify:mainnet` re-reads each one.
