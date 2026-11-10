// The live market (state version 1, `market.v1.wasm`) upgrades in place to the
// committed build: the old state survives, then a player keeps a sale in their
// purse and rents a stall, and the keepers' council changes a rule on chain.
//
// Local near-sandbox only. No mainnet transaction.
use near_workspaces::types::{Gas, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, Contract};
use serde_json::{json, Value};

const V1_WASM: &str = "../artifacts/market.v1.wasm";
const MARKET_WASM: &str = "../artifacts/market.wasm";
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MILLI: u128 = NEAR / 1_000;

async fn call(who: &Account, m: &Contract, method: &str, args: Value) -> anyhow::Result<(bool, String, Vec<String>)> {
    let out = who.call(m.id(), method).args_json(args).gas(Gas::from_tgas(100)).transact().await?;
    Ok((out.is_success(), format!("{:?}", out.failures()), out.logs().iter().map(|s| s.to_string()).collect()))
}

fn amount(v: &Value) -> u128 { v.as_str().unwrap().parse().unwrap() }

#[tokio::test]
async fn v1_state_upgrades_and_the_council_changes_a_rule() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let owner = worker.create_tla("nearcarta".parse()?, SecretKey::from_random(KeyType::ED25519)).await?.into_result()?;
    let acc = owner.create_subaccount("arena").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    let market = acc.deploy(&std::fs::read(V1_WASM)?).await?.into_result()?;
    let caps = json!({ "gathers_per_day": 200, "player_payout_per_day": (50 * MILLI).to_string(), "city_payout_per_day": (NEAR / 10).to_string(), "storage_min": (5 * MILLI).to_string() });
    let board = owner.create_subaccount("board").initial_balance(NearToken::from_near(1)).transact().await?.into_result()?;
    let r = owner.call(market.id(), "new").args_json(json!({ "owner": owner.id(), "board": board.id(), "caps": caps })).transact().await?;
    assert!(r.is_success(), "new: {:?}", r.failures());
    for t in ["good:iron", "good:timber"] {
        assert!(owner.call(market.id(), "register_token").args_json(json!({ "token_id": t, "meta": { "title": t, "description": t, "kind": "good" } })).transact().await?.is_success());
    }
    let mut keepers = vec![];
    for id in ["arena", "smith", "tavern"] {
        let k = owner.create_subaccount(&format!("keeper-{id}")).initial_balance(NearToken::from_near(1)).transact().await?.into_result()?;
        let goods = json!([{ "good": "good:iron", "base": (2 * MILLI).to_string(), "target": "20" }]);
        let r = owner.call(market.id(), "open_shop").args_json(json!({ "id": id, "keeper": k.id(), "floor": (20 * MILLI).to_string(), "goods": goods }))
            .deposit(NearToken::from_yoctonear(60 * MILLI)).transact().await?;
        assert!(r.is_success(), "{:?}", r.failures());
        assert!(owner.call(market.id(), "stock_shop").args_json(json!({ "shop": id, "good": "good:iron", "qty": "20" })).transact().await?.is_success());
        keepers.push(k);
    }
    assert!(owner.call(market.id(), "set_node").args_json(json!({ "node": "ore-1", "good": "good:iron" })).transact().await?.is_success());
    let player = owner.create_subaccount("player").initial_balance(NearToken::from_near(1)).transact().await?.into_result()?;
    let buyer = owner.create_subaccount("buyer").initial_balance(NearToken::from_near(1)).transact().await?.into_result()?;
    for p in [&player, &buyer] {
        assert!(p.call(market.id(), "storage_deposit").args_json(json!({})).deposit(NearToken::from_yoctonear(20 * MILLI)).transact().await?.is_success());
        let (ok, f, _) = call(p, &market, "gather", json!({ "node": "ore-1" })).await?;
        assert!(ok, "{f}");
    }
    let before: Vec<Value> = market.view("market_board").await?.json()?;

    // A stranger cannot upgrade; the owner can, and the state carries over.
    let wasm = std::fs::read(MARKET_WASM)?;
    let r = player.call(market.id(), "upgrade").args(wasm.clone()).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(300)).transact().await?;
    assert!(!r.is_success());
    let r = owner.call(market.id(), "upgrade").args(wasm).deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(300)).transact().await?;
    assert!(r.is_success(), "upgrade: {:?}", r.failures());
    println!("upgrade burnt {} TGas", r.total_gas_burnt.as_gas() / 1_000_000_000_000);
    let after: Vec<Value> = market.view("market_board").await?.json()?;
    assert_eq!(before, after, "shops carry over unchanged");
    let iron: String = market.view("mt_balance_of").args_json(json!({ "account_id": player.id(), "token_id": "good:iron" })).await?.json()?;
    assert_eq!(iron, "1");
    let sq: Value = market.view("square").args_json(json!({})).await?.json()?;
    assert_eq!(sq["rules"]["floor_bps"], 10000);

    // The player keeps a sale in their purse and rents a stall from it.
    let (ok, f, _) = call(&player, &market, "sell", json!({ "shop": "smith", "good": "good:iron", "qty": 1, "min_total": "0", "keep": true })).await?;
    assert!(ok, "{f}");
    let (ok, f, _) = call(&buyer, &market, "sell", json!({ "shop": "smith", "good": "good:iron", "qty": 1, "min_total": "0", "keep": true })).await?;
    assert!(ok, "{f}");
    let sq: Value = market.view("square").args_json(json!({ "account_id": player.id() })).await?.json()?;
    assert!(amount(&sq["purse"]) >= MILLI, "purse {sq}");
    let (ok, f, logs) = call(&player, &market, "stall", json!({ "stall": 1, "action": "rent" })).await?;
    assert!(ok && logs.iter().any(|l| l.contains("stall_rented")), "{f}");
    let (ok, _, _) = call(&buyer, &market, "stall", json!({ "stall": 1, "action": "rent" })).await?;
    assert!(!ok, "a rented stall is taken");

    // The keepers' council: a stranger cannot set it or propose; two of three change the floor.
    let members: Vec<String> = keepers.iter().map(|k| k.id().to_string()).collect();
    let (ok, _, _) = call(&player, &market, "set_council", json!({ "members": members, "quorum": 2 })).await?;
    assert!(!ok);
    let (ok, f, _) = call(&owner, &market, "set_council", json!({ "members": members, "quorum": 2 })).await?;
    assert!(ok, "{f}");
    let (ok, _, _) = call(&player, &market, "council", json!({ "yes": true, "rule": "floor_bps", "value": "8000" })).await?;
    assert!(!ok);
    let (ok, f, _) = call(&keepers[0], &market, "council", json!({ "yes": true, "rule": "floor_bps", "value": "8000", "decision": "chatcmpl-a" })).await?;
    assert!(ok, "{f}");
    let (ok, f, logs) = call(&keepers[1], &market, "council", json!({ "yes": true, "decision": "chatcmpl-b" })).await?;
    assert!(ok && logs.iter().any(|l| l.contains("rule_changed")), "{f}");
    let sq: Value = market.view("square").args_json(json!({})).await?.json()?;
    assert_eq!(sq["rules"]["floor_bps"], 8000);
    let board: Vec<Value> = market.view("market_board").await?.json()?;
    let smith = board.iter().find(|s| s["id"] == "smith").unwrap();
    assert_eq!(amount(&smith["floor"]), 16 * MILLI);
    Ok(())
}
