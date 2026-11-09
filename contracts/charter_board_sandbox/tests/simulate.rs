//! One local board, one visitor row with a call list, then the free `simulate` view.
//! Local near-sandbox only. This does not sign a mainnet transaction.
//!
//! The deployed board loads only its header (`read_head`, partial) and hydrates one row per
//! call. `simulate` skipped the hydrate, so on mainnet it answered `no_charter` for a row that
//! `get_charter` returned (measured 2026-11-09 on code hash CM6WA2gZ…). This pins a real
//! answer: allowed inside the caps, and the exact refusal words outside them.
//!
//! Run: cd contracts/charter_board_sandbox && cargo test --test simulate
use ed25519_dalek::SigningKey;
use near_workspaces::types::NearToken;
use near_workspaces::AccountId;
use serde_json::{json, Value};

const WASM: &str = "../charter_board/target/near/charter_board.wasm";
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MAX_ROW: u128 = 30_000_000_000_000_000_000_000;
const CALLS_DEPOSIT: u128 = 5 * NEAR / 100;

fn hex32(b: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::new();
    for x in b {
        s.push(H[(x >> 4) as usize] as char);
        s.push(H[(x & 15) as usize] as char);
    }
    s
}

async fn sim(board: &near_workspaces::Contract, owner: &AccountId, receiver: &AccountId, method: &str, deposit: u128) -> anyhow::Result<Value> {
    let out = board
        .view("simulate")
        .args_json(json!({ "owner": owner, "receiver": receiver, "method": method, "deposit": deposit.to_string(), "effects": [] }))
        .await?;
    let v: Value = out.json()?;
    // The view returns the JSON object itself.
    Ok(if let Some(s) = v.as_str() { serde_json::from_str(s)? } else { v })
}

#[tokio::test]
async fn simulate_reads_the_row_and_answers_allowed_and_refused() -> anyhow::Result<()> {
    let wasm = std::fs::read(WASM).expect("build contracts/charter_board/target/near/charter_board.wasm first");
    let worker = near_workspaces::sandbox().await?;
    let registrar = worker.dev_create_account().await?;
    let board = registrar.create_subaccount("board").initial_balance(NearToken::from_near(30)).transact().await?.into_result()?;
    let board = board.deploy(&wasm).await?.into_result()?;
    board.call("new").transact().await?.into_result()?;
    let visitor = registrar.create_subaccount("visitor").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    let hall = registrar.create_subaccount("hall").initial_balance(NearToken::from_near(2)).transact().await?.into_result()?;
    let other = registrar.create_subaccount("other").initial_balance(NearToken::from_near(2)).transact().await?.into_result()?;

    let agent = SigningKey::from_bytes(&[33u8; 32]);
    let rules = json!({
        "receivers": [hall.id()],
        "per_action_cap": (NEAR / 100).to_string(),
        "daily_budget": (NEAR / 20).to_string(),
        "max_actions_per_day": 8,
        "window_start_min": 0, "window_end_min": 0,
        "min_amount": (NEAR / 10_000).to_string(),
        "expires_at": "0"
    });
    visitor
        .batch(board.id())
        .call(near_workspaces::operations::Function::new("open_charter")
            .args_json(json!({ "rules": rules, "agent": hex32(agent.verifying_key().as_bytes()), "fund": (NEAR / 100).to_string() }))
            .deposit(NearToken::from_yoctonear(MAX_ROW))
            .gas(near_workspaces::types::Gas::from_tgas(100)))
        .call(near_workspaces::operations::Function::new("set_calls")
            .args_json(json!({ "calls": [
                { "receiver": hall.id(), "method": "post_job", "cap": (NEAR / 50).to_string() },
                { "receiver": hall.id(), "method": "bid", "cap": (NEAR / 1000).to_string() }
            ], "session_cap": (NEAR / 20).to_string() }))
            .deposit(NearToken::from_yoctonear(CALLS_DEPOSIT))
            .gas(near_workspaces::types::Gas::from_tgas(100)))
        .transact()
        .await?
        .into_result()?;
    let row: Value = board.view("get_charter").args_json(json!({ "owner": visitor.id() })).await?.json()?;
    assert_eq!(row["owner"], visitor.id().as_str(), "the row exists");

    // Allowed: a payment inside every cap, and a zero-value lifecycle step.
    let a = sim(&board, visitor.id(), hall.id(), "post_job", NEAR / 1000).await?;
    assert_eq!(a["ok"], true, "{a}");
    assert_eq!(a["reason"], "allowed", "{a}");
    let z = sim(&board, visitor.id(), hall.id(), "bid", 0).await?;
    assert_eq!(z["ok"], true, "a zero-value bid is not held to min_amount: {z}");

    // Refused, with the words the send would use.
    assert_eq!(sim(&board, visitor.id(), hall.id(), "post_job", NEAR / 50).await?["reason"], "over_per_action_cap");
    assert_eq!(sim(&board, visitor.id(), hall.id(), "bid", NEAR / 500).await?["reason"], "over_shop_cap");
    assert_eq!(sim(&board, visitor.id(), hall.id(), "post_job", NEAR / 100_000).await?["reason"], "below_min_amount");
    assert_eq!(sim(&board, visitor.id(), hall.id(), "review", 0).await?["reason"], "method_not_allowlisted");
    assert_eq!(sim(&board, visitor.id(), other.id(), "post_job", NEAR / 1000).await?["reason"], "receiver_not_allowlisted");
    // A stranger still has no row.
    assert_eq!(sim(&board, other.id(), hall.id(), "post_job", NEAR / 1000).await?["reason"], "no_charter");
    Ok(())
}
