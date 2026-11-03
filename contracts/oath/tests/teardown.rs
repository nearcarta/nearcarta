//! Refund path: the charter owner swaps the charter code for the reaper through the charter's own
//! upgrade gate, then `reap()` deletes the account and every yocto goes back to the owner.
use near_workspaces::types::{Gas, NearToken};
use serde_json::json;

fn pick(local: &str, artifact: &str) -> String { if std::path::Path::new(local).exists() { local.into() } else { artifact.into() } }
fn oath_wasm() -> Vec<u8> { std::fs::read(std::env::var("OATH_WASM").unwrap_or_else(|_| pick("target/near/oath.wasm", "../artifacts/oath.wasm"))).unwrap() }
fn reaper_wasm() -> Vec<u8> { std::fs::read(pick("../reaper/target/near/reaper.wasm", "../artifacts/reaper.wasm")).unwrap() }
fn sha(b: &[u8]) -> String { use sha2::Digest; hex::encode(sha2::Sha256::digest(b)) }

#[tokio::test]
async fn teardown_reaper_refunds_everything_to_owner_only() -> anyhow::Result<()> {
    let w = near_workspaces::sandbox().await?;
    let owner = w.dev_create_account().await?;
    let mallory = w.dev_create_account().await?;
    let oath = w.dev_deploy(&oath_wasm()).await?;
    oath.call("new").args_json(json!({"owner": owner.id(), "dao": null, "policy_delay_ns": "0"})).transact().await?.into_result()?;
    // a stranger cannot swap the code
    let r = mallory.call(oath.id(), "upgrade").args(reaper_wasm()).gas(Gas::from_tgas(300)).transact().await?;
    assert!(r.is_failure(), "stranger upgraded the charter");
    owner.call(oath.id(), "upgrade").args(reaper_wasm()).gas(Gas::from_tgas(300)).transact().await?.into_result()?;
    let stored: String = oath.view("owner").await?.json()?;
    assert_eq!(stored, owner.id().to_string(), "reaper reads the owner from the old charter state");
    let r = mallory.call(oath.id(), "reap").deposit(NearToken::from_yoctonear(1)).transact().await?;
    assert!(r.is_failure() && format!("{:?}", r.failures()).contains("ERR_NOT_OWNER"));
    let r = owner.call(oath.id(), "reap").transact().await?;
    assert!(r.is_failure() && format!("{:?}", r.failures()).contains("ERR_ONE_YOCTO"));
    let charter_bal = oath.view_account().await?.balance.as_yoctonear();
    let o0 = owner.view_account().await?.balance.as_yoctonear();
    owner.call(oath.id(), "reap").deposit(NearToken::from_yoctonear(1)).transact().await?.into_result()?;
    assert!(oath.view_account().await.is_err(), "charter account still exists");
    let o1 = owner.view_account().await?.balance.as_yoctonear();
    // owner gets the whole charter balance back, minus the gas of one call (< 0.01 NEAR)
    assert!(o1 + 10_000_000_000_000_000_000_000 > o0 + charter_bal, "refund short: {o0} + {charter_bal} vs {o1}");
    Ok(())
}

#[tokio::test]
async fn teardown_upgrade_needs_the_timelock_when_a_delay_is_set() -> anyhow::Result<()> {
    let w = near_workspaces::sandbox().await?;
    let owner = w.dev_create_account().await?;
    let oath = w.dev_deploy(&oath_wasm()).await?;
    oath.call("new").args_json(json!({"owner": owner.id(), "dao": null, "policy_delay_ns": "0"})).transact().await?.into_result()?;
    owner.call(oath.id(), "set_policy_delay").args_json(json!({"delay_ns": "3600000000000"})).transact().await?.into_result()?;
    let r = owner.call(oath.id(), "upgrade").args(reaper_wasm()).gas(Gas::from_tgas(300)).transact().await?;
    assert!(r.is_failure() && format!("{:?}", r.failures()).contains("ERR_UPGRADE_NOT_TIMELOCKED"));
    owner.call(oath.id(), "queue_upgrade").args_json(json!({"code_hash": sha(&reaper_wasm())})).transact().await?.into_result()?;
    let r = owner.call(oath.id(), "upgrade").args(reaper_wasm()).gas(Gas::from_tgas(300)).transact().await?;
    assert!(r.is_failure(), "queued upgrade ran before its delay");
    let bad = owner.call(oath.id(), "queue_upgrade").args_json(json!({"code_hash": "zz"})).transact().await?;
    assert!(bad.is_failure() && format!("{:?}", bad.failures()).contains("ERR_CODE_HASH"));
    Ok(())
}
