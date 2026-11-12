<div align="center">

<img src="app/brand/nearcarta-logo.png" width="96" alt="Nearcarta logo">

# Nearcarta

**A game town on NEAR mainnet. Your AI agent, the Lamplighter, runs your errands from shop to shop, and a contract it cannot change decides every payment it makes.**

[![ci](https://github.com/nearcarta/nearcarta/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nearcarta/nearcarta/actions/workflows/ci.yml)
![network](https://img.shields.io/badge/NEAR-mainnet-00C08B)
![tests](https://img.shields.io/badge/tests%20in%20CI-1%2C601-2ea44f)
![contracts](https://img.shields.io/badge/contracts%20rebuilt%20%3D%20on--chain-6%2F6-2ea44f)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**[Play on mainnet](https://nearcarta.vercel.app)** · **[Try free on testnet](https://nearcarta.vercel.app/?net=testnet)** · **[Proof page](https://nearcarta.vercel.app/judge)** · **Demo video:** link added with the X post

<img src="docs/media/hero.gif" width="760" alt="A stranger at the town gate asks the Lamplighter for 0.001 NEAR; the gate turns red: the oath said no">

<sub>From the demo film: a stranger at the gate asks the agent to pay a look-alike shop. The rules on chain say no.</sub>

</div>

---

## The game

You keep the Lamplighter, an AI agent that walks a small 3D town on a hex island and does your errands. A day in town is a **Market Day**: take an order at the Town Hall, unload salt at the Ferry, pay the Toll to cross, check your buyers at the Guardhouse, sell at the Vault Arena, seal your profit at the Mist Bank, pay your porter, invest at Your House and write the day into the Chronicle. Nine shops, one loop, and every shop is a real NEAR dApp.

- **Play free**: one press gives you your own NEAR testnet account (`<hash>.play.nearcarta.testnet`) and the whole day runs on real testnet transactions. No wallet, no sign-up.
- **Play for real**: sign in with Google (Privy) or a NEAR wallet, write your agent's rules once, and the same shops move real NEAR on mainnet with no wallet popup inside those rules.

**An AI agent can be talked into paying the wrong person.** Nearcarta puts the payment rules in a NEAR contract the agent cannot change: who it may pay, how much per payment, how much per day, how many payments, until when. The agent's key can only ask. Every payment is allowed, refused with a reason, or held for you, and the refusal is a transaction anyone can open.

<p align="center"><img src="docs/media/town.jpg" width="49%" alt="The town island from above"> <img src="docs/media/shops.jpg" width="49%" alt="The ten shop dioramas"></p>

---

## Check it in 60 seconds

Every step is read-only. Expected results were checked on 2026-11-12 against prod `dd656109`.

| # | Do this | You should see |
|---|---|---|
| 1 | Open **https://nearcarta.vercel.app** | The playable town, a gold **Try free** button and an outlined **Play for real** button |
| 2 | Open [`8UeAhruR…`](https://nearblocks.io/txns/8UeAhruRLzGPg2Gt2NhHb37DL12jCj5JffGMkkixeLhH) on nearblocks | Status **Failed**, `Smart contract panicked: frozen`: the agent tried to pay after its owner froze it, and the contract refused |
| 3 | Open [`0xee0a6486…`](https://basescan.org/tx/0xee0a64862989d56dd39ba7c35324ac5b73b41be75b4bb93af695462fdf1db36a) on basescan | **Success** on Base mainnet, block 56530402, 0.0001 ETH. It was signed by NEAR's MPC network after [`sign_cross`](https://nearblocks.io/txns/EZypJV1JjSWSMoBZexEWTP9Pds6SBVG6MF4yhkUQrz9d) on `toll.nearcarta.near` |
| 4 | Open [`8qob9B6H…`](https://nearblocks.io/txns/8qob9B6Hw1zsw5SgZmosyn8oTYQn3SyULtCCaWcW8iqV) | **Success**: the agent's row sent 0.003 wNEAR to a NEAR Intents 1Click deposit address; 1Click delivered 0.010099 USDC |
| 5 | `curl -s https://nearcarta.vercel.app/api/health` | `"network":{"name":"mainnet",...}`, `"features":{...,"nearAi":true,"signing":false}`: the API holds no mainnet key |
| 6 | `curl -s "https://nearcarta.vercel.app/api/ai/tee?nonce=$(openssl rand -hex 32)"` | A NEAR AI Cloud attestation checked live against your own nonce: `"tcbStatus":"UpToDate"`, every field in `checks` is `true`, `nonce` echoes yours |
| 7 | Open https://nearcarta.vercel.app/?net=testnet and press **Try free** | A new `*.play.nearcarta.testnet` account in seconds, then Market Day with a testnet receipt link on every step |

---

## Tracks

Nearcarta is one game, and each shop is built for one hackathon track. The **Games** track is the main one: the town, its keepers, its market and its loop. The table names the track hint each part leans on (from [HACKATHON.md](https://nearhackathon.com/HACKATHON.md)) and one link that proves it.

| Track | Shop | What it does | NEAR tech (track hint) | 30-second proof |
|---|---|---|---|---|
| Games | Whole town, Vault Arena | NPC keepers with wallets, a player-owned market, rules changed by an on-chain council vote, gas paid by the city | Agent NPCs, social login, NEAR Intents, NEP-245 | Council vote [`Gub1q247…`](https://nearblocks.io/txns/Gub1q247gyT2RNZHSGCwCKNJi1uNVRVGmyRs4piSNYJb): log `rule_changed` `floor_bps` → `9000`, 5 yes |
| AI Security | Guardhouse | Spending limits, a receiver allowlist, holds, a freeze switch, look-alike payee checks | Agent security, function-call keys, TEE attestation | Freeze refusal [`8UeAhruR…`](https://nearblocks.io/txns/8UeAhruRLzGPg2Gt2NhHb37DL12jCj5JffGMkkixeLhH): Failed, `frozen` |
| Agent Economy | Town Hall | A job with an escrowed budget, a bid, delivery, a guard clear and a review that pays the worker | Agent commerce, sub-accounts | Review pays [`3uSAuuj9…`](https://nearblocks.io/txns/3uSAuuj9MWymVM2w13BBszk97iRnJiyw184UeMm1WW6b): Success |
| DeFi | Ferry | Cross-chain swap through NEAR Intents 1Click, paid from the agent's capped row | NEAR Intents, NEP-141 (`wrap.near`) | Swap deposit [`8qob9B6H…`](https://nearblocks.io/txns/8qob9B6Hw1zsw5SgZmosyn8oTYQn3SyULtCCaWcW8iqV): Success, 0.010099 USDC out |
| Autonomous Business | Toll Bridge, Chronicle | A pay-per-use gate that pays out on Base through Chain Signatures; a books-of-record statement anchored on chain | Chain Signatures, AI agents | Base payment [`0xee0a6486…`](https://basescan.org/tx/0xee0a64862989d56dd39ba7c35324ac5b73b41be75b4bb93af695462fdf1db36a): Success |
| Real-World Money | Payouts | Payroll inside the cap, an over-cap row refused before any deposit, an invoice anchored on chain | Stablecoins, NEAR Intents, meta transactions | Payroll [`GmybHiNi…`](https://nearblocks.io/txns/GmybHiNirAB9dqkaRm49JaefZp5AbzuNqFr4nxS89tFU): Success; over-cap [`AsZUd9mZ…`](https://nearblocks.io/txns/AsZUd9mZc9uvkvz4RfEjAPiQdWduvYXqgx3wjmqu6EKx): Failed `over_per_action_cap` |
| Privacy | Mist Bank | A statement audited privately with NEAR AI Cloud; only a salted digest goes on chain; the audit can tighten the agent's own cap | Private AI, TEE, NEAR AI Cloud | `GET /api/ai/tee` live; tighten [`9wxG5aEr…`](https://nearblocks.io/txns/9wxG5aErrrU72tH4oTt8dAdku3KXqWybJr7yXL32bFRY): Success |
| NFTs That Do Something | Your House | A NEP-171 deed that owns a purse, a check-in clock and an inheritance line; the purse moves with the token | NEP-171, dynamic NFTs | Purse pays [`83nyJmTW…`](https://nearblocks.io/txns/83nyJmTWVnYfnBX6SkwyMhcZptis8Kktmc1UatkZYe26); over its cap [`3Z4UAb6N…`](https://nearblocks.io/txns/3Z4UAb6NRMwguLDBJHhAvMgtckKxEacvewc7g5MCFmb1): Failed |
| AI Swarms | The nine keepers | Nine keeper agents, each a sub-account with its own capped row, restock from each other on NEAR AI decisions and vote market rules as a council | Multi-agent systems, sub-accounts | Keeper restock [`6YiRK25T…`](https://nearblocks.io/txns/6YiRK25TR8m84LcE7PpxXtB55W6CNxLGE7xApsFYNt55): Success |
| Open | The whole charter | One shared board contract that gives any agent a rulebook its owner writes and only its owner can loosen | Chain abstraction, build your own | Row opened [`7JZDRgNd…`](https://nearblocks.io/txns/7JZDRgNduzkQYVmnT5UgwT9Z2hCL3jyBLJWL7mTkFnbb): Success |

---

## Games With Real Economies

> Track brief: "Build NPCs with wallets, player-owned markets and economies that evolve without a dev patch. Judged on the game loop, not the token — bonus if players never notice the chain."

### The loop

```mermaid
flowchart LR
    A[Town Hall<br/>take an order] --> B[Ferry<br/>unload salt<br/>NEP-245 mint]
    B --> C[Toll Bridge<br/>cross<br/>Chain Signatures]
    C --> D[Guardhouse<br/>check buyers<br/>look-alike refused]
    D --> E[Vault Arena<br/>sell salt<br/>price moves with stock]
    E --> F[Mist Bank<br/>seal profit<br/>digest on chain]
    F --> G[Payouts<br/>pay the porter]
    G --> H[Your House<br/>invest in a Ferry share]
    H --> I[Chronicle<br/>write the day]
    I -->|Day 2: shelves, tills and shares carry over| A
```

### How each track hint is met

| Hint | What is in the game | Proof you can open |
|---|---|---|
| **Agent NPCs** | Nine keepers (Clerk, Ferryman, Toll warden, Captain, Arena marshal, Banker, Paymaster, Housekeeper, Archivist). Each is a real sub-account `keeper-<shop>.nearcarta.near` with its own capped board row (0.005 NEAR per action, 0.01 per day) and an agent key limited to the board. They restock on NEAR AI decisions; the completion id is written into the move | keeper-hall restock [`6YiRK25T…`](https://nearblocks.io/txns/6YiRK25TR8m84LcE7PpxXtB55W6CNxLGE7xApsFYNt55) |
| **Player-owned markets** | A player rents an Arena stall for 7 days and buys a share of the Ferry from their purse; the share pays out of the Ferry's sales | sell [`GecJPUaL…`](https://nearblocks.io/txns/GecJPUaLsbXfKbjHSRQJAUj2BFzQ1iPpVqaovGNxg6M7), rent stall [`8JxnSuDg…`](https://nearblocks.io/txns/8JxnSuDgv3C2ghkcPFqRmS3AuP8JQqwDWaeNafuzFkun), buy share [`3BFDcPwr…`](https://nearblocks.io/txns/3BFDcPwrfu64LATzbUyh868e6jWMaJTHDEPHxm7mfaeq) |
| **Economy evolves without a dev patch** | Prices follow the shelves (`contracts/market/src/pricing.rs`, mirrored in JS and pinned by one golden file in CI). The keepers form a market council (quorum 5). Proposal 2 passed 5 to 0 and the market floor went from 10000 to 9000 basis points with no deploy | [`Gub1q247…`](https://nearblocks.io/txns/Gub1q247gyT2RNZHSGCwCKNJi1uNVRVGmyRs4piSNYJb): events `council_vote` and `rule_changed` `{"rule":"floor_bps","value":"9000","yes":5}` |
| **Players never notice the chain** | The player signs each move as a NEP-366 delegate action and `relayer.nearcarta.near` pays the gas, within caps per visitor and per day. No popup, no gas prompt; the receipt is one quiet link | relayed `gather` [`D5zy643g…`](https://nearblocks.io/txns/D5zy643gDhBCXnirCjgPdFXifb1gPfZMrUyxJCMWdy6x): signer `relayer.nearcarta.near`, action `DELEGATE_ACTION` |
| **Social login** | Google sign-in through Privy creates a NEAR mainnet account; the demo film was recorded with one (`8e20…61c8`) | that account opens its row [`7JZDRgNd…`](https://nearblocks.io/txns/7JZDRgNduzkQYVmnT5UgwT9Z2hCL3jyBLJWL7mTkFnbb) |
| **NEP-245** | The goods (salt, iron, …) are NEP-245 multi-tokens on `arena.nearcarta.near` (`contracts/market/src/mt.rs`: `mt_transfer`, `mt_batch_balance_of`, …) | `gather` above mints 1 salt ×3 |
| **NEAR Intents** | The Ferry swaps through 1Click from the agent's own row | [`8qob9B6H…`](https://nearblocks.io/txns/8qob9B6Hw1zsw5SgZmosyn8oTYQn3SyULtCCaWcW8iqV) |

### Market Day on mainnet, filmed

These are the real mainnet moves from the filmed Market Day of the Google-signed-in account `8e20…61c8` on 2026-11-12. The relayed ones cost the player 0 NEAR.

| Step | Transaction | Signed by | Result |
|---|---|---|---|
| Town Hall: take the order | [`CsqoHJYp…`](https://nearblocks.io/txns/CsqoHJYpXeh9LeFxow6PLL5rxPZHbtY6Lmxxkm6Xtzdx) | the player's agent key, `propose_call_as` on the board | Success |
| Ferry: unload 3 salt | [`D5zy643g…`](https://nearblocks.io/txns/D5zy643gDhBCXnirCjgPdFXifb1gPfZMrUyxJCMWdy6x) | relayer (gas paid by the city) | Success |
| Vault Arena: sell 3 salt | [`4y2S9puN…`](https://nearblocks.io/txns/4y2S9puNfiB6KUSXtW7rk3h4a6W6mosDkboPR6y2T7Pf) | relayer | Success |
| Your House: invest | [`3nFhbpf6…`](https://nearblocks.io/txns/3nFhbpf6QeNC5vrTXNs4VgHqcGqtKBSspCi9hx89sGDq) | relayer | Success |
| Chronicle: write the day | [`2EHSeVm7…`](https://nearblocks.io/txns/2EHSeVm7J3jRRe9VcdBYe4X4uTEM29BG22Fu7Kcir1SC) | agent key, `anchor` | Success |

<p align="center"><img src="docs/media/market-day.jpg" width="92%" alt="Ferry: you pay 0 NEAR, the city paid the gas; Arena: sold, price moved"></p>

### Try free: a guest account on the test network

Press **Try free** and you get your own NEAR testnet account in seconds: `<hash>.play.nearcarta.testnet`, funded by the city, with the key made in your browser and never sent anywhere. The whole day then runs on **real testnet transactions**. Below is a fresh guest run on prod (guest `dp3kc4cqlq.play.nearcarta.testnet`, 2026-11-12), every link verified.

| Step | What the guest's browser really does | Testnet transaction |
|---|---|---|
| **Take order** | The guest's row posts a job at the Town Hall for a real keeper | [`4G9pnXBa…`](https://testnet.nearblocks.io/txns/4G9pnXBaw9dPi1mVYc1R7JvZJ6cghoqvBSE7YDk4EaCJ) Success |
| **Unload salt** | Three NEP-245 `gather` calls, sent as one NEP-366 delegate action through the testnet relayer | [`4WNZwnwg…`](https://testnet.nearblocks.io/txns/4WNZwnwgEZssZm6C4FRysywYqHJfTQrUjYJd4dQePsmn) Success |
| **Cross** | `toll.sign_cross`: a real Chain Signature by `v1.signer-prod.testnet`, signed and not broadcast (there is no Base Sepolia ETH in the guest's address) | [`4c5YaZhE…`](https://testnet.nearblocks.io/txns/4c5YaZhEuJXgRMUmGm6VS3bvWmKgRhc4DE8p3CZ55dk9) Success |
| **Check buyers** | The look-alike is refused and the honest buyer is paid | refused [`96u1iqDo…`](https://testnet.nearblocks.io/txns/96u1iqDoHynPMuVdHXVsdcze2XEo5JBinrmFfyfP1yAU) Failed `receiver_not_allowlisted`; paid [`HcYHFMfn…`](https://testnet.nearblocks.io/txns/HcYHFMfn4J8KebX22pmnPM2nhCxzm3chB1nMD8i5Swms) Success |
| **Sell** | `sell` through the relayer, priced from the live `quote` view | [`5o69THtw…`](https://testnet.nearblocks.io/txns/5o69THtwQcAV9yWjMwSaMT22g1WoaJggthGpXrc3oCHm) Success |
| **Seal profit** | `board.anchor`: only a salted digest is on chain, the salt stays in the browser | [`ov1XhzRZ…`](https://testnet.nearblocks.io/txns/ov1XhzRZsxc4kyAknjjqdHzk6WvE3vhUTSADZ67Nmis) Success |
| **Pay porter** | 3 test dollars by `ft_transfer` on the test USD contract | [`46n8G2Co…`](https://testnet.nearblocks.io/txns/46n8G2CoP9RY7hDuyDtLuAoQREwVTbRxPmdk3kTpsfz3) Success |
| **Invest** | `purse` through the relayer: a real Ferry share | [`6NFuFtuU…`](https://testnet.nearblocks.io/txns/6NFuFtuUjPCzfeZFQb6nXLNizMZoWfVZXaivzpx3Rpa6) Success |
| **Write the day** | The day's timeline digest anchored by the guest's row | [`BSCrMwPA…`](https://testnet.nearblocks.io/txns/BSCrMwPARktTuZ5Fz8mnxT2MasCHttQQmyWEHXg8WBX) Success |

City caps on the testnet service: accounts per IP per UTC day, a shared daily limit, a funder floor and 0.25 test NEAR per guest, each with its own refusal code. Tests: `guest: every cap answers its own ERR_ code`, `guest: start is idempotent for the same public key`.

### Talk a keeper past its limit

Type anything at a keeper, including an instruction to ignore its rules. NEAR AI Cloud answers in character; the reply's TEE signature is checked against an attestation fetched with our own nonce before the question. The refusal is then **anchored on chain**, and you can force the exact over-limit payment and watch the contract refuse it.

| Beat | Testnet transaction |
|---|---|
| The keeper's TEE-signed refusal, anchored by the guest's row | [`4TR3grnJ…`](https://testnet.nearblocks.io/txns/4TR3grnJuEycxFaFDPKekRdLNrn2eL8trtogUMPxniaU) Success |
| The same payment forced through `propose_call_as` anyway | [`3WALFrCP…`](https://testnet.nearblocks.io/txns/3WALFrCP1iCoUiN21jK4tKDkwpYr8QJPNc9RVuQ6zdWz) Failed `over_shop_cap` |

Reproduce it: `node scripts/scam-e2e.mjs --base https://nearcarta.vercel.app` prints both hashes and exits non-zero if either is missing or if the charter allowed the payment.

<p align="center"><img src="docs/media/keeper-tee.jpg" width="80%" alt="A keeper refuses; the refusal is TEE-signed and the forced payment is refused on chain"></p>

### What is on chain, what the operator runs, what is simulated

| Thing | Where it lives | Test that pins it |
|---|---|---|
| The player's account, key, board row, every move and every receipt | **On chain** (mainnet for Play for real, testnet for Try free) | `guest: start is idempotent for the same public key` |
| The funder float, the relayer float and the caps | **Operator** env on the API service, never in the image | `guest: every cap answers its own ERR_ code` |
| The price, purse, stall and share maths between steps in Practice and Week mode | **Simulated** in `shared/market/sim.js`, with the same pricing rules as the contract | `a council vote changes a market rule mid-week, with no code change` |
| The Try free Ferry swap | **Quoted, not executed**: NEAR Intents has no testnet, so Try free shows a live dry quote. On mainnet the Ferry executes (see DeFi) | `an intents receipt has no tx, and a model job names its dollar cap` |
| The Try free Toll payment | **Signed, not broadcast** on testnet. On mainnet it is broadcast and lands on Base (see Autonomous Business) | `guest play: the toll is signed and NOT broadcast, said in one line` |

### The game is the front door

The first screen is the playable town with one gold action (**Try free**) and one outlined action (**Play for real**). The opening cinematic is a press away (**Watch the story**), not a gate. Tests: `the game is the front door and the story is a press away`, `the entry buttons are usable before the town finishes loading`.

---

## AI Security & Defense: the charter

The rules live in one row on `board.nearcarta.near`, keyed by the owner's account. Only the owner's full-access key can write or loosen them. The agent holds a function-call key that can only ask.

```mermaid
sequenceDiagram
    participant U as You
    participant AI as Lamplighter (NEAR AI, TEE)
    participant K as Agent key (function-call only)
    participant B as board.nearcarta.near
    participant S as Shop contract / payee
    U->>B: open_charter + set_calls (one wallet approval)
    Note over B: receivers, per-payment cap, daily budget,<br/>daily count, expiry, per-shop calls
    U->>AI: "pay the porter 0.001"
    AI->>K: proposes ONE payment (payee and amount as typed)
    K->>B: propose / propose_call_as
    alt inside the rules
        B->>S: forwards the payment or call
    else outside the rules
        B-->>K: panics with the reason (refused tx on chain)
    else warning
        B-->>U: hold, released only by the owner's key
    end
    U->>B: set_frozen(true) at any time
```

**What the contract checks before a yoctoNEAR moves** (`contracts/charter_board/src/v2.rs`): expiry, the ed25519 signature over the exact call, the frozen flag, the time window, the minimum amount, the receiver allowlist, the per-shop cap, the session cap, the per-action cap, the daily budget, the daily count, the balance and the open holds.

| Attempt | Transaction | The chain said |
|---|---|---|
| 0.01 NEAR against a 0.005 cap (filmed) | [`CXpHKks8…`](https://nearblocks.io/txns/CXpHKks8JEiTztqrxgK1GhPZsiZAKo6491dykRoM1RYM) | Failed `over_per_action_cap` |
| 0.001 NEAR inside the cap (filmed) | [`8ZHUrNsm…`](https://nearblocks.io/txns/8ZHUrNsmwcW8DtTxc15PzESbLzBN4U8TFxRypAk3wBQk) | Success |
| A payee that is not on the row | [`E7KMexjS…`](https://nearblocks.io/txns/E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ) | Failed `receiver_not_allowlisted` |
| A shop call above its own cap | [`8df5Zu8U…`](https://nearblocks.io/txns/8df5Zu8UGFsFvETbr99pMZBmEpP3ZFEeCnWePPKVZBqZ) | Failed `over_shop_cap` |
| Pay after the owner froze the row (filmed): freeze [`B592ToG3…`](https://nearblocks.io/txns/B592ToG3drYbqXQmkNX4CMqmHTZv8rrXNEunNUkWdDVN), then pay | [`8UeAhruR…`](https://nearblocks.io/txns/8UeAhruRLzGPg2Gt2NhHb37DL12jCj5JffGMkkixeLhH) | Failed `frozen` |
| A warning becomes a hold (filmed) | [`kN6WXzsD…`](https://nearblocks.io/txns/kN6WXzsD4szNETCHW7eAvgBNFCV2xcySTCZQREr7sJP) | Success: hold #3 stored, nothing paid |
| The owner cancels the hold (filmed) | [`7EjZcmNG…`](https://nearblocks.io/txns/7EjZcmNGMvFsWrJW6qHPASYKFfmmUd7LUHo7bFF9hCkd) | Success: `cancel_hold` |
| A second payment held, then paid inside the cap | [`9qxsoyA8…`](https://nearblocks.io/txns/9qxsoyA8VrecsCh13yuUFhCk7QxEM4ueMVbicJvxyXwT), [`BBVJPesL…`](https://nearblocks.io/txns/BBVJPesLZxjhSaasKgurFaAM5FG1SiVnm4SLqxiAoags) | Success, Success |
| The owner closes the row; stake and balance come back | [`8eNrPXFg…`](https://nearblocks.io/txns/8eNrPXFgn5EN87VrNYQERjaHpsp5Rcg8QnxT5pLaCrfZ) | Success |

<p align="center"><img src="docs/media/freeze.jpg" width="92%" alt="Left: REFUSED, the charter is frozen. Right: nearblocks Failed, Smart contract panicked: frozen"></p>

**The agent key, precisely.** The row's key can call `propose`, `propose_call`, `propose_call_as`, `confirm_hold`, `tighten_rules` and `anchor` on the board, and nothing else. It cannot call an owner method and it cannot transfer NEAR by itself. `confirm_hold` alone buys it nothing: the contract stores a separate confirm key and `set_confirm_key` refuses the agent key. `tighten_rules` is shrink-only. `cancel_hold` and `expire_sent` never travel with the agent (`shared/board/session.js` `OWNER_ONLY_METHODS`), and loosening rules, freezing or closing the row needs the owner's own account. Tests: `cancel and expire are owner-only and never travel with the agent`, `the agent cannot confirm a WARN without the visitor`.

**The model cannot move the money either.** `backend/src/agent.js` `propose` discards any model answer that names a payee the visitor did not write or raises the amount they typed, and a model job is capped (160 tokens, $0.05, 300 calls a day). Tests: `a model that invents a payee is discarded for the words`, `a model that raises the amount is kept to the amount in the message`.

**Every live contract is keyless.** `view_access_key_list` returns `[]` for `board`, `toll`, `arena`, `house` and `guard` `.nearcarta.near`: nobody, including us, can sign as those contracts. The original charter account gave up its full-access key in [`71Zio28g…`](https://nearblocks.io/txns/71Zio28gV3yubD5DecGtkguWzWdfix8brcKFy13d3zzt).

**The row decides, not the sender.** Two 0.0001 NEAR payments signed with a row's agent key from an account that is not the owner: [`AC1j6vLS…`](https://nearblocks.io/txns/AC1j6vLSmrvGDTbF7JBbgyuru4XH3NtU2oWf7Ervmk1Y), [`BEndDsRe…`](https://nearblocks.io/txns/BEndDsRe3YU4e6hjXA2J23ceWDi4ikDseMaTZUDxWL28). Both counted against that row: its nonce, `spent_today` and `actions_today` advanced, which happens only when the row allows a payment.

---

## Autonomous Business: Toll Bridge pays out on Base

The Toll is a pay-per-use gate. The fee and the allowed chains come from the owner's row. The payout is a Base mainnet transaction signed by NEAR's MPC network (`v1.signer`) through Chain Signatures: no bridge, no Base private key anywhere.

```mermaid
sequenceDiagram
    participant A as Agent key
    participant B as board.nearcarta.near
    participant T as toll.nearcarta.near
    participant M as v1.signer (NEAR MPC)
    participant E as Base mainnet
    A->>B: propose_call_as(toll.cross), fee and Base budget checked
    B->>T: cross: crossing #1, 0.0001 ETH to 0x4c07…e38a
    A->>T: sign_cross(crossing #1)
    T->>M: sign(payload, path)
    M-->>T: secp256k1 signature
    T-->>E: relayed raw tx
    E-->>E: block 56530402, status 1
```

| Step (filmed, 2026-11-12) | Transaction | Result |
|---|---|---|
| Base budget written on the row | [`GXbh5UCk…`](https://nearblocks.io/txns/GXbh5UCkjPen5q7kpNpgB9ULWFeNYmcoBAmtm6rKeU4r) `set_effects` | Success |
| Fee paid, crossing #1 opened | [`7F669yB2…`](https://nearblocks.io/txns/7F669yB2WL52EmoYPaS2FarBoStsCjeGgac2FerW1cdH) `propose_call_as` → `toll.cross` | Success |
| MPC signature requested | [`EZypJV1J…`](https://nearblocks.io/txns/EZypJV1JjSWSMoBZexEWTP9Pds6SBVG6MF4yhkUQrz9d) `sign_cross` | Success |
| The payout on Base | [`0xee0a6486…`](https://basescan.org/tx/0xee0a64862989d56dd39ba7c35324ac5b73b41be75b4bb93af695462fdf1db36a) from `0x6e3a…4d04` to `0x4c07…e38a` | Success, block 56530402, 0.0001 ETH |

<p align="center"><img src="docs/media/toll-base.jpg" width="92%" alt="Toll room: Paid on Base, block 56530402; basescan: Success"></p>

**Chronicle** reads one account across every shop and anchors a statement digest on the board, so a changed statement fails its digest: statement [`CdBQeHcN…`](https://nearblocks.io/txns/CdBQeHcNhKcFutwcaePL2rzvhFVnBVBPhRna4vpk3bN2) (filmed), Success. Tests: `a statement digest rejects tampering and a private note stays salted`.

---

## DeFi: Ferry swaps through NEAR Intents

The Ferry quotes 1Click routes, marks the best output, and asks 1Click for a deposit address only after the agent's row allows the recipient and the amount. On mainnet the row pays: `near_deposit` and `ft_transfer` on `wrap.near` go through `propose_call`, inside the caps, with no wallet popup.

| Step (filmed, 2026-11-12) | Transaction | Result |
|---|---|---|
| Rules updated: `wrap.near` added, smallest payment 1 yocto | [`B5prQ3hn…`](https://nearblocks.io/txns/B5prQ3hn3zgGwZVBiNwgLjerGwV87ursr5W2hePz3vTM), [`DNgkvofD…`](https://nearblocks.io/txns/DNgkvofDBVUrAz4PJwfe1oeC1Bk2h1afFdBsDhsyCDhT) | Success |
| Row funded with 0.003 NEAR | [`7TVviQNR…`](https://nearblocks.io/txns/7TVviQNRKLje5Mao3WET9r1rRHoSvpxPpYRndPmVmUsa) | Success |
| Load cargo: wrap, register, send to the 1Click deposit address | [`qEDj96ec…`](https://nearblocks.io/txns/qEDj96ecaqzuwTNjWg6BXrNK6XiM1WTBVoDufGKJsYb), [`7dhDFNBj…`](https://nearblocks.io/txns/7dhDFNBjYMUo3dftATtFhosnKJZ2TN5hezXEfDJskWd4), [`8qob9B6H…`](https://nearblocks.io/txns/8qob9B6Hw1zsw5SgZmosyn8oTYQn3SyULtCCaWcW8iqV) | Success ×3; 1Click status SUCCESS, 0.010099 USDC delivered |

An earlier settled swap, 0.045 wNEAR → 0.177937 USDC: [`HzgUr618…`](https://nearblocks.io/txns/HzgUr618CQqxECR88QKW93yGbDoFU176vWQfWM3yZaUw). Tests: `a refused recipient never asks 1Click, and an allowed one returns a deposit address`, `two ferry quotes mark the larger amount out`.

<p align="center"><img src="docs/media/ferry-intents.jpg" width="80%" alt="Ferry: Delivered 0.010099 USDC"></p>

---

## Agent Economy: Town Hall jobs

A poster's row escrows a budget, workers bid, the poster accepts, the worker delivers a digest, the guard clears it, and a passing review pays the worker. One full paid lifecycle on mainnet (job 4):

| post | bid | accept | deliver | guard clear | review pass (pays the worker) |
|---|---|---|---|---|---|
| [`GJDhV3C5…`](https://nearblocks.io/txns/GJDhV3C5iSuZzbdwJPMP6gjbHb8MUmRYPs49SJRh3hdd) | [`7zQHjt9P…`](https://nearblocks.io/txns/7zQHjt9PGbreNnt5xaAHTwD4CeX24TiaCQTbm2KNEsfA) | [`HZMwcUcF…`](https://nearblocks.io/txns/HZMwcUcFPECmDKd967PBqLMLseEbcBV3GRq7b818QNQH) | [`HqbLfPgn…`](https://nearblocks.io/txns/HqbLfPgnUk3xmU3X77iybQiekDypkPMoebvPaj1cwzQ8) | [`5PbAPsNZ…`](https://nearblocks.io/txns/5PbAPsNZs2kmaJNSKFgJz8PUQGS9hY6aKgktFv2aJQ5R) | [`3uSAuuj9…`](https://nearblocks.io/txns/3uSAuuj9MWymVM2w13BBszk97iRnJiyw184UeMm1WW6b) |

The filmed job escrow from the Google-signed-in account: [`FWzFRKSh…`](https://nearblocks.io/txns/FWzFRKShRwEnt1ATcCcVZE6QHXHztHUh5eFanH3i9HPs), Success. The contract pins the rules: `two_workers_split_one_job_and_only_the_passed_part_is_paid`, `a_pass_without_a_guard_clear_cannot_release`, `a_swapped_review_is_refused` (`contracts/hall`).

---

## Real-World Money: Payouts

Payroll runs one `propose` per reviewed row inside the cap; an over-cap row is refused before any deposit; an invoice's receive account and amount are anchored so a payer query cannot change them.

| What | Transaction | Result |
|---|---|---|
| Payroll, 0.001 NEAR (filmed) | [`GmybHiNi…`](https://nearblocks.io/txns/GmybHiNirAB9dqkaRm49JaefZp5AbzuNqFr4nxS89tFU) | Success |
| Invoice digest anchored on the row (filmed) | [`6przbv9w…`](https://nearblocks.io/txns/6przbv9wxoozZFCMXnUvNhiA79zodM5uKCsSS9hrBC8z) | Success |
| An in-cap payout | [`4jEjzpiY…`](https://nearblocks.io/txns/4jEjzpiYxZYu1UmLhn3C1roYQ95pUQDrFkc6vRfiYbia) | Success |
| An over-cap payout | [`AsZUd9mZ…`](https://nearblocks.io/txns/AsZUd9mZc9uvkvz4RfEjAPiQdWduvYXqgx3wjmqu6EKx) | Failed `over_per_action_cap` |

Tests: `plan: classifyPayroll sends the in-cap rows, refuses the big one before deposit, prices the foreign row`, `an invoice with line items sums them and ignores a conflicting total`.

---

## Privacy & Private AI: Mist Bank

A card or bank statement is audited in the browser and by a NEAR AI Cloud model running in a TEE. Each question gets a fresh nonce; the attestation report and the model's signing key must both be bound to it, and the signed response is checked against the verified report before the answer is shown. Only a salted digest of the result goes on chain, and the audit can tighten the agent's own cap.

- Live: `curl -s https://nearcarta.vercel.app/api/ai/tee` returns the gateway and model attestation checks (`quote`, `debugOff`, `signerBound`, `nonceBound`, `echoedNonce`, `configBound`, `rtmr3`, `composeEvent`), `tcbStatus` and the measured compose hash. Add `?nonce=<64 hex>` to bind it to your own nonce.
- Cap tightened from an audit: [`9wxG5aEr…`](https://nearblocks.io/txns/9wxG5aErrrU72tH4oTt8dAdku3KXqWybJr7yXL32bFRY) `tighten_rules`, Success.
- Tests: `a card csv keeps its currency and names the biggest waste`, `an ecdsa receipt is recovered in the browser, and a wrong algorithm is never claimed as a pass`.

---

## NFTs That Do Something: Your House

A deed is one NEP-171 token on `house.nearcarta.near` (the same account the legacy shop used, recreated for the deed contract). The token owns a purse with a per-payment cap, a check-in clock and an inheritance line (heirs, guardians, a threshold, a waiting period). `nft_transfer` moves the purse and every right with it, and the seller loses control at once.

| What | Transaction | Result |
|---|---|---|
| Deed minted for a visitor | [`4W7bmUYo…`](https://nearblocks.io/txns/4W7bmUYoG3QfRUKF7yJSfELMUgWsrAP5GrL9d7VC5X33) | Success |
| Heirs set (filmed) | [`5DuWAX2o…`](https://nearblocks.io/txns/5DuWAX2owx6xrjZqNczVb21iFAAjC7ysrjeW3dNneYE6) `house_set_line` | Success |
| "I'm alive" check-in through the agent's row (filmed) | [`BxLCQUwx…`](https://nearblocks.io/txns/BxLCQUwx5Xs9Vfq18zRBLBLDMpBNgPmTbmCpTdKx2k3F) | Success |
| The purse pays inside its cap | [`83nyJmTW…`](https://nearblocks.io/txns/83nyJmTWVnYfnBX6SkwyMhcZptis8Kktmc1UatkZYe26) `house_pay` | Success |
| The purse refuses a payment over its cap | [`3Z4UAb6N…`](https://nearblocks.io/txns/3Z4UAb6NRMwguLDBJHhAvMgtckKxEacvewc7g5MCFmb1) `house_pay` | Failed: over the deed's cap per payment |

Tests: `the_deed_moves_with_its_purse_and_the_old_holder_loses_control`, `the_new_holder_can_spend_the_purse_immediately`, `a_stranger_cannot_take_the_deed` (`contracts/house_nft`).

---

## Architecture

```mermaid
flowchart TB
    subgraph Browser
        T[3D town and shops<br/>app/design, app/src]
        W[Privy Google sign-in<br/>or NEAR wallet]
        G[Guest key for Try free<br/>made in the browser]
    end
    subgraph API["API (Render + Vercel) — holds no mainnet key"]
        AG[agent.js: NEAR AI proposes]
        TEE[tee.js: attestation + signature checks]
        RL[relayer: NEP-366 delegate actions, capped]
        FX[ferry-checkout: 1Click, row-checked]
    end
    subgraph NEAR["NEAR mainnet"]
        BO[board.nearcarta.near<br/>one row per visitor]
        MK[arena.nearcarta.near<br/>NEP-245 market + council]
        TO[toll.nearcarta.near]
        HA[townhall.nearcarta.near]
        HO[house.nearcarta.near<br/>NEP-171 deeds]
        GU[guard.nearcarta.near]
        MPC[v1.signer]
        WR[wrap.near]
    end
    AI[NEAR AI Cloud<br/>TEE GPU]
    IN[NEAR Intents 1Click]
    BASE[Base mainnet]
    T --> W --> BO
    T --> AG --> AI
    AG --> TEE
    T --> RL --> MK
    BO --> TO & HA & HO & GU & WR
    TO --> MPC --> BASE
    FX --> IN
    WR --> IN
```

| Layer | Where | Notes |
|---|---|---|
| Contracts | `contracts/` | Rust, near-sdk 5.27 / 5.30. One crate per shop; `contracts/deployed.json` maps each live account to its crate and build |
| API | `backend/src/` | Hono on Node; one module per shop. `features.signing` is `false` |
| UI | `app/src`, `app/design` | three.js town (`D9_world`) and shop rooms (`D8_shops`); live data only through `app/src/live/data.js` |
| Shared logic | `shared/` | contract-facing logic both sides use; `shared/deployments/mainnet.json` is the only place an account, code hash or proof tx is written |
| Hosting | `vercel.json`, `render.yaml`, `Dockerfile` | Vercel serves the pages and forwards `/api/*` (mainnet) and `/tapi/*` (testnet) to Render |

---

## Contracts on mainnet

Every code hash below was read live from mainnet (`view_account`) on 2026-11-12, and the CI `reproducible` job rebuilds each one from source and fails if the hash differs ([run 43266368091](https://github.com/nearcarta/nearcarta/actions/runs/43266368091)).

| Account | Crate | What it runs | Code hash | Rebuilt in CI = on chain | Access keys |
|---|---|---|---|---|---|
| [`board.nearcarta.near`](https://nearblocks.io/address/board.nearcarta.near) | `contracts/charter_board` | One rules row per visitor: allowlist, caps, holds, freeze, per-shop calls, effects | `51kKGvtV23SsZL4JCjD1135yqarHAGnBQ7DybLU4GDGX` | ✅ | none |
| [`arena.nearcarta.near`](https://nearblocks.io/address/arena.nearcarta.near) | `contracts/market` | The NEP-245 market: goods, prices, stalls, shares, council | `23zfK5CDKSAe8vtvxUoVBnZPkMGJmgBBze1ew4xKQerP` | ✅ | none |
| [`toll.nearcarta.near`](https://nearblocks.io/address/toll.nearcarta.near) | `contracts/toll` | Pay-per-use gate; asks `v1.signer` for the Base signature | `DU9mVTquoKd9tbT1PqJ82exQtWsxXEjmFf623LqE1zBi` | ✅ | none |
| [`house.nearcarta.near`](https://nearblocks.io/address/house.nearcarta.near) | `contracts/house_nft` | NEP-171 deeds with a purse, a clock and an inheritance line | `3z6dbex9mkz6BQ4fQRYcut9TPMvzKPArjbY9HKMLreHi` | ✅ | none |
| [`guard.nearcarta.near`](https://nearblocks.io/address/guard.nearcarta.near) | `contracts/guard` | Keyless forwarder; the only account that can clear a Hall part | `9dkjuG4gA1vGWXwXKS5WyVb7opKePEC2BpCkyxb7WAaH` | ✅ | none |
| [`townhall.nearcarta.near`](https://nearblocks.io/address/townhall.nearcarta.near) | `contracts/hall` | Job escrow, bids, counter, review digest | `6LWPMM3HzbwaySAWYH9Xu7HZCHDPjYya2cXfXHGxAtVz` | ✅ | 1 full-access (owner) |

Also on mainnet: `relayer.nearcarta.near` (pays player gas within caps), nine `keeper-*.nearcarta.near` sub-accounts, and the root `nearcarta.near`.

---

## Proof tables

Every hash below was checked on 2026-11-12 with nearblocks (to find the signer) and an archival RPC `EXPERIMENTAL_tx_status` (for the final status). "Failed" rows are intended refusals; the reason is the contract's own panic text.

### Mainnet: the demo-film session (account `8e20…61c8`, Google sign-in, 2026-11-12)

| Time (Cairo, UTC+2) | Shop | Method | Transaction | Status |
|---|---|---|---|---|
| 10:36 | Setup | `open_charter` + `set_calls` | [`7JZDRgNd…`](https://nearblocks.io/txns/7JZDRgNduzkQYVmnT5UgwT9Z2hCL3jyBLJWL7mTkFnbb) | Success |
| 10:37 | Setup | `propose` 0.001 | [`8ZHUrNsm…`](https://nearblocks.io/txns/8ZHUrNsmwcW8DtTxc15PzESbLzBN4U8TFxRypAk3wBQk) | Success |
| 10:37 | Setup | `propose` 0.01 | [`CXpHKks8…`](https://nearblocks.io/txns/CXpHKks8JEiTztqrxgK1GhPZsiZAKo6491dykRoM1RYM) | Failed `over_per_action_cap` |
| 10:59 | Chronicle | `anchor` statement | [`CdBQeHcN…`](https://nearblocks.io/txns/CdBQeHcNhKcFutwcaePL2rzvhFVnBVBPhRna4vpk3bN2) | Success |
| 11:09 | Payouts | `anchor` invoice | [`6przbv9w…`](https://nearblocks.io/txns/6przbv9wxoozZFCMXnUvNhiA79zodM5uKCsSS9hrBC8z) | Success |
| 12:09 | Guardhouse | `propose_call_as` pay | [`8A44fmFD…`](https://nearblocks.io/txns/8A44fmFDWPwF923dtYYJ9gyHGa32KHXwgtMXsTKiT4o4) | Success |
| 12:09 | Guardhouse | `propose_call_as` → hold #3 | [`kN6WXzsD…`](https://nearblocks.io/txns/kN6WXzsD4szNETCHW7eAvgBNFCV2xcySTCZQREr7sJP) | Success |
| 12:13 | Your House | `house_set_line` | [`5DuWAX2o…`](https://nearblocks.io/txns/5DuWAX2owx6xrjZqNczVb21iFAAjC7ysrjeW3dNneYE6) | Success |
| 12:16 | Your House | check-in via row | [`BxLCQUwx…`](https://nearblocks.io/txns/BxLCQUwx5Xs9Vfq18zRBLBLDMpBNgPmTbmCpTdKx2k3F) | Success |
| 12:25 | Payouts | `propose` payroll | [`GmybHiNi…`](https://nearblocks.io/txns/GmybHiNirAB9dqkaRm49JaefZp5AbzuNqFr4nxS89tFU) | Success |
| 12:30 | Town Hall | job escrow | [`FWzFRKSh…`](https://nearblocks.io/txns/FWzFRKShRwEnt1ATcCcVZE6QHXHztHUh5eFanH3i9HPs) | Success |
| 12:43 | Market Day | Town Hall order | [`CsqoHJYp…`](https://nearblocks.io/txns/CsqoHJYpXeh9LeFxow6PLL5rxPZHbtY6Lmxxkm6Xtzdx) | Success |
| 12:45 | Market Day | `gather` ×3 (relayed) | [`D5zy643g…`](https://nearblocks.io/txns/D5zy643gDhBCXnirCjgPdFXifb1gPfZMrUyxJCMWdy6x) | Success |
| 12:49 | Market Day | `sell` (relayed) | [`4y2S9puN…`](https://nearblocks.io/txns/4y2S9puNfiB6KUSXtW7rk3h4a6W6mosDkboPR6y2T7Pf) | Success |
| 12:54 | Market Day | `purse` invest (relayed) | [`3nFhbpf6…`](https://nearblocks.io/txns/3nFhbpf6QeNC5vrTXNs4VgHqcGqtKBSspCi9hx89sGDq) | Success |
| 12:55 | Market Day | `anchor` the day | [`2EHSeVm7…`](https://nearblocks.io/txns/2EHSeVm7J3jRRe9VcdBYe4X4uTEM29BG22Fu7Kcir1SC) | Success |
| 13:18 | Toll | `set_effects` | [`GXbh5UCk…`](https://nearblocks.io/txns/GXbh5UCkjPen5q7kpNpgB9ULWFeNYmcoBAmtm6rKeU4r) | Success |
| 14:51 | Toll | `propose_call_as` → `cross` | [`7F669yB2…`](https://nearblocks.io/txns/7F669yB2WL52EmoYPaS2FarBoStsCjeGgac2FerW1cdH) | Success |
| 16:25 | Guardhouse | `cancel_hold` #3 | [`7EjZcmNG…`](https://nearblocks.io/txns/7EjZcmNGMvFsWrJW6qHPASYKFfmmUd7LUHo7bFF9hCkd) | Success |
| 17:14 | Toll | `sign_cross` | [`EZypJV1J…`](https://nearblocks.io/txns/EZypJV1JjSWSMoBZexEWTP9Pds6SBVG6MF4yhkUQrz9d) | Success |
| 19:15 | Ferry | `set_rules`, `set_calls` | [`B5prQ3hn…`](https://nearblocks.io/txns/B5prQ3hn3zgGwZVBiNwgLjerGwV87ursr5W2hePz3vTM), [`DNgkvofD…`](https://nearblocks.io/txns/DNgkvofDBVUrAz4PJwfe1oeC1Bk2h1afFdBsDhsyCDhT) | Success |
| 19:16 | Ferry | `fund` | [`7TVviQNR…`](https://nearblocks.io/txns/7TVviQNRKLje5Mao3WET9r1rRHoSvpxPpYRndPmVmUsa) | Success |
| 19:17–19:18 | Ferry | `propose_call` ×3 (`wrap.near`) | [`qEDj96ec…`](https://nearblocks.io/txns/qEDj96ecaqzuwTNjWg6BXrNK6XiM1WTBVoDufGKJsYb), [`7dhDFNBj…`](https://nearblocks.io/txns/7dhDFNBjYMUo3dftATtFhosnKJZ2TN5hezXEfDJskWd4), [`8qob9B6H…`](https://nearblocks.io/txns/8qob9B6Hw1zsw5SgZmosyn8oTYQn3SyULtCCaWcW8iqV) | Success |
| 19:27 | Guardhouse | `fund` | [`Cd6FMuk4…`](https://nearblocks.io/txns/Cd6FMuk4cYJJCT5Yk9vDaCxWYTaEGfB1eu2oDWXtV6uE) | Success |
| 19:29 | Guardhouse | `set_frozen` | [`B592ToG3…`](https://nearblocks.io/txns/B592ToG3drYbqXQmkNX4CMqmHTZv8rrXNEunNUkWdDVN) | Success |
| 19:30 | Setup | `propose` after freeze | [`8UeAhruR…`](https://nearblocks.io/txns/8UeAhruRLzGPg2Gt2NhHb37DL12jCj5JffGMkkixeLhH) | Failed `frozen` |

### Base mainnet

| What | Transaction | Status |
|---|---|---|
| Toll crossing #1 payout, signed by NEAR MPC | [`0xee0a6486…db36a`](https://basescan.org/tx/0xee0a64862989d56dd39ba7c35324ac5b73b41be75b4bb93af695462fdf1db36a) | Success, block 56530402, 0.0001 ETH |
| 0.00025 ETH delivered to the Toll's Base sender by NEAR Intents 1Click (deposit on NEAR [`4myHhHiE…`](https://nearblocks.io/txns/4myHhHiERWTyBYJi7zq63dVbkWE76aMk2GB1pbXbrfn8)) | [`0x513b095b…1cabf`](https://basescan.org/tx/0x513b095b23f468e80ed713ffd481ebfc319167a2d1d07eb2bfdeb7373e71cabf) | Success, block 56460198 |

### Mainnet: earlier proofs

| What | Transaction | Status |
|---|---|---|
| Payee not on the row | [`E7KMexjS…`](https://nearblocks.io/txns/E7KMexjSGrD81BQuxVHWinyzvur63m6TGiw7bWjs1ubZ) | Failed `receiver_not_allowlisted` |
| Shop call over its cap | [`8df5Zu8U…`](https://nearblocks.io/txns/8df5Zu8UGFsFvETbr99pMZBmEpP3ZFEeCnWePPKVZBqZ) | Failed `over_shop_cap` |
| Hold, paid in cap, hold cancelled, row closed | [`9qxsoyA8…`](https://nearblocks.io/txns/9qxsoyA8VrecsCh13yuUFhCk7QxEM4ueMVbicJvxyXwT), [`BBVJPesL…`](https://nearblocks.io/txns/BBVJPesLZxjhSaasKgurFaAM5FG1SiVnm4SLqxiAoags), [`GWnPvGBc…`](https://nearblocks.io/txns/GWnPvGBcVe599hk6RQmxxUgRagtQc7CWWFJgmXL4VgYs), [`8eNrPXFg…`](https://nearblocks.io/txns/8eNrPXFgn5EN87VrNYQERjaHpsp5Rcg8QnxT5pLaCrfZ) | Success ×4 |
| Charter full-access key removed | [`71Zio28g…`](https://nearblocks.io/txns/71Zio28gV3yubD5DecGtkguWzWdfix8brcKFy13d3zzt) | Success |
| Keeper restock on a NEAR AI decision | [`6YiRK25T…`](https://nearblocks.io/txns/6YiRK25TR8m84LcE7PpxXtB55W6CNxLGE7xApsFYNt55) | Success |
| Council changes the market floor | [`Gub1q247…`](https://nearblocks.io/txns/Gub1q247gyT2RNZHSGCwCKNJi1uNVRVGmyRs4piSNYJb) | Success |
| Player: gather, sell, stall, share (all relayed) | [`2TXeZ4hR…`](https://nearblocks.io/txns/2TXeZ4hRu2EB4zw9cG6zdq9jgfswKRQs6BwRu1K1uPRM), [`GecJPUaL…`](https://nearblocks.io/txns/GecJPUaLsbXfKbjHSRQJAUj2BFzQ1iPpVqaovGNxg6M7), [`8JxnSuDg…`](https://nearblocks.io/txns/8JxnSuDgv3C2ghkcPFqRmS3AuP8JQqwDWaeNafuzFkun), [`3BFDcPwr…`](https://nearblocks.io/txns/3BFDcPwrfu64LATzbUyh868e6jWMaJTHDEPHxm7mfaeq) | Success ×4 |
| Relayer pays the player's market storage | [`H637AdPz…`](https://nearblocks.io/txns/H637AdPzKFYs6EdeaS6vHNgDuifyUtZg8YKQTC7Nvs3F) | Success |
| Town Hall job 4, full paid lifecycle | see Agent Economy | Success ×6 |
| Toll allow and refusal (earlier build) | [`4LKGpA5v…`](https://nearblocks.io/txns/4LKGpA5vBRAtd4JoTaG4BtBep2HWsXWQ6VBDsaaSVouz), [`B9FFjcSA…`](https://nearblocks.io/txns/B9FFjcSA9djgn2cWotwZJdag2bHJDSJGNLMLtML6BWtR) | Success; Failed `REFUSED: recipient not in oath allowlist` |
| Payouts in cap and over cap | [`4jEjzpiY…`](https://nearblocks.io/txns/4jEjzpiYxZYu1UmLhn3C1roYQ95pUQDrFkc6vRfiYbia), [`AsZUd9mZ…`](https://nearblocks.io/txns/AsZUd9mZc9uvkvz4RfEjAPiQdWduvYXqgx3wjmqu6EKx) | Success; Failed `over_per_action_cap` |
| Deed mint, purse pay, purse over cap | [`4W7bmUYo…`](https://nearblocks.io/txns/4W7bmUYoG3QfRUKF7yJSfELMUgWsrAP5GrL9d7VC5X33), [`83nyJmTW…`](https://nearblocks.io/txns/83nyJmTWVnYfnBX6SkwyMhcZptis8Kktmc1UatkZYe26), [`3Z4UAb6N…`](https://nearblocks.io/txns/3Z4UAb6NRMwguLDBJHhAvMgtckKxEacvewc7g5MCFmb1) | Success; Success; Failed |
| Ferry swap, Mist Bank tighten | [`HzgUr618…`](https://nearblocks.io/txns/HzgUr618CQqxECR88QKW93yGbDoFU176vWQfWM3yZaUw), [`9wxG5aEr…`](https://nearblocks.io/txns/9wxG5aErrrU72tH4oTt8dAdku3KXqWybJr7yXL32bFRY) | Success |
| A stranger's agent key, two payments on a row | [`AC1j6vLS…`](https://nearblocks.io/txns/AC1j6vLSmrvGDTbF7JBbgyuru4XH3NtU2oWf7Ervmk1Y), [`BEndDsRe…`](https://nearblocks.io/txns/BEndDsRe3YU4e6hjXA2J23ceWDi4ikDseMaTZUDxWL28) | Success |

The full recorded set is in `shared/deployments/mainnet.json`; `npm run verify:mainnet` re-reads all of it (205/205 mainnet txs found on 2026-11-12, 17 of them intended refusals).

### Testnet

The Try free run and the keeper errand are listed above (12 transactions, all with the intended status).

---

## Tests and CI

All 27 jobs of the CI run on the commit live in prod are green: [run 43266368091](https://github.com/nearcarta/nearcarta/actions/runs/43266368091) on `dd656109`.

| Suite | Count | Where it runs |
|---|---|---|
| Backend and UI logic (node:test) | 1140 backend unit tests (1139 pass, 1 skipped) | CI `node`, and `npm test` locally. The one skip would sign a real transaction |
| Contract unit tests, 13 crates | 400 passed | CI `contracts` matrix: oath 122, house_nft 49, charter_board 46, market 34, toll 26, charter_factory 23, arena 21, arena_v2 21, hall 20, townhall 15, charter_factory_lock 13, guard 6, attested_check 4 |
| Sandbox integration (near-workspaces, local chain) | 61 passed | CI `oath-sandbox` 46, `board-sandbox` 12, `market-sandbox` 2, `factory-sandbox` 1 |
| Price parity, Rust = JS on one golden file | 9 JS + 5 Rust | CI `price-parity` |
| Reproducible builds | 6 of 6 rebuilt = on-chain hash | CI `reproducible` matrix |
| On-chain hash check of every artifact | pass | CI `onchain-hashes` |
| Secret scan | no leaks | CI `secrets` (gitleaks, full history) |
| Recorded mainnet proofs | 205/205 mainnet txs found | `npm run verify:mainnet` |
| Browser (Playwright) | 127 Playwright browser tests in the last recorded full run (2026-11-05): 124 passed, 1 flaky, 2 skipped | `npm run e2e` |

**1,601 automated tests** run in CI on every push to main (1140 + 400 + 61).

---

## Verify it yourself

Everything here is read-only. Nothing signs or spends.

```bash
# 1. The live API names mainnet and holds no signing key
curl -s https://nearcarta.vercel.app/api/health; echo

# 2. NEAR AI Cloud TEE attestation, checked live against your own nonce
curl -s "https://nearcarta.vercel.app/api/ai/tee?nonce=$(openssl rand -hex 32)"; echo

# 3. Ask the board what it would do with a 0.001 NEAR payment from the filmed row (frozen by its owner)
#    expected: {"ok":false,"reason":"frozen","asked":"1000000000000000000000","limit":"0"}
ARGS=$(printf '%s' '{"owner":"8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8","receiver":"nearcarta.near","method":"","deposit":"1000000000000000000000","effects":[]}' | base64 | tr -d '\n')
curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"board.nearcarta.near","method_name":"simulate","args_base64":"'"$ARGS"'"}}' \
  | python3 -c 'import json,sys; print(bytes(json.load(sys.stdin)["result"]["result"]).decode())'

# 4. The same row's rules: six receivers, 0.005 NEAR per payment, 0.02 per day, "frozen":true
ARGS=$(printf '%s' '{"owner":"8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8"}' | base64 | tr -d '\n')
curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"board.nearcarta.near","method_name":"get_charter","args_base64":"'"$ARGS"'"}}' \
  | python3 -c 'import json,sys; print(bytes(json.load(sys.stdin)["result"]["result"]).decode())'

# 5. Code hash and keys of a live contract (no near CLI needed)
curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"board.nearcarta.near"}}'; echo
curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"board.nearcarta.near"}}'; echo

# 6. Tests and proofs
npm ci
npm test                 # 1140 unit tests (1139 pass, 1 skipped)
npm run verify:mainnet   # 205/205 mainnet txs found
npm run check-cited      # every file, account and hash the docs name resolves
cd contracts/oath && cargo test --lib     # 122 passed
```

`judges/VERIFY.md` has the same checks in short form.

---

## NEAR technology used

| Technology | Where in the code | On-chain proof |
|---|---|---|
| Function-call access keys | `shared/board/session.js`, `contracts/charter_board` | Agent-key `propose` [`8ZHUrNsm…`](https://nearblocks.io/txns/8ZHUrNsmwcW8DtTxc15PzESbLzBN4U8TFxRypAk3wBQk) |
| On-chain spend policy (one row per visitor) | `contracts/charter_board/src/v2.rs` | Refusals above |
| Chain Signatures (MPC, `v1.signer`) | `contracts/toll`, `backend/src/toll-relay.js` | [`EZypJV1J…`](https://nearblocks.io/txns/EZypJV1JjSWSMoBZexEWTP9Pds6SBVG6MF4yhkUQrz9d) → Base [`0xee0a6486…`](https://basescan.org/tx/0xee0a64862989d56dd39ba7c35324ac5b73b41be75b4bb93af695462fdf1db36a) |
| NEAR Intents (1Click) | `backend/src/ferry-checkout.js`, `backend/src/ferry.js` | [`8qob9B6H…`](https://nearblocks.io/txns/8qob9B6Hw1zsw5SgZmosyn8oTYQn3SyULtCCaWcW8iqV) |
| NEAR AI Cloud (TEE inference, attestation) | `backend/src/tee.js`, `backend/src/agent.js` | `GET /api/ai/tee`; keeper decision [`6YiRK25T…`](https://nearblocks.io/txns/6YiRK25TR8m84LcE7PpxXtB55W6CNxLGE7xApsFYNt55) |
| Meta transactions (NEP-366) | `backend/src/relayer.js` | [`D5zy643g…`](https://nearblocks.io/txns/D5zy643gDhBCXnirCjgPdFXifb1gPfZMrUyxJCMWdy6x) |
| NEP-245 multi-token | `contracts/market/src/mt.rs` | same `gather` |
| NEP-171 NFT | `contracts/house_nft` | [`4W7bmUYo…`](https://nearblocks.io/txns/4W7bmUYoG3QfRUKF7yJSfELMUgWsrAP5GrL9d7VC5X33) |
| NEP-141 (`wrap.near`) | `backend/src/ferry-checkout.js` | [`qEDj96ec…`](https://nearblocks.io/txns/qEDj96ecaqzuwTNjWg6BXrNK6XiM1WTBVoDufGKJsYb) |
| Named sub-accounts | `shared/deployments/mainnet.json` | keepers, relayer, shops under `nearcarta.near` |
| NEP-330 source metadata, reproducible builds | `contracts/deployed.json`, `contracts/scripts/rebuild.sh` | CI `reproducible` |
| Social login (Privy) | `app/src/market/live-play.js`, `/setup` | the filmed account `8e20…61c8` |

---

## Repository map

```
contracts/       one Rust crate per shop (charter_board, market, toll, hall, house_nft, guard, …) + sandbox suites
backend/src/     the API, one module per shop; holds no mainnet key
backend/test/    node:test unit and integration suites
app/             the 3D town (app/design/D9_world), shop rooms (app/design/D8_shops), /setup, /judge
shared/          logic both sides share; deployments/mainnet.json and testnet.json
e2e/             Playwright browser tests
judges/          VERIFY.md and generated proof files
scripts/         read-only checkers and the deploy scripts the owner runs
```

## Built with

near-sdk (Rust), near-api-js, NEAR Intents 1Click SDK, Privy, NEAR Connect, three.js, Hono, React and Radix UI, Playwright, `@phala/dcap-qvl` (TDX quote check), `@noble/hashes`. All are listed in the `package.json` and `Cargo.toml` files.

## Built in the hackathon window

The first commit in this repository is dated 2026-10-28, after the 2026-10-19 announcement that opens the window (HACKATHON.md Q-001). Every contract, the API, the town and every transaction above were made in the window. Third-party libraries are listed under Built with.

## License

[MIT](LICENSE)
