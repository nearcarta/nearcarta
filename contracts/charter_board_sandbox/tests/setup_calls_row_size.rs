// How the row's own size reduces the room for its call list, against the committed wasm.
//
// `MAX_PAIR_BYTES` was measured with a one-receiver row. A visitor whose rules name six
// receivers has a bigger row, so fewer pairs fit in the same 0.02 NEAR. This test uses the
// exact list from the failed mainnet attempt 7H3H2HFiqPiGTPkF8gkkFLvbMecARWQdyG9DCdBPNnh9
// (open_charter succeeded, set_calls panicked ERR_ROW_TOO_BIG) and measures both shapes.
//
// Local near-sandbox only. This does not sign a mainnet transaction.
use ed25519_dalek::SigningKey;
use near_workspaces::types::{KeyType, NearToken, SecretKey};
use near_workspaces::AccountId;
use serde_json::{json, Value};

const WASM: &str = "../charter_board/target/near/charter_board.wasm";
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MAX_ROW: u128 = 20_000_000_000_000_000_000_000;
const CALLS_DEPOSIT: u128 = 15 * NEAR / 1000;
const TGAS: u64 = 1_000_000_000_000;

fn hex32(b: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::new();
    for x in b {
        s.push(H[(x >> 4) as usize] as char);
        s.push(H[(x & 15) as usize] as char);
    }
    s
}

/// The receivers the failed mainnet attempt named, in the order the page sent them.
const MAINNET_RECEIVERS: [&str; 6] = [
    "charter.nearcarta.near", "toll.nearcarta.near", "wrap.near",
    "arena.nearcarta.near", "house.nearcarta.near", "townhall.nearcarta.near",
];

/// The 11 pairs that attempt sent to set_calls.
const MAINNET_PAIRS: [(&str, &str); 11] = [
    ("charter.nearcarta.near", "ft_transfer"),
    ("toll.nearcarta.near", "ft_transfer"),
    ("arena.nearcarta.near", "ft_transfer"),
    ("house.nearcarta.near", "ft_transfer"),
    ("townhall.nearcarta.near", "ft_transfer"),
    ("wrap.near", "near_deposit"),
    ("wrap.near", "ft_transfer"),
    ("wrap.near", "storage_deposit"),
    ("board.nearcarta.near", "stamp"),
    ("house.nearcarta.near", "house_session_check_in"),
    ("house.nearcarta.near", "house_session_prepare_send"),
];

fn rules(receivers: &[&str]) -> Value {
    json!({
        "receivers": receivers,
        "per_action_cap": (NEAR / 10).to_string(),
        "daily_budget": (NEAR * 4 / 10).to_string(),
        "max_actions_per_day": 60,
        "window_start_min": 0,
        "window_end_min": 0,
        "min_amount": (NEAR / 10_000).to_string(),
        "expires_at": "1794063519225000000"
    })
}

fn calls(pairs: &[(&str, &str)]) -> Value {
    let cap = (NEAR / 10).to_string();
    let rows: Vec<Value> = pairs.iter().map(|(r, m)| json!({ "receiver": r, "method": m, "cap": cap })).collect();
    json!({ "calls": rows, "session_cap": (NEAR / 10).to_string() })
}

fn why(out: &near_workspaces::result::ExecutionFinalResult) -> String {
    if out.is_success() { return "ok".into(); }
    let s = format!("{:?}", out.failures());
    let at = s.find("panicked").unwrap_or(0);
    s.get(at..(at + 50).min(s.len())).unwrap_or("").to_string()
}

#[tokio::test]
async fn a_six_receiver_row_holds_fewer_pairs_than_a_one_receiver_row() -> anyhow::Result<()> {
    let wasm = std::fs::read(WASM).expect("build target/near/charter_board.wasm first");
    let worker = near_workspaces::sandbox().await?;
    let owner = worker.create_tla("nearcarta".parse()?, SecretKey::from_random(KeyType::ED25519)).await?.into_result()?;
    let board = owner.create_subaccount("board").initial_balance(NearToken::from_near(80)).transact().await?.into_result()?;
    let deployed = board.deploy(&wasm).await?.into_result()?;
    let init = owner.call(deployed.id(), "new").gas(near_workspaces::types::Gas::from_tgas(50)).transact().await?;
    assert!(init.is_success(), "new: {:?}", init.failures());

    let mut n = 0u8;
    // A. The exact failed mainnet shape: six-receiver rules, then those 11 pairs.
    for (label, receivers) in [("six receivers", &MAINNET_RECEIVERS[..]), ("one receiver", &MAINNET_RECEIVERS[..1])] {
        n += 1;
        let visitor = worker.dev_create_account().await?;
        let key = SigningKey::from_bytes(&[n; 32]);
        let opened = visitor.call(deployed.id(), "open_charter")
            .args_json(json!({ "rules": rules(receivers), "agent": hex32(key.verifying_key().as_bytes()), "fund": (NEAR / 100).to_string() }))
            .deposit(NearToken::from_yoctonear(MAX_ROW))
            .gas(near_workspaces::types::Gas::from_gas(60 * TGAS))
            .transact().await?;
        assert!(opened.is_success(), "{label} open: {:?}", opened.failures());
        let out = visitor.call(deployed.id(), "set_calls")
            .args_json(calls(&MAINNET_PAIRS))
            .deposit(NearToken::from_yoctonear(CALLS_DEPOSIT))
            .gas(near_workspaces::types::Gas::from_gas(60 * TGAS))
            .transact().await?;
        let row: Value = deployed.view("get_charter").args_json(json!({ "owner": visitor.id() })).await?.json()?;
        let locked = row["storage_locked"].as_str().unwrap_or("0");
        let locked_bytes = locked.parse::<u128>().unwrap_or(0) / (10u128.pow(19));
        println!("{label}: rules={} pairs=11 {} locked_bytes={locked_bytes}", receivers.len(), why(&out));
        // Report how many pairs each shape can take, by dropping pairs until it lands.
        if !out.is_success() {
            for keep in (0..MAINNET_PAIRS.len()).rev() {
                let short = &MAINNET_PAIRS[..keep];
                let ok = visitor.call(deployed.id(), "set_calls")
                    .args_json(calls(short))
                    .deposit(NearToken::from_yoctonear(CALLS_DEPOSIT))
                    .gas(near_workspaces::types::Gas::from_gas(60 * TGAS))
                    .transact().await?;
                let row: Value = deployed.view("get_charter").args_json(json!({ "owner": visitor.id() })).await?.json()?;
                let locked = row["storage_locked"].as_str().unwrap_or("0").parse::<u128>().unwrap_or(0) / 10u128.pow(19);
                println!("  {label}: {keep} pairs {} locked_bytes={locked}", why(&ok));
                if ok.is_success() { break; }
            }
        }
    }
    Ok(())
}
