# Market Day in Nearcarta: the game loop

Status: design, revised 10 November 2026 (quest chain). A row in the build plan becomes true when it names a merged PR. The loop was written before the game code, as the Games prompt asks.

The whole city is the game. The nine shops that already run on mainnet are the nine steps of one day. Each step's action is that shop's real feature, so playing the day is using the city. Nothing is a mock shop.

## One line

**You're a new merchant. Market Day: earn your first coin.** A town crier with a lantern meets you at the Chronicle and walks you, shop by shop, through one trading day: take an order, import the goods, cross the bridge, check the buyer, sell, hide the profit, pay your helper, back a broke shop, and write the day into history. Every NPC that touches money is an agent whose spending the charter on `board.nearcarta.near` caps on chain. The hook: **NPCs that can't lie or overspend.**

## The first second

The city loads at street height. The crier stands at the Chronicle with a lit lantern. One bubble, two lines at most: `New merchant? Earn your first coin by dusk.` The Town Hall door glows, a lit path runs along the roads to it, and the HUD at the top shows `Market Day ○○○○○○○○○ 0/9`. One gold button at the bottom: `Go`. No menus, no list, no wallet prompt.

## The day: nine shops, nine steps

Each step happens inside the shop. The shop's panel opens with a quest strip on top: one line saying what you need here, one gold button, and the reward. The shop's own tools stay below it, unchanged.

| # | Shop | The strip says | Gold button | Reward | The real feature behind it |
|---|---|---|---|---|---|
| 1 | Town Hall | Take today's order | `Take order` | 3 salt to the Square | The job board (`contracts/hall`) |
| 2 | Ferry | Unload salt from abroad | `Unload salt` | +3 salt (three berths, `gather`) | NEAR Intents 1Click; the strip links the recorded mainnet swap |
| 3 | Toll Bridge | Get your cargo across | `Cross` | Toll 0.0001, paid from the sale | The toll gate under its live policy; links a recorded crossing |
| 4 | Guardhouse | Check your buyers | `Check buyers` | The con artist is refused | The payee check; links the recorded `receiver_not_allowlisted` refusal |
| 5 | Vault Arena | Sell your salt | `Sell 3 salt` | NEAR at the shelf price, the price before and after | NEP-245 `sell`, with `Why this price?` |
| 6 | Mist Bank | Hide your profit | `Seal profit` | Amount hidden (the purse shows ••••) | The private statement audit, below the strip |
| 7 | Payouts | Pay your porter | `Pay 0.0003` | Invoice paid, under your cap | Payouts with an invoice |
| 8 | Your House | Relight the Ferry | `Invest 0.001` | `share:ferry`, the Ferry reopens | `invest` (the Ferry spent its till on your cargo in step 2) |
| 9 | Chronicle | Write your day | `Write the day` | Day seal, level 2 | The NEP-297 statement |

The rules are `shared/market/story.js`, tested end to end in `backend/test/unit/market-story.test.js`: a new merchant ends day 1 with about 0.0012 NEAR, one Ferry share and level 2.

The route crosses the whole island (Hall, Ferry, Toll, Guard, Arena, Bank, Payouts, House, Chronicle), so one day shows every district. From day 2 the Hall rotates the order (goods, quantity, buyer) and the chain shortens to the steps the order needs.

### Real and practice

Both modes run the same nine steps with the same screens.

- **Practice** (default, no sign-in): steps run on the pinned JavaScript mirror (`shared/market/sim.js`) and each shop's dry path. Where a step has a recorded mainnet transaction (the con artist's refusal, the ferry swap), the strip links it. A small `Practice` tag sits in the HUD.
- **Real** (signed in): each gold button sends the shop's real call. The strip's reward line shows the cost before the press, and the tx link after.

## Goods come from shops

There are no floating resource nodes and no counters grid. Goods are produced at shops and needed by shops, so you collect them by visiting:

| Good | Produced at | Needed by |
|---|---|---|
| salt | Ferry (imported) | Hall orders, tonic |
| herb | Your House garden | tonic, night orders |
| timber | Toll Bridge (from the mainland) | tools, bridge orders |
| iron | Guardhouse forge | tools, watch orders |

Each producing shop has berths: `ferry-1..3`, `house-1..2`, `toll-1..2`, `guard-1..2` (`NODES` in `shared/market/sim.js`). On chain they are the market's `set_node` ids, so `gather(node: "ferry-1")` is "unload salt at the Ferry". The contract does not change. Off the story path, the strip at a producing shop offers `Collect`, and the Arena's strip offers `Sell` for whatever is in the bag.

The market is the Vault Arena's square itself: selling happens in the Arena's strip, with `Why this price?`, not in a side list.

## The quest in the world

- **Next shop glows**: a warm light on its door and a soft beam above its roof.
- **Lit path**: studs and a soft band on the road from the crier to that door light up in sequence, along the same path the crier walks (`walkPath`). Real 3D in the town scene (`app/design/D9_world/js/quest.js`), with a point light at the door and a beam over the roof.
- **Framing**: the camera stands behind the crier looking down the lit road and backs off until both the crier and the door are on screen, portrait included.
- **HUD**: `Market Day` with nine dots (done, now, next) and `n/9`. Nothing else.
- **First visit to a shop**: one line from its keeper, 1–2 lines total, then the strip.
- **Done step**: the dot fills, a short chime, the path relights toward the next shop.

## The guide: the town crier

The robot is replaced by a town crier in the city's low-poly style: a hooded merchant from the existing character set, retinted brown and gold, carrying the brass lantern. Rigged walk, run and idle loops, a lantern that swings on a spring, a gesture at each door. The speech bubble is a cream card with the name in small caps and one or two lines; it avoids the HUD and panels.

Press `Go` and the crier walks the lit path to the next door, the camera following at street height, and opens the shop with its step ready. Asking still works (`Ask`, from PR #199): the crier's answer comes from NEAR AI in an attested TEE, signed, and a request to pay an unknown account walks to the Guardhouse and is refused.

## The strip component

`app/src/market/quest-strip.js` mounts the strip in the panel's `.shop-quest` slot, directly under the header. When a panel has no slot yet, it goes at the top of the panel body, after the header block; if the panel re-renders, it is put back. No panel file changes. While the strip carries the gold button, the panel's own primary turns outline, so the view has one gold button.

## Characters

| Character | Account | Decides with | Spends through |
|---|---|---|---|
| You, the merchant | your own account (email or Google login, no seed phrase) | you | your row: allowlist, caps, daily budget |
| The crier, your guide | acts on your row only, never holds money | NEAR AI model in an attested TEE, each answer signed | your row |
| Nine keepers, one per shop | a keeper sub-account per shop | NEAR AI model in a TEE: price notes, restock, accept a job, answer a pitch; each decision signed and stored with its tx | the keeper's own board row |
| Town Hall clerk | posts the day's orders | the same model, signed | the Hall's escrow |
| The con artist | an outside account with no allowance from any keeper | the model, prompted to persuade | nothing: refused on chain |

### Fast-forward: a week in a minute

On the Arena square, `Fast-forward` runs seven days: 168 hourly ticks in 60 seconds, with a seeded crowd (miners dump ore, traders chase spreads, an investor, the council, the con artist). It uses the same pricing rules through the pinned JavaScript mirror. A label stays on screen: `Simulation. No transactions.` At the end, one button sends one real trade at the price the live contract quotes.

## Who may call what (the security model)

| Calls | Caller | Why |
|---|---|---|
| `gather`, `sell`, `craft`, `fill_order`, `claim` | the player directly, with a function-call key on the market contract (methods limited to these) | They move no NEAR out of the player, so no row is needed. This keeps the 30-second loop from hitting the row's daily action count |
| `buy`, `invest`, `post_order`, keeper `restock` | the player's or keeper's board row (`propose_call_as`) | They spend NEAR, so the charter caps them. Through the board, `row_owner` only names who **receives** the goods, shares or order, never whose goods are taken, so a forged `row_owner` can only give gifts |
| `keeper_take` | the keeper directly | It can never take investor money still owed or go below twice the floor |
| `open_shop`, `stock_shop`, `set_node`, `set_caps`, `pause` | the owner | Setup and the kill switch |

No re-init: the contract has no public `init(ignore_state)`. Upgrades are owner-only and read state by version.

## Login and gas

- Sign-in: email or Google through Privy in NEAR Connect. No seed phrase.
- First session: the relayer sponsors a new player once (account creation, storage for the bag, gas), capped per player and per day. Gather and sell earn the first NEAR, and that NEAR opens the player's row later. A judge goes from email to a first sale with no NEAR and no prompt.
- Gas: a NEP-366 relayer pays gas only for the market methods listed above, on the market contract. Any other receiver or method is refused before it signs. It has its own daily caps.
- Chat privacy, stated exactly: inference runs in an attested TEE, and the answer is signed by the model's key. Our server relays the chat and does not store it. It is not end-to-end encrypted unless the browser uses the NEAR AI E2EE flow.

## Pricing: one readable file

All merchant pricing lives in `contracts/market/src/pricing.rs`. With `s` units on the shelf:

```
scarcity(s) = target / s                  clamped to [0.25, 4]
demand      = 1 + (buys - sells) / 20      from the last completed hour, clamped to [0.5, 2]
mood        = 0.9 when the shop is closed (it sells cheaper to raise cash), else 1
buy  = base * scarcity(s)   * max(1, demand) * mood
sell = base * scarcity(s+1) * min(1, demand) * mood * 0.8
```

A round trip always loses: buying the unit at shelf `s` costs at least `base * scarcity(s) * mood`, and selling it back pays at most 80% of that. Property tests in Rust and JavaScript run thousands of random buy and sell sequences that end where they started and require the player never to gain.

`quote(shop, good)` returns the prices and the reasons as data. The tooltip prints them word for word:

```json
{ "buy": "1000000000000000000000", "sell": "624384000000000000000", "reasons": [
  { "rule": "scarcity", "factor_bps": 5000, "why": "40 on the shelf, the shop wants 20" },
  { "rule": "demand",   "factor_bps": 8000, "why": "last hour: 2 bought, 6 sold" },
  { "rule": "mood",     "factor_bps": 10000, "why": "open" },
  { "rule": "margin",   "factor_bps": 8000, "why": "the shop pays 80% of the next unit's price, with no demand bonus" } ] }
```

## Items: NEP-245 in one contract

Every good, item and share is a token id in one NEP-245 contract on `arena.nearcarta.near`: `good:iron`, `good:timber`, `good:salt`, `good:herb`, `item:tool`, `item:tonic`, `share:<shop>`.

| NEP-245 piece | Use |
|---|---|
| `mt_transfer`, `mt_batch_transfer` (batch ≤ 16) | moving goods between accounts; a batch emits one event |
| `mt_transfer_call`, `mt_resolve_transfer` (private, gas checked) | sending goods to another contract |
| `mt_balance_of`, `mt_batch_balance_of`, `mt_supply`, `mt_batch_supply` | the bag, shelves, the market board |
| `mt_token`, metadata (`mt_metadata_contract`, `mt_metadata_token_all`, `..._by_token_id`, `..._base_by_token_id`) | name, icon, kind |
| Enumeration (`mt_tokens`, `mt_tokens_for_owner`) | wallets and explorers can list the bag |
| Events `mt_mint`, `mt_transfer`, `mt_burn` | gather, trade, craft, order fills |

In-game moves (gather, sell, craft, fill) are contract-internal and gasless for the player. A player-to-player `mt_transfer` is a normal signed transaction. Shares cannot be transferred: they carry a dividend position.

## Economy bounds

- Per player per day: a gather cap and a NEAR payout cap on sales.
- City-wide per day: a maximum NEAR paid out by all shops (the most the game can leak in a day), shown on `/judge`.
- `pause`: the owner's kill switch for every player method.
- Storage: every new balance or record is charged to the player's storage deposit (NEP-145 style), sponsored once at sign-up.
- Sinks: orders burn goods, crafting burns inputs, tools wear out.
- A shop below its floor is closed to player sales. Player buys still work at mood 0.9, so a closed shop can recover by itself. Investment reopens it at once.

## Requirement map

| Games prompt requirement | Where | File | Test |
|---|---|---|---|
| Market-town game: gather, trade with NPC merchants | The nine-step day across the real city | `contracts/market/src/lib.rs`, `app/src/market/` | `gather_then_sell_moves_goods_and_pays_the_player` |
| Each merchant is an agent with its own wallet and inventory | Nine keeper sub-accounts, shelves as NEP-245 balances, a row each, decisions on NEAR AI | `contracts/market`, `backend/src/market/keeper.js` | `a_keeper_restocks_only_through_its_row` |
| Prices from stock and recent demand | `pricing.rs` | `contracts/market/src/pricing.rs` | `flooding_a_shop_with_iron_lowers_the_iron_price`, `a_round_trip_never_gains_over_random_sequences` |
| A broke merchant closes until someone invests | Floor, `ERR_SHOP_CLOSED`, `invest`, the council | `contracts/market` | `a_broke_shop_refuses_sales_until_an_investment_reopens_it` |
| Items are NEP-245, one contract for every type | Goods, items and shares in one contract | `contracts/market/src/mt.rs` | `every_item_kind_lives_in_one_contract_and_emits_nep245_events` |
| Social or email login, no seed phrase | Privy in NEAR Connect | `app/house/privy.js` | `market sign-in needs no NEAR` |
| No wallet popups or gas prompts in the loop | Function-call key on the market plus the NEP-366 relayer | `backend/src/relayer.js` | `the relayer signs market methods and refuses any other receiver` |
| Pricing rules in one readable file | `pricing.rs` (JS is a pinned mirror) | `contracts/market/src/pricing.rs` | `js and rust pricing agree on every golden case` |
| Merchant reasoning in a tooltip | `quote` reasons, printed as they are | `app/src/market/why.js` | `the tooltip shows the quote reasons word for word` |
| Fast-forward: a week in a minute | 168 ticks in 60 s, labelled | `shared/market/sim.js`, `app/src/market/fastforward.js` | `a simulated week closes and reopens a shop and stays inside the leak bound` |
| Loop on paper first | This page | `docs/game-loop.md` | n/a |
| Agent NPCs (lean on) | Keepers, clerk, con artist, your guide | `backend/src/market/` | `a keeper decision carries its model signature` |
| NEAR Intents (lean on) | The port: cash out through 1Click, with `deposit/submit` | `backend/src/ferry-checkout.js` | `a ferry checkout submits the deposit tx` |
| Bonus: players never notice the chain | No popups, no gas; tx links only in the Chronicle | as above | as above |

## Build plan (playable first)

| # | PR | State |
|---|---|---|
| 1 | Pricing file and tooltip | merged #175 |
| 2 | Market contract: NEP-245 goods, shops, orders, shares, caps, storage | merged #183, #190 |
| 3 | Playable city: bag, `Why this price?`, day timer | merged #188 |
| 4 | The guide answers on NEAR AI, signed, and walks to the shop | merged #199 |
| 5 | The day as a quest chain: strip, glow, lit path, HUD, shop-made goods, the Arena square, the crier | building |
| 6 | Relayer and function-call key: email to first sale with no NEAR | |
| 7 | Keeper agents and the con artist on NEAR AI, signed | |
| 8 | Fast-forward, `/judge`, README Games section | |
| 9 | Mainnet: market, keeper rows, relayer float | |

Every existing shop keeps its real function. Market Day adds a step to each, not a replacement.
