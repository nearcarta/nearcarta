//! One local board, one visitor, a real `anchor` under a function-call session key.
//! Local near-sandbox only. This does not sign a mainnet transaction.
//!
//! It covers what the tray does: the visitor opens a row and adds a FunctionCall key that
//! names `anchor`, the browser signs `anchor {kind,digest,salt}`, and the board logs one
//! `nearcarta-board` v2 event with sha256(salt || digest) and no salt.
//!
//! Run: cd contracts/charter_board_sandbox && cargo test --test anchor
use ed25519_dalek::SigningKey;
use near_workspaces::types::{KeyType, NearToken, SecretKey};
use near_workspaces::AccountId;
use serde_json::{json, Value};

const WASM: &str = "../charter_board/target/near/charter_board.wasm";
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MAX_ROW: u128 = 20_000_000_000_000_000_000_000;

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
        "min_amount": (NEAR / 10_000).to_string(),
        "expires_at": "0"
    })
}

/// The event the contract writes, parsed without a serde struct so the shape is checked literally.
fn anchor_event(logs: &[String]) -> Option<Value> {
    logs.iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .filter_map(|body| serde_json::from_str::<Value>(body).ok())
        .find(|v| v["standard"] == "nearcarta-board" && v["event"] == "anchor")
}

#[tokio::test]
async fn a_session_key_anchors_one_statement_event_and_stores_nothing() -> anyhow::Result<()> {
    let wasm = std::fs::read(WASM)
        .expect("copy contracts/artifacts/charter_board.wasm to contracts/charter_board/target/near/charter_board.wasm");
    let worker = near_workspaces::sandbox().await?;
    let registrar = worker.dev_create_account().await?;

    // The board records its first caller as the owner; `reap` pays that account.
    let board = registrar
        .create_subaccount("board")
        .initial_balance(NearToken::from_near(30))
        .transact()
        .await?
        .into_result()?;
    let board = board.deploy(&wasm).await?.into_result()?;
    board.call("new").transact().await?.into_result()?;

    // One visitor. The board is multi-tenant: this account owns exactly one row.
    let visitor = registrar
        .create_subaccount("visitor")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let shop = registrar
        .create_subaccount("shop")
        .initial_balance(NearToken::from_near(2))
        .transact()
        .await?
        .into_result()?;

    // The agent key the browser makes. Only `anchor` is needed for this test.
    let agent = SigningKey::from_bytes(&[21u8; 32]);
    let agent_hex = hex32(agent.verifying_key().as_bytes());

    visitor
        .call(board.id(), "open_charter")
        .args_json(json!({ "rules": rules(shop.id()), "agent": agent_hex, "fund": (NEAR / 1000).to_string() }))
        .deposit(NearToken::from_yoctonear(MAX_ROW))
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    // The session key: a FunctionCall key on the visitor's own account naming the board
    // and the methods the tray needs. It cannot attach a deposit.
    let session = SecretKey::from_seed(KeyType::ED25519, "nearcarta-anchor-session");
    let session_public = session.public_key();
    visitor
        .batch(visitor.id())
        .add_key(
            session_public.clone(),
            near_workspaces::types::AccessKey {
                nonce: 0,
                permission: near_workspaces::types::AccessKeyPermission::FunctionCall(
                    near_workspaces::types::FunctionCallPermission {
                        allowance: Some(NearToken::from_millinear(250)),
                        receiver_id: board.id().to_string(),
                        method_names: vec!["anchor".to_string()],
                    },
                ),
            },
        )
        .transact()
        .await?
        .into_result()?;

    let before = board.view("get_charter").args_json(json!({ "owner": visitor.id() })).await?;
    let before: Value = before.json()?;
    // Storage usage is the "stores nothing" claim; the view method is not exported in the wasm.
    let state_before = board.view_account().await?.storage_usage;

    // What the tray sends: kind statement, the bundle digest, a 16-char salt.
    let digest = "ab".repeat(32);
    let salt = "0123456789abcdef";
    // The visitor is the predecessor, which is what the contract checks for the row.
    let out = visitor
        .call(board.id(), "anchor")
        .args_json(json!({ "kind": "statement", "digest": digest, "salt": salt }))
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    let logs: Vec<String> = out.logs().iter().map(|s| s.to_string()).collect();
    let ev = anchor_event(&logs).expect("the board logs one anchor event");
    assert_eq!(ev["owner"], visitor.id().as_str(), "the event names the visitor");
    assert_eq!(ev["kind"], "statement");
    assert_eq!(ev["version"], "2");
    assert!(ev["commitment"].as_str().unwrap().len() == 64, "commitment is sha256");
    assert!(!ev.to_string().contains(&digest), "the raw digest is not published");
    assert!(!ev.to_string().contains(salt), "the salt is not published");
    // The commitment is the same one the tray builds: sha256(salt || digest).
    // The contract decodes the 64 hex chars to 32 bytes, then sha256(salt_bytes || digest_bytes).
    let mut pre = salt.as_bytes().to_vec();
    pre.extend(hex_to_bytes(&digest));
    assert_eq!(ev["commitment"], hex32(&near_sdk_sha256_bytes(&pre)), "commitment is sha256(salt || digest)");
    // Pinned: backend/test/unit/chronicle-depth.test.js asserts the same literal for the tray,
    // so the browser and the contract cannot drift on this value.
    assert_eq!(ev["commitment"], "038b315d7cb111c589bc2fc9c18098a18960026d0d147dddf03e772157dbf75a");
    assert!(ev["nonce"].as_str().unwrap().parse::<u64>().is_ok());
    assert!(ev["time"].as_str().unwrap().parse::<u128>().is_ok());

    // The row is untouched and the board stores nothing: no balance moves, no new bytes.
    let after = board.view("get_charter").args_json(json!({ "owner": visitor.id() })).await?;
    let after: Value = after.json()?;
    assert_eq!(after["balance"], before["balance"], "an anchor moves no money");
    assert_eq!(after["nonce"], before["nonce"], "an anchor is not an action");
    assert_eq!(after["agent"], before["agent"], "the key is unchanged");
    let state_after = board.view_account().await?.storage_usage;
    assert_eq!(state_after, state_before, "the board keeps no anchor state");

    // A visitor with no row is refused, not silently anchored.
    let stranger = registrar
        .create_subaccount("stranger")
        .initial_balance(NearToken::from_near(2))
        .transact()
        .await?
        .into_result()?;
    stranger
        .call(board.id(), "anchor")
        .args_json(json!({ "kind": "statement", "digest": digest, "salt": salt }))
        .max_gas()
        .transact()
        .await?
        .into_result()
        .expect_err("no row means no anchor");
    Ok(())
}

fn hex_to_bytes(s: &str) -> Vec<u8> {
    (0..s.len() / 2)
        .map(|i| u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap())
        .collect()
}

fn near_sdk_sha256_bytes(bytes: &[u8]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    let out = h.finalize();
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&out);
    arr
}
