// What each board call /setup makes really costs, against the committed wasm.
// `open_charter` and `set_calls` are separate receipts, so each needs its own gas.
// The page used 10 Tgas per action; that is only twice the sandbox burn and mainnet
// ran out. These numbers set the page's gas with margin.
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
const RULES_DEPOSIT: u128 = NEAR / 1000;
const TGAS: u64 = 1_000_000_000_000;
const MAX_PAIR_BYTES: usize = 602;
const BOARD_ID_LEN: usize = 20;
const HOUSE_SHOP: &str = "house.nearcarta.near";
const HOUSE_METHODS: [&str; 2] = ["house_session_check_in", "house_session_prepare_send"];

fn hex32(b: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::new();
    for x in b {
        s.push(H[(x >> 4) as usize] as char);
        s.push(H[(x & 15) as usize] as char);
    }
    s
}

/// The rules the failing mainnet tx carried: six receivers, 0.1 NEAR caps, one hour out.
fn production_rules() -> Value {
    json!({
        "receivers": ["charter.nearcarta.near", "toll.nearcarta.near", "wrap.near",
                      "arena.nearcarta.near", "house.nearcarta.near", "townhall.nearcarta.near"],
        "per_action_cap": (NEAR / 10).to_string(),
        "daily_budget": (NEAR * 4 / 10).to_string(),
        "max_actions_per_day": 60,
        "window_start_min": 0,
        "window_end_min": 0,
        "min_amount": (NEAR / 10_000).to_string(),
        "expires_at": "1794063519225000000"
    })
}

fn calls_for(board: &AccountId, shops: &[String]) -> Value {
    let cap = (NEAR / 200).to_string();
    let mut calls: Vec<Value> = shops.iter().map(|s| json!({ "receiver": s, "method": "ft_transfer", "cap": cap })).collect();
    for m in ["near_deposit", "ft_transfer", "storage_deposit"] {
        calls.push(json!({ "receiver": "wrap.near", "method": m, "cap": cap }));
    }
    calls.push(json!({ "receiver": board, "method": "stamp", "cap": cap }));
    for m in HOUSE_METHODS {
        calls.push(json!({ "receiver": HOUSE_SHOP, "method": m, "cap": cap }));
    }
    json!({ "calls": calls, "session_cap": (NEAR / 100).to_string() })
}

fn padded_shops(slots: usize, name_len: usize) -> Vec<String> {
    (0..slots).map(|i| {
        let head = format!("shop{i}");
        let tail = ".nearcarta.near";
        format!("{head}{}{tail}", "x".repeat(name_len.saturating_sub(head.len() + tail.len())))
    }).collect()
}

fn pair_bytes(shops: &[String]) -> usize {
    let pair = |receiver: usize, method: usize| receiver + method + 24;
    let shop: usize = shops.iter().map(|s| pair(s.len(), "ft_transfer".len())).sum();
    let ferry: usize = pair(9, "near_deposit".len()) + pair(9, "ft_transfer".len()) + pair(9, "storage_deposit".len());
    let house: usize = HOUSE_METHODS.iter().map(|m| pair(HOUSE_SHOP.len(), m.len())).sum();
    shop + ferry + house + pair(BOARD_ID_LEN, "stamp".len())
}

fn why(out: &near_workspaces::result::ExecutionFinalResult) -> String {
    if out.is_success() { return "ok".into(); }
    let s = format!("{:?}", out.failures());
    let at = s.find("panicked").unwrap_or(0);
    s.get(at..(at + 60).min(s.len())).unwrap_or("").to_string()
}

fn tgas(gas: u64) -> f64 { gas as f64 / TGAS as f64 }

#[tokio::test]
async fn the_board_calls_are_measured() -> anyhow::Result<()> {
    let wasm = std::fs::read(WASM).expect("build target/near/charter_board.wasm first");
    let worker = near_workspaces::sandbox().await?;
    let owner = worker.create_tla("nearcarta".parse()?, SecretKey::from_random(KeyType::ED25519)).await?.into_result()?;
    let board = owner.create_subaccount("board").initial_balance(NearToken::from_near(80)).transact().await?.into_result()?;
    let deployed = board.deploy(&wasm).await?.into_result()?;
    let init = owner.call(deployed.id(), "new").gas(near_workspaces::types::Gas::from_tgas(50)).transact().await?;
    assert!(init.is_success(), "new: {:?}", init.failures());

    let name_len = 20usize;
    let mut slots = 0usize;
    for k in 0..=9usize {
        if pair_bytes(&padded_shops(k, name_len)) <= MAX_PAIR_BYTES { slots = k; }
    }
    let widest = padded_shops(slots, name_len);
    println!("widest list: shops={slots} pairs={} bytes={}", slots + 6, pair_bytes(&widest));
    let mut n = 0u8;

    // open_charter with the six receivers mainnet used.
    n += 1;
    let a = worker.dev_create_account().await?;
    let ka = SigningKey::from_bytes(&[n; 32]);
    let out = a.call(deployed.id(), "open_charter")
        .args_json(json!({ "rules": production_rules(), "agent": hex32(ka.verifying_key().as_bytes()), "fund": (NEAR / 100).to_string() }))
        .deposit(NearToken::from_yoctonear(MAX_ROW)).gas(near_workspaces::types::Gas::from_gas(300 * TGAS)).transact().await?;
    println!("open_charter 6 receivers: {} {:.2} Tgas", why(&out), tgas(out.total_gas_burnt.as_gas()));

    // set_calls with the widest list.
    let out = a.call(deployed.id(), "set_calls")
        .args_json(calls_for(deployed.id(), &widest))
        .deposit(NearToken::from_yoctonear(CALLS_DEPOSIT)).gas(near_workspaces::types::Gas::from_gas(300 * TGAS)).transact().await?;
    println!("set_calls widest: {} {:.2} Tgas", why(&out), tgas(out.total_gas_burnt.as_gas()));

    // set_rules with six receivers (the update path).
    let out = a.call(deployed.id(), "set_rules").args_json(json!({ "rules": production_rules() }))
        .deposit(NearToken::from_yoctonear(RULES_DEPOSIT)).gas(near_workspaces::types::Gas::from_gas(300 * TGAS)).transact().await?;
    println!("set_rules 6 receivers: {} {:.2} Tgas", why(&out), tgas(out.total_gas_burnt.as_gas()));

    // set_agent (one key swap on the row).
    let kb = SigningKey::from_bytes(&[n.wrapping_add(9); 32]);
    let out = a.call(deployed.id(), "set_agent").args_json(json!({ "agent": hex32(kb.verifying_key().as_bytes()) }))
        .deposit(NearToken::from_yoctonear(1)).gas(near_workspaces::types::Gas::from_gas(300 * TGAS)).transact().await?;
    println!("set_agent: {} {:.2} Tgas", why(&out), tgas(out.total_gas_burnt.as_gas()));

    // fund (top-up, update path).
    let out = a.call(deployed.id(), "fund").deposit(NearToken::from_yoctonear(NEAR / 200))
        .gas(near_workspaces::types::Gas::from_gas(300 * TGAS)).transact().await?;
    println!("fund: {} {:.2} Tgas", why(&out), tgas(out.total_gas_burnt.as_gas()));

    // The whole first transaction at a few per-action limits, with the six-receiver
    // rules mainnet used (that is the shape that failed).
    for limit in [10u64, 20, 25, 50, 75] {
        n += 1;
        let v = worker.dev_create_account().await?;
        let k = SigningKey::from_bytes(&[n; 32]);
        let out = v.batch(deployed.id())
            .call(near_workspaces::operations::Function::new("open_charter")
                .args_json(json!({ "rules": production_rules(), "agent": hex32(k.verifying_key().as_bytes()), "fund": (NEAR / 100).to_string() }))
                .deposit(NearToken::from_yoctonear(MAX_ROW))
                .gas(near_workspaces::types::Gas::from_tgas(limit)))
            .call(near_workspaces::operations::Function::new("set_calls")
                .args_json(calls_for(deployed.id(), &padded_shops(1, name_len)))
                .deposit(NearToken::from_yoctonear(CALLS_DEPOSIT))
                .gas(near_workspaces::types::Gas::from_tgas(limit)))
            .transact().await?;
        println!("first tx 6rec at {limit} Tgas x2: {} burnt={:.2} Tgas", why(&out), tgas(out.total_gas_burnt.as_gas()));
    }
    Ok(())
}
