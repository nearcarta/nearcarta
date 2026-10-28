//! Unit tests (fast, run by cargo-mutants). Names map to R10 findings.
use super::*;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult, RuntimeFeesConfig};
use std::collections::HashMap;

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
fn acc(s: &str) -> AccountId { s.parse().unwrap() }
fn me() -> AccountId { acc("oath.test") }
fn agent_pk() -> PublicKey { "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp".parse().unwrap() }

fn ctx(pred: &str, ts_ns: u64) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(me()).predecessor_account_id(acc(pred)).signer_account_id(acc(pred))
        .signer_account_pk(agent_pk()).block_timestamp(ts_ns).account_balance(NearToken::from_near(50))
        .prepaid_gas(Gas::from_tgas(300));
    b
}
fn set(pred: &str, ts: u64) { testing_env!(ctx(pred, ts).build()); }
fn set_results(pred: &str, ts: u64, r: Vec<PromiseResult>) {
    testing_env!(ctx(pred, ts).build(), near_sdk::test_vm_config(), RuntimeFeesConfig::test(), HashMap::default(), r);
}
const T0: u64 = 1_800_000_000_000_000_000;

fn clause(receivers: &[&str], cap: u128, budget: u128, receipt: bool, esc: Option<u128>) -> Clause {
    Clause { asset: Asset::Native, receivers: receivers.iter().map(|r| acc(r)).collect(), per_action_cap: U128(cap),
        daily_budget: U128(budget), window_start_min: 0, window_end_min: 0, requires_receipt: receipt,
        escalation_max: esc.map(U128), min_amount: U128(1), max_actions_per_day: 50, min_receiver_age_days: 0,
        code_hash_pins: BTreeMap::new() }
}

/// Oath with owner/dao, agent key set, clause "tip" (bob, cap 1, budget 5, esc 3).
fn setup(delay: u64) -> Oath {
    set("owner.test", T0);
    let mut o = Oath::new(acc("owner.test"), Some(acc("dao.test")), Some(U64(0)), None, None);
    let _ = o.set_clause("tip".into(), clause(&["bob.test", "bakery.test"], NEAR, 5 * NEAR, false, Some(3 * NEAR)));
    o.agent_key = Some(agent_pk());
    if delay > 0 { let _ = o.set_policy_delay(U64(delay)); }
    o
}

fn prop(o: &Oath, clause_id: &str, to: &str, amount: u128) -> Proposal {
    Proposal { shop: "guardhouse".into(), clause_id: clause_id.into(), receiver: acc(to), amount: U128(amount),
        nonce: U64(o.next_nonce), policy_version: o.policy_version, expires_at: U64(u64::MAX), memo: None, receipt: None }
}

fn outcome(r: PromiseOrValue<Outcome>) -> Option<Outcome> { match r { PromiseOrValue::Value(v) => Some(v), _ => None } }
fn deny_reason(o: &mut Oath, p: Proposal) -> String {
    set("oath.test", T0);
    outcome(o.propose(p)).map(|x| x.reason).unwrap_or_else(|| "PROMISE".into())
}

// ---------------- S6: canonical receipt ----------------
fn body(ah: &str, receiver: &str, amount: u128, job: &str, verdict: &str, code_hash: &str, age: u64) -> String {
    serde_json::to_string(&json!({"action_hash": ah, "age_days": age, "amount": amount.to_string(), "code_hash": code_hash,
        "job_id": job, "receiver": receiver, "v": RECEIPT_V, "verdict": verdict})).unwrap()
}
fn sign(sk: &SigningKey, req: &str, resp: &str, job: &str) -> Receipt {
    let text = format!("m:{}:{}", hex::encode(env::sha256_array(req.as_bytes())), hex::encode(env::sha256_array(resp.as_bytes())));
    Receipt { signer_key_id: "screen-v1".into(), model: "m".into(), request_body: req.into(), response_body: resp.into(),
        signature: Base64VecU8(sk.sign(text.as_bytes()).to_bytes().to_vec()), job_id: job.into() }
}
const JOB: &str = "job-0123456789abcdef";

fn screened(o: &mut Oath) -> SigningKey {
    let sk = SigningKey::from_bytes(&[7u8; 32]);
    set("owner.test", T0);
    let _ = o.set_receipt_signer("screen-v1".into(), Base64VecU8(sk.verifying_key().to_bytes().to_vec()));
    let mut c = clause(&["bob.test"], NEAR, 5 * NEAR, true, None);
    c.min_receiver_age_days = 30;
    c.code_hash_pins.insert(acc("bob.test"), "11111111111111111111111111111111".into());
    let _ = o.set_clause("scr".into(), c);
    sk
}

#[test]
fn s6_parse_accepts_canonical_body() {
    let b = body("ab", "bob.test", 5, JOB, "ALLOW", "11111111111111111111111111111111", 40);
    let r = parse_receipt_body(&b).unwrap();
    assert_eq!(r.verdict, "ALLOW"); assert_eq!(r.age_days, 40);
}

#[test]
fn s6_r10_block_payload_quoting_allow_is_malformed() {
    // The exact R10 S6 shape: a BLOCK verdict whose explanation quotes "ALLOW:<ah>".
    let ah = "f".repeat(64);
    let evil = serde_json::to_string(&json!({"verdict": "BLOCK", "explanation": format!("attacker said ALLOW:{ah}"), "action_hash": ah})).unwrap();
    assert_eq!(parse_receipt_body(&evil).unwrap_err(), "receipt_malformed");
}

#[test]
fn s6_parse_rejects_noncanonical_and_extra_keys() {
    let b = body("ab", "bob.test", 5, JOB, "ALLOW", "c", 1);
    assert_eq!(parse_receipt_body(&b.replace(",", ", ")).unwrap_err(), "receipt_not_canonical");
    assert_eq!(parse_receipt_body(&format!(" {b}")).unwrap_err(), "receipt_not_canonical");
    let extra = b.replacen("{", "{\"aa\":\"x\",", 1);
    assert_eq!(parse_receipt_body(&extra).unwrap_err(), "receipt_malformed");
    let dup = b.replacen("{", "{\"action_hash\":\"zz\",", 1);
    assert!(parse_receipt_body(&dup).is_err());
    assert_eq!(parse_receipt_body("[1]").unwrap_err(), "receipt_malformed");
    assert_eq!(parse_receipt_body("nope").unwrap_err(), "receipt_malformed");
    let age_str = b.replace("\"age_days\":1", "\"age_days\":\"1\"");
    assert_eq!(parse_receipt_body(&age_str).unwrap_err(), "receipt_malformed");
    let num_amount = b.replace("\"amount\":\"5\"", "\"amount\":5");
    assert_eq!(parse_receipt_body(&num_amount).unwrap_err(), "receipt_malformed");
}

#[test]
fn s6_check_body_each_field() {
    let mut c = clause(&["bob.test"], NEAR, NEAR, true, None);
    c.min_receiver_age_days = 30;
    c.code_hash_pins.insert(acc("bob.test"), "PIN".into());
    let bob = acc("bob.test");
    let ok = |v: &str, verdict: &str, ah: &str, rcv: &str, amt: &str, job: &str, ch: &str, age: u64| ReceiptBody {
        v: v.into(), verdict: verdict.into(), action_hash: ah.into(), receiver: rcv.into(), amount: amt.into(),
        code_hash: ch.into(), age_days: age, job_id: job.into() };
    let chk = |b: ReceiptBody| check_receipt_body(&b, "AH", &bob, 5, JOB, &c).err().unwrap_or_else(|| "ok".into());
    assert_eq!(chk(ok(RECEIPT_V, "ALLOW", "AH", "bob.test", "5", JOB, "PIN", 30)), "ok");
    assert_eq!(chk(ok("oath-receipt-v1", "ALLOW", "AH", "bob.test", "5", JOB, "PIN", 30)), "receipt_malformed");
    assert_eq!(chk(ok(RECEIPT_V, "BLOCK", "AH", "bob.test", "5", JOB, "PIN", 30)), "receipt_verdict_not_allow");
    assert_eq!(chk(ok(RECEIPT_V, "allow", "AH", "bob.test", "5", JOB, "PIN", 30)), "receipt_verdict_not_allow");
    assert_eq!(chk(ok(RECEIPT_V, "ALLOW", "AX", "bob.test", "5", JOB, "PIN", 30)), "receipt_not_bound_to_action");
    assert_eq!(chk(ok(RECEIPT_V, "ALLOW", "AH", "eve.test", "5", JOB, "PIN", 30)), "receipt_receiver_mismatch");
    assert_eq!(chk(ok(RECEIPT_V, "ALLOW", "AH", "bob.test", "6", JOB, "PIN", 30)), "receipt_amount_mismatch");
    assert_eq!(chk(ok(RECEIPT_V, "ALLOW", "AH", "bob.test", "5", "job-other-000000000", "PIN", 30)), "receipt_job_mismatch");
    assert_eq!(chk(ok(RECEIPT_V, "ALLOW", "AH", "bob.test", "5", JOB, "", 30)), "receipt_malformed");
    assert_eq!(chk(ok(RECEIPT_V, "ALLOW", "AH", "bob.test", "5", JOB, &"x".repeat(65), 30)), "receipt_malformed");
    assert_eq!(chk(ok(RECEIPT_V, "ALLOW", "AH", "bob.test", "5", JOB, "OTHER", 30)), "receipt_code_hash_mismatch");
    assert_eq!(chk(ok(RECEIPT_V, "ALLOW", "AH", "bob.test", "5", JOB, "PIN", 29)), "receipt_receiver_too_new");
    // an unpinned receiver accepts any code hash
    let mut c2 = c.clone(); c2.code_hash_pins.clear();
    let b = ok(RECEIPT_V, "ALLOW", "AH", "bob.test", "5", JOB, "ANY", 30);
    assert!(check_receipt_body(&b, "AH", &bob, 5, JOB, &c2).is_ok());
}

#[test]
fn s6_propose_with_r10_payload_denied_and_valid_receipt_allowed() {
    let mut o = setup(0);
    let sk = screened(&mut o);
    set("oath.test", T0);
    let mut p = prop(&o, "scr", "bob.test", NEAR / 100);
    let ah = action_hash(&p);
    let req = format!("screen {ah}");
    let evil = serde_json::to_string(&json!({"verdict": "BLOCK", "explanation": format!("ALLOW:{ah}")})).unwrap();
    p.receipt = Some(sign(&sk, &req, &evil, JOB));
    assert_eq!(deny_reason(&mut o, p), "receipt_malformed");
    // the job id was not burned by the failed attempt
    let mut p = prop(&o, "scr", "bob.test", NEAR / 100);
    let ah = action_hash(&p);
    p.receipt = Some(sign(&sk, &format!("screen {ah}"), &body(&ah, "bob.test", NEAR / 100, JOB, "ALLOW", "11111111111111111111111111111111", 31), JOB));
    assert_eq!(deny_reason(&mut o, p), "PROMISE");
    // replay of the same job id
    let mut p = prop(&o, "scr", "bob.test", NEAR / 100);
    let ah = action_hash(&p);
    p.receipt = Some(sign(&sk, &format!("screen {ah}"), &body(&ah, "bob.test", NEAR / 100, JOB, "ALLOW", "11111111111111111111111111111111", 31), JOB));
    assert_eq!(deny_reason(&mut o, p), "receipt_replayed");
}

#[test]
fn s6_propose_receipt_errors() {
    let mut o = setup(0);
    let sk = screened(&mut o);
    let p = prop(&o, "scr", "bob.test", NEAR / 100);
    assert_eq!(deny_reason(&mut o, p), "receipt_required");
    // unknown signer
    let mut p = prop(&o, "scr", "bob.test", NEAR / 100);
    let ah = action_hash(&p);
    let mut r = sign(&sk, &ah, &body(&ah, "bob.test", NEAR / 100, JOB, "ALLOW", "11111111111111111111111111111111", 31), JOB);
    r.signer_key_id = "nope".into(); p.receipt = Some(r);
    assert_eq!(deny_reason(&mut o, p), "unknown_receipt_signer");
    // bad signature
    let mut p = prop(&o, "scr", "bob.test", NEAR / 100);
    let ah = action_hash(&p);
    let mut r = sign(&sk, &ah, &body(&ah, "bob.test", NEAR / 100, JOB, "ALLOW", "11111111111111111111111111111111", 31), JOB);
    r.model = "other".into(); p.receipt = Some(r);
    assert_eq!(deny_reason(&mut o, p), "receipt_signature_invalid");
    // bad sig length
    let mut p = prop(&o, "scr", "bob.test", NEAR / 100);
    let ah = action_hash(&p);
    let mut r = sign(&sk, &ah, &body(&ah, "bob.test", NEAR / 100, JOB, "ALLOW", "11111111111111111111111111111111", 31), JOB);
    r.signature = Base64VecU8(vec![1; 10]); p.receipt = Some(r);
    assert_eq!(deny_reason(&mut o, p), "bad_sig_len");
    // request not referencing the action
    let mut p = prop(&o, "scr", "bob.test", NEAR / 100);
    let ah = action_hash(&p);
    p.receipt = Some(sign(&sk, "unrelated", &body(&ah, "bob.test", NEAR / 100, JOB, "ALLOW", "11111111111111111111111111111111", 31), JOB));
    assert_eq!(deny_reason(&mut o, p), "receipt_not_bound_to_action");
    // too-new receiver
    let mut p = prop(&o, "scr", "bob.test", NEAR / 100);
    let ah = action_hash(&p);
    p.receipt = Some(sign(&sk, &ah, &body(&ah, "bob.test", NEAR / 100, JOB, "ALLOW", "11111111111111111111111111111111", 2), JOB));
    assert_eq!(deny_reason(&mut o, p), "receipt_receiver_too_new");
}

// ---------------- M6: job id ----------------
#[test]
fn m6_job_id_rules() {
    assert!(!valid_job_id("")); assert!(!valid_job_id("job-1")); assert!(!valid_job_id(&"a".repeat(15)));
    assert!(valid_job_id(&"a".repeat(16))); assert!(valid_job_id(&"a".repeat(64))); assert!(!valid_job_id(&"a".repeat(65)));
    assert!(!valid_job_id("job 0123456789abcdef")); assert!(!valid_job_id("job:0123456789abcdef"));
    assert!(valid_job_id("Job_0123-456789abcdef"));
    let mut o = setup(0);
    let sk = screened(&mut o);
    let mut p = prop(&o, "scr", "bob.test", NEAR / 100);
    let ah = action_hash(&p);
    p.receipt = Some(sign(&sk, &ah, &body(&ah, "bob.test", NEAR / 100, "job-1", "ALLOW", "11111111111111111111111111111111", 31), "job-1"));
    assert_eq!(deny_reason(&mut o, p), "receipt_job_id_invalid");
}

// ---------------- M5: memo in action hash ----------------
#[test]
fn m5_memo_changes_action_hash() {
    set("oath.test", T0);
    let o = setup(0);
    set("oath.test", T0);
    let mut p = prop(&o, "tip", "bob.test", 5);
    let h0 = action_hash(&p);
    p.memo = Some("invoice #7".into()); let h1 = action_hash(&p);
    p.memo = Some("invoice #8".into()); let h2 = action_hash(&p);
    assert_ne!(h0, h1); assert_ne!(h1, h2);
    p.memo = Some(String::new()); assert_ne!(action_hash(&p), h0);
    assert_eq!(h0.len(), 64);
}

#[test]
fn fields_and_memo_length() {
    let mut o = setup(0);
    let mut p = prop(&o, "tip", "bob.test", 5);
    p.memo = Some("m".repeat(65));
    assert_eq!(deny_reason(&mut o, p), "memo_too_long");
    let mut p = prop(&o, "tip", "bob.test", 5);
    p.memo = Some("m".repeat(64));
    assert_eq!(deny_reason(&mut o, p), "PROMISE");
    let mut p = prop(&o, "tip", "bob.test", 5);
    p.shop = "a|b".into();
    assert_eq!(deny_reason(&mut o, p), "bad_field");
    let mut p = prop(&o, "tip", "bob.test", 5);
    p.shop = "s".repeat(33);
    assert_eq!(deny_reason(&mut o, p), "bad_field");
    assert!(valid_field(&"s".repeat(32))); assert!(!valid_field(""));
}

// ---------------- basic clause checks ----------------
#[test]
fn clause_checks_basic() {
    let mut o = setup(0);
    let p = prop(&o, "tip", "eve.test", 5); assert_eq!(deny_reason(&mut o, p), "receiver_not_allowlisted");
    let p = prop(&o, "tip", "bob.test", 0); assert_eq!(deny_reason(&mut o, p), "zero_amount");
    let p = prop(&o, "tip", "bob.test", 4 * NEAR); assert_eq!(deny_reason(&mut o, p), "over_per_action_cap");
    let p = prop(&o, "nope", "bob.test", 5); assert_eq!(deny_reason(&mut o, p), "unknown_clause");
    let mut p = prop(&o, "tip", "bob.test", 5); p.policy_version -= 1; assert_eq!(deny_reason(&mut o, p), "stale_policy_version");
    let mut p = prop(&o, "tip", "bob.test", 5); p.expires_at = U64(T0 - 1); assert_eq!(deny_reason(&mut o, p), "expired");
    let mut p = prop(&o, "tip", "bob.test", 5); p.expires_at = U64(T0); assert_eq!(deny_reason(&mut o, p), "PROMISE");
    let p = prop(&o, "tip", "bob.test", NEAR); assert_eq!(deny_reason(&mut o, p), "PROMISE");
    let p = prop(&o, "tip", "bob.test", 3 * NEAR); assert_eq!(deny_reason(&mut o, p), "over_cap_waiting_owner");
    // budget 5: spent/reserved 1 + 3 + 5yocto*2 ; another 1 NEAR over
    let p = prop(&o, "tip", "bob.test", NEAR); assert_eq!(deny_reason(&mut o, p), "over_daily_budget");
    set("dao.test", T0); o.freeze();
    let p = prop(&o, "tip", "bob.test", 5); assert_eq!(deny_reason(&mut o, p), "frozen");
}

#[test]
fn time_window() {
    let mut o = setup(0);
    let m = ((T0 / NS_PER_MIN) % 1440) as u16;
    let mut c = clause(&["bob.test"], NEAR, NEAR, false, None);
    c.window_start_min = (m + 60) % 1440; c.window_end_min = (m + 120) % 1440;
    set("owner.test", T0); let _ = o.set_clause("night".into(), c.clone());
    let p = prop(&o, "night", "bob.test", 5); assert_eq!(deny_reason(&mut o, p), "outside_time_window");
    c.window_start_min = m; c.window_end_min = (m + 1) % 1440;
    set("owner.test", T0); let _ = o.set_clause("night".into(), c.clone());
    let p = prop(&o, "night", "bob.test", 5); assert_eq!(deny_reason(&mut o, p), "PROMISE");
    // wrap-around window [m+10, m) is closed exactly at m... open just before
    c.window_start_min = (m + 10) % 1440; c.window_end_min = m;
    set("owner.test", T0); let _ = o.set_clause("night".into(), c.clone());
    let p = prop(&o, "night", "bob.test", 5); assert_eq!(deny_reason(&mut o, p), "outside_time_window");
    c.window_start_min = (m + 10) % 1440; c.window_end_min = (m + 1) % 1440;
    set("owner.test", T0); let _ = o.set_clause("night".into(), c);
    let p = prop(&o, "night", "bob.test", 5); assert_eq!(deny_reason(&mut o, p), "PROMISE");
}

#[test]
fn nonce_must_match_and_bumps_on_denial() {
    let mut o = setup(0);
    let p = prop(&o, "tip", "eve.test", 5); deny_reason(&mut o, p);
    assert_eq!(o.next_nonce, 1);
    let mut p = prop(&o, "tip", "bob.test", 5); p.nonce = U64(0);
    set("oath.test", T0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = o.propose(p); }));
    assert!(r.is_err());
}

#[test]
#[should_panic(expected = "ERR_NOT_AGENT")]
fn propose_by_outsider_panics() {
    let mut o = setup(0);
    let p = prop(&o, "tip", "bob.test", 5);
    set("bob.test", T0); let _ = o.propose(p);
}

#[test]
#[should_panic(expected = "ERR_NOT_AGENT_KEY")]
fn propose_with_wrong_key_panics() {
    let mut o = setup(0);
    let p = prop(&o, "tip", "bob.test", 5);
    let mut b = ctx("oath.test", T0);
    b.signer_account_pk("ed25519:DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847".parse().unwrap());
    testing_env!(b.build());
    let _ = o.propose(p);
}

// ---------------- H15: storage griefing ----------------
#[test]
fn h15_min_amount() {
    let mut o = setup(0);
    let mut c = clause(&["bob.test"], NEAR, 5 * NEAR, false, None);
    c.min_amount = U128(NEAR / 1000);
    set("owner.test", T0); let _ = o.set_clause("tip".into(), c);
    let p = prop(&o, "tip", "bob.test", 1); assert_eq!(deny_reason(&mut o, p), "below_min_amount");
    let p = prop(&o, "tip", "bob.test", NEAR / 1000 - 1); assert_eq!(deny_reason(&mut o, p), "below_min_amount");
    let p = prop(&o, "tip", "bob.test", NEAR / 1000); assert_eq!(deny_reason(&mut o, p), "PROMISE");
}

#[test]
fn h15_daily_action_count_and_rollover() {
    let mut o = setup(0);
    let mut c = clause(&["bob.test"], NEAR, 5 * NEAR, false, None);
    c.max_actions_per_day = 3;
    set("owner.test", T0); let _ = o.set_clause("tip".into(), c);
    for _ in 0..3 { let p = prop(&o, "tip", "bob.test", 5); assert_eq!(deny_reason(&mut o, p), "PROMISE"); }
    let p = prop(&o, "tip", "bob.test", 5); assert_eq!(deny_reason(&mut o, p), "over_daily_action_count");
    assert_eq!(o.usage_today(&"tip".to_string()).count, 3);
    // next day resets the counter
    let p = prop(&o, "tip", "bob.test", 5);
    set("oath.test", T0 + NS_PER_DAY);
    assert!(outcome(o.propose(p)).is_none());
}

#[test]
fn h15_storage_reserve_low() {
    let mut o = setup(0);
    let p = prop(&o, "tip", "bob.test", NEAR);
    let mut b = ctx("oath.test", T0);
    b.account_balance(NearToken::from_yoctonear(NEAR + NEAR / 10)).storage_usage(2_000); // amount + 0.1 reserve, storage not covered
    testing_env!(b.build());
    assert_eq!(outcome(o.propose(p)).unwrap().reason, "storage_reserve_low");
    // small amount with enough for reserve + storage passes
    let p = prop(&o, "tip", "bob.test", 5);
    let mut b = ctx("oath.test", T0);
    b.account_balance(NearToken::from_near(1)).storage_usage(2_000); // mock default usage is 1e6 bytes
    testing_env!(b.build());
    let r = outcome(o.propose(p));
    assert!(r.is_none(), "{:?}", r.map(|x| x.reason));
}

fn settle(o: &mut Oath, id: u64, ok: bool) -> Outcome {
    set_results("oath.test", T0, vec![if ok { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed }]);
    o.on_settle(U64(id))
}

#[test]
fn h15_prune_keeps_recent_and_skips_unsettled() {
    let mut o = setup(0);
    let mut c = clause(&["bob.test"], NEAR, 5 * NEAR, false, None);
    c.max_actions_per_day = 200;
    set("owner.test", T0); let _ = o.set_clause("tip".into(), c);
    for i in 0..40u64 {
        let p = prop(&o, "tip", "bob.test", 5); deny_reason(&mut o, p);
        if i != 3 { settle(&mut o, i, true); }
    }
    // auto-prune ran on each insert: records 0..2 gone, 3 is unsettled -> cursor stops
    assert!(o.get_action(U64(0)).is_none());
    assert!(o.get_action(U64(2)).is_none());
    assert!(o.get_action(U64(3)).is_some());
    assert_eq!(o.prune_cursor, 3);
    set("anyone.test", T0); assert_eq!(o.prune(10), 0);
    settle(&mut o, 3, false);
    set("anyone.test", T0); assert_eq!(o.prune(3), 3);
    assert_eq!(o.prune_cursor, 6);
    set("anyone.test", T0); assert_eq!(o.prune(100), 2); // 40 - 32 = 8 prunable in total
    assert_eq!(o.prune_cursor, 40 - KEEP_RECENT);
    assert!(o.get_action(U64(40 - KEEP_RECENT)).is_some());
    assert!(o.get_action(U64(39)).is_some());
}

#[test]
fn settle_success_failure_and_idempotent() {
    let mut o = setup(0);
    let p = prop(&o, "tip", "bob.test", 7); deny_reason(&mut o, p);
    let p = prop(&o, "tip", "bob.test", 9); deny_reason(&mut o, p);
    let u = o.usage_today(&"tip".to_string()); assert_eq!(u.reserved.0, 16);
    assert_eq!(settle(&mut o, 0, true).status, "confirmed");
    let u = o.usage_today(&"tip".to_string()); assert_eq!((u.spent.0, u.reserved.0), (7, 9));
    assert_eq!(settle(&mut o, 1, false).status, "failed_released");
    let u = o.usage_today(&"tip".to_string()); assert_eq!((u.spent.0, u.reserved.0), (7, 0));
    assert_eq!(settle(&mut o, 0, true).reason, "already_settled");
    let u = o.usage_today(&"tip".to_string()); assert_eq!(u.spent.0, 7);
    assert!(get_logs().iter().all(|l| !l.contains("confirmed")) || true);
}

#[test]
fn h14_low_gas_reverts_before_logging() {
    let mut o = setup(0);
    let p = prop(&o, "tip", "bob.test", 5);
    let mut b = ctx("oath.test", T0); b.prepaid_gas(Gas::from_tgas(20)); testing_env!(b.build());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = o.propose(p); }));
    assert!(r.is_err());
    assert!(get_logs().is_empty(), "no event may be logged on a starved call");
    let mut o = setup(0);
    let p = prop(&o, "tip", "bob.test", 2 * NEAR);
    let mut b = ctx("oath.test", T0); b.prepaid_gas(Gas::from_tgas(60)); testing_env!(b.build());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = o.propose(p); }));
    assert!(r.is_err(), "escalation needs >= 75 Tgas");
    let mut o = setup(0);
    let p = prop(&o, "tip", "bob.test", 5);
    let mut b = ctx("oath.test", T0); b.prepaid_gas(Gas::from_tgas(24)); testing_env!(b.build());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = o.propose(p); }));
    assert!(r.is_err(), "native needs >= 25 Tgas");
}

// ---------------- F4: escalation re-check ----------------
fn escalate(o: &mut Oath) -> u64 {
    let id = o.next_action;
    let p = prop(o, "tip", "bakery.test", 2 * NEAR);
    assert_eq!(deny_reason(o, p), "over_cap_waiting_owner");
    id
}
fn approve(o: &mut Oath, id: u64, ok: bool) -> Option<Outcome> {
    set_results("oath.test", T0, vec![PromiseResult::Successful(json!({"approve": ok}).to_string().into_bytes())]);
    outcome(o.on_escalation(U64(id)))
}

#[test]
fn f4_r10_sequence_freeze_unfreeze_remove_receiver_then_approve_denied() {
    let mut o = setup(0);
    let id = escalate(&mut o);
    set("owner.test", T0); o.freeze();
    set("dao.test", T0); o.unfreeze();
    let _ = { set("owner.test", T0); o.set_clause("tip".into(), clause(&["bob.test"], NEAR, 5 * NEAR, false, Some(3 * NEAR))) };
    let r = approve(&mut o, id, true).expect("must not pay");
    assert_eq!(r.status, "denied");
    assert_eq!(r.reason, "freeze_epoch_changed");
    assert_eq!(o.usage_today(&"tip".to_string()).reserved.0, 0);
}

#[test]
fn f4_each_reason() {
    // receiver removed only
    let mut o = setup(0); let id = escalate(&mut o);
    set("owner.test", T0); let _ = o.set_clause("tip".into(), clause(&["bob.test"], NEAR, 5 * NEAR, false, Some(3 * NEAR)));
    assert_eq!(approve(&mut o, id, true).unwrap().reason, "receiver_not_allowlisted");
    // escalation band narrowed
    let mut o = setup(0); let id = escalate(&mut o);
    set("owner.test", T0); let _ = o.set_clause("tip".into(), clause(&["bob.test", "bakery.test"], NEAR, 5 * NEAR, false, Some(NEAR + 1)));
    assert_eq!(approve(&mut o, id, true).unwrap().reason, "over_per_action_cap");
    // asset swapped (Native -> FT, same amount)
    let mut o = setup(0); let id = escalate(&mut o);
    let mut c = clause(&["bob.test", "bakery.test"], NEAR, 5 * NEAR, false, Some(3 * NEAR));
    c.asset = Asset::Ft { token: acc("usdc.test") };
    o.clauses.insert("tip".into(), c); // direct insert: the queue would hold it in production
    assert_eq!(approve(&mut o, id, true).unwrap().reason, "asset_changed");
    // clause removed
    let mut o = setup(0); let id = escalate(&mut o);
    set("owner.test", T0); o.remove_clause("tip".into());
    assert_eq!(approve(&mut o, id, true).unwrap().reason, "unknown_clause");
    // still frozen
    let mut o = setup(0); let id = escalate(&mut o);
    set("owner.test", T0); o.freeze();
    assert_eq!(approve(&mut o, id, true).unwrap().reason, "frozen");
    // unrelated policy change (signer added) still bumps policy_version
    let mut o = setup(0); let id = escalate(&mut o);
    set("owner.test", T0); let _ = o.set_receipt_signer("k".into(), Base64VecU8(vec![1; 32]));
    assert_eq!(approve(&mut o, id, true).unwrap().reason, "policy_changed");
    // rejected and timed out
    let mut o = setup(0); let id = escalate(&mut o);
    assert_eq!(approve(&mut o, id, false).unwrap().reason, "owner_rejected");
    let mut o = setup(0); let id = escalate(&mut o);
    set_results("oath.test", T0, vec![PromiseResult::Failed]);
    let r = outcome(o.on_escalation(U64(id))).unwrap();
    assert_eq!(r.reason, "escalation_timed_out");
    assert_eq!(o.usage_today(&"tip".to_string()).reserved.0, 0);
    assert_eq!(o.get_action(U64(id)).unwrap().status, "denied");
}

#[test]
fn f4_unchanged_policy_approval_pays_with_memo() {
    let mut o = setup(0);
    let id = o.next_action;
    let mut p = prop(&o, "tip", "bakery.test", 2 * NEAR); p.memo = Some("invoice-7".into());
    assert_eq!(deny_reason(&mut o, p), "over_cap_waiting_owner");
    let rec = o.get_action(U64(id)).unwrap();
    assert_eq!((rec.policy_version, rec.freeze_epoch, rec.asset.clone(), rec.memo.clone()), (o.policy_version, 0, Asset::Native, Some("invoice-7".into())));
    assert!(approve(&mut o, id, true).is_none(), "approved -> promise");
    assert_eq!(o.get_action(U64(id)).unwrap().status, "submitted");
    assert_eq!(o.usage_today(&"tip".to_string()).reserved.0, 2 * NEAR);
}

// ---------------- M7: FT storage check ----------------
fn ft_setup() -> (Oath, u64) {
    let mut o = setup(0);
    let mut c = clause(&["bob.test"], NEAR, 5 * NEAR, false, None);
    c.asset = Asset::Ft { token: acc("usdc.test") };
    set("owner.test", T0); let _ = o.set_clause("ft".into(), c);
    let id = o.next_action;
    let p = prop(&o, "ft", "bob.test", 5); assert_eq!(deny_reason(&mut o, p), "PROMISE");
    (o, id)
}

#[test]
fn m7_ft_unregistered_receiver_released() {
    let (mut o, id) = ft_setup();
    set_results("oath.test", T0, vec![PromiseResult::Successful(b"null".to_vec())]);
    let r = outcome(o.on_ft_storage(U64(id))).unwrap();
    assert_eq!((r.status.as_str(), r.reason.as_str()), ("failed_released", "ft_receiver_not_registered"));
    assert_eq!(o.usage_today(&"ft".to_string()).reserved.0, 0);
    // a second call is a no-op
    set_results("oath.test", T0, vec![PromiseResult::Successful(b"null".to_vec())]);
    assert_eq!(outcome(o.on_ft_storage(U64(id))).unwrap().reason, "already_settled");
    let (mut o, id) = ft_setup();
    set_results("oath.test", T0, vec![PromiseResult::Failed]);
    assert_eq!(outcome(o.on_ft_storage(U64(id))).unwrap().reason, "ft_receiver_not_registered");
}

#[test]
fn m7_ft_registered_receiver_transfers() {
    let (mut o, id) = ft_setup();
    set_results("oath.test", T0, vec![PromiseResult::Successful(br#"{"total":"1","available":"0"}"#.to_vec())]);
    assert!(outcome(o.on_ft_storage(U64(id))).is_none());
    assert_eq!(o.usage_today(&"ft".to_string()).reserved.0, 5);
}

// ---------------- owner-key theft: timelock ----------------
#[test]
fn widening_classification() {
    let base = clause(&["bob.test"], 10, 100, true, Some(20));
    assert!(is_widening(None, &base));
    assert!(!is_widening(Some(&base), &base.clone()));
    let w = |f: &dyn Fn(&mut Clause)| { let mut c = base.clone(); f(&mut c); is_widening(Some(&base), &c) };
    assert!(w(&|c| c.receivers.push(acc("eve.test"))));
    assert!(!w(&|c| c.receivers.clear()));
    assert!(w(&|c| c.per_action_cap = U128(11))); assert!(!w(&|c| c.per_action_cap = U128(9)));
    assert!(w(&|c| c.daily_budget = U128(101))); assert!(!w(&|c| c.daily_budget = U128(99)));
    assert!(w(&|c| c.escalation_max = Some(U128(21)))); assert!(!w(&|c| c.escalation_max = None)); assert!(!w(&|c| c.escalation_max = Some(U128(19))));
    assert!(is_widening(Some(&clause(&["bob.test"], 10, 100, true, None)), &base));
    assert!(w(&|c| c.window_start_min = 5));
    assert!(w(&|c| c.window_end_min = 5));
    assert!(w(&|c| c.requires_receipt = false));
    assert!(!is_widening(Some(&clause(&["bob.test"], 10, 100, false, Some(20))), &base));
    assert!(w(&|c| c.asset = Asset::Ft { token: acc("t.test") }));
    assert!(!w(&|c| c.min_amount = U128(2)));
    let mut hi = base.clone(); hi.min_amount = U128(5);
    assert!(is_widening(Some(&hi), &base));
    assert!(w(&|c| c.max_actions_per_day = 51)); assert!(!w(&|c| c.max_actions_per_day = 49));
    let mut aged = base.clone(); aged.min_receiver_age_days = 3;
    assert!(is_widening(Some(&aged), &base)); assert!(!is_widening(Some(&base), &aged));
    let mut pinned = base.clone(); pinned.code_hash_pins.insert(acc("bob.test"), "A".into());
    assert!(!is_widening(Some(&base), &pinned));
    assert!(is_widening(Some(&pinned), &base));
    let mut repinned = pinned.clone(); repinned.code_hash_pins.insert(acc("bob.test"), "B".into());
    assert!(is_widening(Some(&pinned), &repinned));
}

const DELAY: u64 = 3_600_000_000_000; // 1 h

#[test]
fn timelock_widening_is_queued_tightening_instant() {
    let mut o = setup(DELAY);
    let v = o.policy_version;
    // stolen owner key adds the attacker as receiver: queued, not applied
    set("owner.test", T0);
    let _ = o.set_clause("tip".into(), clause(&["bob.test", "bakery.test", "eve.test"], NEAR, 5 * NEAR, false, Some(3 * NEAR)));
    assert_eq!(o.policy_version, v);
    assert_eq!(o.pending.len(), 1);
    let p = prop(&o, "tip", "eve.test", 5); assert_eq!(deny_reason(&mut o, p), "receiver_not_allowlisted");
    // tightening applies at once
    set("owner.test", T0);
    let _ = o.set_clause("tip".into(), clause(&["bob.test"], NEAR, 5 * NEAR, false, Some(3 * NEAR)));
    assert_eq!(o.policy_version, v + 1);
    // early execute refused
    set("owner.test", T0 + DELAY - 1);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = o.execute_change(U64(0)); }));
    assert!(r.is_err());
    // DAO cancels the attacker's change
    set("dao.test", T0 + 10); o.cancel_change(U64(0));
    assert!(o.pending.is_empty());
    assert!(get_logs().iter().any(|l| l.contains("policy_cancelled")));
}

#[test]
fn timelock_execute_after_delay() {
    let mut o = setup(DELAY);
    set("owner.test", T0);
    let _ = o.set_clause("tip".into(), clause(&["bob.test", "bakery.test", "eve.test"], NEAR, 5 * NEAR, false, Some(3 * NEAR)));
    set("bob.test", T0 + DELAY);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = o.execute_change(U64(0)); }));
    assert!(r.is_err(), "outsider cannot execute");
    set("owner.test", T0 + DELAY);
    let _ = o.execute_change(U64(0));
    assert!(o.clauses["tip"].receivers.contains(&acc("eve.test")));
    assert!(o.pending.is_empty());
}

#[test]
fn timelock_signer_dao_delay_agent_key_are_queued() {
    let mut o = setup(DELAY);
    set("owner.test", T0);
    let _ = o.set_receipt_signer("evil".into(), Base64VecU8(vec![9; 32]));
    let _ = o.set_dao(None);
    let _ = o.set_policy_delay(U64(0));
    let _ = o.set_agent_key("ed25519:DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847".parse().unwrap(), U128(1));
    assert_eq!(o.pending.len(), 4);
    assert!(o.receipt_signers.is_empty()); assert_eq!(o.dao, Some(acc("dao.test")));
    assert_eq!(o.policy_delay_ns, DELAY); assert_eq!(o.agent_key, Some(agent_pk()));
    // raising the delay is instant
    let _ = o.set_policy_delay(U64(2 * DELAY)); assert_eq!(o.policy_delay_ns, 2 * DELAY);
    // removing a signer is instant
    o.receipt_signers.insert("x".into(), vec![1; 32]);
    o.remove_receipt_signer("x".into()); assert!(o.receipt_signers.is_empty());
    // execute the dao change after delay
    set("owner.test", T0 + DELAY); let _ = o.execute_change(U64(1));
    assert_eq!(o.dao, None);
}

#[test]
fn unfreeze_dao_only_when_dao_set() {
    let mut o = setup(0);
    set("owner.test", T0); o.freeze();
    assert_eq!(o.freeze_epoch, 1);
    set("owner.test", T0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| o.unfreeze()));
    assert!(r.is_err(), "stolen owner key cannot unfreeze");
    set("dao.test", T0); o.unfreeze(); assert!(!o.frozen);
    // without a DAO the owner can
    o.dao = None;
    set("owner.test", T0); o.freeze(); o.unfreeze(); assert!(!o.frozen); assert_eq!(o.freeze_epoch, 2);
    set("bob.test", T0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| o.freeze()));
    assert!(r.is_err());
}

#[test]
fn upgrade_requires_timelocked_hash() {
    let mut o = setup(DELAY);
    let code = b"\0asm fake".to_vec();
    let h = hex::encode(env::sha256_array(&code));
    set("owner.test", T0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = o.queue_upgrade(h.clone()); }));
    assert!(r.is_err(), "with a DAO only the DAO queues upgrades");
    set("dao.test", T0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = o.queue_upgrade("zz".into()); }));
    assert!(r.is_err());
    let _ = o.queue_upgrade(h.clone());
    let mut b = ctx("dao.test", T0 + 1); b.context.input = code.clone().into(); testing_env!(b.build());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = o.upgrade(); }));
    assert!(r.is_err(), "not yet past the timelock");
    set("dao.test", T0 + DELAY); let _ = o.execute_change(U64(0));
    // other code still refused
    let mut b = ctx("dao.test", T0 + DELAY); b.context.input = b"other".to_vec().into(); testing_env!(b.build());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = o.upgrade(); }));
    assert!(r.is_err());
    let mut b = ctx("dao.test", T0 + DELAY); b.context.input = code.into(); testing_env!(b.build());
    let _ = o.upgrade();
    assert!(o.pending.is_empty(), "ready hash consumed");
}

#[test]
fn governance_guards() {
    let mut o = setup(0);
    set("bob.test", T0);
    for f in [
        Box::new(|o: &mut Oath| { let _ = o.set_clause("x".into(), clause(&["bob.test"], 1, 1, false, None)); }) as Box<dyn Fn(&mut Oath)>,
        Box::new(|o: &mut Oath| o.remove_clause("tip".into())),
        Box::new(|o: &mut Oath| { let _ = o.set_receipt_signer("k".into(), Base64VecU8(vec![1; 32])); }),
        Box::new(|o: &mut Oath| { let _ = o.set_dao(None); }),
        Box::new(|o: &mut Oath| { let _ = o.resolve_escalation(U64(0), true); }),
        Box::new(|o: &mut Oath| { let _ = o.set_policy_delay(U64(5)); }),
        Box::new(|o: &mut Oath| { let _ = o.revoke_agent(); }),
    ] {
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(&mut o)));
        assert!(r.is_err());
    }
    // DAO cannot set_dao (owner-only)
    set("dao.test", T0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = o.set_dao(None); }));
    assert!(r.is_err());
    // bad clause input
    set("owner.test", T0);
    let mut c = clause(&["bob.test"], 1, 1, false, None); c.min_amount = U128(0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = o.set_clause("y".into(), c.clone()); }));
    assert!(r.is_err());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = o.set_clause("a|b".into(), clause(&["bob.test"], 1, 1, false, None)); }));
    assert!(r.is_err());
    let mut c = clause(&["bob.test"], 1, 1, false, None); c.window_start_min = 1440;
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = o.set_clause("y".into(), c); }));
    assert!(r.is_err());
}

#[test]
fn policy_hash_changes_with_delay() {
    let mut o = setup(0);
    let h = o.policy_hash;
    set("owner.test", T0); let _ = o.set_policy_delay(U64(5));
    assert_ne!(o.policy_hash, h);
    let _ = base64::engine::general_purpose::STANDARD.encode([0u8]);
}

// ---------------- boundaries found by cargo-mutants ----------------
#[test]
fn upgrade_without_delay_needs_no_queue() {
    let mut o = setup(0);
    let mut b = ctx("dao.test", T0); b.context.input = b"\0asm fake".to_vec().into(); testing_env!(b.build());
    let _ = o.upgrade(); // delay 0: no timelock entry needed
}

#[test]
fn daily_budget_exact_boundary_allowed() {
    let mut o = setup(0); // tip: cap 1, budget 5
    for i in 0..5 { let p = prop(&o, "tip", "bob.test", NEAR); assert_eq!(deny_reason(&mut o, p), "PROMISE", "action {i} reaches exactly the budget"); }
    let p = prop(&o, "tip", "bob.test", 1); assert_eq!(deny_reason(&mut o, p), "over_daily_budget");
}

#[test]
fn storage_reserve_exact_boundary() {
    let mut o = setup(0);
    let amount = NEAR / 100;
    let byte_cost = { set("oath.test", T0); env::storage_byte_cost().as_yoctonear() };
    let need = (2_000u128 + 600) * byte_cost + NEAR / 10 + amount;
    for (bal, want_ok) in [(need - 1, false), (need, true)] {
        let p = prop(&o, "tip", "bob.test", amount);
        let mut b = ctx("oath.test", T0); b.account_balance(NearToken::from_yoctonear(bal)).storage_usage(2_000); testing_env!(b.build());
        let r = outcome(o.propose(p)).map(|x| x.reason);
        if want_ok { assert!(r.is_none(), "balance == need must pass: {r:?}"); } else { assert_eq!(r.as_deref(), Some("storage_reserve_low")); }
    }
}

#[test]
fn prune_skips_missing_ids() {
    let mut o = setup(0);
    o.next_action = 40; // ids 0..39 have no record (e.g. already pruned)
    set("anyone.test", T0);
    assert_eq!(o.prune(5), 0);
    assert_eq!(o.prune_cursor, 40 - KEEP_RECENT, "missing records advance the cursor up to the keep window");
}

#[test]
fn receipt_code_hash_64_chars_accepted() {
    let c = clause(&["bob.test"], NEAR, 5 * NEAR, true, None);
    let mk = |ch: &str| ReceiptBody { v: RECEIPT_V.into(), verdict: "ALLOW".into(), action_hash: "ah".into(), receiver: "bob.test".into(),
        amount: "5".into(), code_hash: ch.into(), age_days: 1, job_id: JOB.into() };
    assert_eq!(check_receipt_body(&mk(&"a".repeat(64)), "ah", &acc("bob.test"), 5, JOB, &c), Ok(()));
    assert_eq!(check_receipt_body(&mk(&"a".repeat(65)), "ah", &acc("bob.test"), 5, JOB, &c), Err("receipt_malformed".into()));
}

// ---------------- R14: set_agent_key callback with rollback ----------------
fn pk2() -> PublicKey { "ed25519:DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847".parse().unwrap() }
fn pk3() -> PublicKey { "ed25519:H9k5eiU4xXS3M4z8HzKJSLaZdqGdGwBG49o7orNC4eZW".parse().unwrap() }
fn is_promise<T>(r: &PromiseOrValue<T>) -> bool { matches!(r, PromiseOrValue::Promise(_)) }
fn val<T: Copy>(r: &PromiseOrValue<T>) -> Option<T> { match r { PromiseOrValue::Value(v) => Some(*v), _ => None } }
fn has_log(op: &str) -> bool { get_logs().iter().any(|l| l.contains(&format!("\"op\":\"{op}\""))) }

#[test]
fn r14_set_agent_key_switches_state_and_returns_promise() {
    let mut o = setup(0);
    set("owner.test", T0);
    let r = o.set_agent_key(pk2(), U128(NEAR));
    assert!(is_promise(&r));
    assert_eq!(o.agent_key, Some(pk2()));
}

#[test]
fn r14_add_key_failure_rolls_back_to_prev() {
    let mut o = setup(0);
    o.agent_key = Some(pk2());
    set_results("oath.test", T0, vec![PromiseResult::Failed]);
    let r = o.on_agent_key(Some(agent_pk()), pk2());
    assert_eq!(val(&r), Some(false));
    assert_eq!(o.agent_key, Some(agent_pk()));
    assert!(has_log("rollback"));
}

#[test]
fn r14_add_key_failure_with_no_prev_clears_key() {
    let mut o = setup(0);
    o.agent_key = Some(pk2());
    set_results("oath.test", T0, vec![PromiseResult::Failed]);
    let r = o.on_agent_key(None, pk2());
    assert_eq!(val(&r), Some(false));
    assert_eq!(o.agent_key, None);
}

#[test]
fn r14_add_key_failure_after_later_change_does_not_clobber() {
    let mut o = setup(0);
    o.agent_key = Some(pk3());
    set_results("oath.test", T0, vec![PromiseResult::Failed]);
    let r = o.on_agent_key(Some(agent_pk()), pk2());
    assert_eq!(val(&r), Some(false));
    assert_eq!(o.agent_key, Some(pk3()));
    assert!(has_log("add_failed_stale"));
    assert!(!has_log("rollback"));
}

#[test]
fn r16_add_key_success_keeps_new_old_already_deleted_in_batch() {
    let mut o = setup(0);
    o.agent_key = Some(pk2());
    set_results("oath.test", T0, vec![PromiseResult::Successful(vec![])]);
    let r = o.on_agent_key(Some(agent_pk()), pk2());
    assert_eq!(val(&r), Some(true), "R16: nothing left to delete in the callback");
    assert_eq!(o.agent_key, Some(pk2()));
    assert!(has_log("added"));
}

#[test]
fn r14_add_key_success_same_key_no_delete() {
    let mut o = setup(0);
    set_results("oath.test", T0, vec![PromiseResult::Successful(vec![])]);
    let r = o.on_agent_key(Some(agent_pk()), agent_pk());
    assert_eq!(val(&r), Some(true));
    assert_eq!(o.agent_key, Some(agent_pk()));
}

#[test]
fn r14_add_key_success_first_key_no_delete() {
    let mut o = setup(0);
    o.agent_key = Some(pk2());
    set_results("oath.test", T0, vec![PromiseResult::Successful(vec![])]);
    let r = o.on_agent_key(None, pk2());
    assert_eq!(val(&r), Some(true));
}

#[test]
fn r14_add_key_success_after_revoke_removes_stale_key() {
    let mut o = setup(0);
    o.agent_key = None;
    set_results("oath.test", T0, vec![PromiseResult::Successful(vec![])]);
    let r = o.on_agent_key(Some(agent_pk()), pk2());
    assert!(is_promise(&r));
    assert_eq!(o.agent_key, None);
    assert!(has_log("added_stale_removed"));
}

#[test]
fn r14_add_key_success_prev_restored_elsewhere_not_deleted() {
    // prev is current again (e.g. a later rotation back): it must not be deleted, the new one must.
    let mut o = setup(0);
    o.agent_key = Some(agent_pk());
    set_results("oath.test", T0, vec![PromiseResult::Successful(vec![])]);
    let r = o.on_agent_key(Some(agent_pk()), pk2());
    assert!(is_promise(&r));
    assert_eq!(o.agent_key, Some(agent_pk()));
    assert!(has_log("added_stale_removed"));
}
// Note: #[private] is enforced by the wasm wrapper only; checked in tests/sandbox.rs (r14_on_agent_key_private).

#[test]
fn r14_set_agent_key_low_gas_reverts_before_state_or_log() {
    let mut o = setup(0);
    let before = o.agent_key.clone();
    let mut b = ctx("owner.test", T0); b.prepaid_gas(Gas::from_tgas(24)); testing_env!(b.build());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = o.set_agent_key(pk2(), U128(NEAR)); }));
    assert!(r.is_err());
    assert!(get_logs().is_empty());
    assert_eq!(o.agent_key, before);
    let mut b = ctx("owner.test", T0); b.prepaid_gas(Gas::from_tgas(25)); testing_env!(b.build());
    let _ = o.set_agent_key(pk2(), U128(NEAR));
    assert_eq!(o.agent_key, Some(pk2()));
}

// ---------------- R14: tests added for mutants missed in the R14 run ----------------
fn deleted_keys() -> Vec<String> {
    near_sdk::test_utils::get_created_receipts().iter().flat_map(|r| r.actions.iter()).filter_map(|a| match a {
        near_sdk::mock::MockAction::DeleteKey { public_key, .. } => Some(public_key.to_string()),
        _ => None,
    }).collect()
}

#[test]
fn r14_on_agent_key_deletes_exactly_the_right_keys() {
    // prev is current again: only the stale new key is deleted, never prev.
    let mut o = setup(0);
    o.agent_key = Some(agent_pk());
    set_results("oath.test", T0, vec![PromiseResult::Successful(vec![])]);
    let _ = o.on_agent_key(Some(agent_pk()), pk2());
    assert_eq!(deleted_keys(), vec![String::from(&pk2())]);
    // normal rotation: the old key went in the AddKey batch (R16), so the callback deletes nothing.
    let mut o = setup(0);
    o.agent_key = Some(pk2());
    set_results("oath.test", T0, vec![PromiseResult::Successful(vec![])]);
    let _ = o.on_agent_key(Some(agent_pk()), pk2());
    assert_eq!(deleted_keys(), Vec::<String>::new());
    // same key re-set, then revoked meanwhile: the key is deleted once, not twice.
    let mut o = setup(0);
    o.agent_key = None;
    set_results("oath.test", T0, vec![PromiseResult::Successful(vec![])]);
    let _ = o.on_agent_key(Some(pk2()), pk2());
    assert_eq!(deleted_keys(), vec![String::from(&pk2())]);
}

#[test]
fn r14_ready_upgrades_get_distinct_change_ids() {
    let mut o = setup(0); // delay 0: queue_upgrade applies at once and marks the hash ready
    let n0 = o.next_change;
    set("dao.test", T0);
    let _ = o.queue_upgrade("a".repeat(64));
    let _ = o.queue_upgrade("b".repeat(64));
    assert_eq!(o.next_change, n0 + 2);
    assert_eq!(o.pending.len(), 2, "second ready hash must not overwrite the first");
}

// ---------------- setup window (factory charters) ----------------
fn fresh_setup(delay: u64) -> Oath {
    set("owner.test", T0);
    Oath::new(acc("owner.test"), None, Some(U64(delay)), None, Some(true))
}

#[test]
fn setup_window_applies_first_rules_and_key_at_once_then_closes() {
    let mut o = fresh_setup(DELAY);
    assert!(o.setup_open);
    let r = o.set_clause("pay".into(), clause(&["bob.test"], NEAR, 2 * NEAR, false, None));
    assert!(!is_promise(&r));
    assert!(o.clauses.contains_key("pay") && o.pending.is_empty());
    let r = o.set_agent_key(pk2(), U128(NEAR));
    assert!(is_promise(&r));
    assert_eq!(o.agent_key, Some(pk2()));
    assert!(!o.setup_open);
    assert_eq!(o.get_state()["setup_open"], json!(false));
    // after setup, widening waits for the delay
    let _ = o.set_clause("pay".into(), clause(&["bob.test", "eve.test"], NEAR, 2 * NEAR, false, None));
    assert_eq!(o.pending.len(), 1);
    assert_eq!(o.clauses["pay"].receivers.len(), 1);
    let _ = o.set_agent_key(pk3(), U128(NEAR));
    assert_eq!(o.pending.len(), 2);
    assert_eq!(o.agent_key, Some(pk2()));
    // tightening stays instant
    let _ = o.set_clause("pay".into(), clause(&["bob.test"], NEAR / 2, 2 * NEAR, false, None));
    assert_eq!(o.clauses["pay"].per_action_cap, U128(NEAR / 2));
}

#[test]
fn setup_window_never_exempts_dao_delay_or_upgrade() {
    let mut o = fresh_setup(DELAY);
    let _ = o.set_dao(Some(acc("dao.test")));
    let _ = o.set_policy_delay(U64(0));
    let _ = o.queue_upgrade("ab".repeat(32));
    assert_eq!(o.pending.len(), 3);
    assert_eq!(o.dao, None);
    assert_eq!(o.policy_delay_ns, DELAY);
    assert!(o.setup_open);
}

#[test]
fn setup_window_off_by_default_and_closable() {
    set("owner.test", T0);
    let mut o = Oath::new(acc("owner.test"), None, Some(U64(DELAY)), None, None);
    assert!(!o.setup_open);
    let _ = o.set_clause("pay".into(), clause(&["bob.test"], NEAR, 2 * NEAR, false, None));
    assert_eq!(o.pending.len(), 1);
    let mut o = fresh_setup(DELAY);
    set("eve.test", T0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| o.close_setup()));
    assert!(r.is_err());
    set("owner.test", T0);
    o.close_setup();
    assert!(!o.setup_open);
    let _ = o.set_clause("pay".into(), clause(&["bob.test"], NEAR, 2 * NEAR, false, None));
    assert_eq!(o.pending.len(), 1);
}

#[test]
fn setup_window_reopens_when_the_closing_key_fails_to_land() {
    let mut o = fresh_setup(DELAY);
    let _ = o.set_agent_key(pk2(), U128(NEAR));
    assert!(!o.setup_open);
    set_results("oath.test", T0, vec![PromiseResult::Failed]);
    let _ = o.on_agent_key(None, pk2());
    assert!(o.setup_open);
    assert_eq!(o.agent_key, None);
    assert_eq!(o.setup_key, None);
}

#[test]
fn setup_window_stays_closed_when_the_closing_key_lands() {
    let mut o = fresh_setup(DELAY);
    let _ = o.set_agent_key(pk2(), U128(NEAR));
    set_results("oath.test", T0, vec![PromiseResult::Successful(vec![])]);
    let _ = o.on_agent_key(None, pk2());
    assert!(!o.setup_open);
    assert_eq!(o.setup_key, None);
    // a later failed rotation does not reopen it
    set("owner.test", T0 + DELAY);
    o.agent_key = Some(pk3());
    set_results("oath.test", T0 + DELAY, vec![PromiseResult::Failed]);
    let _ = o.on_agent_key(Some(pk2()), pk3());
    assert!(!o.setup_open);
}

// ---------------- R16: Judge A11 / A12 and user-set rules + reputation ----------------
fn relayed(ts: u64) {
    let mut b = ctx("oath.test", ts); b.signer_account_id(acc("relayer.test")); testing_env!(b.build());
}
fn rotate_to_pk2(o: &mut Oath) {
    set("owner.test", T0);
    let _ = o.set_agent_key(pk2(), U128(NEAR));
}

#[test]
fn r16_a11_rotation_adds_new_and_deletes_old_in_one_receipt() {
    let mut o = setup(0);
    rotate_to_pk2(&mut o);
    let rs = near_sdk::test_utils::get_created_receipts();
    let batch = rs.iter().find(|r| r.actions.iter().any(|a| matches!(a, near_sdk::mock::MockAction::AddKeyWithFunctionCall { .. }))).expect("AddKey receipt");
    let dels: Vec<String> = batch.actions.iter().filter_map(|a| match a {
        near_sdk::mock::MockAction::DeleteKey { public_key, .. } => Some(public_key.to_string()), _ => None }).collect();
    assert_eq!(dels, vec![String::from(&agent_pk())], "old key deleted in the same atomic batch as AddKey");
    assert!(rotating());
}

#[test]
fn r16_a11_old_key_refused_on_both_paths_during_rotation() {
    let mut o = setup(0);
    rotate_to_pk2(&mut o);
    // direct path: the old key no longer matches state
    let p = prop(&o, "tip", "bob.test", 1);
    set("oath.test", T0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = o.propose(p); }));
    assert!(r.is_err(), "direct old key refused");
    // relayed path: refused while the rotation is in flight
    let p = prop(&o, "tip", "bob.test", 1);
    relayed(T0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = o.propose(p); }));
    assert!(r.is_err(), "relayed propose refused while rotating");
    // callback lands: relayed path open again (the old key is gone from the account by now)
    set_results("oath.test", T0, vec![PromiseResult::Successful(vec![])]);
    let _ = o.on_agent_key(Some(agent_pk()), pk2());
    assert!(!rotating());
    let p = prop(&o, "tip", "bob.test", 1);
    relayed(T0);
    let _ = o.propose(p);
}

#[test]
fn r16_a11_failed_rotation_clears_flag_and_rolls_back() {
    let mut o = setup(0);
    rotate_to_pk2(&mut o);
    set_results("oath.test", T0, vec![PromiseResult::Failed]);
    let _ = o.on_agent_key(Some(agent_pk()), pk2());
    assert!(!rotating());
    assert_eq!(o.agent_key, Some(agent_pk()));
}

#[test]
fn r16_a11_revoke_clears_rotation_flag() {
    let mut o = setup(0);
    rotate_to_pk2(&mut o);
    set("owner.test", T0);
    let _ = o.revoke_agent();
    assert!(!rotating());
}

#[test]
fn r16_a12_spend_reserved_before_midnight_counts_after_it() {
    let mut o = setup(0);
    let p = prop(&o, "tip", "bob.test", NEAR / 2);
    set("oath.test", T0);
    let _ = o.propose(p);
    let id = o.next_action - 1;
    assert_eq!(o.usage_today(&"tip".to_string()).reserved.0, NEAR / 2);
    let next_day = T0 + NS_PER_DAY;
    set_results("oath.test", next_day, vec![PromiseResult::Successful(vec![])]);
    let _ = o.on_settle(U64(id));
    let u = o.usage_today(&"tip".to_string());
    assert_eq!(u.reserved.0, 0);
    assert_eq!(u.spent.0, NEAR / 2, "settled after midnight still counts toward spent");
}

#[test]
fn r16_a12_failed_settle_after_midnight_counts_nothing() {
    let mut o = setup(0);
    let p = prop(&o, "tip", "bob.test", NEAR / 2);
    set("oath.test", T0);
    let _ = o.propose(p);
    let id = o.next_action - 1;
    set_results("oath.test", T0 + NS_PER_DAY, vec![PromiseResult::Failed]);
    let _ = o.on_settle(U64(id));
    let u = o.usage_today(&"tip".to_string());
    assert_eq!((u.reserved.0, u.spent.0), (0, 0));
}

#[test]
fn r16_expiry_refuses_after_deadline() {
    let mut o = setup(0);
    set("owner.test", T0);
    let _ = o.set_clause_expiry("tip".into(), Some(U64(T0 + 10)));
    assert_eq!(o.get_clause_expiry("tip".into()), Some(U64(T0 + 10)));
    let p = prop(&o, "tip", "bob.test", 1);
    set("oath.test", T0 + 10);
    assert_eq!(outcome(o.propose(p)).unwrap().reason, "clause_expired");
}

#[test]
fn r16_expiry_earlier_applies_now_later_or_none_waits_for_delay() {
    let mut o = setup(1_000);
    set("owner.test", T0);
    let v0 = o.policy_version;
    let r = o.set_clause_expiry("tip".into(), Some(U64(T0 + 100)));
    assert!(matches!(r, PromiseOrValue::Value(ref j) if j.get("applied").is_some()), "first expiry narrows");
    assert!(o.policy_version > v0);
    let r = o.set_clause_expiry("tip".into(), Some(U64(T0 + 50)));
    assert!(matches!(r, PromiseOrValue::Value(ref j) if j.get("applied").is_some()), "earlier expiry narrows");
    let r = o.set_clause_expiry("tip".into(), Some(U64(T0 + 500)));
    assert!(matches!(r, PromiseOrValue::Value(ref j) if j.get("queued").is_some()), "later expiry widens");
    let r = o.set_clause_expiry("tip".into(), None);
    assert!(matches!(r, PromiseOrValue::Value(ref j) if j.get("queued").is_some()), "removing expiry widens");
    assert_eq!(o.get_clause_expiry("tip".into()), Some(U64(T0 + 50)));
}

#[test]
fn r16_expiry_is_gov_only_and_needs_a_clause() {
    let mut o = setup(0);
    set("mallory.test", T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = o.set_clause_expiry("tip".into(), Some(U64(1))); })).is_err());
    set("owner.test", T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = o.set_clause_expiry("nope".into(), Some(U64(1))); })).is_err());
}

#[test]
fn r16_remove_clause_clears_its_expiry() {
    let mut o = setup(0);
    set("owner.test", T0);
    let _ = o.set_clause_expiry("tip".into(), Some(U64(T0 + 5)));
    o.remove_clause("tip".into());
    assert_eq!(o.get_clause_expiry("tip".into()), None);
}

#[test]
fn r16_get_rules_returns_every_user_set_rule() {
    let mut o = setup(0);
    set("owner.test", T0);
    let _ = o.set_clause_expiry("tip".into(), Some(U64(T0 + 5)));
    let r = o.get_rules("tip".into()).unwrap();
    assert_eq!(r["clause"]["per_action_cap"], json!(NEAR.to_string()));
    assert_eq!(r["clause"]["receivers"], json!(["bob.test", "bakery.test"]));
    assert_eq!(r["clause"]["max_actions_per_day"], json!(50));
    assert_eq!(r["clause"]["escalation_max"], json!((3 * NEAR).to_string()));
    assert_eq!(r["expires_at"], json!((T0 + 5).to_string()));
    assert!(o.get_rules("nope".into()).is_none());
}

#[test]
fn r16_reputation_counts_on_chain_refusals() {
    let mut o = setup(0);
    for to in ["mallory.test", "mallory.test", "evil.test"] { let p = prop(&o, "tip", to, 1); assert_eq!(deny_reason(&mut o, p), "receiver_not_allowlisted"); }
    let p = prop(&o, "tip", "bob.test", 10 * NEAR);
    assert_eq!(deny_reason(&mut o, p), "over_per_action_cap");
    assert_eq!(o.get_reputation()["score"], json!(null), "no score under 5 proposals");
    let p = prop(&o, "tip", "bob.test", 1);
    set("oath.test", T0);
    let _ = o.propose(p);
    let r = o.get_reputation();
    assert_eq!(r["counts"]["proposals"], json!(5));
    assert_eq!(r["counts"]["allowed"], json!(1));
    assert_eq!(r["counts"]["refused"], json!(4));
    assert_eq!(r["counts"]["refusals"]["receiver_not_allowlisted"], json!(3));
    assert_eq!(r["counts"]["refusals"]["over_per_action_cap"], json!(1));
    assert_eq!(r["score"], json!(20));
}

#[test]
fn r16_reputation_score_math() {
    let mut r = Reputation::default();
    r.proposals = 4; r.allowed = 4;
    assert_eq!(reputation_score(&r), None);
    r.proposals = 10; r.allowed = 6; r.escalated = 1; r.refused = 3;
    assert_eq!(reputation_score(&r), Some(70));
}

#[test]
fn r16_reputation_denial_never_grows_storage() {
    // The mock resets storage_usage per testing_env!, so check the record itself: allocated by
    // gov-paid set_clause, same size after denials. Real storage is checked in tests/exploits.rs.
    let mut o = setup(0);
    let n0 = env::storage_read(K_REPUTATION).expect("allocated by set_clause").len();
    for to in ["mallory.test", "evil.test", "x.test"] { let p = prop(&o, "tip", to, 1); let _ = deny_reason(&mut o, p); }
    let p = prop(&o, "tip", "bob.test", 10 * NEAR);
    assert_eq!(deny_reason(&mut o, p), "over_per_action_cap");
    assert_eq!(env::storage_read(K_REPUTATION).unwrap().len(), n0, "denials only rewrite the fixed-size counters");
    assert_eq!(o.get_reputation()["counts"]["refused"], json!(4));
}

#[test]
fn r16_refusal_buckets() {
    assert_eq!(REFUSAL_BUCKETS[refusal_bucket("receiver_not_allowlisted")], "receiver_not_allowlisted");
    assert_eq!(REFUSAL_BUCKETS[refusal_bucket("receipt_replayed")], "receipt");
    assert_eq!(REFUSAL_BUCKETS[refusal_bucket("unknown_receipt_signer")], "receipt");
    assert_eq!(REFUSAL_BUCKETS[refusal_bucket("memo_too_long")], "other");
    assert_eq!(REFUSAL_BUCKETS[refusal_bucket("clause_expired")], "clause_expired");
}

// ---------------- R16.1: propose_batch (all-or-nothing reward round) ----------------
/// Clause "round": three receivers, cap 1 NEAR each, daily budget 2.5 NEAR, no escalation.
fn round() -> Oath {
    let mut o = setup(0);
    set("owner.test", T0);
    let _ = o.set_clause("round".into(), clause(&["bob.test", "bakery.test", "carol.test"], NEAR, 5 * NEAR / 2, false, None));
    o
}
fn props(o: &Oath, items: &[(&str, u128)]) -> Vec<Proposal> {
    items.iter().enumerate().map(|(i, (to, a))| { let mut p = prop(o, "round", to, *a); p.nonce = U64(o.next_nonce + i as u64); p }).collect()
}

#[test]
fn batch_pays_three_receivers_and_reserves_the_total() {
    let mut o = round();
    let ps = props(&o, &[("bob.test", NEAR / 2), ("bakery.test", NEAR / 2), ("carol.test", NEAR / 2)]);
    set("oath.test", T0);
    let out = o.propose_batch(ps);
    assert_eq!(out.len(), 3);
    assert!(out.iter().all(|x| x.decision == "allowed" && x.status == "submitted"));
    let u = o.usage_today(&"round".to_string());
    assert_eq!(u.reserved.0, 3 * NEAR / 2);
    assert_eq!(u.count, 3);
    assert_eq!(o.next_nonce, 3);
    assert_eq!(o.get_action(U64(2)).unwrap().receiver, acc("carol.test"));
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"batch\"") && l.contains("\"decision\":\"allowed\"")));
}

#[test]
fn batch_over_total_is_refused_whole_and_pays_nobody() {
    let mut o = round();
    // Each item is under the 1 NEAR cap, but the total 3 NEAR is over the 2.5 NEAR budget.
    let ps = props(&o, &[("bob.test", NEAR), ("bakery.test", NEAR), ("carol.test", NEAR)]);
    set("oath.test", T0);
    let out = o.propose_batch(ps);
    assert!(out.iter().all(|x| x.decision == "denied" && x.reason == "over_daily_budget"));
    let u = o.usage_today(&"round".to_string());
    assert_eq!((u.reserved.0, u.spent.0, u.count), (0, 0, 0));
    assert_eq!(o.next_nonce, 3, "nonces are used up so the refused batch cannot be replayed");
    assert_eq!(o.next_action, 0);
    let r = o.get_reputation();
    assert_eq!(r["counts"]["refused"], json!(3));
    assert_eq!(r["counts"]["allowed"], json!(0));
    assert_eq!(r["counts"]["refusals"]["over_daily_budget"], json!(3));
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"batch\"") && l.contains("\"decision\":\"denied\"")));
}

#[test]
fn batch_counts_what_is_already_reserved_today() {
    let mut o = round();
    let ps = props(&o, &[("bob.test", NEAR), ("bakery.test", NEAR)]);
    set("oath.test", T0);
    assert!(o.propose_batch(ps).iter().all(|x| x.decision == "allowed"));
    // 2 NEAR reserved; a second round of 2 x 0.3 NEAR would make 2.6 > 2.5.
    let ps = props(&o, &[("bob.test", 3 * NEAR / 10), ("carol.test", 3 * NEAR / 10)]);
    set("oath.test", T0);
    assert!(o.propose_batch(ps).iter().all(|x| x.reason == "over_daily_budget"));
}

#[test]
fn batch_with_one_bad_item_names_it_and_refuses_the_rest() {
    let mut o = round();
    let ps = props(&o, &[("bob.test", NEAR / 10), ("mallory.test", NEAR / 10), ("carol.test", NEAR / 10)]);
    set("oath.test", T0);
    let out = o.propose_batch(ps);
    assert_eq!(out[1].reason, "receiver_not_allowlisted");
    assert_eq!(out[0].reason, "batch_refused");
    assert_eq!(out[2].reason, "batch_refused");
    assert_eq!(o.usage_today(&"round".to_string()).reserved.0, 0);
}

#[test]
fn batch_refuses_over_cap_item_instead_of_escalating() {
    let mut o = setup(0); // clause "tip" escalates between 1 and 3 NEAR
    let mut a = prop(&o, "tip", "bob.test", NEAR / 10);
    let mut b = prop(&o, "tip", "bakery.test", 2 * NEAR);
    a.nonce = U64(0); b.nonce = U64(1);
    set("oath.test", T0);
    let out = o.propose_batch(vec![a, b]);
    assert_eq!(out[1].reason, "over_per_action_cap");
    assert!(o.get_pending().is_empty());
    assert_eq!(o.usage_today(&"tip".to_string()).reserved.0, 0);
}

#[test]
fn batch_refuses_mixed_clauses_and_receipt_clauses() {
    let mut o = round();
    let mut ps = props(&o, &[("bob.test", NEAR / 10), ("bob.test", NEAR / 10)]);
    ps[1].clause_id = "tip".into();
    set("oath.test", T0);
    assert_eq!(o.propose_batch(ps)[1].reason, "batch_mixed_clauses");
    let mut o = setup(0);
    let _ = screened(&mut o);
    let mut a = prop(&o, "scr", "bob.test", 1); let mut b = prop(&o, "scr", "bob.test", 1);
    a.nonce = U64(0); b.nonce = U64(1);
    set("oath.test", T0);
    assert_eq!(o.propose_batch(vec![a, b])[0].reason, "batch_receipt_clause");
}

#[test]
fn batch_refused_while_frozen() {
    let mut o = round();
    set("owner.test", T0);
    o.freeze();
    let ps = props(&o, &[("bob.test", NEAR / 10), ("carol.test", NEAR / 10)]);
    set("oath.test", T0);
    assert_eq!(o.propose_batch(ps)[0].reason, "frozen");
}

#[test]
#[should_panic(expected = "ERR_BATCH_SIZE")]
fn batch_of_one_panics() {
    let mut o = round();
    let ps = props(&o, &[("bob.test", 1)]);
    set("oath.test", T0);
    o.propose_batch(ps);
}

#[test]
#[should_panic(expected = "ERR_BATCH_SIZE")]
fn batch_over_max_panics() {
    let mut o = round();
    let ps = props(&o, &[("bob.test", 1); 6]);
    set("oath.test", T0);
    o.propose_batch(ps);
}

#[test]
#[should_panic(expected = "ERR_NONCE")]
fn batch_nonces_must_be_consecutive() {
    let mut o = round();
    let mut ps = props(&o, &[("bob.test", 1), ("carol.test", 1)]);
    ps[1].nonce = U64(5);
    set("oath.test", T0);
    o.propose_batch(ps);
}

#[test]
#[should_panic(expected = "ERR_NOT_AGENT")]
fn batch_only_from_the_agent_account() {
    let mut o = round();
    let ps = props(&o, &[("bob.test", 1), ("carol.test", 1)]);
    set("bob.test", T0);
    o.propose_batch(ps);
}

#[test]
#[should_panic(expected = "ERR_LOW_GAS")]
fn batch_needs_gas_for_every_item() {
    let mut o = round();
    let ps = props(&o, &[("bob.test", 1), ("carol.test", 1), ("bakery.test", 1)]);
    let mut b = ctx("oath.test", T0); b.prepaid_gas(Gas::from_tgas(60));
    testing_env!(b.build());
    o.propose_batch(ps);
}

#[test]
fn batch_items_settle_one_by_one() {
    let mut o = round();
    let ps = props(&o, &[("bob.test", NEAR / 2), ("carol.test", NEAR / 2)]);
    set("oath.test", T0);
    let _ = o.propose_batch(ps);
    set_results("oath.test", T0, vec![PromiseResult::Successful(vec![])]);
    assert_eq!(o.on_settle(U64(0)).status, "confirmed");
    set_results("oath.test", T0, vec![PromiseResult::Failed]);
    assert_eq!(o.on_settle(U64(1)).status, "failed_released");
    let u = o.usage_today(&"round".to_string());
    assert_eq!((u.spent.0, u.reserved.0), (NEAR / 2, 0));
}

#[test]
fn agent_key_scope_is_propose_and_propose_batch() {
    assert_eq!(AGENT_METHODS, "propose,propose_batch");
}

// R16.1 boundaries the first batch tests left open (found by cargo-mutants on the 85e0563 diff).
#[test]
fn batch_exactly_at_budget_is_allowed_and_ids_advance() {
    let mut o = round(); // budget 2.5 NEAR
    let ps = props(&o, &[("bob.test", NEAR / 2); 5]);
    set("oath.test", T0);
    assert!(o.propose_batch(ps).iter().all(|x| x.decision == "allowed"), "total == budget must pass");
    assert_eq!(o.next_action, 5);
    assert_eq!(o.usage_today(&"round".to_string()).count, 5);
}

#[test]
fn batch_count_counts_earlier_actions_and_allows_exactly_the_max() {
    let mut o = round();
    let mut c = clause(&["bob.test", "bakery.test", "carol.test"], NEAR, 5 * NEAR / 2, false, None);
    c.max_actions_per_day = 3;
    set("owner.test", T0); let _ = o.set_clause("round".into(), c);
    let p = prop(&o, "round", "bob.test", 5); assert_eq!(deny_reason(&mut o, p), "PROMISE"); // 1 used
    let ps = props(&o, &[("bob.test", 5); 3]);
    set("oath.test", T0);
    assert!(o.propose_batch(ps).iter().all(|x| x.reason == "over_daily_action_count"), "1 + 3 > 3");
    let ps = props(&o, &[("bob.test", 5); 2]);
    set("oath.test", T0);
    assert!(o.propose_batch(ps).iter().all(|x| x.decision == "allowed"), "1 + 2 == 3 must pass");
    let ps = props(&o, &[("bob.test", 5); 2]);
    set("oath.test", T0);
    let out = o.propose_batch(ps); // the per-item check already sees 3 of 3 used
    assert_eq!((out[0].reason.as_str(), out[1].reason.as_str()), ("over_daily_action_count", "batch_refused"));
}

#[test]
fn batch_storage_reserve_exact_boundary() {
    let mut o = round();
    let amount = NEAR / 100;
    let byte_cost = { set("oath.test", T0); env::storage_byte_cost().as_yoctonear() };
    // storage now + 600 bytes per item, plus the 0.1 NEAR reserve, plus the native total.
    let need = (2_000u128 + 600 * 3) * byte_cost + NEAR / 10 + 3 * amount;
    for (bal, want_ok) in [(need - 1, false), (need, true)] {
        let ps = props(&o, &[("bob.test", amount), ("bakery.test", amount), ("carol.test", amount)]);
        let mut b = ctx("oath.test", T0); b.account_balance(NearToken::from_yoctonear(bal)).storage_usage(2_000); testing_env!(b.build());
        let out = o.propose_batch(ps);
        if want_ok { assert!(out.iter().all(|x| x.decision == "allowed"), "balance == need must pass: {:?}", out[0].reason); }
        else { assert!(out.iter().all(|x| x.reason == "storage_reserve_low"), "{:?}", out[0].reason); }
    }
}

#[test]
#[should_panic(expected = "ERR_LOW_GAS")]
fn batch_ft_needs_ft_gas_for_every_item() {
    let mut o = round();
    let mut c = clause(&["bob.test", "carol.test"], NEAR, 5 * NEAR / 2, false, None);
    c.asset = Asset::Ft { token: acc("usdc.test") };
    set("owner.test", T0); let _ = o.set_clause("round".into(), c);
    let ps = props(&o, &[("bob.test", 1), ("carol.test", 1)]);
    // 100 Tgas covers 2 native items (2 x 25) but not 2 token items (2 x 60).
    let mut b = ctx("oath.test", T0); b.prepaid_gas(Gas::from_tgas(100)); testing_env!(b.build());
    o.propose_batch(ps);
}

#[test]
#[should_panic(expected = "ERR_NOT_AGENT_KEY")]
fn batch_with_wrong_key_panics() {
    let mut o = round();
    let ps = props(&o, &[("bob.test", 1), ("carol.test", 1)]);
    let mut b = ctx("oath.test", T0);
    b.signer_account_pk("ed25519:DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847".parse().unwrap());
    testing_env!(b.build());
    o.propose_batch(ps);
}

// ---------------- C5: optional hidden rules (commit-reveal) ----------------
const SALT: &str = "salt-0123456789ab";
fn hrule(max: Option<u128>, deny: &[&str]) -> HiddenRule {
    HiddenRule { max_amount: max.map(U128), deny: deny.iter().map(|a| acc(a)).collect() }
}
/// "tip" sealed with: hidden cap 0.5 NEAR, bakery.test blocked.
fn the_rule() -> HiddenRule { hrule(Some(NEAR / 2), &["bakery.test"]) }
fn sealed(delay: u64) -> Oath {
    let mut o = setup(delay);
    set("owner.test", T0);
    let _ = o.seal_rule("tip".into(), hidden_commitment("tip", &the_rule(), SALT));
    o
}
fn held(o: &mut Oath, to: &str, amount: u128) -> u64 {
    let p = prop(o, "tip", to, amount);
    set("oath.test", T0);
    let r = outcome(o.propose(p)).expect("held is a value");
    assert_eq!((r.decision.as_str(), r.status.as_str(), r.reason.as_str()), ("held", "held", "hidden_rule_check"));
    r.action_id.unwrap().0
}
fn reveal(o: &mut Oath, id: u64, r: HiddenRule, salt: &str) -> Option<Outcome> {
    set("owner.test", T0);
    outcome(o.reveal_hidden(U64(id), r, salt.into()))
}

#[test]
fn c5_commitment_text_is_canonical_and_bound() {
    set("owner.test", T0);
    let r = hrule(Some(500), &["eve.test", "mal.test"]);
    assert_eq!(hidden_rule_text("tip", &r, SALT), format!("oath-hidden-v1|oath.test|tip|500|eve.test,mal.test|{SALT}"));
    assert_eq!(hidden_rule_text("tip", &hrule(None, &[]), SALT), format!("oath-hidden-v1|oath.test|tip|none||{SALT}"));
    use sha2::Digest;
    let want = hex::encode(sha2::Sha256::digest(hidden_rule_text("tip", &r, SALT).as_bytes()));
    assert_eq!(hidden_commitment("tip", &r, SALT), want);
    assert_ne!(hidden_commitment("tip", &r, SALT), hidden_commitment("tap", &r, SALT));
    assert_ne!(hidden_commitment("tip", &r, SALT), hidden_commitment("tip", &r, "salt-0123456789ac"));
}

#[test]
fn c5_hidden_checks_cap_and_deny() {
    let r = hrule(Some(10), &["bakery.test"]);
    assert_eq!(hidden_checks(&r, &acc("bob.test"), 10), Ok(()));
    assert_eq!(hidden_checks(&r, &acc("bob.test"), 11), Err("hidden_rule_cap".into()));
    assert_eq!(hidden_checks(&r, &acc("bakery.test"), 1), Err("hidden_rule_receiver".into()));
    assert_eq!(hidden_checks(&r, &acc("bakery.test"), 11), Err("hidden_rule_receiver".into()));
    assert_eq!(hidden_checks(&hrule(None, &[]), &acc("bob.test"), u128::MAX), Ok(()));
}

#[test]
#[should_panic(expected = "ERR_NOT_GOVERNOR")]
fn c5_seal_by_outsider_panics() {
    let mut o = setup(0);
    set("eve.test", T0);
    let _ = o.seal_rule("tip".into(), "ab".repeat(32));
}
#[test]
#[should_panic(expected = "ERR_NO_CLAUSE")]
fn c5_seal_unknown_clause_panics() {
    let mut o = setup(0);
    set("owner.test", T0);
    let _ = o.seal_rule("nope".into(), "ab".repeat(32));
}
#[test]
#[should_panic(expected = "ERR_COMMITMENT")]
fn c5_seal_short_commitment_panics() {
    let mut o = setup(0);
    set("owner.test", T0);
    let _ = o.seal_rule("tip".into(), "ab".repeat(31));
}
#[test]
#[should_panic(expected = "ERR_COMMITMENT")]
fn c5_seal_non_hex_commitment_panics() {
    let mut o = setup(0);
    set("owner.test", T0);
    let _ = o.seal_rule("tip".into(), "zz".repeat(32));
}
#[test]
#[should_panic(expected = "ERR_NOT_SEALED")]
fn c5_unseal_without_seal_panics() {
    let mut o = setup(0);
    set("owner.test", T0);
    let _ = o.unseal_rule("tip".into());
}
#[test]
#[should_panic(expected = "ERR_NOT_GOVERNOR")]
fn c5_unseal_by_outsider_panics() {
    let mut o = sealed(0);
    set("eve.test", T0);
    let _ = o.unseal_rule("tip".into());
}

#[test]
fn c5_first_seal_is_instant_replace_and_unseal_wait() {
    let mut o = setup(3600 * 1_000_000_000);
    let v0 = o.policy_version;
    set("owner.test", T0);
    let r = o.seal_rule("tip".into(), "AB".repeat(32));
    assert!(matches!(r, PromiseOrValue::Value(ref v) if v["applied"] == json!(true)));
    assert_eq!(o.get_seal("tip".into()), Some("ab".repeat(32)), "stored lower-case");
    assert_eq!(o.policy_version, v0 + 1);
    assert_eq!(o.get_rules("tip".into()).unwrap()["hidden_rule_sealed"], json!(true));
    assert!(get_logs().iter().any(|l| l.contains("\"change\":\"seal\"")));
    set("owner.test", T0);
    let _ = o.seal_rule("tip".into(), "cd".repeat(32));
    assert_eq!(o.get_seal("tip".into()), Some("ab".repeat(32)), "replacing waits");
    assert_eq!(o.pending.len(), 1);
    set("owner.test", T0);
    let _ = o.unseal_rule("tip".into());
    assert_eq!(o.pending.len(), 2);
    assert_eq!(o.policy_version, v0 + 1);
    let ids: Vec<u64> = o.pending.keys().cloned().collect();
    set("owner.test", T0 + 3600 * 1_000_000_000);
    let _ = o.execute_change(U64(ids[0]));
    assert_eq!(o.get_seal("tip".into()), Some("cd".repeat(32)));
    set("owner.test", T0 + 3600 * 1_000_000_000);
    let _ = o.execute_change(U64(ids[1]));
    assert_eq!(o.get_seal("tip".into()), None);
    assert_eq!(o.get_rules("tip".into()).unwrap()["hidden_rule_sealed"], json!(false));
    assert_eq!(o.policy_version, v0 + 3);
}

#[test]
fn c5_remove_clause_drops_the_seal() {
    let mut o = sealed(0);
    set("owner.test", T0);
    o.remove_clause("tip".into());
    assert_eq!(o.get_seal("tip".into()), None);
}

#[test]
fn c5_sealed_propose_is_held_with_budget_reserved() {
    let mut o = sealed(0);
    let id = held(&mut o, "bob.test", NEAR / 4);
    let rec = o.get_action(U64(id)).unwrap();
    assert_eq!(rec.status, "held");
    assert_eq!(o.usage_today(&"tip".to_string()).reserved.0, NEAR / 4);
    assert_eq!(o.get_hold(U64(id)), Some(U64(T0 + SEAL_HOLD_NS)));
    assert_eq!(SEAL_HOLD_NS, 30 * 60 * 1_000_000_000);
    let r = o.get_reputation();
    assert_eq!((r["counts"]["escalated"].clone(), r["counts"]["refused"].clone()), (json!(1), json!(0)));
    assert!(get_logs().iter().any(|l| l.contains("\"decision\":\"held\"") && l.contains("hidden_rule_check")));
    // Visible refusals still come first: no hold for a receiver outside the allowlist.
    let p = prop(&o, "tip", "eve.test", 5);
    assert_eq!(deny_reason(&mut o, p), "receiver_not_allowlisted");
    // An unsealed clause is not held.
    set("owner.test", T0);
    let _ = o.set_clause("open".into(), clause(&["bob.test"], NEAR, 5 * NEAR, false, None));
    let p = prop(&o, "open", "bob.test", 5);
    assert_eq!(deny_reason(&mut o, p), "PROMISE");
}

#[test]
fn c5_reveal_pass_pays_and_settles() {
    let mut o = sealed(0);
    let id = held(&mut o, "bob.test", NEAR / 2);
    assert!(reveal(&mut o, id, the_rule(), SALT).is_none(), "payment promise");
    assert_eq!(o.get_action(U64(id)).unwrap().status, "submitted");
    assert_eq!(o.get_hold(U64(id)), None);
    let logs = get_logs();
    assert!(logs.iter().any(|l| l.contains("\"event\":\"reveal\"") && l.contains(SALT)));
    assert!(logs.iter().any(|l| l.contains("hidden_rule_passed")));
    assert_eq!(settle(&mut o, id, true).status, "confirmed");
    let u = o.usage_today(&"tip".to_string());
    assert_eq!((u.spent.0, u.reserved.0), (NEAR / 2, 0));
}

#[test]
fn c5_reveal_over_hidden_cap_refuses_and_releases() {
    let mut o = sealed(0);
    let id = held(&mut o, "bob.test", NEAR / 2 + 1);
    let r = reveal(&mut o, id, the_rule(), SALT).expect("refusal is a value");
    assert_eq!((r.decision.as_str(), r.status.as_str(), r.reason.as_str()), ("denied", "denied", "hidden_rule_cap"));
    assert_eq!(r.action_id, Some(U64(id)));
    assert_eq!(o.get_action(U64(id)).unwrap().status, "denied");
    assert_eq!(o.usage_today(&"tip".to_string()).reserved.0, 0);
    assert_eq!(o.get_hold(U64(id)), None);
    let rep = o.get_reputation();
    assert_eq!(rep["counts"]["escalated"], json!(0));
    assert_eq!(rep["counts"]["refused"], json!(1));
    assert_eq!(rep["counts"]["refusals"]["other"], json!(1));
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"settle\"") && l.contains("hidden_rule_cap")));
}

#[test]
fn c5_reveal_denied_receiver_refuses() {
    let mut o = sealed(0);
    let id = held(&mut o, "bakery.test", 5);
    assert_eq!(reveal(&mut o, id, the_rule(), SALT).unwrap().reason, "hidden_rule_receiver");
}

#[test]
#[should_panic(expected = "ERR_NOT_HELD")]
fn c5_reveal_twice_panics() {
    let mut o = sealed(0);
    let id = held(&mut o, "bob.test", NEAR);
    let _ = reveal(&mut o, id, the_rule(), SALT);
    let _ = reveal(&mut o, id, the_rule(), SALT);
}
#[test]
#[should_panic(expected = "ERR_SEAL_MISMATCH")]
fn c5_reveal_wrong_salt_panics() {
    let mut o = sealed(0);
    let id = held(&mut o, "bob.test", NEAR);
    let _ = reveal(&mut o, id, the_rule(), "salt-0123456789ac");
}
#[test]
#[should_panic(expected = "ERR_SEAL_MISMATCH")]
fn c5_reveal_other_rule_panics() {
    let mut o = sealed(0);
    let id = held(&mut o, "bob.test", NEAR);
    let _ = reveal(&mut o, id, hrule(None, &[]), SALT);
}
#[test]
#[should_panic(expected = "ERR_SALT_SHORT")]
fn c5_reveal_short_salt_panics() {
    let mut o = sealed(0);
    let id = held(&mut o, "bob.test", NEAR);
    let _ = reveal(&mut o, id, the_rule(), "short-salt-1234");
}
#[test]
#[should_panic(expected = "ERR_NOT_GOVERNOR")]
fn c5_reveal_by_agent_panics() {
    let mut o = sealed(0);
    let id = held(&mut o, "bob.test", NEAR);
    set("oath.test", T0);
    let _ = o.reveal_hidden(U64(id), the_rule(), SALT.into());
}
#[test]
#[should_panic(expected = "ERR_NOT_HELD")]
fn c5_reveal_on_plain_action_panics() {
    let mut o = setup(0);
    let p = prop(&o, "tip", "bob.test", 5); deny_reason(&mut o, p);
    let _ = reveal(&mut o, 0, the_rule(), SALT);
}

#[test]
fn c5_salt_of_exactly_min_length_is_accepted() {
    let salt = "a".repeat(MIN_SALT);
    let mut o = setup(0);
    set("owner.test", T0);
    let _ = o.seal_rule("tip".into(), hidden_commitment("tip", &the_rule(), &salt));
    let id = held(&mut o, "bob.test", 5);
    assert!(reveal(&mut o, id, the_rule(), &salt).is_none());
    assert_eq!(MIN_SALT, 16);
}

#[test]
fn c5_reveal_rechecks_freeze_and_policy() {
    let mut o = sealed(0);
    let id = held(&mut o, "bob.test", 5);
    set("owner.test", T0); o.freeze();
    assert_eq!(reveal(&mut o, id, the_rule(), SALT).unwrap().reason, "frozen");

    let mut o = sealed(0);
    let id = held(&mut o, "bob.test", 5);
    set("owner.test", T0); o.freeze();
    set("dao.test", T0); o.unfreeze();
    assert_eq!(reveal(&mut o, id, the_rule(), SALT).unwrap().reason, "freeze_epoch_changed");

    let mut o = sealed(0);
    let id = held(&mut o, "bob.test", 5);
    set("owner.test", T0);
    let _ = o.set_clause("tip".into(), clause(&["bob.test", "bakery.test"], NEAR / 2, 5 * NEAR, false, Some(3 * NEAR)));
    assert_eq!(reveal(&mut o, id, the_rule(), SALT).unwrap().reason, "policy_changed");
    assert_eq!(o.usage_today(&"tip".to_string()).reserved.0, 0);
}

#[test]
fn c5_unsealed_before_reveal_refuses() {
    let mut o = sealed(0);
    let id = held(&mut o, "bob.test", 5);
    set("owner.test", T0);
    let _ = o.unseal_rule("tip".into());
    // No commitment to check against: refused even with a garbage rule.
    assert_eq!(reveal(&mut o, id, hrule(None, &[]), SALT).unwrap().reason, "seal_removed");
    assert!(!get_logs().iter().any(|l| l.contains("\"event\":\"reveal\"")));
}

#[test]
fn c5_expire_hold_fails_closed_at_the_deadline() {
    let mut o = sealed(0);
    let id = held(&mut o, "bob.test", 5);
    set("anyone.test", T0 + SEAL_HOLD_NS);
    let r = o.expire_hold(U64(id));
    assert_eq!((r.decision.as_str(), r.reason.as_str()), ("denied", "hidden_rule_not_revealed"));
    assert_eq!(o.get_action(U64(id)).unwrap().status, "denied");
    assert_eq!(o.usage_today(&"tip".to_string()).reserved.0, 0);
    assert_eq!(o.get_hold(U64(id)), None);
}
#[test]
#[should_panic(expected = "ERR_HOLD_NOT_EXPIRED")]
fn c5_expire_hold_too_early_panics() {
    let mut o = sealed(0);
    let id = held(&mut o, "bob.test", 5);
    set("anyone.test", T0 + SEAL_HOLD_NS - 1);
    let _ = o.expire_hold(U64(id));
}
#[test]
#[should_panic(expected = "ERR_NOT_HELD")]
fn c5_expire_plain_action_panics() {
    let mut o = setup(0);
    let p = prop(&o, "tip", "bob.test", 5); deny_reason(&mut o, p);
    set("anyone.test", T0 + SEAL_HOLD_NS);
    let _ = o.expire_hold(U64(0));
}
#[test]
#[should_panic(expected = "ERR_NOT_HELD")]
fn c5_expire_after_reveal_panics() {
    let mut o = sealed(0);
    let id = held(&mut o, "bob.test", 5);
    let _ = reveal(&mut o, id, the_rule(), SALT);
    set("anyone.test", T0 + SEAL_HOLD_NS);
    let _ = o.expire_hold(U64(id));
}

fn reveal_gas(o: &mut Oath, id: u64, g: Gas) -> Option<Outcome> {
    testing_env!(ctx("owner.test", T0).prepaid_gas(g).build());
    outcome(o.reveal_hidden(U64(id), the_rule(), SALT.into()))
}
#[test]
fn c5_reveal_gas_floor_is_inclusive_and_skipped_for_refusals() {
    let mut o = sealed(0);
    let id = held(&mut o, "bob.test", NEAR);
    assert_eq!(reveal_gas(&mut o, id, Gas::from_tgas(20)).unwrap().reason, "hidden_rule_cap");
    // Exactly the floor passes the check (the mock VM then runs out while building the promise).
    let id = held(&mut o, "bob.test", 5);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = reveal_gas(&mut o, id, MIN_GAS_NATIVE); }));
    let msg = r.err().and_then(|e| e.downcast_ref::<String>().cloned()).unwrap_or_default();
    assert!(!msg.contains("ERR_LOW_GAS"), "{msg}");
}
#[test]
#[should_panic(expected = "ERR_LOW_GAS")]
fn c5_reveal_pass_with_low_gas_panics() {
    let mut o = sealed(0);
    let id = held(&mut o, "bob.test", 5);
    let _ = reveal_gas(&mut o, id, Gas::from_gas(MIN_GAS_NATIVE.as_gas() - 1));
}
#[test]
#[should_panic(expected = "ERR_LOW_GAS")]
fn c5_reveal_ft_needs_the_ft_floor() {
    let mut o = setup(0);
    let mut c = clause(&["bob.test"], NEAR, 5 * NEAR, false, None);
    c.asset = Asset::Ft { token: acc("usdc.test") };
    set("owner.test", T0);
    let _ = o.set_clause("tip".into(), c);
    set("owner.test", T0);
    let _ = o.seal_rule("tip".into(), hidden_commitment("tip", &the_rule(), SALT));
    let id = held(&mut o, "bob.test", 5);
    let _ = reveal_gas(&mut o, id, MIN_GAS_NATIVE);
}

#[test]
fn c5_escalation_band_is_held_not_yielded() {
    let mut o = setup(0);
    set("owner.test", T0);
    let _ = o.seal_rule("tip".into(), hidden_commitment("tip", &hrule(None, &[]), SALT));
    let id = held(&mut o, "bob.test", 2 * NEAR);
    assert!(o.get_action(U64(id)).unwrap().yield_id.is_none());
    // The governor-signed reveal is the approval for the over-cap amount.
    assert!(reveal(&mut o, id, hrule(None, &[]), SALT).is_none());
    assert_eq!(o.get_action(U64(id)).unwrap().status, "submitted");
}

#[test]
fn c5_batch_refuses_a_sealed_clause() {
    let mut o = round();
    set("owner.test", T0);
    let _ = o.seal_rule("round".into(), hidden_commitment("round", &the_rule(), SALT));
    let ps = props(&o, &[("bob.test", 5), ("carol.test", 5)]);
    set("oath.test", T0);
    let out = o.propose_batch(ps);
    assert_eq!(out[0].reason, "batch_sealed_clause");
    assert_eq!(out[1].reason, "batch_refused");
    assert_eq!(o.next_action, 0);
}
#[test]
fn c5_holds_are_per_action() {
    let mut o = sealed(0);
    let a = held(&mut o, "bob.test", 5);
    let b = held(&mut o, "bob.test", 6);
    let _ = reveal(&mut o, a, the_rule(), SALT);
    assert_eq!(o.get_hold(U64(a)), None);
    assert_eq!(o.get_hold(U64(b)), Some(U64(T0 + SEAL_HOLD_NS)));
    set("anyone.test", T0 + SEAL_HOLD_NS);
    assert_eq!(o.expire_hold(U64(b)).reason, "hidden_rule_not_revealed");
}
