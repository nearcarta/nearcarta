//! Charter rules and adversarial cases against the real wasm in a local near-sandbox.
//! Every test asserts the SAFE outcome: refusal reason on chain, and no NEAR moved.
use near_workspaces::network::Sandbox;
use near_workspaces::types::{Gas, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
fn pick(local: &str, artifact: &str) -> String { if std::path::Path::new(local).exists() { local.into() } else { artifact.into() } }
fn wasm_path() -> String { std::env::var("OATH_WASM").unwrap_or_else(|_| pick("target/near/oath.wasm", "../artifacts/oath.wasm")) }

struct Env { w: Worker<Sandbox>, oath: Contract, owner: Account, agent: Account, bob: Account, mallory: Account }

async fn setup() -> anyhow::Result<Env> {
    let w = near_workspaces::sandbox().await?;
    let owner = w.dev_create_account().await?;
    let bob = w.dev_create_account().await?;
    let mallory = w.dev_create_account().await?;
    let oath = w.dev_deploy(&std::fs::read(wasm_path())?).await?;
    oath.call("new").args_json(json!({"owner": owner.id(), "dao": null, "policy_delay_ns": "0"})).transact().await?.into_result()?;
    let sk = SecretKey::from_random(KeyType::ED25519);
    owner.call(oath.id(), "set_agent_key").args_json(json!({"public_key": sk.public_key(), "allowance": NEAR.to_string()}))
        .gas(Gas::from_tgas(30)).transact().await?.into_result()?;
    let agent = Account::from_secret_key(oath.id().clone(), sk, &w);
    let e = Env { w, oath, owner, agent, bob, mallory };
    set_clause(&e, "tip", json!({"asset": "Native", "receivers": [e.bob.id()], "per_action_cap": (NEAR / 10).to_string(),
        "daily_budget": (NEAR / 4).to_string(), "window_start_min": 0, "window_end_min": 0, "requires_receipt": false,
        "escalation_max": null, "max_actions_per_day": 50})).await?;
    Ok(e)
}
async fn set_clause(e: &Env, id: &str, c: Value) -> anyhow::Result<()> {
    e.owner.call(e.oath.id(), "set_clause").args_json(json!({"clause_id": id, "clause": c})).transact().await?.into_result()?;
    Ok(())
}
async fn state(e: &Env) -> anyhow::Result<Value> { Ok(e.oath.view("get_state").await?.json()?) }
async fn prop(e: &Env, to: &AccountId, amount: u128) -> anyhow::Result<Value> {
    let s = state(e).await?;
    Ok(json!({"shop": "guardhouse", "clause_id": "tip", "receiver": to, "amount": amount.to_string(), "nonce": s["next_nonce"],
        "policy_version": s["policy_version"], "expires_at": u64::MAX.to_string(), "memo": null, "receipt": null}))
}
async fn propose(e: &Env, p: &Value) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    Ok(e.agent.call(e.oath.id(), "propose").args_json(json!({"p": p})).gas(Gas::from_tgas(100)).transact().await?)
}
async fn outcome(e: &Env, p: &Value) -> anyhow::Result<Value> {
    let r = propose(e, p).await?;
    assert!(r.is_success(), "{:?}", r.failures());
    Ok(r.json().unwrap_or(Value::Null))
}
async fn bal(a: &Account) -> anyhow::Result<u128> { Ok(a.view_account().await?.balance.as_yoctonear()) }
fn err_has(r: &near_workspaces::result::ExecutionFinalResult, s: &str) -> bool { format!("{:?}", r.failures()).contains(s) }

#[tokio::test]
async fn adv_wrong_signer_cannot_propose() -> anyhow::Result<()> {
    let e = setup().await?;
    let p = prop(&e, e.mallory.id(), 1).await?;
    let r = e.mallory.call(e.oath.id(), "propose").args_json(json!({"p": p})).gas(Gas::from_tgas(100)).transact().await?;
    assert!(r.is_failure() && err_has(&r, "ERR_NOT_AGENT"));
    let r = e.owner.call(e.oath.id(), "propose").args_json(json!({"p": p})).gas(Gas::from_tgas(100)).transact().await?;
    assert!(r.is_failure() && err_has(&r, "ERR_NOT_AGENT"), "even the owner cannot propose");
    Ok(())
}

#[tokio::test]
async fn adv_non_owner_cannot_change_rules() -> anyhow::Result<()> {
    let e = setup().await?;
    for (m, a) in [("set_clause", json!({"clause_id": "x", "clause": {"asset": "Native", "receivers": [e.mallory.id()], "per_action_cap": "1",
            "daily_budget": "1", "window_start_min": 0, "window_end_min": 0, "requires_receipt": false, "escalation_max": null}})),
        ("freeze", json!({})), ("revoke_agent", json!({})), ("remove_clause", json!({"clause_id": "tip"})),
        ("set_dao", json!({"dao": e.mallory.id()})), ("queue_upgrade", json!({"code_hash": "11111111111111111111111111111111"}))] {
        let r = e.mallory.call(e.oath.id(), m).args_json(a).gas(Gas::from_tgas(50)).transact().await?;
        assert!(r.is_failure(), "{m} must be owner-only");
    }
    Ok(())
}

#[tokio::test]
async fn adv_agent_key_cannot_call_owner_methods_or_transfer() -> anyhow::Result<()> {
    let e = setup().await?;
    let r = e.agent.call(e.oath.id(), "set_clause").args_json(json!({"clause_id": "x", "clause": {"asset": "Native", "receivers": [e.mallory.id()],
        "per_action_cap": "1", "daily_budget": "1", "window_start_min": 0, "window_end_min": 0, "requires_receipt": false, "escalation_max": null}}))
        .transact().await;
    assert!(r.map(|x| x.is_failure()).unwrap_or(true), "agent key widened its own charter");
    let r = e.agent.transfer_near(e.mallory.id(), NearToken::from_near(1)).await;
    assert!(r.map(|x| x.is_failure()).unwrap_or(true), "agent key moved NEAR outside the charter");
    assert!(state(&e).await?["frozen"] == json!(false));
    Ok(())
}

#[tokio::test]
async fn adv_replay_same_nonce_is_rejected() -> anyhow::Result<()> {
    let e = setup().await?;
    let p = prop(&e, e.bob.id(), NEAR / 100).await?;
    let b0 = bal(&e.bob).await?;
    assert_eq!(outcome(&e, &p).await?["decision"], "allowed");
    let r = propose(&e, &p).await?;
    assert!(r.is_failure() && err_has(&r, "ERR_NONCE"));
    assert_eq!(bal(&e.bob).await? - b0, NEAR / 100, "paid exactly once");
    Ok(())
}

#[tokio::test]
async fn adv_allowlist_cap_and_budget() -> anyhow::Result<()> {
    let e = setup().await?;
    let m0 = bal(&e.mallory).await?;
    assert_eq!(outcome(&e, &prop(&e, e.mallory.id(), 1).await?).await?["reason"], "receiver_not_allowlisted");
    assert_eq!(outcome(&e, &prop(&e, e.bob.id(), NEAR / 10 + 1).await?).await?["reason"], "over_per_action_cap");
    assert_eq!(outcome(&e, &prop(&e, e.bob.id(), 0).await?).await?["reason"], "zero_amount");
    // 0.1 + 0.1 fit the 0.25 budget, the third 0.1 does not.
    assert_eq!(outcome(&e, &prop(&e, e.bob.id(), NEAR / 10).await?).await?["decision"], "allowed");
    assert_eq!(outcome(&e, &prop(&e, e.bob.id(), NEAR / 10).await?).await?["decision"], "allowed");
    assert_eq!(outcome(&e, &prop(&e, e.bob.id(), NEAR / 10).await?).await?["reason"], "over_daily_budget");
    assert_eq!(bal(&e.mallory).await?, m0);
    Ok(())
}

#[tokio::test]
async fn adv_stale_version_expired_and_unknown_clause() -> anyhow::Result<()> {
    let e = setup().await?;
    let mut p = prop(&e, e.bob.id(), 1).await?;
    p["policy_version"] = json!(p["policy_version"].as_u64().unwrap() + 1);
    assert_eq!(outcome(&e, &p).await?["reason"], "stale_policy_version");
    let mut p = prop(&e, e.bob.id(), 1).await?; p["expires_at"] = json!("1");
    assert_eq!(outcome(&e, &p).await?["reason"], "expired");
    let mut p = prop(&e, e.bob.id(), 1).await?; p["clause_id"] = json!("nope");
    assert_eq!(outcome(&e, &p).await?["reason"], "unknown_clause");
    let mut p = prop(&e, e.bob.id(), 1).await?; p["shop"] = json!("a|b");
    assert_eq!(outcome(&e, &p).await?["reason"], "bad_field", "separator injection into the action hash");
    let mut p = prop(&e, e.bob.id(), 1).await?; p["memo"] = json!("m".repeat(65));
    assert_eq!(outcome(&e, &p).await?["reason"], "memo_too_long");
    Ok(())
}

#[tokio::test]
async fn adv_clause_expiry_refuses_after_deadline() -> anyhow::Result<()> {
    let e = setup().await?;
    e.owner.call(e.oath.id(), "set_clause_expiry").args_json(json!({"clause_id": "tip", "expires_at": "1"})).transact().await?.into_result()?;
    assert_eq!(outcome(&e, &prop(&e, e.bob.id(), 1).await?).await?["reason"], "clause_expired");
    Ok(())
}

#[tokio::test]
async fn adv_freeze_refuses_then_owner_unfreezes() -> anyhow::Result<()> {
    let e = setup().await?;
    e.owner.call(e.oath.id(), "freeze").transact().await?.into_result()?;
    assert_eq!(outcome(&e, &prop(&e, e.bob.id(), 1).await?).await?["reason"], "frozen");
    let r = e.mallory.call(e.oath.id(), "unfreeze").transact().await?;
    assert!(r.is_failure());
    e.owner.call(e.oath.id(), "unfreeze").transact().await?.into_result()?;
    assert_eq!(outcome(&e, &prop(&e, e.bob.id(), 1).await?).await?["decision"], "allowed");
    Ok(())
}

#[tokio::test]
async fn adv_revoked_agent_key_is_gone() -> anyhow::Result<()> {
    let e = setup().await?;
    e.owner.call(e.oath.id(), "revoke_agent").gas(Gas::from_tgas(30)).transact().await?.into_result()?;
    let p = prop(&e, e.bob.id(), 1).await?;
    let r = propose(&e, &p).await;
    assert!(r.map(|x| x.is_failure()).unwrap_or(true), "revoked key still signs");
    Ok(())
}

#[tokio::test]
async fn adv_over_budget_batch_is_all_or_nothing() -> anyhow::Result<()> {
    let e = setup().await?;
    let b0 = bal(&e.bob).await?;
    let s = state(&e).await?;
    let n0 = s["next_nonce"].as_str().map(|x| x.parse::<u64>().unwrap()).or(s["next_nonce"].as_u64()).unwrap();
    let mk = |i: u64| json!({"shop": "townhall", "clause_id": "tip", "receiver": e.bob.id(), "amount": (NEAR / 10).to_string(),
        "nonce": (n0 + i).to_string(), "policy_version": s["policy_version"], "expires_at": u64::MAX.to_string(), "memo": null, "receipt": null});
    // three items of 0.1: each is under the cap, the total 0.3 is over the 0.25 budget.
    let r = e.agent.call(e.oath.id(), "propose_batch").args_json(json!({"ps": [mk(0), mk(1), mk(2)]})).gas(Gas::from_tgas(200)).transact().await?;
    assert!(r.is_success(), "{:?}", r.failures());
    let out: Vec<Value> = r.json()?;
    assert!(out.iter().all(|o| o["decision"] == "denied"), "{out:?}");
    assert_eq!(bal(&e.bob).await?, b0, "no item of a refused batch paid");
    // single-item batches are refused outright
    let r = e.agent.call(e.oath.id(), "propose_batch").args_json(json!({"ps": [mk(3)]})).gas(Gas::from_tgas(200)).transact().await?;
    assert!(r.is_failure() && err_has(&r, "ERR_BATCH_SIZE"));
    let _ = &e.w;
    Ok(())
}
