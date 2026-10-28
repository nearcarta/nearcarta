//! Sandbox: publish the committed R14 oath artifact as a global contract (by hash),
//! deploy the factory, then walk a visitor through create -> clauses -> agent key ->
//! a refused spend and an allowed spend, plus the failure and refund paths.
use near_jsonrpc_client::{methods, JsonRpcClient};
use near_jsonrpc_primitives::types::query::QueryResponseKind;
use near_primitives::action::{Action, DeployGlobalContractAction, GlobalContractDeployMode};
use near_primitives::transaction::{SignedTransaction, Transaction, TransactionV0};
use near_primitives::types::{BlockReference, Finality};
use near_primitives::views::{QueryRequest, TxExecutionStatus};
use near_workspaces::network::Sandbox;
use near_workspaces::types::{Gas, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const OATH_ARTIFACT: &str = "../artifacts/oath.wasm";
const FACTORY_WASM: &str = "target/near/charter_factory.wasm";
const R14_HASH: &str = "6iazbQxXNWY6puNN9hC3njiiErrNyCvWzXL9fX95vRSe";
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MILLI: u128 = NEAR / 1000;

/// near-workspaces 0.24 has no global-contract API, so sign the action by hand.
async fn deploy_global(w: &Worker<Sandbox>, who: &Account, code: Vec<u8>) -> anyhow::Result<()> {
    let client = JsonRpcClient::connect(w.rpc_addr());
    let sk: near_crypto::SecretKey = who.secret_key().to_string().parse()?;
    let signer = near_crypto::InMemorySigner::from_secret_key(who.id().clone(), sk.clone());
    let q = client.call(methods::query::RpcQueryRequest {
        block_reference: BlockReference::Finality(Finality::None),
        request: QueryRequest::ViewAccessKey { account_id: who.id().clone(), public_key: sk.public_key() },
    }).await?;
    let nonce = match q.kind { QueryResponseKind::AccessKey(ak) => ak.nonce, _ => anyhow::bail!("no access key") };
    let tx = Transaction::V0(TransactionV0 {
        signer_id: who.id().clone(), public_key: sk.public_key(), nonce: nonce + 1,
        receiver_id: who.id().clone(), block_hash: q.block_hash,
        actions: vec![Action::DeployGlobalContract(DeployGlobalContractAction {
            code: code.into(), deploy_mode: GlobalContractDeployMode::CodeHash })],
    });
    let sig = signer.sign(tx.get_hash_and_size().0.as_ref());
    let r = client.call(methods::send_tx::RpcSendTransactionRequest {
        signed_transaction: SignedTransaction::new(sig, tx), wait_until: TxExecutionStatus::Final,
    }).await?;
    let st = r.final_execution_outcome.map(|o| o.into_outcome().status);
    anyhow::ensure!(matches!(st, Some(near_primitives::views::FinalExecutionStatus::SuccessValue(_))), "global deploy: {:?}", st);
    Ok(())
}

fn native_clause(receivers: Vec<&AccountId>, cap: u128, budget: u128) -> Value {
    json!({"asset": "Native", "receivers": receivers, "per_action_cap": cap.to_string(),
           "daily_budget": budget.to_string(), "window_start_min": 0, "window_end_min": 0,
           "requires_receipt": false, "escalation_max": null})
}

async fn create(visitor: &Account, factory: &Contract, name: &str, deposit: u128) -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    Ok(visitor.call(factory.id(), "create_charter").args_json(json!({"name": name}))
        .deposit(NearToken::from_yoctonear(deposit)).gas(Gas::from_tgas(120)).transact().await?)
}

async fn propose(agent: &Account, charter: &AccountId, pv: u64, nonce: &mut u64, recv: &AccountId, amount: u128, memo: &str)
    -> anyhow::Result<near_workspaces::result::ExecutionFinalResult> {
    let p = json!({"shop": "arena", "clause_id": "pay", "receiver": recv, "amount": amount.to_string(),
        "nonce": nonce.to_string(), "policy_version": pv, "expires_at": u64::MAX.to_string(), "memo": memo, "receipt": null});
    *nonce += 1;
    Ok(agent.call(charter, "propose").args_json(json!({"p": p})).gas(Gas::from_tgas(100)).transact().await?)
}

#[tokio::test]
async fn factory_end_to_end() -> anyhow::Result<()> {
    let w = near_workspaces::sandbox().await?;
    let root = w.root_account()?;
    let code = std::fs::read(OATH_ARTIFACT)?;
    assert_eq!(bs58::encode(Sha256::digest(&code)).into_string(), R14_HASH, "artifact is not the R14 build");

    // 1. publish the R14 oath code once, by hash
    let publisher = root.create_subaccount("publisher").initial_balance(NearToken::from_near(100)).transact().await?.into_result()?;
    deploy_global(&w, &publisher, code).await?;
    println!("STEP global oath published by hash {R14_HASH}");

    // 2. factory pinned to that hash; init is private
    let factory_acct = root.create_subaccount("charters").initial_balance(NearToken::from_near(20)).transact().await?.into_result()?;
    let factory = factory_acct.deploy(&std::fs::read(FACTORY_WASM)?).await?.into_result()?;
    let outsider = root.create_subaccount("outsider").initial_balance(NearToken::from_near(10)).transact().await?.into_result()?;
    let r = outsider.call(factory.id(), "new").args_json(json!({"code_hash": R14_HASH})).transact().await?;
    assert!(r.is_failure(), "outsider init must fail");
    factory.call("new").args_json(json!({"code_hash": R14_HASH})).transact().await?.into_result()?;
    let cfg: Value = factory.view("get_config").await?.json()?;
    assert_eq!(cfg["code_hash"], R14_HASH);
    println!("STEP factory config {cfg}");

    // 3. a visitor creates a charter
    let alice = root.create_subaccount("alice").initial_balance(NearToken::from_near(20)).transact().await?.into_result()?;
    let merchant = root.create_subaccount("merchant").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    let lookalike = root.create_subaccount("merchnat").initial_balance(NearToken::from_near(5)).transact().await?.into_result()?;
    let r = create(&alice, &factory, "alice-shop", NEAR).await?;
    assert!(r.is_success(), "{:?}", r.failures());
    println!("GAS create_charter: {}", r.total_gas_burnt);
    let charter: AccountId = format!("alice-shop.{}", factory.id()).parse()?;
    let info: Value = factory.view("get_charter").args_json(json!({"account_id": charter})).await?.json()?;
    assert_eq!(info["owner"], alice.id().to_string());
    let st: Value = w.view(&charter, "get_state").await?.json()?;
    assert_eq!(st["owner"], alice.id().to_string());
    // the charter runs the global R14 code and has no access keys of its own
    let acct = w.view_account(&charter).await?;
    println!("STEP charter account {:?}", acct);
    let keys = w.view_access_keys(&charter).await?;
    assert!(keys.is_empty(), "charter must start with zero keys");
    let fee = cfg["registry_fee"].as_str().unwrap().parse::<u128>()?;
    assert!(acct.balance.as_yoctonear() > NEAR - fee - 10 * MILLI, "deposit minus fee reaches the charter");

    // 4. clauses + agent key, signed by the owner
    alice.call(&charter, "set_clause").args_json(json!({"clause_id": "pay", "clause": native_clause(vec![merchant.id()], 100 * MILLI, 150 * MILLI)}))
        .transact().await?.into_result()?;
    let agent_sk = SecretKey::from_random(KeyType::ED25519);
    alice.call(&charter, "set_agent_key").args_json(json!({"public_key": agent_sk.public_key(), "allowance": (250 * MILLI).to_string()}))
        .gas(Gas::from_tgas(30)).transact().await?.into_result()?;
    let agent = Account::from_secret_key(charter.clone(), agent_sk, &w);
    let st: Value = w.view(&charter, "get_state").await?.json()?;
    let pv = st["policy_version"].as_u64().unwrap();

    let mut nonce = 0u64;
    // refused: look-alike payee
    let r = propose(&agent, &charter, pv, &mut nonce, lookalike.id(), 10 * MILLI, "arena:t:lookalike").await?;
    let out: Value = r.json()?;
    assert_eq!(out["decision"], "denied"); println!("DENY lookalike -> {}", out["reason"]);
    // refused: over the per-action cap
    let r = propose(&agent, &charter, pv, &mut nonce, merchant.id(), 200 * MILLI, "arena:t:impersonation").await?;
    let out: Value = r.json()?;
    assert_eq!(out["decision"], "denied"); println!("DENY over cap -> {}", out["reason"]);
    // allowed, then split-under-cap blows the daily budget
    let m0 = merchant.view_account().await?.balance;
    let r = propose(&agent, &charter, pv, &mut nonce, merchant.id(), 90 * MILLI, "invoice-1").await?;
    let out: Value = r.json()?;
    assert_ne!(out["decision"], "denied", "{out}");
    let m1 = merchant.view_account().await?.balance;
    assert_eq!(m1.as_yoctonear() - m0.as_yoctonear(), 90 * MILLI);
    let r = propose(&agent, &charter, pv, &mut nonce, merchant.id(), 90 * MILLI, "arena:t:split").await?;
    let out: Value = r.json()?;
    assert_eq!(out["decision"], "denied"); println!("DENY split -> {}", out["reason"]);

    // 5. failure paths
    let r = create(&alice, &factory, "alice-shop", NEAR).await?;
    assert!(r.is_failure(), "taken name must fail");
    let r = create(&alice, &factory, "cheap", 100 * MILLI).await?;
    assert!(r.is_failure(), "low deposit must fail");
    let r = outsider.call(factory.id(), "on_created")
        .args_json(json!({"charter": "x.charters.test.near", "owner": outsider.id(), "deposit": "1"})).transact().await?;
    assert!(r.is_failure(), "callback must be private");
    // account exists already (pre-made by someone else) -> callback refunds the whole deposit
    let squat = factory_acct.create_subaccount("squat").initial_balance(NearToken::from_near(1)).transact().await?.into_result()?;
    let b0 = alice.view_account().await?.balance.as_yoctonear();
    let r = create(&alice, &factory, squat.id().as_str().split('.').next().unwrap(), NEAR).await?;
    assert!(r.is_success(), "outer call succeeds, inner create fails: {:?}", r.failures());
    let b1 = alice.view_account().await?.balance.as_yoctonear();
    assert!(b0 - b1 < 5 * MILLI, "deposit refunded, only gas spent: {}", b0 - b1);
    let isc: bool = factory.view("is_charter").args_json(json!({"account_id": squat.id()})).await?.json()?;
    assert!(!isc);
    let mine: Value = factory.view("charters_of").args_json(json!({"owner": alice.id()})).await?.json()?;
    assert_eq!(mine.as_array().unwrap().len(), 1);
    println!("STEP refund ok, gas only {} yN", b0 - b1);
    Ok(())
}
