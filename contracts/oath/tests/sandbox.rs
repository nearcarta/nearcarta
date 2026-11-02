use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use near_workspaces::types::{KeyType, NearToken, SecretKey};
use near_workspaces::{Account, AccountId, Contract, Worker};
use near_workspaces::network::Sandbox;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const OATH_WASM: &str = "target/near/oath.wasm";
const OATH_ARTIFACT: &str = "../artifacts/oath.wasm";
const FT_WASM: &str = "../mock_ft/target/near/mock_ft.wasm";
const FT_ARTIFACT: &str = "../artifacts/mock_ft.wasm";
/// Local build if present, else the committed artifact (sha256 base58 = the deployed code_hash).
fn pick(local: &str, artifact: &str) -> String { if std::path::Path::new(local).exists() { local.into() } else { artifact.into() } }
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

fn sha_hex(b: &[u8]) -> String { hex::encode(Sha256::digest(b)) }

struct Env { w: Worker<Sandbox>, oath: Contract, owner: Account, agent: Account, bob: Account, dao: Account, ft: Contract }

fn native_clause(receivers: Vec<&AccountId>, cap: u128, budget: u128, receipt: bool, esc: Option<u128>) -> Value {
    json!({"asset": "Native", "receivers": receivers, "per_action_cap": cap.to_string(),
           "daily_budget": budget.to_string(), "window_start_min": 0, "window_end_min": 0,
           "requires_receipt": receipt, "escalation_max": esc.map(|e| e.to_string())})
}

async fn setup() -> anyhow::Result<Env> {
    let w = near_workspaces::sandbox().await?;
    let owner = w.dev_create_account().await?;
    let bob = w.dev_create_account().await?;
    let dao = w.dev_create_account().await?;
    let oath = w.dev_deploy(&std::fs::read(pick(OATH_WASM, OATH_ARTIFACT))?).await?;
    let ft = w.dev_deploy(&std::fs::read(pick(FT_WASM, FT_ARTIFACT))?).await?;
    ft.call("new").transact().await?.into_result()?;
    oath.call("new").args_json(json!({"owner": owner.id(), "dao": dao.id()})).transact().await?.into_result()?;
    let agent_sk = SecretKey::from_random(KeyType::ED25519);
    let r = owner.call(oath.id(), "set_agent_key")
        .args_json(json!({"public_key": agent_sk.public_key()}))
        .gas(near_workspaces::types::Gas::from_tgas(30)).transact().await?;
    assert!(r.is_success(), "{:?}", r.failures());
    println!("GAS set_agent_key: {}", r.total_gas_burnt);
    let agent = Account::from_secret_key(oath.id().clone(), agent_sk, &w);
    Ok(Env { w, oath, owner, agent, bob, dao, ft })
}

async fn pv(e: &Env) -> anyhow::Result<u32> {
    let s: Value = e.oath.view("get_state").await?.json()?;
    Ok(s["policy_version"].as_u64().unwrap() as u32)
}
async fn nonce(e: &Env) -> anyhow::Result<u64> {
    e.w.fast_forward(2).await?;
    let s: Value = e.oath.view("get_state").await?.json()?;
    Ok(s["next_nonce"].as_str().unwrap().parse()?)
}

fn proposal(clause: &str, receiver: &AccountId, amount: u128, nonce: u64, pv: u32) -> Value {
    json!({"shop": "guardhouse", "clause_id": clause, "receiver": receiver, "amount": amount.to_string(),
           "nonce": nonce.to_string(), "policy_version": pv, "expires_at": u64::MAX.to_string(), "memo": null, "receipt": null})
}

async fn propose(e: &Env, p: Value) -> anyhow::Result<(Value, near_workspaces::result::ExecutionFinalResult)> {
    let r = e.agent.call(e.oath.id(), "propose").args_json(json!({"p": p})).gas(near_workspaces::types::Gas::from_tgas(100)).transact().await?;
    let v: Value = if r.is_success() { r.clone().json().unwrap_or(Value::Null) } else { Value::Null };
    Ok((v, r))
}

/// Escalated proposals leave a yielded receipt open, so the tx is not "final" until resume/timeout.
/// Send async and read state instead of waiting (blocking makes the client resend -> ERR_NONCE).
async fn propose_async(e: &Env, p: Value) -> anyhow::Result<Value> {
    let before: Value = e.oath.view("get_state").await?.json()?;
    let _st = e.agent.call(e.oath.id(), "propose").args_json(json!({"p": p})).gas(near_workspaces::types::Gas::from_tgas(100)).transact_async().await?;
    let id = before["next_action"].clone();
    for _ in 0..40 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let a: Value = e.oath.view("get_action").args_json(json!({"action_id": id})).await?.json()?;
        if !a.is_null() { return Ok(a); }
    }
    Ok(Value::Null)
}

/// R14: an escalation resolves through a yield resume plus a callback receipt, which may land a block or
/// two after `fast_forward` returns (seen flaky after the box reboot). Poll instead of reading once.
async fn action_until(e: &Env, id: &Value, want: &str) -> anyhow::Result<Value> {
    let mut a = Value::Null;
    for _ in 0..40 {
        a = e.oath.view("get_action").args_json(json!({"action_id": id})).await?.json()?;
        if a["status"] == want { break; }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    Ok(a)
}

fn action_hash(oath: &AccountId, p: &Value) -> String {
    let memo = match p["memo"].as_str() { Some(m) => sha_hex(m.as_bytes()), None => "none".to_string() };
    let s = format!("oath-v2|{}|{}|{}|{}|{}|{}|{}|{}|{}", oath, p["shop"].as_str().unwrap(), p["clause_id"].as_str().unwrap(),
        p["receiver"].as_str().unwrap(), p["amount"].as_str().unwrap(), p["nonce"].as_str().unwrap(),
        p["policy_version"], p["expires_at"].as_str().unwrap(), memo);
    sha_hex(s.as_bytes())
}

/// R11 canonical receipt: the response is exactly the compact, key-sorted verdict object.
fn make_receipt(sk: &SigningKey, model: &str, ah: &str, job: &str, verdict: &str, p: &Value) -> Value {
    let req = json!({"model": model, "messages": [{"role": "user", "content": format!("screen action {ah} job {job}")}]}).to_string();
    let resp = json!({"action_hash": ah, "age_days": 365, "amount": p["amount"], "code_hash": "11111111111111111111111111111111",
        "job_id": job, "receiver": p["receiver"], "v": "oath-receipt-v2", "verdict": verdict}).to_string();
    let text = format!("{}:{}:{}", model, sha_hex(req.as_bytes()), sha_hex(resp.as_bytes()));
    let sig = sk.sign(text.as_bytes());
    json!({"signer_key_id": "nearai-test", "model": model, "request_body": req, "response_body": resp,
           "signature": base64::engine::general_purpose::STANDARD.encode(sig.to_bytes()), "job_id": job})
}

#[tokio::test]
async fn oath_end_to_end() -> anyhow::Result<()> {
    let e = setup().await?;
    let ghost: AccountId = "ghost-does-not-exist.test.near".parse()?;
    // policy: pay bob up to 1 NEAR per action, 2 NEAR per day
    let r = e.owner.call(e.oath.id(), "set_clause")
        .args_json(json!({"clause_id": "tip", "clause": native_clause(vec![e.bob.id(), &ghost], NEAR, 2 * NEAR, false, Some(3 * NEAR / 2))}))
        .transact().await?;
    assert!(r.is_success()); println!("GAS set_clause: {}", r.total_gas_burnt);
    let v = pv(&e).await?;

    // 1. allowed action executes
    let bob0 = e.bob.view_account().await?.balance;
    let st0 = e.w.view_account(e.oath.id()).await?.storage_usage;
    let (out, r) = propose(&e, proposal("tip", e.bob.id(), NEAR / 2, 0, v)).await?;
    println!("T1 allowed: {out} gas={}", r.total_gas_burnt);
    assert_eq!(out["status"], "confirmed");
    let bob1 = e.bob.view_account().await?.balance;
    assert_eq!(bob1.as_yoctonear() - bob0.as_yoctonear(), NEAR / 2);
    let st1 = e.w.view_account(e.oath.id()).await?.storage_usage;
    println!("STORAGE per confirmed action: {} bytes", st1 - st0);
    let ev: Vec<&str> = r.logs().into_iter().filter(|l| l.starts_with("EVENT_JSON")).collect();
    println!("EVENTS: {:?}", ev);
    assert!(ev.iter().any(|l| l.contains("\"event\":\"action\"") && l.contains("allowed")));
    assert!(ev.iter().any(|l| l.contains("\"event\":\"settle\"") && l.contains("confirmed")));

    // 2. replay (same nonce) rejected
    let (_, r) = propose(&e, proposal("tip", e.bob.id(), NEAR / 2, 0, v)).await?;
    assert!(!r.is_success()); println!("T2 replayed nonce rejected: {:?}", r.failures().len());

    // 3. over per-action cap without escalation range -> denied (logged, no storage)
    let st2 = e.w.view_account(e.oath.id()).await?.storage_usage;
    let (out, r) = propose(&e, proposal("tip", e.bob.id(), 2 * NEAR, 1, v)).await?;
    println!("T3 over cap: {out} gas={}", r.total_gas_burnt);
    assert_eq!(out["reason"], "over_per_action_cap");
    assert!(r.logs().iter().any(|l| l.contains("\"decision\":\"denied\"")));
    let st3 = e.w.view_account(e.oath.id()).await?.storage_usage;
    println!("STORAGE per denied action: {} bytes", st3 as i64 - st2 as i64);

    // 4. receiver not allowlisted -> denied
    let (out, _) = propose(&e, proposal("tip", e.dao.id(), NEAR / 10, 2, v)).await?;
    assert_eq!(out["reason"], "receiver_not_allowlisted"); println!("T4 {out}");

    // 5. daily budget: 0.5 spent; 1.0 ok; another 0.6 -> over budget
    let (out, _) = propose(&e, proposal("tip", e.bob.id(), NEAR, 3, v)).await?;
    assert_eq!(out["status"], "confirmed");
    let (out, _) = propose(&e, proposal("tip", e.bob.id(), 6 * NEAR / 10, 4, v)).await?;
    assert_eq!(out["reason"], "over_daily_budget"); println!("T5 {out}");

    // 6. execution failure releases the reservation (ghost account doesn't exist)
    let u0: Value = e.oath.view("get_usage").args_json(json!({"clause_id": "tip"})).await?.json()?;
    let (out, r) = propose(&e, proposal("tip", &ghost, NEAR / 10, 5, v)).await?;
    println!("T6 failed exec: {out} gas={}", r.total_gas_burnt);
    assert_eq!(out["status"], "failed_released");
    let u1: Value = e.oath.view("get_usage").args_json(json!({"clause_id": "tip"})).await?.json()?;
    // R11: the action count still increments (anti-griefing); spent/reserved are released.
    assert_eq!((&u0["spent"], &u0["reserved"]), (&u1["spent"], &u1["reserved"])); println!("T6 usage after release: {u1}");

    // 7. stale policy version -> denied
    let (out, _) = propose(&e, proposal("tip", e.bob.id(), 1, 6, v - 1)).await?;
    assert_eq!(out["reason"], "stale_policy_version");

    // 8. the agent key can do nothing else
    let r = e.agent.call(e.oath.id(), "freeze").transact().await;
    println!("T8a agent->freeze: {}", short(&r));
    assert!(r.map(|x| !x.is_success()).unwrap_or(true));
    let r = e.agent.call(e.oath.id(), "set_clause").args_json(json!({"clause_id": "x", "clause": native_clause(vec![e.bob.id()], 100*NEAR, 100*NEAR, false, None)})).transact().await;
    println!("T8b agent->set_clause: {}", short(&r));
    assert!(r.map(|x| !x.is_success()).unwrap_or(true));
    let r = e.agent.transfer_near(e.bob.id(), NearToken::from_near(1)).await;
    println!("T8c agent->raw transfer: {:?}", r.as_ref().map(|x| x.is_success()).map_err(|e| e.to_string().chars().take(160).collect::<String>()));
    assert!(r.map(|x| !x.is_success()).unwrap_or(true));
    let r = e.agent.call(e.bob.id(), "anything").transact().await;
    println!("T8d agent->other contract: {}", short(&r));
    assert!(r.map(|x| !x.is_success()).unwrap_or(true));
    let r = e.agent.call(e.oath.id(), "propose").args_json(json!({"p": proposal("tip", e.bob.id(), 1, 6, v)})).deposit(NearToken::from_yoctonear(1)).transact().await;
    println!("T8e agent->propose with deposit: {}", short(&r));
    assert!(r.map(|x| !x.is_success()).unwrap_or(true));
    let r = e.agent.call(e.oath.id(), "on_settle").args_json(json!({"action_id": "0"})).transact().await;
    println!("T8f agent->on_settle: {}", short(&r));
    assert!(r.map(|x| !x.is_success()).unwrap_or(true));
    // outsider calling propose directly
    let r = e.bob.call(e.oath.id(), "propose").args_json(json!({"p": proposal("tip", e.bob.id(), 1, 6, v)})).transact().await?;
    assert!(!r.is_success()); println!("T8g outsider->propose rejected");
    let keys = e.w.view_access_keys(e.oath.id()).await?;
    println!("KEYS on oath account: {:?}", keys.iter().map(|k| format!("{:?}", k.access_key.permission)).collect::<Vec<_>>());

    // 9. freeze (by DAO) blocks in-limit action; unfreeze restores
    let r = e.dao.call(e.oath.id(), "freeze").transact().await?; assert!(r.is_success());
    let n = nonce(&e).await?;
    let (out, _) = propose(&e, proposal("tip", e.bob.id(), 1, n, v)).await?;
    assert_eq!(out["reason"], "frozen"); println!("T9 frozen: {out}");
    let r = e.bob.call(e.oath.id(), "freeze").transact().await?;
    assert!(!r.is_success()); println!("T9b outsider freeze rejected");
    let r = e.owner.call(e.oath.id(), "unfreeze").transact().await?;
    assert!(!r.is_success()); println!("T9c owner cannot unfreeze when a DAO is set (R11)");
    e.dao.call(e.oath.id(), "unfreeze").transact().await?.into_result()?;

    // 10. time window closed
    let blk = e.w.view_block().await?;
    let m = ((blk.timestamp() / 60_000_000_000) % 1440) as u16;
    let mut c = native_clause(vec![e.bob.id()], NEAR, 2 * NEAR, false, None);
    c["window_start_min"] = json!((m + 120) % 1440); c["window_end_min"] = json!((m + 180) % 1440);
    e.owner.call(e.oath.id(), "set_clause").args_json(json!({"clause_id": "night", "clause": c})).transact().await?.into_result()?;
    let v = pv(&e).await?; let n = nonce(&e).await?;
    let (out, _) = propose(&e, proposal("night", e.bob.id(), 1, n, v)).await?;
    assert_eq!(out["reason"], "outside_time_window"); println!("T10 {out}");

    // 11. receipt-gated clause
    let sk = SigningKey::generate(&mut rand::rngs::OsRng);
    e.owner.call(e.oath.id(), "set_receipt_signer").args_json(json!({"key_id": "nearai-test",
        "public_key": base64::engine::general_purpose::STANDARD.encode(sk.verifying_key().to_bytes())})).transact().await?.into_result()?;
    e.owner.call(e.oath.id(), "set_clause").args_json(json!({"clause_id": "screened", "clause": native_clause(vec![e.bob.id()], NEAR, 2 * NEAR, true, None)})).transact().await?.into_result()?;
    let v = pv(&e).await?; let n = nonce(&e).await?;
    let p0 = proposal("screened", e.bob.id(), NEAR / 100, n, v);
    let (out, _) = propose(&e, p0.clone()).await?;
    assert_eq!(out["reason"], "receipt_required"); println!("T11a {out}");
    let mut p = proposal("screened", e.bob.id(), NEAR / 100, n + 1, v);
    let ah = action_hash(e.oath.id(), &p);
    p["receipt"] = make_receipt(&sk, "test-model", &ah, "job-0000000000000001", "ALLOW", &p);
    let (out, r) = propose(&e, p.clone()).await?;
    println!("T11b valid receipt: {out} gas={}", r.total_gas_burnt);
    assert_eq!(out["status"], "confirmed");
    // replayed job id
    let mut p2 = proposal("screened", e.bob.id(), NEAR / 100, n + 2, v);
    let ah2 = action_hash(e.oath.id(), &p2);
    p2["receipt"] = make_receipt(&sk, "test-model", &ah2, "job-0000000000000001", "ALLOW", &p2);
    let (out, _) = propose(&e, p2).await?;
    assert_eq!(out["reason"], "receipt_replayed"); println!("T11c {out}");
    // tampered response
    let mut p3 = proposal("screened", e.bob.id(), NEAR / 100, n + 3, v);
    let ah3 = action_hash(e.oath.id(), &p3);
    let mut rc = make_receipt(&sk, "test-model", &ah3, "job-0000000000000003", "ALLOW", &p3);
    rc["response_body"] = json!(rc["response_body"].as_str().unwrap().replace("ALLOW", "ALLOW "));
    p3["receipt"] = rc;
    let (out, _) = propose(&e, p3).await?;
    assert_eq!(out["reason"], "receipt_signature_invalid"); println!("T11d {out}");
    // receipt for a different action (amount swapped after signing)
    let mut p4 = proposal("screened", e.bob.id(), NEAR / 100, n + 4, v);
    let ah4 = action_hash(e.oath.id(), &p4);
    p4["receipt"] = make_receipt(&sk, "test-model", &ah4, "job-0000000000000004", "ALLOW", &p4);
    p4["amount"] = json!((NEAR / 2).to_string());
    let (out, _) = propose(&e, p4).await?;
    assert_eq!(out["reason"], "receipt_not_bound_to_action"); println!("T11e {out}");
    // DENY verdict
    let mut p5 = proposal("screened", e.bob.id(), NEAR / 100, n + 5, v);
    let ah5 = action_hash(e.oath.id(), &p5);
    p5["receipt"] = make_receipt(&sk, "test-model", &ah5, "job-0000000000000005", "DENY", &p5);
    let (out, _) = propose(&e, p5).await?;
    assert_eq!(out["reason"], "receipt_verdict_not_allow"); println!("T11f {out}");

    // 12. FT clause: contract builds ft_transfer; failure (no balance) releases
    let r = e.owner.call(e.oath.id(), "set_clause").args_json(json!({"clause_id": "usdc", "clause": {
        "asset": {"Ft": {"token": e.ft.id()}}, "receivers": [e.bob.id()], "per_action_cap": "5000000",
        "daily_budget": "10000000", "window_start_min": 0, "window_end_min": 0, "requires_receipt": false, "escalation_max": null}})).transact().await?;
    assert!(r.is_success());
    let v = pv(&e).await?; let n = nonce(&e).await?;
    let (out, _) = propose(&e, proposal("usdc", e.bob.id(), 1_000_000, n, v)).await?;
    assert_eq!(out["status"], "failed_released"); println!("T12a ft no balance: {out}");
    assert_eq!(out["reason"], "ft_receiver_not_registered");
    e.owner.call(e.ft.id(), "mint").args_json(json!({"account_id": e.oath.id(), "amount": "20000000"})).transact().await?.into_result()?;
    e.bob.call(e.ft.id(), "storage_deposit").args_json(json!({"account_id": e.bob.id()})).deposit(NearToken::from_millinear(2)).transact().await?.into_result()?;
    let (out, r) = propose(&e, proposal("usdc", e.bob.id(), 3_000_000, n + 1, v)).await?;
    println!("T12b ft ok: {out} gas={}", r.total_gas_burnt);
    assert_eq!(out["status"], "confirmed");
    let bal: String = e.ft.view("ft_balance_of").args_json(json!({"account_id": e.bob.id()})).await?.json()?;
    assert_eq!(bal, "3000000");

    // 13. escalation via yield/resume: over cap (1.2 > 1.0) waits for owner
    e.owner.call(e.oath.id(), "set_clause").args_json(json!({"clause_id": "big", "clause": native_clause(vec![e.bob.id()], NEAR, 5 * NEAR, false, Some(2 * NEAR))})).transact().await?.into_result()?;
    let v = pv(&e).await?; let n = nonce(&e).await?;
    let st: Value = e.oath.view("get_state").await?.json()?; println!("T13 pre state {st} n={n} v={v}");
    let bob_a = e.bob.view_account().await?.balance.as_yoctonear();
    let id: Value = e.oath.view("get_state").await?.json::<Value>()?["next_action"].clone();
    let out = propose_async(&e, proposal("big", e.bob.id(), 12 * NEAR / 10, n, v)).await?;
    println!("T13a escalated record: {out}");
    assert_eq!(out["status"], "escalated");
    let u: Value = e.oath.view("get_usage").args_json(json!({"clause_id": "big"})).await?.json()?;
    println!("T13a usage while waiting: {u}");
    let r = e.bob.call(e.oath.id(), "resolve_escalation").args_json(json!({"action_id": id, "approve": true})).transact().await?;
    assert!(!r.is_success()); println!("T13b outsider cannot approve");
    let bob_a = e.bob.view_account().await?.balance.as_yoctonear(); // after bob paid gas for T13b
    let r = e.owner.call(e.oath.id(), "resolve_escalation").args_json(json!({"action_id": id, "approve": true})).max_gas().transact().await?;
    println!("T13c owner approve: ok={} gas={}", r.is_success(), r.total_gas_burnt);
    e.w.fast_forward(3).await?;
    let a = action_until(&e, &id, "confirmed").await?;
    println!("T13c action after approve: {a}");
    assert_eq!(a["status"], "confirmed");
    let d = e.bob.view_account().await?.balance.as_yoctonear() - bob_a; // + late gas refund from T13b
    println!("T13c bob delta {d}"); assert!(d >= 12 * NEAR / 10 && d < 12 * NEAR / 10 + NEAR / 50);
    // rejected escalation
    let id2: Value = e.oath.view("get_state").await?.json::<Value>()?["next_action"].clone();
    let out = propose_async(&e, proposal("big", e.bob.id(), 11 * NEAR / 10, n + 1, v)).await?; assert_eq!(out["status"], "escalated");
    e.owner.call(e.oath.id(), "resolve_escalation").args_json(json!({"action_id": id2, "approve": false})).max_gas().transact().await?.into_result()?;
    e.w.fast_forward(3).await?;
    let a = action_until(&e, &id2, "denied").await?;
    assert_eq!(a["status"], "denied"); println!("T13d owner rejected -> {a}");
    // timeout: nobody answers within the yield window
    let id3: Value = e.oath.view("get_state").await?.json::<Value>()?["next_action"].clone();
    let out = propose_async(&e, proposal("big", e.bob.id(), 11 * NEAR / 10, n + 2, v)).await?; assert_eq!(out["status"], "escalated");
    e.w.fast_forward(250).await?;
    let a = action_until(&e, &id3, "denied").await?;
    println!("T13e after 250 blocks: {a}");
    assert_eq!(a["status"], "denied");
    let u: Value = e.oath.view("get_usage").args_json(json!({"clause_id": "big"})).await?.json()?;
    assert_eq!(u["reserved"], json!("0")); println!("T13e usage after timeout: {u}");

    // 14. revoke: agent key deleted, agent can no longer sign
    let r = e.dao.call(e.oath.id(), "revoke_agent").transact().await?; assert!(r.is_success());
    let n = nonce(&e).await?; let v = pv(&e).await?;
    let r = e.agent.call(e.oath.id(), "propose").args_json(json!({"p": proposal("tip", e.bob.id(), 1, n, v)})).transact().await;
    println!("T14 after revoke: {}", short(&r));
    assert!(r.map(|x| !x.is_success()).unwrap_or(true));
    let st = e.w.view_account(e.oath.id()).await?;
    println!("FINAL storage_usage={} contract={:?}", st.storage_usage, st.contract_state);
    Ok(())
}

fn short(r: &Result<near_workspaces::result::ExecutionFinalResult, near_workspaces::error::Error>) -> String {
    match r {
        Ok(x) => format!("executed success={} failures={:?}", x.is_success(), x.failures().iter().map(|f| format!("{:?}", (*f).clone().into_result().err())).collect::<Vec<_>>()).chars().take(300).collect(),
        Err(e) => format!("REJECTED: {}", e.to_string().chars().take(300).collect::<String>()),
    }
}

/// R14: set_agent_key with a key that already exists on the account (the contract's own
/// full-access key) -> AddKeyAlreadyExists -> on_agent_key rolls agent_key back; the old agent
/// key is NOT deleted and still works. Then a clean rotation deletes the old key.
#[tokio::test]
async fn r14_set_agent_key_rollback_and_rotation() -> anyhow::Result<()> {
    let e = setup().await?;
    let old_pk = e.agent.secret_key().public_key();
    let full_pk = e.oath.as_account().secret_key().public_key();
    let st0: Value = e.oath.view("get_state").await?.json()?;
    assert_eq!(st0["agent_key"], json!(old_pk));

    // 1. failure path
    let r = e.owner.call(e.oath.id(), "set_agent_key")
        .args_json(json!({"public_key": full_pk, "allowance": NEAR.to_string()}))
        .gas(near_workspaces::types::Gas::from_tgas(50)).transact().await?;
    let logs = r.logs().join("\n");
    println!("R14 rollback tx success={} logs={}", r.is_success(), logs);
    assert!(logs.contains("\"op\":\"rollback\""), "no rollback log: {logs}");
    let st1: Value = e.oath.view("get_state").await?.json()?;
    assert_eq!(st1["agent_key"], json!(old_pk), "agent_key not restored");
    let keys = e.w.view_access_keys(e.oath.id()).await?;
    assert!(keys.iter().any(|k| k.public_key == old_pk), "old agent key must still exist");
    // the restored agent key still signs

    let n = nonce(&e).await?; let v = pv(&e).await?;
    let (_v, r) = propose(&e, proposal("nonexistent", e.bob.id(), 1, n, v)).await?;
    println!("R14 old key after rollback: success={} (deny or panic both prove the key signs)", r.is_success());
    assert!(!r.logs().is_empty() || r.is_failure());

    // 2. success path: rotate to a fresh key -> old one deleted
    let new_sk = SecretKey::from_random(KeyType::ED25519);
    let r = e.owner.call(e.oath.id(), "set_agent_key")
        .args_json(json!({"public_key": new_sk.public_key(), "allowance": NEAR.to_string()}))
        .gas(near_workspaces::types::Gas::from_tgas(50)).transact().await?;
    assert!(r.is_success(), "{:?}", r.failures());
    println!("GAS set_agent_key (rotation, with callback): {}", r.total_gas_burnt);
    let keys = e.w.view_access_keys(e.oath.id()).await?;
    assert!(keys.iter().any(|k| k.public_key == new_sk.public_key()), "new key missing");
    assert!(!keys.iter().any(|k| k.public_key == old_pk), "old key not deleted");
    let st2: Value = e.oath.view("get_state").await?.json()?;
    assert_eq!(st2["agent_key"], json!(new_sk.public_key()));

    // 3. on_agent_key is private
    let r = e.owner.call(e.oath.id(), "on_agent_key")
        .args_json(json!({"prev": null, "new": new_sk.public_key()})).transact().await?;
    assert!(r.is_failure());
    println!("R14 on_agent_key by owner: {:?}", r.failures().first().map(|f| format!("{:?}", (*f).clone().into_result().err())).unwrap_or_default().chars().take(160).collect::<String>());
    Ok(())
}

#[tokio::test]
async fn r18_agent_key_has_no_allowance_by_default_and_cap_is_optional() -> anyhow::Result<()> {
    let e = setup().await?;
    let pk = e.agent.secret_key().public_key();
    let keys = e.w.view_access_keys(e.oath.id()).await?;
    let k = keys.iter().find(|k| k.public_key == pk).expect("agent key");
    match &k.access_key.permission {
        near_workspaces::types::AccessKeyPermission::FunctionCall(fc) => {
            assert_eq!(fc.allowance, None, "default agent key must have no gas allowance");
            assert!(fc.method_names.iter().all(|m| m.starts_with("propose")), "{:?}", fc.method_names);
            assert_eq!(&fc.receiver_id, e.oath.id().as_str());
        }
        p => panic!("agent key must be a function-call key, got {p:?}"),
    }
    // A cap can still be asked for, but never zero.
    let sk = SecretKey::from_random(KeyType::ED25519);
    let r = e.owner.call(e.oath.id(), "set_agent_key").args_json(json!({"public_key": sk.public_key(), "allowance": "0"}))
        .gas(near_workspaces::types::Gas::from_tgas(50)).transact().await?;
    assert!(r.is_failure());
    let r = e.owner.call(e.oath.id(), "set_agent_key").args_json(json!({"public_key": sk.public_key(), "allowance": NEAR.to_string()}))
        .gas(near_workspaces::types::Gas::from_tgas(50)).transact().await?;
    assert!(r.is_success(), "{:?}", r.failures());
    let keys = e.w.view_access_keys(e.oath.id()).await?;
    let k = keys.iter().find(|k| k.public_key == sk.public_key()).expect("capped key");
    if let near_workspaces::types::AccessKeyPermission::FunctionCall(fc) = &k.access_key.permission { assert_eq!(fc.allowance, Some(NearToken::from_near(1))); }
    Ok(())
}
