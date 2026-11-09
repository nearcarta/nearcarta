# Market Day in Nearcarta: the game loop

Status: design, revised 9 November 2026. A row in the build plan becomes true when it names a merged PR. The loop was written before the game code, as the Games prompt asks.

The whole city is the game. The nine shops that already run on mainnet are its locations. Each keeps its real function and gets a game role. Nothing is a mock shop.

## One line

You are a citizen of Nearcarta. You get your own AI agent: a character that walks the 3D city, talks with you, and does the work, with a wallet whose spending the city's law (the charter on `board.nearcarta.near`) caps on chain. Every shopkeeper is an agent too. The hook: **NPCs that can't lie or overspend.** Each keeper decision is made by a NEAR AI model in an attested TEE and signed. Each NEAR it spends goes through its own capped row, and a refused spend is a transaction anyone can open.

## The city as the game

| Location | Its real function today | Its role on Market Day |
|---|---|---|
| Town Hall | Jobs with bids, counters and reviewed delivery (`contracts/hall`) | The quest board. Each city day posts orders ("12 iron for the bridge"). NPC agents bid; your agent takes or posts jobs |
| Arena | NEP-245 items and guardian pots | The market square. Goods are NEP-245 tokens. Shopkeepers set prices with `pricing.rs`, and `Why this price?` explains them |
| Ferry | Cross-chain swaps through NEAR Intents (1Click) | The port. Cash out your earnings or buy cargo on another chain with a real swap |
| Payouts | Invoices and payroll | Payday. Wages for filled orders and completed jobs, with the invoice |
| Guard | Payee checks, holds, deny list | The city watch. When the con artist pitches a keeper, the watch checks the payee and the charter refuses the payment on chain |
| Mist Bank | Private statement audit in a TEE | The vault. Your savings statement is audited privately |
| House | A deed with a purse, a check-in clock and an heir | The council. It funds a broke shop back to life from a shared purse |
| Toll Bridge | Pay-per-use gate, signed by the NEAR MPC signer | The bridge toll on every cross-chain move |
| Chronicle | One statement across every rail | The history book. Every action with its tx, and your reputation |

## The loop on paper

A city day lasts 20 real minutes: dawn, market, dusk, night. Orders refresh at dawn. Prices use the last completed real hour of trades. Daily caps reset at 00:00 UTC.

### Every 30 seconds: gather, trade, talk

| You do | You see | On chain |
|---|---|---|
| Tap a resource node on the island (ore, timber, salt pans, herb beds) | The good flies into your bag | `gather`: one NEP-245 unit, at most once per node per 30 s, within a daily cap. With a tool, two units |
| Open a counter in the market square | Prices, a five-minute sparkline, `Why this price?` | `quote` view: no tx |
| Sell or buy | The next unit's price moves in front of you | `sell` is a direct call (your key on the market contract, gas paid by the relayer). `buy` spends NEAR, so it goes through your row |
| Tell your agent "sell my iron where it pays most" | It walks to the best counter, explains, acts, and shows `Charter said yes` or `no` with the tx | The same calls, proposed by the agent |

### Every 5 minutes: quests and the city

| You do | Why it matters |
|---|---|
| Read the Town Hall board and take an order | Orders are the main sink: filling one burns the goods and pays wages from the order's escrow |
| Craft at the market (2 iron + 1 timber = a tool) | A tool doubles your gather. Tonic (herbs + salt) is what the night orders ask for |
| Carry cargo between counters for the spread | The cheap counter's price rises as its shelf drains, so the spread closes. That is the economy at work |
| Watch the con artist at dusk | He pitches a keeper. The keeper's model may agree. The watch flags the payee and the keeper's row refuses: a real refused tx in the Chronicle |

### Every session: earn, invest, rise

| You do | Result |
|---|---|
| Collect your wages on Payday | NEAR paid for each order you filled, with a statement |
| Find a dark shop (`Closed: out of funds`) and invest, or ask the council | The shop reopens. You hold `share:<shop>` tokens and get 20% of its sales until 110% is repaid |
| Cash out at the port | A real NEAR Intents swap of your earnings, the toll shown before you confirm |
| Check your level in the Chronicle | Reputation rises with every order you fill. Levels unlock bigger orders |

### Fast-forward: a week in a minute

On the market board, `Fast-forward` runs seven days: 168 hourly ticks in 60 seconds, with a seeded crowd (miners dump ore, traders chase spreads, an investor, the council, the con artist). It uses the same pricing rules through the pinned JavaScript mirror. You watch prices, shops closing and reopening, and the leak bound holding. A label stays on screen: `Simulation. No transactions.` At the end, one button sends one real trade at the price the live contract quotes.

## Characters

| Character | Account | Decides with | Spends through |
|---|---|---|---|
| You, the citizen | your own account (email or Google login, no seed phrase) | you | your row: allowlist, caps, daily budget |
| Your agent, the guide | acts on your row only, never holds money | NEAR AI model in an attested TEE, each answer signed | your row |
| Nine keepers, one per location | a keeper sub-account per shop | NEAR AI model in a TEE: price notes, restock, accept a job, answer a pitch; each decision signed and stored with its tx | the keeper's own board row |
| Town Hall clerk | posts the daily orders | the same model, signed | the Hall's escrow |
| The con artist | an outside account with no allowance from any keeper | the model, prompted to persuade | nothing: refused on chain |

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
{ "buy": "1000000000000000000000", "sell": "780487804878048780487", "reasons": [
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
| Market-town game: gather, trade with NPC merchants | The 30 s loop on the real city | `contracts/market/src/lib.rs`, `app/src/market/` | `gather_then_sell_moves_goods_and_pays_the_player` |
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
| 1 | Pricing file and tooltip | merged #175 (rule revised in 2) |
| 2 | Market contract: NEP-245 goods, shops on the nine locations, orders, shares, caps, storage, no-arbitrage pricing, sandbox test through the live board build | building |
| 3 | Playable city: bag, counters, nodes, Town Hall orders, `Why this price?`, day/night timer | next |
| 4 | Relayer and function-call key: email to first sale with no NEAR | |
| 5 | Your agent: chat, walking, camera glide, `Charter said yes/no` | |
| 6 | Keeper agents and the con artist on NEAR AI, signed; the watch and the refused tx | |
| 7 | Fast-forward | |
| 8 | `/judge` with one-click mainnet txs and the leak bound | |
| 9 | Port cash-out through Intents; README Games section | |

Every existing shop keeps its real function. Market Day adds a role to each, not a replacement.
