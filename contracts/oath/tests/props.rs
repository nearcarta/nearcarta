//! Property tests over the charter's pure rule functions (seeded RNG, no network).
//! Each property runs many random cases; a failure prints the seed and case.
use near_sdk::json_types::{U128, U64};
use near_sdk::AccountId;
use oath::*;
use rand::{rngs::StdRng, Rng, SeedableRng};
use std::collections::BTreeMap;

const CASES: usize = 2_000;
fn acc(i: u32) -> AccountId { format!("r{i}.testnet").parse().unwrap() }
fn rng(seed: u64) -> StdRng { StdRng::seed_from_u64(seed) }

fn clause(r: &mut StdRng) -> Clause {
    let cap: u128 = r.gen_range(1..1_000_000);
    let n = r.gen_range(1..5);
    Clause {
        asset: Asset::Native,
        receivers: (0..n).map(|_| acc(r.gen_range(0..8))).collect(),
        per_action_cap: U128(cap),
        daily_budget: U128(cap * r.gen_range(1..10)),
        window_start_min: 0,
        window_end_min: 0,
        requires_receipt: r.gen_bool(0.5),
        escalation_max: if r.gen_bool(0.5) { Some(U128(cap + r.gen_range(0..1_000_000))) } else { None },
        min_amount: U128(r.gen_range(1..=cap.min(100))),
        max_actions_per_day: r.gen_range(1..60),
        min_receiver_age_days: r.gen_range(0..30),
        code_hash_pins: BTreeMap::new(),
    }
}
/// A random clause that is never wider than `o` (subset of receivers, lower or equal limits).
fn narrower(r: &mut StdRng, o: &Clause) -> Clause {
    let mut n = o.clone();
    n.receivers.retain(|_| r.gen_bool(0.7));
    n.per_action_cap = U128(r.gen_range(0..=o.per_action_cap.0));
    n.daily_budget = U128(r.gen_range(0..=o.daily_budget.0));
    n.escalation_max = match o.escalation_max { Some(m) if r.gen_bool(0.5) => Some(U128(r.gen_range(0..=m.0))), _ => None };
    n.min_amount = U128(o.min_amount.0 + r.gen_range(0..10));
    n.max_actions_per_day = r.gen_range(0..=o.max_actions_per_day);
    n.min_receiver_age_days = o.min_receiver_age_days + r.gen_range(0..5);
    n.requires_receipt = o.requires_receipt || r.gen_bool(0.5);
    n
}

#[test]
fn prop_receiver_outside_allowlist_is_always_refused() {
    let mut r = rng(1);
    for i in 0..CASES {
        let c = clause(&mut r);
        let out: AccountId = format!("x{i}.evil.testnet").parse().unwrap();
        assert_eq!(clause_checks(&c, &out, r.gen_range(0..u128::MAX)), Err("receiver_not_allowlisted".into()));
    }
}

#[test]
fn prop_zero_and_below_min_are_refused() {
    let mut r = rng(2);
    for _ in 0..CASES {
        let c = clause(&mut r);
        let to = c.receivers[0].clone();
        assert_eq!(clause_checks(&c, &to, 0), Err("zero_amount".into()));
        if c.min_amount.0 > 1 {
            assert_eq!(clause_checks(&c, &to, r.gen_range(1..c.min_amount.0)), Err("below_min_amount".into()));
        }
    }
}

#[test]
fn prop_within_cap_is_allowed_without_escalation() {
    let mut r = rng(3);
    for _ in 0..CASES {
        let c = clause(&mut r);
        let a = r.gen_range(c.min_amount.0..=c.per_action_cap.0);
        assert_eq!(clause_checks(&c, &c.receivers[0], a), Ok(false));
    }
}

#[test]
fn prop_over_cap_escalates_only_inside_the_band() {
    let mut r = rng(4);
    for _ in 0..CASES {
        let c = clause(&mut r);
        let a = c.per_action_cap.0 + r.gen_range(1..2_000_000);
        let got = clause_checks(&c, &c.receivers[0], a);
        match c.escalation_max {
            Some(m) if a <= m.0 => assert_eq!(got, Ok(true)),
            _ => assert_eq!(got, Err("over_per_action_cap".into())),
        }
    }
}

#[test]
fn prop_same_clause_is_never_widening() {
    let mut r = rng(5);
    for _ in 0..CASES { let c = clause(&mut r); assert!(!is_widening(Some(&c), &c)); }
}

#[test]
fn prop_new_clause_always_counts_as_widening() {
    let mut r = rng(6);
    for _ in 0..200 { assert!(is_widening(None, &clause(&mut r))); }
}

#[test]
fn prop_narrowing_is_not_widening() {
    let mut r = rng(7);
    for _ in 0..CASES { let o = clause(&mut r); let n = narrower(&mut r, &o); assert!(!is_widening(Some(&o), &n), "{o:?} -> {n:?}"); }
}

/// Core safety property: a change the contract accepts without the timelock (not widening)
/// can never permit an action the old clause refused.
#[test]
fn prop_non_widening_change_never_permits_more() {
    let mut r = rng(8);
    for _ in 0..CASES {
        let o = clause(&mut r);
        let n = narrower(&mut r, &o);
        for _ in 0..20 {
            let to = acc(r.gen_range(0..8));
            let a = r.gen_range(0..3_000_000u128);
            if clause_checks(&n, &to, a).is_ok() { assert!(clause_checks(&o, &to, a).is_ok(), "{a} to {to}"); }
        }
    }
}

#[test]
fn prop_each_loosening_field_is_widening() {
    let mut r = rng(9);
    for _ in 0..500 {
        let o = clause(&mut r);
        let mut n = o.clone(); n.receivers.push("new-receiver.testnet".parse().unwrap()); assert!(is_widening(Some(&o), &n));
        let mut n = o.clone(); n.per_action_cap = U128(o.per_action_cap.0 + 1); assert!(is_widening(Some(&o), &n));
        let mut n = o.clone(); n.daily_budget = U128(o.daily_budget.0 + 1); assert!(is_widening(Some(&o), &n));
        let mut n = o.clone(); n.escalation_max = Some(U128(o.escalation_max.map(|m| m.0 + 1).unwrap_or(1))); assert!(is_widening(Some(&o), &n));
        let mut n = o.clone(); n.window_start_min = 60; n.window_end_min = 120; assert!(is_widening(Some(&o), &n));
        let mut n = o.clone(); n.max_actions_per_day = o.max_actions_per_day + 1; assert!(is_widening(Some(&o), &n));
        let mut n = o.clone(); n.asset = Asset::Ft { token: "usdc.testnet".parse().unwrap() }; assert!(is_widening(Some(&o), &n));
        if o.min_amount.0 > 1 { let mut n = o.clone(); n.min_amount = U128(o.min_amount.0 - 1); assert!(is_widening(Some(&o), &n)); }
        if o.min_receiver_age_days > 0 { let mut n = o.clone(); n.min_receiver_age_days -= 1; assert!(is_widening(Some(&o), &n)); }
        if o.requires_receipt { let mut n = o.clone(); n.requires_receipt = false; assert!(is_widening(Some(&o), &n)); }
    }
}

#[test]
fn removing_a_code_hash_pin_is_widening() {
    let mut r = rng(10);
    let mut o = clause(&mut r);
    o.code_hash_pins.insert(o.receivers[0].clone(), "abc".into());
    let mut n = o.clone(); n.code_hash_pins.clear(); assert!(is_widening(Some(&o), &n));
    let mut n = o.clone(); n.code_hash_pins.insert(o.receivers[0].clone(), "def".into()); assert!(is_widening(Some(&o), &n));
}

#[test]
fn prop_hidden_rule_checks() {
    let mut r = rng(11);
    for _ in 0..CASES {
        let deny = acc(r.gen_range(0..8));
        let max = r.gen_range(1..1_000_000u128);
        let h = HiddenRule { max_amount: Some(U128(max)), deny: vec![deny.clone()] };
        assert_eq!(hidden_checks(&h, &deny, 1), Err("hidden_rule_receiver".into()));
        let other: AccountId = "ok.testnet".parse().unwrap();
        assert_eq!(hidden_checks(&h, &other, max + r.gen_range(1..100)), Err("hidden_rule_cap".into()));
        assert_eq!(hidden_checks(&h, &other, r.gen_range(0..=max)), Ok(()));
    }
}

#[test]
fn hidden_commitment_is_deterministic_and_bound_to_salt_clause_and_rule() {
    let h = HiddenRule { max_amount: Some(U128(5)), deny: vec![acc(1)] };
    let base = hidden_commitment("c1", &h, "salt-a");
    assert_eq!(base, hidden_commitment("c1", &h, "salt-a"));
    assert_eq!(base.len(), 64);
    assert_ne!(base, hidden_commitment("c1", &h, "salt-b"));
    assert_ne!(base, hidden_commitment("c2", &h, "salt-a"));
    assert_ne!(base, hidden_commitment("c1", &HiddenRule { max_amount: Some(U128(6)), deny: vec![acc(1)] }, "salt-a"));
    assert_ne!(base, hidden_commitment("c1", &HiddenRule { max_amount: Some(U128(5)), deny: vec![] }, "salt-a"));
}

#[test]
fn prop_valid_field_rejects_separator_and_bad_lengths() {
    let mut r = rng(12);
    for _ in 0..CASES {
        let len = r.gen_range(0..80);
        let s: String = (0..len).map(|_| r.gen_range(32u8..127) as char).collect();
        let ok = !s.is_empty() && s.len() <= 32 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b));
        assert_eq!(valid_field(&s), ok, "{s:?}");
        if s.contains('|') { assert!(!valid_field(&s)); }
    }
}

#[test]
fn prop_valid_job_id_bounds() {
    let mut r = rng(13);
    for _ in 0..CASES {
        let len = r.gen_range(0..100);
        let s: String = (0..len).map(|_| if r.gen_bool(0.95) { 'a' } else { r.gen_range(32u8..127) as char }).collect();
        let ok = (16..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
        assert_eq!(valid_job_id(&s), ok, "{s:?}");
    }
}

fn body(ah: &str, amount: &str, job: &str, verdict: &str, age: u64, code: &str) -> String {
    serde_json::json!({"action_hash": ah, "age_days": age, "amount": amount, "code_hash": code, "job_id": job,
        "receiver": "r1.testnet", "v": RECEIPT_V, "verdict": verdict}).to_string()
}
fn plain() -> Clause { let mut r = rng(14); let mut c = clause(&mut r); c.code_hash_pins.clear(); c.min_receiver_age_days = 0; c }
const JOB: &str = "job-0123456789abcdef";

#[test]
fn receipt_canonical_body_parses_and_checks() {
    let b = parse_receipt_body(&body("ah", "5", JOB, "ALLOW", 9, "h")).unwrap();
    assert_eq!(check_receipt_body(&b, "ah", &acc(1), 5, JOB, &plain()), Ok(()));
}

#[test]
fn receipt_non_canonical_bodies_are_refused() {
    let good = body("ah", "5", JOB, "ALLOW", 9, "h");
    assert!(parse_receipt_body(&good.replace(",", ", ")).is_err(), "whitespace");
    assert!(parse_receipt_body(&good.replacen("{", "{\"zz\":\"1\",", 1)).is_err(), "extra key");
    assert!(parse_receipt_body(&good.replace("\"age_days\":9", "\"age_days\":\"9\"")).is_err(), "age as string");
    assert!(parse_receipt_body(&good.replace("\"age_days\":9", "\"age_days\":-1")).is_err(), "negative age");
    assert!(parse_receipt_body("[]").is_err());
    assert!(parse_receipt_body("not json").is_err());
    let missing = serde_json::json!({"action_hash": "ah", "amount": "5"}).to_string();
    assert!(parse_receipt_body(&missing).is_err());
}

#[test]
fn receipt_every_binding_field_is_checked() {
    let c = plain();
    let chk = |s: String, ah: &str, amt: u128, job: &str| check_receipt_body(&parse_receipt_body(&s).unwrap(), ah, &acc(1), amt, job, &c);
    assert_eq!(chk(body("ah", "5", JOB, "DENY", 9, "h"), "ah", 5, JOB), Err("receipt_verdict_not_allow".into()));
    assert_eq!(chk(body("other", "5", JOB, "ALLOW", 9, "h"), "ah", 5, JOB), Err("receipt_not_bound_to_action".into()));
    assert_eq!(chk(body("ah", "6", JOB, "ALLOW", 9, "h"), "ah", 5, JOB), Err("receipt_amount_mismatch".into()));
    assert_eq!(chk(body("ah", "5", JOB, "ALLOW", 9, "h"), "ah", 5, "job-ffffffffffffffff"), Err("receipt_job_mismatch".into()));
    assert_eq!(chk(body("ah", "5", JOB, "ALLOW", 9, ""), "ah", 5, JOB), Err("receipt_malformed".into()));
    assert_eq!(chk(body("ah", "5", JOB, "ALLOW", 9, &"x".repeat(65)), "ah", 5, JOB), Err("receipt_malformed".into()));
    let b = parse_receipt_body(&body("ah", "5", JOB, "ALLOW", 9, "h")).unwrap();
    assert_eq!(check_receipt_body(&b, "ah", &acc(2), 5, JOB, &c), Err("receipt_receiver_mismatch".into()));
}

#[test]
fn receipt_pins_and_receiver_age() {
    let mut c = plain();
    c.code_hash_pins.insert(acc(1), "pinned".into());
    c.min_receiver_age_days = 30;
    let chk = |code: &str, age: u64| check_receipt_body(&parse_receipt_body(&body("ah", "5", JOB, "ALLOW", age, code)).unwrap(), "ah", &acc(1), 5, JOB, &c);
    assert_eq!(chk("other", 99), Err("receipt_code_hash_mismatch".into()));
    assert_eq!(chk("pinned", 29), Err("receipt_receiver_too_new".into()));
    assert_eq!(chk("pinned", 30), Ok(()));
}

#[test]
fn receipt_wrong_version_is_refused() {
    let s = body("ah", "5", JOB, "ALLOW", 9, "h").replace(RECEIPT_V, "oath-receipt-v1");
    assert_eq!(check_receipt_body(&parse_receipt_body(&s).unwrap(), "ah", &acc(1), 5, JOB, &plain()), Err("receipt_malformed".into()));
}

fn prop(nonce: u64, amount: u128, memo: Option<&str>) -> Proposal {
    Proposal { shop: "guardhouse".into(), clause_id: "c".into(), receiver: acc(1), amount: U128(amount), nonce: U64(nonce),
        policy_version: 1, expires_at: U64(9), memo: memo.map(Into::into), receipt: None }
}

#[test]
fn prop_action_hash_binds_every_field() {
    let mut r = rng(15);
    for _ in 0..500 {
        let n = r.gen_range(0..u64::MAX - 1);
        let a = r.gen_range(1..u128::MAX - 1);
        let h = action_hash(&prop(n, a, None));
        assert_eq!(h, action_hash(&prop(n, a, None)));
        assert_ne!(h, action_hash(&prop(n + 1, a, None)), "nonce (replay)");
        assert_ne!(h, action_hash(&prop(n, a + 1, None)), "amount");
        assert_ne!(h, action_hash(&prop(n, a, Some("m"))), "memo");
        let mut p = prop(n, a, None); p.receiver = acc(2); assert_ne!(h, action_hash(&p), "receiver");
        let mut p = prop(n, a, None); p.policy_version = 2; assert_ne!(h, action_hash(&p), "policy version");
        let mut p = prop(n, a, None); p.expires_at = U64(10); assert_ne!(h, action_hash(&p), "expiry");
        let mut p = prop(n, a, None); p.clause_id = "d".into(); assert_ne!(h, action_hash(&p), "clause");
        let mut p = prop(n, a, None); p.shop = "ferry".into(); assert_ne!(h, action_hash(&p), "shop");
    }
}

#[test]
fn prop_reputation_score() {
    let mut r = rng(16);
    for _ in 0..CASES {
        let proposals = r.gen_range(0..1000u64);
        let allowed = r.gen_range(0..=proposals);
        let escalated = r.gen_range(0..=proposals - allowed);
        let rep = Reputation { proposals, allowed, escalated, refused: proposals - allowed - escalated, refusals: [0; 13] };
        match reputation_score(&rep) {
            None => assert!(proposals < 5),
            Some(s) => { assert!(proposals >= 5 && s <= 100); assert_eq!(s, (allowed + escalated) * 100 / proposals); }
        }
    }
}
