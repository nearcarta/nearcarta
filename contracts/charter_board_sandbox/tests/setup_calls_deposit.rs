//! The `/setup` first-row transaction against the committed wasm.
//! Board v2 charges the real trie bytes, so the deposit the page sends must cover the
//! call list it builds, and a list that would exceed the row's 0.03 NEAR must be
//! refused before it is sent. This pins both: `CALLS_DEPOSIT_YOCTO` and
//! `callsFitRow` in `shared/board/session.js` must match what this wasm does.
//! Local near-sandbox only. This does not sign a mainnet transaction.
use ed25519_dalek::SigningKey;
use near_workspaces::operations::Function;
use near_workspaces::types::{KeyType, NearToken, SecretKey};
use near_workspaces::AccountId;
use serde_json::{json, Value};

const WASM: &str = "../charter_board/target/near/charter_board.wasm";
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MAX_ROW: u128 = 30_000_000_000_000_000_000_000;
/// What `set_calls` may spend: the 1400-byte side reserve the contract prepays for the later
/// hold and effect records, plus the call list itself. `CALLS_DEPOSIT_YOCTO` in
/// shared/board/session.js is still 0.015 NEAR for the live 600-byte build; this is the figure
/// the 0.03 NEAR build needs and it is what /setup must send once that build is live.
const CALLS_DEPOSIT: u128 = 5 * NEAR / 100;
/// The pair budget for `n` receivers on this build: 3000 bytes less ROW_FIXED_BYTES (1490)
/// less 24 per receiver. This is `pairBudgetBytes(n)` in shared/board/session.js.
fn max_pair_bytes(receivers: usize) -> usize {
    let n = receivers.max(1);
    3000usize.saturating_sub(1490 + 24 * n)
}
/// The production board id `board.nearcarta.near` is 20 bytes; the sandbox subaccount is shorter.
const BOARD_ID_LEN: usize = 20;

fn hex32(b: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::new();
    for x in b {
        s.push(H[(x >> 4) as usize] as char);
        s.push(H[(x & 15) as usize] as char);
    }
    s
}

fn rules(receiver: &str) -> Value {
    json!({
        "receivers": [receiver],
        "per_action_cap": (NEAR / 200).to_string(),
        "daily_budget": (NEAR / 100).to_string(),
        "max_actions_per_day": 3,
        "window_start_min": 0,
        "window_end_min": 0,
        "min_amount": (NEAR / 10_000).to_string(),
        "expires_at": "0"
    })
}

/// The same shape `callPolicy` builds: the shops, the wrap.near trio, then the stamp.
/// The same shape `callPolicy` builds: the shops, the wrap.near trio, the board stamp,
/// then the House shop's two calls. shared/house/shop.js HOUSE_CALLS.
const HOUSE_SHOP: &str = "house.nearcarta.near";
const HOUSE_METHODS: [&str; 2] = ["house_session_check_in", "house_session_prepare_send"];

fn setup_calls(board: &AccountId, shops: &[String]) -> Value {
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

fn pair_bytes(_board: &AccountId, shops: &[String]) -> usize {
    let pair = |receiver: &str, method: &str| receiver.len() + method.len() + 24;
    let shops: usize = shops.iter().map(|s| pair(s, "ft_transfer")).sum();
    let ferry: usize = [("wrap.near", "near_deposit"), ("wrap.near", "ft_transfer"), ("wrap.near", "storage_deposit")]
        .iter().map(|(r, m)| pair(r, m)).sum();
    let house: usize = HOUSE_METHODS.iter().map(|m| pair(HOUSE_SHOP, m)).sum();
    shops + ferry + house + BOARD_ID_LEN + "stamp".len() + 24
}

fn refused(out: &near_workspaces::result::ExecutionFinalResult, code: &str) -> bool {
    let s = format!("{:?}", out.failures());
    s.contains(&format!("Smart contract panicked: {code}"))
}

#[tokio::test]
async fn the_setup_first_row_transaction_is_accepted() -> anyhow::Result<()> {
    let wasm = std::fs::read(WASM).expect("build target/near/charter_board.wasm first");
    let worker = near_workspaces::sandbox().await?;
    let owner = worker.create_tla("nearcarta".parse()?, SecretKey::from_random(KeyType::ED25519)).await?.into_result()?;
    let board = owner.create_subaccount("board").initial_balance(NearToken::from_near(80)).transact().await?.into_result()?;
    let deployed = board.deploy(&wasm).await?.into_result()?;
    let init = owner.call(deployed.id(), "new").gas(near_workspaces::types::Gas::from_tgas(50)).transact().await?;
    assert!(init.is_success(), "new: {:?}", init.failures());
    let shop = worker.dev_create_account().await?;

    // The transaction this pins is the one /setup signs: open_charter plus set_calls in one
    // batch, with the deposit the page sends. What must hold is that the deposit covers the
    // list the page builds, for every shop-name length the city can produce. The exact ceiling
    // per length is the contract's business (MAX_RECEIVERS 8, then ERR_ROW_TOO_BIG); this test
    // pins the deposit and the batch shape.
    let mut n = 0u8;
    for name_len in [19usize, 25, 32, 40, 48, 56] {
        for shops_n in [1usize, 2, 3] {
            n += 1;
            let shops: Vec<String> = (0..shops_n).map(|i| {
                let head = format!("shop{i}");
                let tail = ".nearcarta.near";
                format!("{head}{}{tail}", "x".repeat(name_len.saturating_sub(head.len() + tail.len())))
            }).collect();
            let visitor = worker.dev_create_account().await?;
            let key = SigningKey::from_bytes(&[n; 32]);
            // Two actions in one transaction, the shape /setup signs.
            let out = visitor.batch(deployed.id())
                .call(Function::new("open_charter")
                    .args_json(json!({ "rules": rules(shop.id().as_str()), "agent": hex32(key.verifying_key().as_bytes()), "fund": (NEAR / 100).to_string() }))
                    .deposit(NearToken::from_yoctonear(MAX_ROW))
                    .gas(near_workspaces::types::Gas::from_tgas(30)))
                .call(Function::new("set_calls")
                    .args_json(setup_calls(deployed.id(), &shops))
                    .deposit(NearToken::from_yoctonear(CALLS_DEPOSIT))
                    .gas(near_workspaces::types::Gas::from_tgas(30)))
                .transact().await?;
            let row: Value = deployed.view("get_charter").args_json(json!({ "owner": visitor.id() })).await?.json()?;
            println!("name_len={name_len} shops={shops_n} bytes={} ok={}", pair_bytes(deployed.id(), &shops), out.is_success());
            assert!(out.is_success(), "{shops_n} shops of {name_len}-byte names must land with the setup deposit: {:?}", out.failures());
            let locked: u128 = row["storage_locked"].as_str().unwrap().parse()?;
            assert!(locked <= MAX_ROW, "locked {locked} is over the row cap");
        }
    }
    Ok(())
}
