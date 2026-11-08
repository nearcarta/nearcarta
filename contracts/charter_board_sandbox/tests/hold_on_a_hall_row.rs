// Can a row that carries a shop list write the per-action hold record?
//
// Measured on mainnet 2026-11-08 with the deployed board (code_hash BF1rQSrG…). Row
// `8ccd5d33…` carried a clean seven-pair Town Hall list at 1848 bytes locked and 0.01 NEAR of
// balance. Pressing Post job in the city sent a real `propose_call_as` (`post_job`,
// hold:true, no deposit, signed by the session key) and the board panicked ERR_DEPOSIT:
//
//   tx 3sAWZghNXW9nph7vTKjGjBjWsdEHpsqfg88npgzQUrYt  (receipt FY7eiZh5… on the deployed board)
//
// The hold record is the biggest side write a row makes: it stores the receiver, the method,
// the whole argument blob and the effect list. `propose_call_as` charged it entirely against
// the prepaid side reserve, and the call carries no deposit, so when the record outgrew the
// reserve there was nothing left to charge. Every held payment, the toll crossing and the Town
// Hall post were blocked by the same write.
//
// This test pins the fix: the hold is paid from the reserve first and then from the row's own
// remaining room, which `open_charter` already took a deposit for.
//
// Local near-sandbox only. No mainnet transaction.
use ed25519_dalek::{Signer, SigningKey};
use near_workspaces::types::{KeyType, NearToken, SecretKey};
use serde_json::{json, Value};

const FIXED_WASM: &str = "../artifacts/charter_board.hold.wasm";
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const ROW_CAP: u128 = 30_000_000_000_000_000_000_000;
const TGAS: u64 = 1_000_000_000_000;

fn hex32(b: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::new();
    for x in b { s.push(H[(x >> 4) as usize] as char); s.push(H[(x & 15) as usize] as char); }
    s
}

/// A nanosecond timestamp an hour from now. The contract caps expiry at now + HOLD_MAX_NS
/// (one day), so a far-future constant is refused ERR_EXPIRY and a past one is refused too.
fn soon() -> String {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap();
    (now.as_nanos() as u64 + 3_600 * 1_000_000_000).to_string()
}

/// The argument blob the city actually sends when someone presses Post job: a task sentence,
/// a part count, a deadline and two worker accounts. The hold record stores this whole string.
fn job_args() -> String {
    json!({
        "task": "write one line about the river",
        "parts": 1,
        "deadline": soon(),
        "workers": ["nearcarta.near", "8ccd5d33d2e8eb2d27eef13a7a0c88ae2ea9209c002fa7f27ed6021592393bb9"]
    }).to_string()
}

fn rules(receivers: &[&str], cap: &str) -> Value {
    json!({
        "receivers": receivers,
        "per_action_cap": cap,
        "daily_budget": (NEAR / 2).to_string(),
        "max_actions_per_day": 20,
        "window_start_min": 0,
        "window_end_min": 0,
        "min_amount": (NEAR / 10_000).to_string(),
        "expires_at": soon()
    })
}

fn hall_calls(cap: &str) -> Value {
    let methods = ["post_job", "bid", "counter", "accept", "deliver", "review", "refund"];
    json!(methods.iter().map(|m| json!({
        "receiver": "townhall.nearcarta.near", "method": m, "cap": cap,
    })).collect::<Vec<_>>())
}

#[tokio::test]
async fn a_hall_row_can_write_its_hold_on_the_fixed_build() -> anyhow::Result<()> {
    let wasm = std::fs::read(FIXED_WASM).expect("build contracts/artifacts/charter_board.hold.wasm first");
    let worker = near_workspaces::sandbox().await?;
    let owner = worker.create_tla("nearcarta".parse()?, SecretKey::from_random(KeyType::ED25519)).await?.into_result()?;
    let board = owner.create_subaccount("board").initial_balance(NearToken::from_near(80)).transact().await?.into_result()?;
    let deployed = board.deploy(&wasm).await?.into_result()?;
    assert!(owner.call(deployed.id(), "new").gas(near_workspaces::types::Gas::from_tgas(50)).transact().await?.is_success());

    // A mainnet visitor is an implicit account: 64 hex characters. Every stored key in the row
    // and in the hold record is longer for a real visitor than for a sandbox `dev-…` account.
    let long_name = format!("{}{}", "a".repeat(50), 7);
    let visitor = owner.create_subaccount(&long_name).initial_balance(NearToken::from_near(2)).transact().await?.into_result()?;
    let key = SigningKey::from_bytes(&[41u8; 32]);
    let cap = (NEAR / 50).to_string();
    let opened = visitor.call(deployed.id(), "open_charter")
        .args_json(json!({ "rules": rules(&["townhall.nearcarta.near"], &cap), "agent": hex32(key.verifying_key().as_bytes()), "fund": (NEAR / 100).to_string() }))
        .deposit(NearToken::from_yoctonear(ROW_CAP))
        .gas(near_workspaces::types::Gas::from_gas(60 * TGAS))
        .transact().await?;
    assert!(opened.is_success(), "open: {:?}", opened.failures());

    let set = visitor.call(deployed.id(), "set_calls")
        .args_json(json!({ "calls": hall_calls(&cap), "session_cap": (NEAR / 10).to_string() }))
        .deposit(NearToken::from_yoctonear(5 * NEAR / 100))
        .gas(near_workspaces::types::Gas::from_gas(60 * TGAS))
        .transact().await?;
    assert!(set.is_success(), "set_calls: {:?}", set.failures());
    let before: Value = deployed.view("get_charter").args_json(json!({ "owner": visitor.id() })).await?.json()?;
    let locked = before["storage_locked"].as_str().unwrap().parse::<u128>()? / 10u128.pow(19);
    println!("after the seven-pair Hall list: locked {locked} bytes");

    // The exact call the city makes: signed with the session key, no deposit attached, hold=true.
    let expiry = soon();
    let nonce = before["nonce"].as_str().unwrap().to_string();
    let args = job_args();
    let raw = deployed.view("call_as_message").args_json(json!({
        "owner": visitor.id(), "receiver": "townhall.nearcarta.near", "method": "post_job",
        "args": args, "deposit": (NEAR / 2000).to_string(), "nonce": nonce, "expiry": expiry,
        "effects": [], "hold": true
    })).await?;
    let message = String::from_utf8(raw.result.clone())?;
    let sig = hex32(&key.sign(message.as_bytes()).to_bytes());

    let held = visitor.call(deployed.id(), "propose_call_as")
        .args_json(json!({
            "owner": visitor.id(), "receiver": "townhall.nearcarta.near", "method": "post_job",
            "args": args, "deposit": (NEAR / 2000).to_string(), "expiry": expiry,
            "effects": [], "hold": true, "signature": sig
        }))
        .gas(near_workspaces::types::Gas::from_gas(100 * TGAS))
        .transact().await?;
    let after: Value = deployed.view("get_charter").args_json(json!({ "owner": visitor.id() })).await?.json()?;
    let locked_after = after["storage_locked"].as_str().unwrap().parse::<u128>()? / 10u128.pow(19);
    println!("hold {}: locked {} -> {} bytes, balance {} -> {}",
        if held.is_success() { "ALLOWED" } else { "REFUSED" }, locked, locked_after,
        before["balance"].as_str().unwrap(), after["balance"].as_str().unwrap());
    assert!(held.is_success(), "a Hall row must be able to hold a real post_job: {:?}", held.failures());
    // The hold was paid from the prepaid reserve, so `storage_locked` can stay flat while the
    // record is written; what moves is the balance, because the deposit is held with the row.
    // The old build refused this outright, which is the bug this test pins.
    assert!(locked_after >= locked, "the hold did not shrink the row");
    assert!(locked_after <= 3000, "the row stays inside its 0.03 NEAR allowance: {locked_after}");
    Ok(())
}
