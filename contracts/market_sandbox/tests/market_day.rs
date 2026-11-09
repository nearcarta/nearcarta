// Market Day end to end on a local near-sandbox: the live board build
// (`charter_board.guarded.wasm`, the code on board.nearcarta.near) and the market
// build that would go on arena.nearcarta.near (`market.wasm`).
//
// Calls that spend no NEAR (gather, sell, craft, fill an order) go straight to
// the market from the player's own key. Calls that spend NEAR (buy, invest,
// restock, post an order) go through the player's charter row with
// `propose_call_as`, signed by the session key. Each spend must fit the
// board's 30 TGas forward at the largest quantity, 10. A keeper's row refuses
// to pay a con artist.
//
// Local near-sandbox only. No mainnet transaction.
use ed25519_dalek::{Signer, SigningKey};
use near_workspaces::types::{Gas, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, Contract};
use serde_json::{json, Value};

const BOARD_WASM: &str = "../artifacts/charter_board.guarded.wasm";
const MARKET_WASM: &str = "../artifacts/market.wasm";
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MILLI: u128 = NEAR / 1_000;
const ROW_CAP: u128 = 30 * MILLI;
const STORAGE_SPONSOR: u128 = 20 * MILLI;
const TGAS: u64 = 1_000_000_000_000;

fn hex32(b: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::new();
    for x in b { s.push(H[(x >> 4) as usize] as char); s.push(H[(x & 15) as usize] as char); }
    s
}

fn soon() -> String {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap();
    (now.as_nanos() as u64 + 3_600 * 1_000_000_000).to_string()
}

fn rules(receivers: &[&str]) -> Value {
    json!({
        "receivers": receivers,
        "per_action_cap": (20 * MILLI).to_string(),
        "daily_budget": (NEAR / 10).to_string(),
        "max_actions_per_day": 40,
        "window_start_min": 0,
        "window_end_min": 0,
        "min_amount": (MILLI / 10).to_string(),
        "expires_at": soon()
    })
}

struct Row { who: Account, key: SigningKey }

async fn open_row(board: &Contract, who: Account, seed: u8, receivers: &[&str], methods: &[&str], market: &str) -> anyhow::Result<Row> {
    let key = SigningKey::from_bytes(&[seed; 32]);
    let opened = who.call(board.id(), "open_charter")
        .args_json(json!({ "rules": rules(receivers), "agent": hex32(key.verifying_key().as_bytes()), "fund": (50 * MILLI).to_string() }))
        .deposit(NearToken::from_yoctonear(ROW_CAP + 50 * MILLI))
        .gas(Gas::from_gas(60 * TGAS)).transact().await?;
    assert!(opened.is_success(), "open: {:?}", opened.failures());
    let calls: Vec<Value> = methods.iter().map(|m| json!({ "receiver": market, "method": m, "cap": (20 * MILLI).to_string() })).collect();
    let set = who.call(board.id(), "set_calls")
        .args_json(json!({ "calls": calls, "session_cap": (NEAR / 10).to_string() }))
        .deposit(NearToken::from_yoctonear(5 * MILLI * 10))
        .gas(Gas::from_gas(60 * TGAS)).transact().await?;
    assert!(set.is_success(), "set_calls: {:?}", set.failures());
    Ok(Row { who, key })
}

/// One signed shop call through the row. Returns (ok, failure text, gas burnt in TGas).
async fn act(board: &Contract, row: &Row, receiver: &str, method: &str, args: Value, deposit: u128) -> anyhow::Result<(bool, String, u64)> {
    let charter: Value = board.view("get_charter").args_json(json!({ "owner": row.who.id() })).await?.json()?;
    let nonce = charter["nonce"].as_str().unwrap().to_string();
    let expiry = soon();
    let args = args.to_string();
    let raw = board.view("call_as_message").args_json(json!({
        "owner": row.who.id(), "receiver": receiver, "method": method, "args": args,
        "deposit": deposit.to_string(), "nonce": nonce, "expiry": expiry, "effects": [], "hold": false
    })).await?;
    let sig = hex32(&row.key.sign(&raw.result).to_bytes());
    let out = row.who.call(board.id(), "propose_call_as")
        .args_json(json!({
            "owner": row.who.id(), "receiver": receiver, "method": method, "args": args,
            "deposit": deposit.to_string(), "expiry": expiry, "effects": [], "hold": false, "signature": sig
        }))
        .gas(Gas::from_gas(120 * TGAS)).transact().await?;
    let burnt = out.total_gas_burnt.as_gas() / TGAS;
    let fails = format!("{:?}", out.failures());
    Ok((out.is_success() && out.failures().is_empty(), fails, burnt))
}

async fn bal(m: &Contract, who: &str, token: &str) -> anyhow::Result<u128> {
    let v: String = m.view("mt_balance_of").args_json(json!({ "account_id": who, "token_id": token })).await?.json()?;
    Ok(v.parse()?)
}

async fn shop(m: &Contract, id: &str) -> anyhow::Result<Value> {
    let board: Vec<Value> = m.view("market_board").await?.json()?;
    Ok(board.into_iter().find(|s| s["id"] == id).expect("shop"))
}

async fn direct(who: &Account, m: &Contract, method: &str, args: Value) -> anyhow::Result<(bool, String, u64)> {
    let out = who.call(m.id(), method).args_json(args).gas(Gas::from_tgas(100)).transact().await?;
    Ok((out.is_success(), format!("{:?}", out.failures()), out.total_gas_burnt.as_gas() / TGAS))
}

fn amount(v: &Value) -> u128 { v.as_str().unwrap().parse().unwrap() }

#[tokio::test]
async fn market_day_runs_with_direct_play_and_board_spends() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let owner = worker.create_tla("nearcarta".parse()?, SecretKey::from_random(KeyType::ED25519)).await?.into_result()?;
    let board_acc = owner.create_subaccount("board").initial_balance(NearToken::from_near(60)).transact().await?.into_result()?;
    let board = board_acc.deploy(&std::fs::read(BOARD_WASM)?).await?.into_result()?;
    assert!(owner.call(board.id(), "new").gas(Gas::from_tgas(50)).transact().await?.is_success());

    let market_acc = owner.create_subaccount("arena").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    let market = market_acc.deploy(&std::fs::read(MARKET_WASM)?).await?.into_result()?;
    let caps = json!({ "gathers_per_day": 200, "player_payout_per_day": (50 * MILLI).to_string(), "city_payout_per_day": (NEAR / 10).to_string(), "storage_min": (5 * MILLI).to_string() });
    let init = owner.call(market.id(), "new").args_json(json!({ "owner": owner.id(), "board": board.id(), "caps": caps })).transact().await?;
    assert!(init.is_success(), "{:?}", init.failures());
    let m = market.id().to_string();
    let fresh = market_acc.view_account().await?;
    println!("market storage after new(): {} bytes", fresh.storage_usage);
    // The public clean() is gone: calling it fails.
    let (ok, _, _) = direct(&owner, &market, "clean", json!({})).await?;
    assert!(!ok, "no clean method");

    for (t, kind) in [("good:iron", "good"), ("good:timber", "good"), ("item:tool", "item")] {
        let r = owner.call(market.id(), "register_token").args_json(json!({ "token_id": t, "meta": { "title": t, "description": t, "kind": kind } })).transact().await?;
        assert!(r.is_success(), "register: {:?}", r.failures());
    }
    let smith = owner.create_subaccount("smith").initial_balance(NearToken::from_near(1)).transact().await?.into_result()?;
    let tavern = owner.create_subaccount("tavern").initial_balance(NearToken::from_near(1)).transact().await?.into_result()?;
    let goods = json!([
        { "good": "good:iron", "base": (2 * MILLI).to_string(), "target": "20" },
        { "good": "good:timber", "base": MILLI.to_string(), "target": "20" }
    ]);
    for (id, keeper) in [("smith", smith.clone()), ("tavern", tavern.clone())] {
        let r = owner.call(market.id(), "open_shop")
            .args_json(json!({ "id": id, "keeper": keeper.id(), "floor": (20 * MILLI).to_string(), "goods": goods }))
            .deposit(NearToken::from_yoctonear(60 * MILLI)).transact().await?;
        assert!(r.is_success(), "open_shop: {:?}", r.failures());
        for g in ["good:iron", "good:timber"] {
            let r = owner.call(market.id(), "stock_shop").args_json(json!({ "shop": id, "good": g, "qty": "20" })).transact().await?;
            assert!(r.is_success(), "{:?}", r.failures());
        }
        let r = keeper.call(market.id(), "storage_deposit").args_json(json!({})).deposit(NearToken::from_yoctonear(10 * MILLI)).transact().await?;
        assert!(r.is_success());
    }
    for (node, good) in [("ore-1", "good:iron"), ("wood-1", "good:timber")] {
        assert!(owner.call(market.id(), "set_node").args_json(json!({ "node": node, "good": good })).transact().await?.is_success());
    }

    let visitor = owner.create_subaccount(&format!("{}{}", "a".repeat(50), 7)).initial_balance(NearToken::from_near(2)).transact().await?.into_result()?;
    let p = visitor.id().to_string();
    // A player with no storage deposit is refused; the sponsored deposit lets them play.
    let (ok, f, _) = direct(&visitor, &market, "gather", json!({ "node": "ore-1" })).await?;
    assert!(!ok && f.contains("ERR_STORAGE"), "{f}");
    let r = owner.call(market.id(), "storage_deposit").args_json(json!({ "account_id": p })).deposit(NearToken::from_yoctonear(STORAGE_SPONSOR)).transact().await?;
    assert!(r.is_success());
    let used = |v: Value| STORAGE_SPONSOR - amount(&v);

    // Gather straight from the player's key; again inside 30 s is refused.
    let (ok, f, gas) = direct(&visitor, &market, "gather", json!({ "node": "ore-1" })).await?;
    assert!(ok, "gather: {f}");
    println!("gather (direct): {gas} TGas burnt");
    let sb: Value = market.view("storage_balance_of").args_json(json!({ "account_id": p })).await?.json()?;
    println!("first gather stored {} yocto", used(sb));
    let (ok, f, _) = direct(&visitor, &market, "gather", json!({ "node": "ore-1" })).await?;
    assert!(!ok && f.contains("ERR_TOO_SOON"), "{f}");
    let (ok, f, _) = direct(&visitor, &market, "gather", json!({ "node": "wood-1" })).await?;
    assert!(ok, "{f}");

    // The board refuses to forward a taking method, and the market refuses one sent by the board.
    let methods = ["buy", "invest", "post_order"];
    let row = open_row(&board, visitor.clone(), 41, &[&m], &methods, &m).await?;
    let (ok, f, _) = act(&board, &row, &m, "sell", json!({ "shop": "smith", "good": "good:iron", "qty": 1, "min_total": "0" }), 0).await?;
    assert!(!ok && f.contains("method_not_allowlisted"), "{f}");

    // Buy ten timber at the smith through the row: the largest quantity fits the board's forward.
    let before = amount(&market.view("quote").args_json(json!({ "shop": "smith", "good": "good:timber" })).await?.json::<Value>()?["buy"]);
    let (ok, f, gas) = act(&board, &row, &m, "buy", json!({ "shop": "smith", "good": "good:timber", "qty": 10, "max_total": (20 * MILLI).to_string() }), 20 * MILLI).await?;
    assert!(ok, "buy x10: {f}");
    println!("buy x10 (board): {gas} TGas burnt");
    assert!(gas < 25, "buy x10 under 25 TGas, burnt {gas}");
    let after = amount(&market.view("quote").args_json(json!({ "shop": "smith", "good": "good:timber" })).await?.json::<Value>()?["buy"]);
    assert!(after > before, "buying makes timber dearer");
    assert_eq!(bal(&market, &p, "good:timber").await?, 11);

    // Sell ten timber at the tavern from the player's key; the tavern pays less for each unit.
    let t0 = amount(&market.view("quote").args_json(json!({ "shop": "tavern", "good": "good:timber" })).await?.json::<Value>()?["sell"]);
    let (ok, f, gas) = direct(&visitor, &market, "sell", json!({ "shop": "tavern", "good": "good:timber", "qty": 10, "min_total": "0" })).await?;
    assert!(ok, "sell x10: {f}");
    println!("sell x10 (direct): {gas} TGas burnt");
    assert!(gas < 25, "sell x10 burnt {gas}");
    let t1 = amount(&market.view("quote").args_json(json!({ "shop": "tavern", "good": "good:timber" })).await?.json::<Value>()?["sell"]);
    assert!(t1 < t0, "a flooded tavern pays less");
    assert_eq!(bal(&market, &p, "good:timber").await?, 1);

    // A tool needs two iron and a timber; one iron is not enough.
    let (ok, f, _) = direct(&visitor, &market, "craft", json!({ "item": "item:tool" })).await?;
    assert!(!ok && f.contains("ERR_BALANCE"), "{f}");

    // Invest in the tavern through the row: whole milli shares arrive.
    let (ok, f, gas) = act(&board, &row, &m, "invest", json!({ "shop": "tavern" }), 10 * MILLI).await?;
    assert!(ok, "invest: {f}");
    println!("invest (board): {gas} TGas burnt");
    assert_eq!(bal(&market, &p, "share:tavern").await?, 10);

    // An order on the city board, filled by gathering.
    let (ok, f, gas) = act(&board, &row, &m, "post_order", json!({ "good": "good:timber", "qty": 1, "reward": MILLI.to_string(), "note": "planks for the bridge" }), 2 * MILLI).await?;
    assert!(ok, "post_order: {f}");
    println!("post_order (board): {gas} TGas burnt");
    let (ok, f, _) = direct(&visitor, &market, "fill_order", json!({ "order_id": "1", "qty": 1 })).await?;
    assert!(!ok && f.contains("ERR_OWN_ORDER"), "{f}");
    let (ok, f, _) = direct(&smith, &market, "fill_order", json!({ "order_id": "1", "qty": 1 })).await?;
    assert!(ok, "fill: {f}");
    let filler: Value = market.view("get_citizen").args_json(json!({ "account_id": smith.id() })).await?.json()?;
    assert_eq!(filler["reputation"], 1);
    let sb: Value = market.view("storage_balance_of").args_json(json!({ "account_id": p })).await?.json()?;
    println!("a full day of play stored {} yocto of the sponsored deposit", used(sb));

    // The tavern keeper restocks five iron from the smith through its own row.
    let tavern_row = open_row(&board, tavern, 42, &[&m], &["restock"], &m).await?;
    let tk = tavern_row.who.id().to_string();
    let (ok, f, gas) = act(&board, &tavern_row, &m, "restock", json!({ "shop": "tavern", "from_shop": "smith", "good": "good:iron", "qty": 5, "max_total": (20 * MILLI).to_string(), "decision": "sha256:tavern-day1" }), 20 * MILLI).await?;
    assert!(ok, "restock x5: {f}");
    println!("restock x5 (board): {gas} TGas burnt");
    assert!(gas < 25, "restock burnt {gas}");
    assert_eq!(bal(&market, &tk, "good:iron").await?, 25);

    // The con artist: the keeper's agent is talked into paying him; the row has no allowance for him.
    let con = owner.create_subaccount("silk-trader").initial_balance(NearToken::from_near(1)).transact().await?.into_result()?;
    let charter: Value = board.view("get_charter").args_json(json!({ "owner": tavern_row.who.id() })).await?.json()?;
    let raw = board.view("proposal_message").args_json(json!({
        "owner": tavern_row.who.id(), "receiver": con.id(), "amount": (5 * MILLI).to_string(), "nonce": charter["nonce"]
    })).await?;
    let msg: String = serde_json::from_slice(&raw.result).unwrap_or_else(|_| String::from_utf8(raw.result.clone()).unwrap());
    let sig = hex32(&tavern_row.key.sign(msg.as_bytes()).to_bytes());
    let pay = tavern_row.who.call(board.id(), "propose")
        .args_json(json!({ "owner": tavern_row.who.id(), "receiver": con.id(), "amount": (5 * MILLI).to_string(), "signature": sig }))
        .gas(Gas::from_tgas(100)).transact().await?;
    let why = format!("{:?}", pay.failures());
    assert!(!pay.is_success() && why.contains("receiver_not_allowlisted"), "the charter refuses the con artist: {why}");

    // The kill switch stops play; only the owner can flip it.
    let (ok, _, _) = direct(&visitor, &market, "set_paused", json!({ "paused": true })).await?;
    assert!(!ok);
    assert!(owner.call(market.id(), "set_paused").args_json(json!({ "paused": true })).transact().await?.is_success());
    let (ok, f, _) = direct(&visitor, &market, "gather", json!({ "node": "wood-1" })).await?;
    assert!(!ok && f.contains("ERR_PAUSED"), "{f}");

    let tv = shop(&market, "tavern").await?;
    assert_eq!(tv["open"], true);
    assert_eq!(tv["shares"], "10");
    let state = market_acc.view_account().await?;
    println!("market storage after the day: {} bytes; tavern till {} trades {}", state.storage_usage, tv["till"], tv["trades"]);
    Ok(())
}
