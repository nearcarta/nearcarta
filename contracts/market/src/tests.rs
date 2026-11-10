use crate::mt::TokenMeta;
use crate::shops::{GoodCfg, GATHER_NS, TOOL_LIFE};
use crate::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::testing_env;

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

fn id(s: &str) -> AccountId { s.parse().unwrap() }
fn board() -> AccountId { id("board.test") }
fn owner() -> AccountId { id("owner.test") }
fn alice() -> AccountId { id("alice.test") }
fn bob() -> AccountId { id("bob.test") }
fn arena_keeper() -> AccountId { id("arena-keeper.test") }
fn ferry_keeper() -> AccountId { id("ferry-keeper.test") }
fn here() -> AccountId { id("market.test") }

fn ctx(pred: AccountId, deposit: u128, ts: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(here())
        .predecessor_account_id(pred.clone())
        .signer_account_id(pred)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(ts)
        .account_balance(NearToken::from_near(100))
        .prepaid_gas(Gas::from_tgas(300));
    testing_env!(b.build());
}

fn fails<F: FnOnce() -> R, R>(f: F) -> String {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(_) => String::new(),
        Err(e) => e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_else(|| "panic".into()),
    }
}

fn caps() -> Caps {
    Caps { gathers_per_day: 200, player_payout_per_day: U128(20 * MILLI), city_payout_per_day: U128(NEAR), storage_min: U128(5 * MILLI) }
}

fn meta(kind: &str) -> TokenMeta { TokenMeta { title: "x".into(), description: "y".into(), kind: kind.into(), icon: None } }

fn goods() -> Vec<GoodCfg> {
    vec![
        GoodCfg { good: "good:iron".into(), base: U128(2 * MILLI), target: U64(20) },
        GoodCfg { good: "good:timber".into(), base: U128(MILLI), target: U64(20) },
    ]
}

fn town() -> Contract {
    ctx(owner(), 0, 1);
    let mut c = Contract::new(owner(), board(), caps());
    for (t, k) in [("good:iron", "good"), ("good:timber", "good"), ("good:herb", "good"), ("good:salt", "good"), ("item:tool", "item"), ("item:tonic", "item")] {
        c.register_token(t.into(), meta(k));
    }
    for (shop, keeper) in [("arena", arena_keeper()), ("ferry", ferry_keeper())] {
        ctx(owner(), 100 * MILLI, 1);
        c.open_shop(shop.into(), keeper, U128(20 * MILLI), goods());
        ctx(owner(), 0, 1);
        c.stock_shop(shop.into(), "good:iron".into(), U128(20));
        c.stock_shop(shop.into(), "good:timber".into(), U128(20));
    }
    c.set_node("ore-1".into(), "good:iron".into());
    c.set_node("wood-1".into(), "good:timber".into());
    for who in [alice(), bob(), arena_keeper(), ferry_keeper()] {
        ctx(who.clone(), 50 * MILLI, 1);
        c.storage_deposit(None);
    }
    c
}

fn gather_n(c: &mut Contract, who: AccountId, node: &str, n: u64, t0: u64) -> u64 {
    let mut t = t0;
    for _ in 0..n {
        t += GATHER_NS;
        ctx(who.clone(), 0, t);
        c.gather(node.into());
    }
    t
}

fn till(c: &Contract, shop: &str) -> u128 { c.shops.get(shop).unwrap().till.0 }

#[test]
fn gather_then_sell_moves_goods_and_pays_the_player() {
    let mut c = town();
    let t = gather_n(&mut c, alice(), "ore-1", 3, 0);
    assert_eq!(c.mt_balance_of(alice(), "good:iron".into()).0, 3);
    let q = c.quote("arena".into(), "good:iron".into()).sell.0;
    ctx(alice(), 0, t + 1);
    let got = c.sell("arena".into(), "good:iron".into(), 1, U128(q), None).0;
    assert_eq!(got, q);
    assert_eq!(c.mt_balance_of(arena_keeper(), "good:iron".into()).0, 21);
    assert_eq!(till(&c, "arena"), 100 * MILLI - got);
    assert!(get_logs().iter().any(|l| l.contains("\"standard\":\"nep245\"") && l.contains("mt_transfer")));
    assert_eq!(c.get_citizen(alice()).paid_today.0, got);
}

#[test]
fn gathering_a_node_again_within_30_seconds_is_refused() {
    let mut c = town();
    ctx(alice(), 0, GATHER_NS);
    c.gather("ore-1".into());
    ctx(alice(), 0, GATHER_NS + 1);
    assert!(fails(|| c.gather("ore-1".into())).contains("ERR_TOO_SOON"));
    c.gather("wood-1".into());
    ctx(bob(), 0, GATHER_NS + 1);
    c.gather("ore-1".into());
}

#[test]
fn a_player_without_a_storage_deposit_cannot_write() {
    let mut c = town();
    ctx(id("fresh.test"), 0, GATHER_NS);
    let why = fails(|| c.gather("ore-1".into()));
    assert!(why.contains("ERR_STORAGE"), "{why:?}");
}

#[test]
fn the_daily_gather_cap_holds() {
    let mut c = town();
    ctx(owner(), 0, 1);
    let mut k = caps();
    k.gathers_per_day = 2;
    c.set_caps(k);
    let t = gather_n(&mut c, alice(), "ore-1", 2, 0);
    ctx(alice(), 0, t + GATHER_NS);
    assert!(fails(|| c.gather("ore-1".into())).contains("ERR_GATHER_DAILY_CAP"));
    ctx(alice(), 0, DAY_NS + 5);
    c.gather("ore-1".into());
}

#[test]
fn sales_stop_at_the_player_cap_and_the_city_cap() {
    let mut c = town();
    ctx(owner(), 0, 1);
    let mut k = caps();
    k.player_payout_per_day = U128(MILLI);
    c.set_caps(k.clone());
    let t = gather_n(&mut c, alice(), "ore-1", 3, 0);
    ctx(alice(), 0, t + 1);
    assert!(fails(|| c.sell("arena".into(), "good:iron".into(), 3, U128(0), None)).contains("ERR_PLAYER_DAILY_CAP"));
    k.player_payout_per_day = U128(NEAR);
    k.city_payout_per_day = U128(MILLI);
    ctx(owner(), 0, t + 2);
    c.set_caps(k);
    ctx(alice(), 0, t + 3);
    assert!(fails(|| c.sell("arena".into(), "good:iron".into(), 3, U128(0), None)).contains("ERR_CITY_DAILY_CAP"));
}

#[test]
fn the_kill_switch_stops_every_player_method() {
    let mut c = town();
    ctx(owner(), 0, 1);
    c.set_paused(true);
    ctx(alice(), 0, GATHER_NS);
    assert!(fails(|| c.gather("ore-1".into())).contains("ERR_PAUSED"));
    ctx(board(), NEAR, GATHER_NS);
    assert!(fails(|| c.buy(alice(), "arena".into(), "good:iron".into(), 1, U128(NEAR))).contains("ERR_PAUSED"));
    ctx(alice(), 0, 2);
    assert!(fails(|| c.set_paused(false)).contains("ERR_OWNER"));
}

#[test]
fn flooding_one_shop_with_iron_makes_iron_cheap_there_only() {
    let mut c = town();
    let t = gather_n(&mut c, alice(), "ore-1", 10, 0);
    let before = c.quote("arena".into(), "good:iron".into()).buy.0;
    let sell_before = c.quote("arena".into(), "good:iron".into()).sell.0;
    ctx(alice(), 0, t + 1);
    c.sell("arena".into(), "good:iron".into(), 10, U128(0), None);
    // The sells count from the next hour.
    ctx(alice(), 0, t + HOUR_NS);
    let after = c.quote("arena".into(), "good:iron".into());
    assert!(after.buy.0 * 3 < before * 2, "{} vs {before}", after.buy.0);
    assert!(after.sell.0 * 2 < sell_before, "the shop pays far less for more iron");
    assert_eq!(c.quote("ferry".into(), "good:iron".into()).buy.0, before);
    assert_eq!(c.quote("arena".into(), "good:iron".into()).reasons[1].why, "last hour: 0 bought, 10 sold");
}

#[test]
fn buying_through_the_board_charges_unit_prices_and_returns_the_rest() {
    let mut c = town();
    let q1 = c.quote("arena".into(), "good:iron".into()).buy.0;
    ctx(board(), NEAR, 5);
    let total = c.buy(alice(), "arena".into(), "good:iron".into(), 2, U128(NEAR)).0;
    assert!(total >= 2 * q1);
    assert_eq!(c.mt_balance_of(alice(), "good:iron".into()).0, 2);
    let r = format!("{:?}", near_sdk::test_utils::get_created_receipts());
    assert!(r.contains("Transfer"), "{r}");
    ctx(board(), NEAR, 6);
    assert!(fails(|| c.buy(alice(), "arena".into(), "good:iron".into(), 1, U128(1))).contains("ERR_PRICE_MOVED"));
}

#[test]
fn a_spoofed_row_owner_can_only_give_and_never_take() {
    let mut c = town();
    let t = gather_n(&mut c, alice(), "ore-1", 2, 0);
    // Taking methods refuse the board: only the owner of the goods may call them.
    ctx(board(), 0, t + 1);
    assert!(fails(|| c.sell("arena".into(), "good:iron".into(), 1, U128(0), None)).contains("ERR_DIRECT_ONLY"));
    assert!(fails(|| c.craft("item:tool".into())).contains("ERR_DIRECT_ONLY"));
    assert!(fails(|| c.keeper_take("arena".into(), U128(1))).contains("ERR_DIRECT_ONLY"));
    // A forged row_owner on a spend only gives the named account the goods.
    ctx(board(), NEAR, t + 2);
    c.buy(alice(), "arena".into(), "good:iron".into(), 1, U128(NEAR));
    assert_eq!(c.mt_balance_of(alice(), "good:iron".into()).0, 3);
    // Spending methods refuse a direct caller: the charter must see them.
    ctx(alice(), NEAR, t + 3);
    assert!(fails(|| c.buy(alice(), "arena".into(), "good:iron".into(), 1, U128(NEAR))).contains("ERR_BOARD_ONLY"));
    assert!(fails(|| c.invest(alice(), "arena".into(), None)).contains("ERR_BOARD_ONLY"));
}

#[test]
fn a_keeper_decision_id_rides_on_the_restock_event() {
    let mut c = town();
    ctx(board(), NEAR, 5);
    c.restock(ferry_keeper(), "ferry".into(), "arena".into(), "good:iron".into(), 1, U128(NEAR), Some("sha256:ab12".into()));
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"restock\"") && l.contains("\"decision\":\"sha256:ab12\"")));
    ctx(board(), NEAR, 6);
    assert!(fails(|| c.restock(ferry_keeper(), "ferry".into(), "arena".into(), "good:iron".into(), 1, U128(NEAR), Some("x\"y".into()))).contains("ERR_DECISION"));
}

#[test]
fn a_keeper_restocks_only_through_its_row() {
    let mut c = town();
    ctx(board(), NEAR, 5);
    let total = c.restock(ferry_keeper(), "ferry".into(), "arena".into(), "good:iron".into(), 2, U128(NEAR), None).0;
    assert_eq!(c.mt_balance_of(ferry_keeper(), "good:iron".into()).0, 22);
    assert_eq!(till(&c, "arena"), 100 * MILLI + total);
    ctx(board(), NEAR, 6);
    assert!(fails(|| c.restock(alice(), "ferry".into(), "arena".into(), "good:iron".into(), 1, U128(NEAR), None)).contains("ERR_NOT_KEEPER"));
}

fn tiny_shop(c: &mut Contract) {
    ctx(owner(), 21 * MILLI, 2);
    c.open_shop("toll".into(), id("toll-keeper.test"), U128(20 * MILLI), goods());
    ctx(owner(), 0, 2);
    c.stock_shop("toll".into(), "good:iron".into(), U128(20));
}

#[test]
fn a_broke_shop_refuses_sales_until_an_investment_reopens_it() {
    let mut c = town();
    tiny_shop(&mut c);
    let t = gather_n(&mut c, alice(), "ore-1", 3, 0);
    ctx(alice(), 0, t + 1);
    c.sell("toll".into(), "good:iron".into(), 1, U128(0), None);
    assert!(!c.market_board().iter().find(|s| s.id == "toll").unwrap().open);
    assert!(get_logs().iter().any(|l| l.contains("shop_closed")));
    ctx(alice(), 0, t + 2);
    assert!(fails(|| c.sell("toll".into(), "good:iron".into(), 1, U128(0), None)).contains("ERR_SHOP_CLOSED"));
    ctx(board(), 3 * MILLI + MILLI / 2, t + 3);
    assert_eq!(c.invest(bob(), "toll".into(), None).0, 3);
    assert!(c.market_board().iter().find(|s| s.id == "toll").unwrap().open);
    assert!(get_logs().iter().any(|l| l.contains("shop_reopened")));
    assert_eq!(c.mt_balance_of(bob(), "share:toll".into()).0, 3);
}

#[test]
fn a_closed_shop_still_sells_cheaper_and_recovers() {
    let mut c = town();
    tiny_shop(&mut c);
    let t = gather_n(&mut c, alice(), "ore-1", 1, 0);
    ctx(alice(), 0, t + 1);
    c.sell("toll".into(), "good:iron".into(), 1, U128(0), None);
    let q = c.quote("toll".into(), "good:iron".into());
    assert_eq!(q.reasons[2].why, "closed: selling cheaper to raise cash");
    ctx(board(), NEAR, t + 2);
    c.buy(bob(), "toll".into(), "good:iron".into(), 1, U128(NEAR));
    assert!(c.market_board().iter().find(|s| s.id == "toll").unwrap().open, "the buy refilled the till");
}

#[test]
fn investors_get_a_fifth_of_sales_until_110_percent_is_back() {
    let mut c = town();
    ctx(board(), 2 * MILLI + MILLI / 2, 2);
    c.invest(bob(), "arena".into(), None);
    assert_eq!(c.shops.get("arena").unwrap().owed.0, 2 * MILLI * 11 / 10);
    let mut t = 3;
    let mut total_cut = 0;
    for _ in 0..6 {
        t += 1;
        let owed_before = c.shops.get("arena").unwrap().owed.0;
        ctx(board(), NEAR, t);
        let paid = c.buy(alice(), "arena".into(), "good:iron".into(), 1, U128(NEAR)).0;
        total_cut += (paid / 5).min(owed_before);
    }
    assert_eq!(c.shops.get("arena").unwrap().owed.0, 0, "fully repaid");
    let owed = c.dividends_of(bob(), "arena".into()).0;
    assert!(owed <= total_cut && owed + 10 >= 2 * MILLI * 11 / 10, "{owed}");
    ctx(bob(), 0, t + 1);
    assert_eq!(c.claim("arena".into()).0, owed);
    assert_eq!(c.dividends_of(bob(), "arena".into()).0, 0);
    ctx(bob(), 1, t + 2);
    assert!(fails(|| c.mt_transfer(alice(), "share:arena".into(), U128(1), None, None)).contains("ERR_SHARE_LOCKED"));
}

#[test]
fn keeper_take_never_touches_the_floor_or_what_investors_are_owed() {
    let mut c = town();
    ctx(board(), 10 * MILLI + MILLI / 2, 2);
    c.invest(bob(), "arena".into(), None);
    let s = c.shops.get("arena").unwrap().clone();
    let free = s.till.0 - 2 * s.floor.0 - s.owed.0;
    ctx(arena_keeper(), 0, 3);
    assert!(fails(|| c.keeper_take("arena".into(), U128(free + 1))).contains("ERR_TILL"));
    c.keeper_take("arena".into(), U128(free));
    ctx(alice(), 0, 4);
    assert!(fails(|| c.keeper_take("arena".into(), U128(1))).contains("ERR_NOT_KEEPER"));
}

#[test]
fn crafting_burns_the_recipe_and_a_tool_doubles_gathers_then_wears_out() {
    let mut c = town();
    let t = gather_n(&mut c, alice(), "ore-1", 2, 0);
    let t = gather_n(&mut c, alice(), "wood-1", 1, t);
    ctx(alice(), 0, t + 1);
    c.craft("item:tool".into());
    assert_eq!(c.mt_balance_of(alice(), "item:tool".into()).0, 1);
    assert_eq!(c.mt_balance_of(alice(), "good:iron".into()).0, 0);
    assert!(get_logs().iter().any(|l| l.contains("mt_burn")));
    let t = gather_n(&mut c, alice(), "ore-1", TOOL_LIFE as u64, t + 1);
    assert_eq!(c.mt_balance_of(alice(), "good:iron".into()).0, 2 * TOOL_LIFE as u128);
    assert_eq!(c.mt_balance_of(alice(), "item:tool".into()).0, 0, "worn out");
    ctx(alice(), 0, t + 1);
    assert!(fails(|| c.craft("item:tonic".into())).contains("ERR_BALANCE"));
}

#[test]
fn an_order_burns_the_goods_pays_wages_and_raises_reputation() {
    let mut c = town();
    ctx(board(), 3 * MILLI + 2 * MILLI, 2);
    let o = c.post_order(bob(), "good:iron".into(), 3, U128(MILLI), "iron for the bridge".into());
    let t = gather_n(&mut c, alice(), "ore-1", 3, 2);
    ctx(alice(), 0, t + 1);
    assert_eq!(c.fill_order(o, 2, None).0, 2 * MILLI);
    assert_eq!(c.get_citizen(alice()).reputation, 1);
    assert_eq!(c.mt_supply("good:iron".into()).unwrap().0, 40 + 1);
    ctx(bob(), 0, t + 2);
    assert_eq!(c.cancel_order(o).0, MILLI);
    assert!(c.orders(None, None).is_empty());
    assert_eq!(level(0), 1);
    assert_eq!(level(3), 2);
    assert_eq!(level(9), 3);
}

#[test]
fn every_item_kind_lives_in_one_contract_and_emits_nep245_events() {
    let mut c = town();
    let t = gather_n(&mut c, alice(), "ore-1", 2, 0);
    let t = gather_n(&mut c, alice(), "wood-1", 2, t);
    ctx(alice(), 0, t + 1);
    c.craft("item:tool".into());
    ctx(board(), MILLI + MILLI / 2, t + 2);
    c.invest(alice(), "ferry".into(), None);
    assert!(get_logs().iter().any(|l| l.starts_with("EVENT_JSON:{\"standard\":\"nep245\",\"version\":\"1.0.0\",\"event\":\"mt_mint\"") && l.contains("share:ferry")));
    let held = c.mt_batch_balance_of(alice(), vec!["item:tool".into(), "share:ferry".into(), "good:timber".into()]);
    assert_eq!(held, vec![U128(1), U128(1), U128(1)]);
    let mine: Vec<String> = c.mt_tokens_for_owner(alice(), None, None).into_iter().map(|t| t.token_id).collect();
    assert_eq!(mine, vec!["good:timber".to_string(), "item:tool".into(), "share:ferry".into()]);
    assert!(c.mt_tokens(None, Some(100)).len() >= 8);
    let m = c.mt_metadata_token_all(vec!["item:tool".into(), "nope".into()]);
    assert!(m[0].is_some() && m[1].is_none());
    assert_eq!(c.mt_metadata_contract().spec, "mt-1.0.0");
    assert_eq!(c.mt_batch_supply(vec!["item:tool".into(), "nope".into()]), vec![Some(U128(1)), None]);
}

#[test]
fn transfers_cap_the_batch_and_log_one_event() {
    let mut c = town();
    let t = gather_n(&mut c, alice(), "ore-1", 2, 0);
    let t = gather_n(&mut c, alice(), "wood-1", 1, t);
    ctx(alice(), 1, t + 1);
    c.mt_batch_transfer(bob(), vec!["good:iron".into(), "good:timber".into()], vec![U128(1), U128(1)], None, Some("gift".into()));
    let logs: Vec<String> = get_logs().into_iter().filter(|l| l.contains("mt_transfer")).collect();
    assert_eq!(logs.len(), 1);
    assert!(logs[0].contains("[\"good:iron\",\"good:timber\"]"));
    let many: Vec<String> = (0..17).map(|_| "good:iron".to_string()).collect();
    let amounts = vec![U128(1); 17];
    ctx(alice(), 1, t + 2);
    assert!(fails(|| c.mt_batch_transfer(bob(), many, amounts, None, None)).contains("ERR_BATCH"));
}

#[test]
fn transfer_call_refuses_too_little_gas() {
    let mut c = town();
    let t = gather_n(&mut c, alice(), "ore-1", 1, 0);
    let mut b = VMContextBuilder::new();
    b.current_account_id(here()).predecessor_account_id(alice()).attached_deposit(NearToken::from_yoctonear(1))
        .block_timestamp(t + 1).prepaid_gas(Gas::from_tgas(40));
    testing_env!(b.build());
    assert!(fails(|| c.mt_transfer_call(bob(), "good:iron".into(), U128(1), None, None, "".into())).contains("ERR_GAS"));
}

#[test]
fn every_event_is_valid_json_even_with_a_hostile_memo() {
    let mut c = town();
    let t = gather_n(&mut c, alice(), "ore-1", 1, 0);
    ctx(alice(), 1, t + 1);
    c.mt_transfer(bob(), "good:iron".into(), U128(1), None, Some("a \"quote\" \\ and\nline".into()));
    for l in get_logs() {
        let v: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(l.strip_prefix("EVENT_JSON:").unwrap()).expect(&l);
        assert_eq!(v["data"][0]["memo"], "a \"quote\" \\ and\nline");
    }
}

#[test]
fn only_this_account_can_migrate_and_there_is_no_public_reinit() {
    let mut c = town();
    c.flush_all();
    near_sdk::env::state_write(&c);
    ctx(here(), 0, 9);
    let m = Contract::migrate();
    assert_eq!(m.get_config().version, STATE_VERSION);
    assert_eq!(m.market_board().len(), 2);
    ctx(alice(), 1, 10);
    let mut c2 = m;
    assert!(fails(|| c2.upgrade()).contains("ERR_OWNER"));
}

#[test]
#[should_panic(expected = "ERR_PRIVATE")]
fn a_stranger_cannot_migrate() {
    let c = town();
    near_sdk::env::state_write(&c);
    ctx(alice(), 0, 9);
    Contract::migrate();
}

/// The contract-level round trip: one actor buys and sells the same good at the
/// same shop across hours and ends with the shelf where it began. The shop never loses.
#[test]
fn a_round_trip_through_the_contract_never_gains() {
    let mut c = town();
    ctx(owner(), 0, 1);
    let mut k = caps();
    k.player_payout_per_day = U128(NEAR);
    c.set_caps(k);
    let mut t = 10;
    let mut spent: i128 = 0;
    let mut seed: u64 = 11;
    let mut net: i64 = 0;
    for i in 0..60 {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let buy = (seed >> 40) % 2 == 0 || net <= 0;
        t += if i % 7 == 0 { HOUR_NS } else { 1 };
        if buy {
            ctx(board(), NEAR, t);
            spent += c.buy(alice(), "arena".into(), "good:iron".into(), 1, U128(NEAR)).0 as i128;
            net += 1;
        } else {
            ctx(alice(), 0, t);
            spent -= c.sell("arena".into(), "good:iron".into(), 1, U128(0), None).0 as i128;
            net -= 1;
        }
    }
    while net > 0 {
        t += 1;
        ctx(alice(), 0, t);
        spent -= c.sell("arena".into(), "good:iron".into(), 1, U128(0), None).0 as i128;
        net -= 1;
    }
    assert!(spent > 0, "the actor gained {}", -spent);
}

#[test]
fn the_market_board_quotes_every_good_with_four_reasons() {
    let c = town();
    let b = c.market_board();
    assert_eq!(b.len(), 2);
    assert!(b[0].open);
    assert_eq!(b[0].goods[0].quote.reasons.len(), 4);
    assert_eq!(b[0].goods[0].quote.reasons[0].why, "20 on the shelf, the shop wants 20");
    assert_eq!(c.recipes().len(), 2);
    let cfg = c.get_config();
    assert_eq!(cfg.city_paid_today.0, 0);
}

// ---------- purse, stalls, council ----------

fn alice_purse(c: &mut Contract) -> u64 {
    let t = gather_n(c, alice(), "ore-1", 6, 0);
    ctx(alice(), 0, t + 1);
    let got = c.sell("arena".into(), "good:iron".into(), 3, U128(0), Some(true)).0;
    assert_eq!(c.square(Some(alice())).purse.0, got);
    t + 1
}

#[test]
fn keep_leaves_the_sale_in_the_purse_and_withdraw_pays_it() {
    let mut c = town();
    let t = alice_purse(&mut c);
    let p = c.square(Some(alice())).purse.0;
    assert!(p > 0);
    ctx(alice(), 0, t + 1);
    assert!(fails(|| c.purse("withdraw".into(), U128(p + 1), None)).contains("ERR_PURSE"));
    c.purse("withdraw".into(), U128(p), None);
    assert_eq!(c.square(Some(alice())).purse.0, 0);
}

#[test]
fn a_player_rents_lists_and_sells_from_a_stall() {
    let mut c = town();
    let t = alice_purse(&mut c);
    let arena0 = till(&c, "arena");
    ctx(alice(), 0, t + 2);
    c.stall(1, "rent".into(), None, None, None);
    assert_eq!(till(&c, "arena"), arena0 + MILLI);
    c.stall(1, "list".into(), Some("good:iron".into()), Some(2), Some(U128(MILLI)));
    // bob earns a purse, then buys from alice's stall
    let tb = gather_n(&mut c, bob(), "wood-1", 6, t + 2);
    ctx(bob(), 0, tb + 1);
    c.sell("ferry".into(), "good:timber".into(), 6, U128(0), Some(true));
    assert!(fails(|| c.stall(1, "rent".into(), None, None, None)).contains("ERR_STALL_TAKEN"));
    let a0 = c.square(Some(alice())).purse.0;
    assert!(fails(|| c.stall(1, "buy".into(), None, Some(1), Some(U128(MILLI - 1)))).contains("ERR_PRICE_MOVED"));
    c.stall(1, "buy".into(), None, Some(1), Some(U128(MILLI)));
    assert_eq!(c.square(Some(alice())).purse.0, a0 + MILLI);
    assert_eq!(c.mt_balance_of(bob(), "good:iron".into()).0, 1);
    assert_eq!(c.square(None).stalls[0].qty, 1);
    assert!(get_logs().iter().any(|l| l.contains("stall_sale")));
    // the stall frees up when the rent runs out
    ctx(bob(), 0, tb + 1 + 8 * DAY_NS);
    assert!(fails(|| c.stall(1, "buy".into(), None, Some(1), Some(U128(MILLI)))).contains("ERR_STALL_CLOSED"));
}

#[test]
fn the_council_changes_a_rule_at_quorum_and_the_floor_follows() {
    let mut c = town();
    ctx(alice(), 0, 5);
    assert!(fails(|| c.set_council(vec![arena_keeper(), ferry_keeper()], 2)).contains("ERR"));
    ctx(owner(), 0, 5);
    c.set_council(vec![arena_keeper(), ferry_keeper(), bob()], 2);
    ctx(alice(), 0, 6);
    assert!(fails(|| c.council(true, Some("floor_bps".into()), Some(U128(8000)), None)).contains("ERR_NOT_MEMBER"));
    ctx(arena_keeper(), 0, 6);
    assert!(fails(|| c.council(true, Some("floor_bps".into()), Some(U128(100)), None)).contains("ERR_RULE_VALUE"));
    c.council(true, Some("floor_bps".into()), Some(U128(8000)), Some("chatcmpl-1".into()));
    assert!(fails(|| c.council(true, None, None, None)).contains("ERR_VOTED"));
    assert_eq!(c.square(None).rules.floor_bps, 10_000);
    let before = c.market_board().into_iter().find(|s| s.id == "arena").unwrap().floor.0;
    ctx(ferry_keeper(), 0, 7);
    c.council(true, None, None, Some("chatcmpl-2".into()));
    assert_eq!(c.square(None).rules.floor_bps, 8000);
    assert!(c.square(None).council.open.is_none());
    assert!(get_logs().iter().any(|l| l.contains("rule_changed")));
    let after = c.market_board().into_iter().find(|s| s.id == "arena").unwrap().floor.0;
    assert_eq!(after, before * 8 / 10);
    // a rejected proposal changes nothing
    ctx(bob(), 0, 8);
    c.council(true, Some("stall_rent".into()), Some(U128(2 * MILLI)), None);
    ctx(arena_keeper(), 0, 9);
    c.council(false, None, None, None);
    ctx(ferry_keeper(), 0, 9);
    c.council(false, None, None, None);
    assert_eq!(c.square(None).rules.stall_rent.0, MILLI);
    assert!(c.square(None).council.open.is_none());
}

#[test]
fn invest_from_the_purse_mints_shares() {
    let mut c = town();
    let t = alice_purse(&mut c);
    let p = c.square(Some(alice())).purse.0;
    ctx(alice(), 0, t + 1);
    let u = c.purse("invest".into(), U128(p), Some("ferry".into())).0;
    assert_eq!(u, p / MILLI);
    assert_eq!(c.mt_balance_of(alice(), "share:ferry".into()).0, u);
}
