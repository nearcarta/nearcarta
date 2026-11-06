//! One board, more than 1000 rows, one failing call.
//! The callback refunds that one row. It must not run out of gas loading the others.
//! Local near-sandbox only. This does not sign a mainnet transaction.
use ed25519_dalek::{Signer, SigningKey};
use near_workspaces::types::{KeyType, NearToken, SecretKey};
use near_workspaces::AccountId;
use serde_json::{json, Value};

const WASM: &str = "../charter_board/target/near/charter_board.wasm";
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MAX_ROW: u128 = 20_000_000_000_000_000_000_000;
const ROWS: u32 = 1000;

fn hex32(b: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::new();
    for x in b {
        s.push(H[(x >> 4) as usize] as char);
        s.push(H[(x & 15) as usize] as char);
    }
    s
}

fn rules(shop: &AccountId) -> Value {
    json!({
        "receivers": [shop],
        "per_action_cap": (NEAR / 500).to_string(),
        "daily_budget": (NEAR / 200).to_string(),
        "max_actions_per_day": 4,
        "window_start_min": 0,
        "window_end_min": 0,
        "min_amount": "1",
        "expires_at": "0"
    })
}

#[tokio::test]
async fn a_thousand_rows_still_refund_one_failed_call() -> anyhow::Result<()> {
    let wasm = std::fs::read(WASM).expect("build target/near/charter_board.wasm first");
    let worker = near_workspaces::sandbox().await?;
    let owner = worker.create_tla("nearcarta".parse()?, SecretKey::from_random(KeyType::ED25519)).await?.into_result()?;
    let board = owner.create_subaccount("board").initial_balance(NearToken::from_near(30)).transact().await?.into_result()?;
    let deployed = board.deploy(&wasm).await?.into_result()?;
    let init = owner.call(deployed.id(), "new").gas(near_workspaces::types::Gas::from_tgas(50)).transact().await?;
    assert!(init.is_success(), "new: {:?}", init.failures());

    let shop = worker.dev_create_account().await?;
    let payer = worker.dev_create_account().await?;
    let sk = SigningKey::from_bytes(&[7u8; 32]);
    let opened = payer.call(deployed.id(), "open_charter")
        .args_json(json!({ "rules": rules(shop.id()), "agent": hex32(sk.verifying_key().as_bytes()), "fund": (NEAR / 1000).to_string() }))
        .deposit(NearToken::from_yoctonear(MAX_ROW))
        .gas(near_workspaces::types::Gas::from_tgas(80))
        .transact().await?;
    assert!(opened.is_success(), "payer open: {:?}", opened.failures());
    let calls = payer.call(deployed.id(), "set_calls")
        .args_json(json!({
            "calls": [{ "receiver": shop.id(), "method": "missing", "cap": (NEAR / 500).to_string() }],
            "session_cap": (NEAR / 200).to_string(),
        }))
        .deposit(NearToken::from_yoctonear(MAX_ROW))
        .gas(near_workspaces::types::Gas::from_tgas(80))
        .transact().await?;
    assert!(calls.is_success(), "set_calls: {:?}", calls.failures());

    for i in 1..ROWS {
        let user = worker.dev_create_account().await?;
        let agent = hex32(&[i as u8, (i >> 8) as u8, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]);
        let opened = user.call(deployed.id(), "open_charter")
            .args_json(json!({ "rules": rules(shop.id()), "agent": &agent[..64], "fund": "1" }))
            .deposit(NearToken::from_yoctonear(MAX_ROW))
            .gas(near_workspaces::types::Gas::from_tgas(80))
            .transact().await?;
        assert!(opened.is_success(), "row {i}: {:?}", opened.failures());
    }

    let config: Value = deployed.view("get_config").await?.json()?;
    assert_eq!(config["rows"], ROWS);

    let before: Value = deployed.view("get_charter").args_json(json!({ "owner": payer.id() })).await?.json()?;
    let balance = before["balance"].as_str().unwrap().to_string();
    let message = deployed.view("call_message").args_json(json!({
        "owner": payer.id(),
        "receiver": shop.id(),
        "method": "missing",
        "args": "{}",
        "deposit": "1",
        "nonce": "0",
    })).await?;
    let signature = hex32(&sk.sign(&message.result).to_bytes());
    let sent = payer.call(deployed.id(), "propose_call")
        .args_json(json!({
            "owner": payer.id(),
            "receiver": shop.id(),
            "method": "missing",
            "args": "{}",
            "deposit": "1",
            "signature": signature,
        }))
        .gas(near_workspaces::types::Gas::from_tgas(150))
        .transact().await?;
    assert!(sent.is_success(), "callback with {ROWS} rows: {:?}", sent.failures());
    let after: Value = deployed.view("get_charter").args_json(json!({ "owner": payer.id() })).await?.json()?;
    assert_eq!(after["balance"].as_str().unwrap(), balance, "the failed call refunds only this row");
    let still: Value = deployed.view("get_config").await?.json()?;
    assert_eq!(still["rows"], ROWS);
    Ok(())
}
