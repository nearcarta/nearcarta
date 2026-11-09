# Market Day: the game loop

Status: design. Nothing on this page is built until a row in the build plan below names a merged PR. The loop was written before any market code, as the Games prompt asks.

Market Day runs on the town that already exists: the island, the nine shop buildings, and the board rows behind them. The new parts are goods, merchants that price them, and a clock.

## The idea in one paragraph

A player walks the island, gathers raw goods (iron, timber, salt, herbs), and sells or trades them at the shops. Each shopkeeper is an agent with its own NEAR sub-account, its own stock and its own row on `board.nearcarta.near`. A shopkeeper prices every good from its stock and the last hour of trades, so if players flood the smithy with iron, iron gets cheap there. A shopkeeper that cannot pay for what it buys runs out of money and closes. Its building goes dark until a player invests in it. A con artist walks the market and tries to talk shopkeepers into paying him. On mainnet the charter refuses him, and the refusal is a transaction anyone can open.

## The loop on paper

### Every 30 seconds: gather, sell, buy

| Player does | What they see | What happens on chain |
|---|---|---|
| Walks to a node (ore rock, woodpile, salt pan, herb bed) and presses Gather | The good lands in their bag with a short pickup sound | `gather` mints one unit of a NEP-245 token to the player, limited to one unit per node per 30 s per player |
| Walks into a shop and opens the counter | Today's price for each good, an arrow for the last hour, and a `Why this price?` link | View `quote(shop, good)`: no tx |
| Sells 3 iron | The price on the next unit already reads lower | `sell`: the player's 3 iron move to the shop by `mt_transfer`, and the shop pays from its own account |
| Buys a tool | The tool appears in the bag | `buy`: NEAR from the player's session, the good moves by `mt_transfer` |

No wallet popup, no seed phrase, no gas prompt in any of these four. The player signed in once with email or Google. The relayer pays gas for market methods only. See "Login and gas" below.

### Every 5 minutes: read the market and react

| Player does | Why it matters |
|---|---|
| Opens the market board in the square: price and stock per shop, with a five-minute sparkline | Iron is cheap at the smithy because the last ten players dumped ore. Salt is dear at the tavern because the cellar is empty |
| Carries goods between shops to profit on the spread | The cheap shop's price rises as its stock drains, so the spread closes. That is the economy working, not a bug |
| Crafts: 2 iron + 1 timber at the smithy becomes 1 tool | Turns gathered goods into a higher-value good, burning the inputs (NEP-245 `mt_burn` event) |
| Watches the con artist try a shopkeeper | A refusal line appears in the shop's ledger with a tx link |

### Every session (10–20 minutes): own a piece of the town

| Player does | Result |
|---|---|
| Finds a shop closed (dark windows, `Closed: out of funds`) | The shop's account balance is below its floor. It cannot buy until someone invests |
| Invests NEAR in the shop | The shop reopens. The investor gets a share token (`share:<shop>`, NEP-245) and a cut of that shop's margin until it is repaid |
| Checks the ledger at the end of the session | Every buy, sell, craft, investment and refusal, each with its tx |
| Leaves | The economy keeps moving. Shopkeepers restock from each other on a timer. The next session finds new prices |

### Fast-forward: a week in a minute

A `Fast-forward` button on the market board runs seven days of trading in 60 seconds: 168 hourly ticks, a fixed crowd of simulated players with seeded behaviour (miners dump iron, traders chase spreads, one investor). It uses the same pricing rules as the contract. The screen shows prices, stock, and shops closing and reopening. A label stays on the screen the whole time: `Simulation. No transactions.` At the end, one button sends a single real mainnet trade at the price the live contract quotes, so a judge sees the rules and the chain agree.

## Who is in the town

| Character | Account | Holds | Spends through |
|---|---|---|---|
| Player | their own account, made by the email or Google login | goods, shares, NEAR | their own board row (session key, caps, allowlist) |
| Nine shopkeepers (smith, tavern, apothecary, carpenter, ferryman, banker, scribe, guard captain, innkeeper) | one sub-account each under the market account | stock (NEP-245 balances), NEAR till | each shopkeeper's own board row: allowlist of the market contract and the other shops, per-action cap, daily budget |
| Con artist | an agent with no row allowance to anyone but itself | nothing | tries to make a shopkeeper pay him; the shopkeeper's row refuses on chain |

A shopkeeper's agent proposes every payment it wants to make (restock from another shop, repay an investor) through `propose_call` on its row. The row decides. So a shopkeeper fooled by the con artist produces a refused transaction, not a loss. This is the same charter story the rest of the town tells, used as a game rule.

## Pricing: one readable file

All merchant pricing lives in `contracts/arena_v2/src/pricing.rs`. The rule, per shop and good:

```
base    = the good's base price
scarcity = target_stock / max(stock, 1)          clamped to [0.25, 4]
demand  = 1 + (buys_last_hour - sells_last_hour) / 20   clamped to [0.5, 2]
mood    = 0.9 if the shop is short of NEAR (it sells cheaper to raise cash)
          1.0 otherwise
buy price  (player pays)    = base * scarcity * demand * mood
sell price (player receives) = buy price * 0.8   (the shop's margin)
```

`quote(shop, good)` returns the price and the reasons as data:

```json
{ "price": "0.0021", "reasons": [
  { "rule": "scarcity", "factor": 0.5, "why": "40 iron in stock, target 20" },
  { "rule": "demand",   "factor": 0.8, "why": "2 bought, 6 sold in the last hour" },
  { "rule": "mood",     "factor": 1.0, "why": "till above floor" } ] }
```

The `Why this price?` tooltip renders those reasons word for word. It does not compute anything itself. The fast-forward runs a JavaScript copy of the same rule (`shared/market/pricing.js`). A test feeds both the Rust and the JS rule the same table of cases and requires the same prices, so the two cannot drift.

## Items: NEP-245 in one contract

Every good, every crafted item and every investor share is a token id in one NEP-245 contract: the market contract on `arena.nearcarta.near`. The arena's live code already implements NEP-245; the market reuses that module.

| NEP-245 piece | Where it is used |
|---|---|
| `mt_transfer`, `mt_batch_transfer` | sell, buy, a basket sale in one call |
| `mt_transfer_call` + `mt_resolve_transfer` | sending goods to another contract (for example an investor share to a vault) |
| `mt_balance_of`, `mt_batch_balance_of` | the bag, the shop counter, the market board |
| `mt_supply`, `mt_batch_supply` | total iron in the world, shown on the board |
| `mt_token` / metadata | name, icon and kind (`good`, `item`, `share`, `badge`) |
| Events `mt_mint`, `mt_transfer`, `mt_burn` (`EVENT_JSON`, standard `nep245`, version `1.0.0`) | gather, trade, craft; indexers and the ledger read these |

Token ids: `good:iron`, `good:timber`, `good:salt`, `good:herb`, `item:tool`, `share:smith`, and the arena's existing `case:<clause>` and `trophy:<id>` badges.

## A shop goes broke, and comes back

1. A shopkeeper's till falls below its floor (it bought too much iron that nobody buys back).
2. `sell` to that shop is refused with `ERR_SHOP_CLOSED`. The building goes dark in 3D and the counter reads `Closed: out of funds`.
3. A player presses Invest and attaches NEAR. `invest(shop)` reopens the shop and mints `share:<shop>` to the investor.
4. Each later sale at that shop pays a share of its margin to share holders until the investment plus 10% is repaid. The payout is a `propose_call` on the shopkeeper's row, so the row's caps also bind repayments.

## The con artist

Every few minutes (or on demand from `/judge`) the con artist pitches a shopkeeper: "pay me 0.5 NEAR for a shipment of silk". The shopkeeper's model may even agree. The shopkeeper's row on the board has no allowance for the con artist's account, so `propose_call` is refused on chain with a reason. The shop ledger shows the attempt and the refusal tx. The first refusal at each shop mints a `case:` badge to the player who watched it, reusing the arena's badge rule.

## Login and gas

- Sign-in: email or Google through the Privy option already offered in NEAR Connect (`app/house/privy.js`). No seed phrase.
- Session: one approval at sign-in opens the player's row and adds a function-call key scoped to the board. After that, no popups inside the row's rules.
- Gas: a relayer (NEP-366 meta transactions) pays gas for the market methods only: `gather`, `buy`, `sell`, `craft`, `invest`, and the board's `propose_call` when its receiver is the market contract. Any other receiver or method is refused by the relayer before it signs. A per-player daily cap and a global daily cap bound what the relayer can spend.

## /judge

One page with one button per proof, each sending a real mainnet transaction and printing its nearblocks link: gather, sell into a falling price, buy, craft, a broke shop refusing a sale, invest to reopen it, and the con artist refused. A run of fast-forward sits beside them, labelled as a simulation.

## The guide: a character who walks you through the town

The headline of Market Day is a guide you can see. The Lamplighter walks the 3D island next to the player. The player talks to it in plain words; it answers, walks to the right shop, explains, and does the action for them inside the player's board caps.

| The player says | The guide does | What the player sees |
|---|---|---|
| "Sell my iron where it pays most" | Reads `quote` at every shop, picks the best, walks there | The camera glides to the smithy, the `Why this price?` card opens, then the sale |
| "Buy two salt for the tavern order" | Buys at the cheapest shop, then fills the order | Two steps, each with its tx |
| "Fill the Town Hall order for tools" | Crafts if needed, then delivers to the Town Hall job | The Hall's job card moves from open to delivered to paid |
| "Put 0.05 into the closed apothecary" | Calls `invest` | The windows light up again, a `share:apothecary` lands in the bag |
| "Swap 1 NEAR to USDC" | Asks the Ferry for quotes through NEAR Intents and checks out | Quotes side by side, the larger output marked |
| "Pay this stranger 0.5 for silk" | Proposes it; the row has no allowance for him | `Charter said no` with the refusal tx |

How it is wired:

- Brain: the NEAR AI Cloud model in a TEE that the town already uses (`backend/src/agent.js`). The chat is private to the player. Each answer carries its attestation, shown behind a small `verified` mark.
- Hands: the guide never holds money. It proposes one action at a time through the player's row (`propose_call` on `board.nearcarta.near`). The row decides.
- The moment: every action ends on one card, `Charter said yes` or `Charter said no`, with the reason and the nearblocks link. It is the same card for buy, sell, invest, a Hall order and a swap.
- Walking: the guide walks a path between shop doors. The camera eases to the shop in about 1.2 s, and the dialog sits in a fixed panel so it never covers the shop's counter.

## One connected loop

Every part feeds another, so a session is one story, not a list of features:

```
gather goods (NEP-245 mint)
   -> sell at a shop; its price moves (pricing.rs)
   -> the shop's till grows, or it overbuys and goes broke
   -> a broke shop closes; a player invests (share token) and it reopens
   -> shops restock from each other through their own board rows
   -> the Town Hall posts orders for goods; filling one pays the player
   -> the con artist pitches a shopkeeper; the charter refuses on chain
   -> the guide does any of these on request, under the player's caps
   -> /judge replays each step as one real mainnet tx
```

## Look and feel

- The existing 3D scenes stay: the island at dusk, the nine buildings, the dark brown and gold palette.
- Motion: camera eases to a shop, prices tick with a short count-up, a closed shop dims and relights, goods fly into the bag, the charter card stamps `yes` or `no`.
- Layout rules: one panel at a time on the right, the guide's chat at the bottom, no panel over another, no nested scroll areas. A panel that is taller than the screen scrolls the page, not the panel.
- Every tx link opens in a new tab; nothing leaves the game screen.

## Town Hall: the pass that cannot pay today

On mainnet a Town Hall `review(pass)` refuses, because the Hall waits for `guard_clear` from `guard.nearcarta.near`, and that account has no key and no method that calls it. So a delivered order can never be paid. The fix, kept out of `charter_board`:

1. Add an owner-only `set_guard(guard)` to `contracts/hall` (state-compatible, no migrate, so open jobs survive), with a unit test that only the owner can call it and that a pass still needs a clear.
2. Redeploy the Hall wasm on `townhall.nearcarta.near` with its existing full-access key, then `set_guard` to a guard signer.
3. The guard signer is a function-call key that can call only `guard_clear` on `townhall.nearcarta.near`. The backend Guardhouse uses it after the model's verdict is ALLOW; a BLOCK never calls it.
4. Prove it with tiny real txs: post a 0.001 NEAR job, bid, deliver, `guard_clear`, `review(pass)` pays the worker.

This is coordinated with the worker on `contracts/charter_board`; neither change touches the other's files.

## Requirement map

| Games prompt requirement | Where in the design | File (planned) | Test (planned) |
|---|---|---|---|
| Market-town game: gather and trade with NPC merchants | The 30 s loop | `contracts/arena_v2/src/market.rs`, `app/src/market/` | `gather_then_sell_moves_goods_and_pays_the_player` |
| Each merchant is an agent with its own wallet and inventory | Nine shopkeeper sub-accounts with stock as NEP-245 balances and rows on the board | `contracts/arena_v2/src/market.rs`, `backend/src/market/keeper.js` | `a_shopkeeper_pays_only_through_its_row` |
| Prices from stock and recent demand | `pricing.rs`: scarcity and demand factors | `contracts/arena_v2/src/pricing.rs` | `flooding_a_shop_with_iron_lowers_the_iron_price` |
| A broke merchant closes until someone invests | Floor, `ERR_SHOP_CLOSED`, `invest` | `contracts/arena_v2/src/market.rs` | `a_broke_shop_refuses_sales_until_an_investment_reopens_it` |
| Items are NEP-245, one contract for every item type | Token ids `good:`, `item:`, `share:`, `case:` on one contract | `contracts/arena_v2/src/mt.rs` | `every_item_kind_lives_in_one_contract_and_emits_nep245_events` |
| Social or email login, no seed phrase | Privy in NEAR Connect | `app/house/privy.js` | existing login tests plus `market sign-in opens a row with one approval` |
| No wallet popups or gas prompts in the loop | Session key plus relayer for market methods | `backend/src/relayer.js` | `the relayer signs market methods and refuses any other receiver` |
| Pricing rules in one readable file | `pricing.rs` | `contracts/arena_v2/src/pricing.rs` | `js and rust pricing agree on every golden case` |
| Merchant reasoning in a tooltip | `quote` returns reasons; tooltip prints them | `app/src/market/why.js` | `the tooltip shows the contract's reasons word for word` |
| Fast-forward: a week in a minute | 168 ticks in 60 s, labelled simulation | `app/src/market/fastforward.js`, `shared/market/sim.js` | `a simulated week runs 168 ticks and closes then reopens a shop` |
| Loop designed on paper first | This page | `docs/game-loop.md` | n/a |
| Agent NPCs (Lean on) | Shopkeepers, the con artist and the guide are agents | `backend/src/market/keeper.js`, `backend/src/agent.js` | `the guide proposes through the row and never holds money` |
| NEAR Intents (Lean on) | The guide's swap goes through the Ferry's 1Click checkout | `backend/src/ferry-checkout.js` | existing ferry tests |
| Bonus: players never notice the chain | No popups, no gas, chain shown only as optional tx links in the ledger | as above | as above |

## Build plan (in impact order)

| # | PR | Mainnet cost |
|---|---|---|
| 1 | Pricing module and `Why this price?` tooltip | none |
| 2 | NEP-245 goods on the arena code (`gather`, `buy`, `sell`, `craft`, `invest`, `quote`), shopkeeper sub-accounts that spend through their rows | needs approval: the arena redeploy |
| 3 | The guide: chat, walking, camera, `Charter said yes/no` card for buy, sell, invest, Hall order, swap | tiny txs |
| 4 | Town Hall `set_guard` fix and the guard signer | under 0.05 NEAR |
| 5 | Fast-forward | none |
| 6 | Con artist refused by the charter on mainnet | tiny txs |
| 7 | `/judge` with one-click mainnet txs | tiny txs |
| 8 | README Games section: prompt line, file, test, tx | none |
| 9 | Relayer for market methods | small float for gas |

The existing 3D scenes stay. Market UI is new files under `app/src/market/`.
