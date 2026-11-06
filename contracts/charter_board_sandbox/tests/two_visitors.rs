//! One deployed board, two visitors, no per-user contract.
//! Local near-sandbox only. This does not sign a mainnet transaction.
use ed25519_dalek::{Signer, SigningKey};
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

#[tokio::test]
async fn two_visitors_share_one_board_and_teardown_pays_the_owner() -> anyhow::Result<()> {
    let wasm = std::fs::read(WASM).expect("build target/near/charter_board.wasm with cargo +1.86.0 near build non-reproducible-wasm --no-abi");
    let worker = near_workspaces::sandbox().await?;
    // The registrar cannot create `nearcarta.near` (it is a subaccount of `near`).
    // `new` records the predecessor and `reap` pays that account. The contract
    // unit test pins the production beneficiary `nearcarta.near`.
    let owner = worker.create_tla("nearcarta".parse()?, SecretKey::from_random(KeyType::ED25519)).await?.into_result()?;
    let board_acc = owner.create_subaccount("board").initial_balance(NearToken::from_near(15)).transact().await?.into_result()?;
    let deployed = board_acc.deploy(&wasm).await?.into_result()?;
    let init = owner.call(deployed.id(), "new").gas(near_workspaces::types::Gas::from_tgas(50)).transact().await?;
    assert!(init.is_success(), "new: {:?}", init.failures());

    let alice = worker.dev_create_account().await?;
    let bob = worker.dev_create_account().await?;
    let shop = worker.dev_create_account().await?;
    let alice_sk = SigningKey::from_bytes(&[7u8; 32]);
    let bob_sk = SigningKey::from_bytes(&[9u8; 32]);

    for (user, sk, fund) in [(&alice, &alice_sk, NEAR / 1000), (&bob, &bob_sk, NEAR / 500)] {
        let opened = user.call(deployed.id(), "open_charter")
            .args_json(json!({
                "rules": rules(shop.id()),
                "agent": hex32(sk.verifying_key().as_bytes()),
                "fund": fund.to_string(),
            }))
            .deposit(NearToken::from_yoctonear(MAX_ROW))
            .gas(near_workspaces::types::Gas::from_tgas(100))
            .transact().await?;
        assert!(opened.is_success(), "{:?} open: {:?}", user.id(), opened.failures());
        let calls = user.call(deployed.id(), "set_calls")
            .args_json(json!({
                "calls": [{ "receiver": shop.id(), "method": "ft_transfer", "cap": (NEAR / 500).to_string() }],
                "session_cap": (NEAR / 200).to_string(),
            }))
            .deposit(NearToken::from_yoctonear(MAX_ROW))
            .gas(near_workspaces::types::Gas::from_tgas(100))
            .transact().await?;
        assert!(calls.is_success(), "{:?} set_calls: {:?}", user.id(), calls.failures());
    }

    let config: Value = deployed.view("get_config").await?.json()?;
    assert_eq!(config["rows"], 2);
    assert_eq!(config["owner"], "nearcarta");
    let alice_state = format!("{:?}", alice.view_account().await?.contract_state);
    let bob_state = format!("{:?}", bob.view_account().await?.contract_state);
    assert_eq!(alice_state, "None", "alice has no contract");
    assert_eq!(bob_state, "None", "bob has no contract");

    let mut spent_gas = 0u64;
    for (user, sk) in [(&alice, &alice_sk), (&bob, &bob_sk)] {
        let row: Value = deployed.view("get_charter").args_json(json!({ "owner": user.id() })).await?.json()?;
        let before: u128 = row["balance"].as_str().unwrap().parse()?;
        let nonce = row["nonce"].as_str().unwrap();
        let deposit = NEAR / 2000;
        let expiry = u64::MAX.to_string();
        let message = deployed.view("call_as_message").args_json(json!({
            "owner": user.id(),
            "receiver": shop.id(),
            "method": "ft_transfer",
            "args": "{}",
            "deposit": deposit.to_string(),
            "nonce": nonce,
            "expiry": expiry,
            "effects": [],
            "hold": false,
        })).await?;
        let signature = hex32(&sk.sign(&message.result).to_bytes());
        let sent = user.call(deployed.id(), "propose_call_as")
            .args_json(json!({
                "owner": user.id(),
                "receiver": shop.id(),
                "method": "ft_transfer",
                "args": "{}",
                "deposit": deposit.to_string(),
                "expiry": expiry,
                "effects": [],
                "hold": false,
                "signature": signature,
            }))
            .gas(near_workspaces::types::Gas::from_tgas(200))
            .transact().await?;
        assert!(sent.is_success(), "{:?} propose_call_as: {:?}", user.id(), sent.failures());
        spent_gas += sent.total_gas_burnt.as_gas();
        let after: Value = deployed.view("get_charter").args_json(json!({ "owner": user.id() })).await?.json()?;
        let balance: u128 = after["balance"].as_str().unwrap().parse()?;
        assert_eq!(balance, before, "{:?} a failed shop call refunds only that row", user.id());
    }
    println!("GAS propose_call_as x2: {spent_gas}");
    println!("STORAGE board bytes: {}", deployed.view_account().await?.storage_usage);

    let alice_row: Value = deployed.view("get_charter").args_json(json!({ "owner": alice.id() })).await?.json()?;
    let bob_before: u128 = deployed.view("get_charter").args_json(json!({ "owner": bob.id() })).await?.json::<Value>()?["balance"].as_str().unwrap().parse()?;
    let amount = NEAR / 2000;
    let proposal = deployed.view("proposal_message").args_json(json!({
        "owner": alice.id(), "receiver": shop.id(), "amount": amount.to_string(), "nonce": alice_row["nonce"].as_str().unwrap(),
    })).await?;
    let paid = alice.call(deployed.id(), "propose")
        .args_json(json!({
            "owner": alice.id(),
            "receiver": shop.id(),
            "amount": amount.to_string(),
            "signature": hex32(&alice_sk.sign(&proposal.result).to_bytes()),
        }))
        .gas(near_workspaces::types::Gas::from_tgas(100))
        .transact().await?;
    assert!(paid.is_success(), "propose: {:?}", paid.failures());
    println!("GAS propose: {}", paid.total_gas_burnt.as_gas());
    let alice_after: u128 = deployed.view("get_charter").args_json(json!({ "owner": alice.id() })).await?.json::<Value>()?["balance"].as_str().unwrap().parse()?;
    let bob_after: u128 = deployed.view("get_charter").args_json(json!({ "owner": bob.id() })).await?.json::<Value>()?["balance"].as_str().unwrap().parse()?;
    assert_eq!(alice_after, alice_row["balance"].as_str().unwrap().parse::<u128>()? - amount);
    assert_eq!(bob_after, bob_before, "bob's row is untouched");

    assert_ne!(String::from_utf8(deployed.view("get_liabilities").await?.result)?, "0");
    alice.call(deployed.id(), "close_charter").gas(near_workspaces::types::Gas::from_tgas(80)).transact().await?.into_result()?;
    bob.call(deployed.id(), "close_charter").gas(near_workspaces::types::Gas::from_tgas(80)).transact().await?.into_result()?;
    assert_eq!(String::from_utf8(deployed.view("get_liabilities").await?.result)?, "0");
    let reap = owner.call(deployed.id(), "reap").deposit(NearToken::from_yoctonear(1)).gas(near_workspaces::types::Gas::from_tgas(30)).transact().await?;
    assert!(reap.is_success(), "reap: {:?}", reap.failures());
    assert!(owner.view_account().await.is_ok(), "the owner account remains");
    Ok(())
}
