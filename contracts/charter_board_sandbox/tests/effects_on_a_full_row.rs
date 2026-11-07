// Does a row that is full of a real four-shop call list still accept an effect budget?
//
// Measured on mainnet 2026-11-07: a four-shop row is exactly full at five pairs (2000/2000), so
// `set_effects` panicked ERR_ROW_TOO_BIG and no visitor could ever pass the toll. `set_calls`
// charges SIDE_RESERVE_BYTES and stores it as `credit`; `set_effects` charged the row again.
//
// Local near-sandbox only. No mainnet transaction.
use ed25519_dalek::SigningKey;
use near_workspaces::types::{KeyType, NearToken, SecretKey};
use serde_json::{json, Value};

const WASM: &str = "../charter_board/target/near/charter_board.wasm";
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MAX_ROW: u128 = 20_000_000_000_000_000_000_000;
const TGAS: u64 = 1_000_000_000_000;

fn hex32(b: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::new();
    for x in b { s.push(H[(x >> 4) as usize] as char); s.push(H[(x & 15) as usize] as char); }
    s
}

fn rules(receivers: &[&str]) -> Value {
    json!({
        "receivers": receivers,
        "per_action_cap": (NEAR / 10).to_string(),
        "daily_budget": (NEAR / 2).to_string(),
        "max_actions_per_day": 20,
        "window_start_min": 0,
        "window_end_min": 0,
        "min_amount": (NEAR / 10_000).to_string(),
        "expires_at": "1794063519225000000"
    })
}

#[tokio::test]
async fn a_four_shop_row_still_takes_an_effect_budget() -> anyhow::Result<()> {
    let wasm = std::fs::read(WASM).expect("build target/near/charter_board.wasm first");
    let worker = near_workspaces::sandbox().await?;
    let owner = worker.create_tla("nearcarta".parse()?, SecretKey::from_random(KeyType::ED25519)).await?.into_result()?;
    let board = owner.create_subaccount("board").initial_balance(NearToken::from_near(80)).transact().await?.into_result()?;
    let deployed = board.deploy(&wasm).await?.into_result()?;
    assert!(owner.call(deployed.id(), "new").gas(near_workspaces::types::Gas::from_tgas(50)).transact().await?.is_success());

    let visitor = worker.dev_create_account().await?;
    let key = SigningKey::from_bytes(&[11u8; 32]);
    let shops = ["toll.nearcarta.near", "guard.nearcarta.near", "house.nearcarta.near", "arena.nearcarta.near"];
    let opened = visitor.call(deployed.id(), "open_charter")
        .args_json(json!({ "rules": rules(&shops), "agent": hex32(key.verifying_key().as_bytes()), "fund": (NEAR / 100).to_string() }))
        .deposit(NearToken::from_yoctonear(MAX_ROW))
        .gas(near_workspaces::types::Gas::from_gas(60 * TGAS))
        .transact().await?;
    assert!(opened.is_success(), "open: {:?}", opened.failures());

    // The list a four-shop row can actually carry: five pairs, which measured 2000 bytes locked.
    let cap = (NEAR / 50).to_string();
    let calls = json!({ "calls": [
        { "receiver": "toll.nearcarta.near", "method": "cross", "cap": cap.clone() },
        { "receiver": "guard.nearcarta.near", "method": "pay", "cap": cap.clone() },
        { "receiver": "house.nearcarta.near", "method": "house_session_check_in", "cap": cap.clone() },
        { "receiver": "arena.nearcarta.near", "method": "ft_transfer", "cap": cap.clone() },
        { "receiver": "wrap.near", "method": "near_deposit", "cap": cap.clone() },
    ], "session_cap": (NEAR / 10).to_string() });
    let set = visitor.call(deployed.id(), "set_calls")
        .args_json(calls)
        .deposit(NearToken::from_yoctonear(15 * NEAR / 1000))
        .gas(near_workspaces::types::Gas::from_gas(60 * TGAS))
        .transact().await?;
    assert!(set.is_success(), "set_calls: {:?}", set.failures());
    let row: Value = deployed.view("get_charter").args_json(json!({ "owner": visitor.id() })).await?.json()?;
    let locked_after_calls = row["storage_locked"].as_str().unwrap().parse::<u128>()? / 10u128.pow(19);
    println!("after set_calls: locked {locked_after_calls} bytes (the side reserve is inside storage_locked)");

    // The crossing the toll needs. Before the fix this panicked ERR_ROW_TOO_BIG.
    let effects = visitor.call(deployed.id(), "set_effects")
        .args_json(json!({ "effects": [
            { "chain": "base", "asset": "native", "to": "0x0000000000000000000000000000000000000001", "value": (NEAR / 1000).to_string(), "fee": (NEAR / 1000).to_string() }
        ] }))
        .deposit(NearToken::from_yoctonear(NEAR / 20))
        .gas(near_workspaces::types::Gas::from_gas(60 * TGAS))
        .transact().await?;
    let row2: Value = deployed.view("get_charter").args_json(json!({ "owner": visitor.id() })).await?.json()?;
    let locked_final = row2["storage_locked"].as_str().unwrap().parse::<u128>()? / 10u128.pow(19);
    println!("after set_effects: {} locked {locked_final} bytes", if effects.is_success() { "OK" } else { "REFUSED" });
    assert!(effects.is_success(), "a four-shop row must be able to hold an effect budget: {:?}", effects.failures());
    assert!(locked_final <= 2000, "the row stays inside its allowance: {locked_final}");
    Ok(())
}

// The anchor test in anchor.rs runs against the same wasm, so this file plus that one prove the
// build carries both the hydrate fix and the charge_acts fix. Run them together:
//   cargo test --test anchor --test effects_on_a_full_row
