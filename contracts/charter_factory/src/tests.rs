use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult, RuntimeFeesConfig};
use near_sdk::test_vm_config;

fn acc(s: &str) -> AccountId { s.parse().unwrap() }
const HASH: &str = "6iazbQxXNWY6puNN9hC3njiiErrNyCvWzXL9fX95vRSe";

fn ctx(pred: &str, deposit: NearToken, gas_tgas: u64) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("charters.testnet"))
        .predecessor_account_id(acc(pred))
        .signer_account_id(acc(pred))
        .attached_deposit(deposit)
        .prepaid_gas(Gas::from_tgas(gas_tgas));
    b
}

fn factory() -> Factory {
    testing_env!(ctx("charters.testnet", NearToken::from_near(0), 300).build());
    Factory::new(HASH.parse().unwrap(), None)
}

fn with_result(pred: &str, ok: bool) {
    let r = if ok { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed };
    testing_env!(ctx(pred, NearToken::from_near(0), 300).build(), test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![r]);
}

#[test]
fn names() {
    for ok in ["ab", "alice", "a-b", "a_b", "x1", "shop-42", "abcdefghijklmnopqrstuvwx"] { assert!(valid_name(ok), "{ok}"); }
    for bad in ["", "a", "-ab", "ab-", "_ab", "a.b", "Alice", "a b", "a--b", "a__b", "abcdefghijklmnopqrstuvwxy", "ä", "a/b"] {
        assert!(!valid_name(bad), "{bad}");
    }
}

#[test]
fn config_defaults() {
    let f = factory();
    let c = f.get_config();
    assert_eq!(String::from(&c.code_hash), HASH);
    assert_eq!(c.min_deposit.0, DEFAULT_MIN_DEPOSIT.as_yoctonear());
    assert_eq!(c.count, 0);
}

#[test]
#[should_panic(expected = "ERR_MIN_DEPOSIT")]
fn min_deposit_must_cover_fee() {
    testing_env!(ctx("charters.testnet", NearToken::from_near(0), 300).build());
    Factory::new(HASH.parse().unwrap(), Some(U128(REGISTRY_FEE.as_yoctonear())));
}

#[test]
#[should_panic(expected = "ERR_DEPOSIT_LOW")]
fn deposit_too_low() {
    let mut f = factory();
    testing_env!(ctx("alice.testnet", NearToken::from_millinear(299), 100).build());
    f.create_charter("alice".into(), None, None);
}

#[test]
#[should_panic(expected = "ERR_DEPOSIT_HIGH")]
fn deposit_too_high() {
    let mut f = factory();
    testing_env!(ctx("alice.testnet", NearToken::from_millinear(5001), 100).build());
    f.create_charter("alice".into(), None, None);
}

#[test]
#[should_panic(expected = "ERR_LOW_GAS")]
fn gas_floor() {
    let mut f = factory();
    testing_env!(ctx("alice.testnet", NearToken::from_near(1), 79).build());
    f.create_charter("alice".into(), None, None);
}

#[test]
#[should_panic(expected = "ERR_NAME")]
fn bad_name() {
    let mut f = factory();
    testing_env!(ctx("alice.testnet", NearToken::from_near(1), 100).build());
    f.create_charter("a.b".into(), None, None);
}

#[test]
#[should_panic(expected = "ERR_PENDING")]
fn pending_name_is_reserved() {
    let mut f = factory();
    testing_env!(ctx("alice.testnet", NearToken::from_near(1), 100).build());
    f.create_charter("shop".into(), None, None);
    testing_env!(ctx("bob.testnet", NearToken::from_near(1), 100).build());
    f.create_charter("shop".into(), None, None);
}

#[test]
fn success_registers() {
    let mut f = factory();
    testing_env!(ctx("alice.testnet", NearToken::from_near(1), 100).build());
    f.create_charter("shop".into(), None, None);
    with_result("charters.testnet", true);
    assert!(f.on_created(acc("shop.charters.testnet"), acc("alice.testnet"), U128(NearToken::from_near(1).as_yoctonear()), U64(DEFAULT_POLICY_DELAY_NS), None));
    assert!(f.is_charter(acc("shop.charters.testnet")));
    assert_eq!(f.charters_of(acc("alice.testnet")), vec![acc("shop.charters.testnet")]);
    let c = f.get_charter(acc("shop.charters.testnet")).unwrap();
    assert_eq!(c.owner, acc("alice.testnet"));
    assert_eq!(c.index, 0);
    assert_eq!(f.list(None, None).len(), 1);
    assert_eq!(f.get_config().count, 1);
    assert!(get_logs().iter().any(|l| l.contains("\"charter_created\"")));
}

#[test]
#[should_panic(expected = "ERR_TAKEN")]
fn taken_after_success() {
    let mut f = factory();
    testing_env!(ctx("alice.testnet", NearToken::from_near(1), 100).build());
    f.create_charter("shop".into(), None, None);
    with_result("charters.testnet", true);
    f.on_created(acc("shop.charters.testnet"), acc("alice.testnet"), U128(1), U64(DEFAULT_POLICY_DELAY_NS), None);
    testing_env!(ctx("bob.testnet", NearToken::from_near(1), 100).build());
    f.create_charter("shop".into(), None, None);
}

#[test]
fn failure_refunds_and_frees_name() {
    let mut f = factory();
    testing_env!(ctx("alice.testnet", NearToken::from_near(1), 100).build());
    f.create_charter("shop".into(), None, None);
    with_result("charters.testnet", false);
    assert!(!f.on_created(acc("shop.charters.testnet"), acc("alice.testnet"), U128(NearToken::from_near(1).as_yoctonear()), U64(DEFAULT_POLICY_DELAY_NS), None));
    assert!(!f.is_charter(acc("shop.charters.testnet")));
    assert!(get_logs().iter().any(|l| l.contains("\"charter_failed\"")));
    // the name is free again
    testing_env!(ctx("bob.testnet", NearToken::from_near(1), 100).build());
    f.create_charter("shop".into(), None, None);
}

#[test]
#[should_panic(expected = "ERR_OWNER_LIMIT")]
fn owner_limit() {
    let mut f = factory();
    for i in 0..=MAX_PER_OWNER {
        let name = format!("shop{i}");
        testing_env!(ctx("alice.testnet", NearToken::from_near(1), 100).build());
        f.create_charter(name.clone(), None, None);
        with_result("charters.testnet", true);
        f.on_created(format!("{name}.charters.testnet").parse().unwrap(), acc("alice.testnet"), U128(1), U64(DEFAULT_POLICY_DELAY_NS), None);
    }
}

#[test]
fn list_paging() {
    let mut f = factory();
    for (i, who) in ["a1.testnet", "a2.testnet", "a3.testnet"].iter().enumerate() {
        let name = format!("c{i}");
        testing_env!(ctx(who, NearToken::from_near(1), 100).build());
        f.create_charter(name.clone(), None, None);
        with_result("charters.testnet", true);
        f.on_created(format!("{name}.charters.testnet").parse().unwrap(), acc(who), U128(1), U64(DEFAULT_POLICY_DELAY_NS), None);
    }
    assert_eq!(f.list(Some(1), Some(1))[0].0, acc("c1.charters.testnet"));
    assert_eq!(f.list(Some(2), Some(10)).len(), 1);
    assert_eq!(f.list(Some(9), None).len(), 0);
}

fn created(f: &mut Factory, who: &str, name: &str, delay: Option<u64>, dao: Option<&str>) -> String {
    testing_env!(ctx(who, NearToken::from_near(1), 100).build());
    f.create_charter(name.into(), delay.map(U64), dao.map(acc));
    get_logs().join("\n")
}

#[test]
fn default_timelock_is_24h_and_passed_to_oath_with_setup_window() {
    let mut f = factory();
    let logs = created(&mut f, "alice.testnet", "shop", None, None);
    assert!(logs.contains(&format!("\"policy_delay_ns\":\"{DEFAULT_POLICY_DELAY_NS}\"")), "{logs}");
    assert_eq!(DEFAULT_POLICY_DELAY_NS, 86_400_000_000_000);
    let c = f.get_config();
    assert_eq!(c.default_policy_delay_ns.0, DEFAULT_POLICY_DELAY_NS);
    assert_eq!(c.min_policy_delay_ns.0, 600_000_000_000);
    with_result("charters.testnet", true);
    f.on_created(acc("shop.charters.testnet"), acc("alice.testnet"), U128(1), U64(DEFAULT_POLICY_DELAY_NS), None);
    let ch = f.get_charter(acc("shop.charters.testnet")).unwrap();
    assert_eq!(ch.policy_delay_ns.0, DEFAULT_POLICY_DELAY_NS);
    assert_eq!(ch.dao, None);
}

#[test]
fn custom_delay_and_dao_are_recorded() {
    let mut f = factory();
    let logs = created(&mut f, "alice.testnet", "shop", Some(MIN_POLICY_DELAY_NS), Some("dao.testnet"));
    assert!(logs.contains("\"dao\":\"dao.testnet\""), "{logs}");
    with_result("charters.testnet", true);
    assert!(f.on_created(acc("shop.charters.testnet"), acc("alice.testnet"), U128(1), U64(MIN_POLICY_DELAY_NS), Some(acc("dao.testnet"))));
    let ch = f.get_charter(acc("shop.charters.testnet")).unwrap();
    assert_eq!(ch.policy_delay_ns.0, MIN_POLICY_DELAY_NS);
    assert_eq!(ch.dao, Some(acc("dao.testnet")));
    assert!(get_logs().iter().any(|l| l.contains("\"charter_created\"") && l.contains("dao.testnet")));
}

#[test]
#[should_panic(expected = "ERR_DELAY")]
fn zero_delay_rejected() { let mut f = factory(); created(&mut f, "alice.testnet", "shop", Some(0), None); }

#[test]
#[should_panic(expected = "ERR_DELAY")]
fn delay_below_min_rejected() { let mut f = factory(); created(&mut f, "alice.testnet", "shop", Some(MIN_POLICY_DELAY_NS - 1), None); }

#[test]
#[should_panic(expected = "ERR_DELAY")]
fn delay_above_max_rejected() { let mut f = factory(); created(&mut f, "alice.testnet", "shop", Some(MAX_POLICY_DELAY_NS + 1), None); }

#[test]
fn delay_bounds_accepted() {
    let mut f = factory();
    created(&mut f, "alice.testnet", "lo", Some(MIN_POLICY_DELAY_NS), None);
    created(&mut f, "alice.testnet", "hi", Some(MAX_POLICY_DELAY_NS), None);
}

#[test]
#[should_panic(expected = "ERR_DAO")]
fn dao_cannot_be_owner() { let mut f = factory(); created(&mut f, "alice.testnet", "shop", None, Some("alice.testnet")); }

#[test]
#[should_panic(expected = "ERR_DAO")]
fn dao_cannot_be_the_charter() { let mut f = factory(); created(&mut f, "alice.testnet", "shop", None, Some("shop.charters.testnet")); }

#[test]
fn delay_bounds_are_the_documented_literals() {
    // 10 min, 24 h and 30 days in ns, written out so a changed constant cannot hide behind itself.
    assert_eq!(MIN_POLICY_DELAY_NS, 600_000_000_000);
    assert_eq!(DEFAULT_POLICY_DELAY_NS, 86_400_000_000_000);
    assert_eq!(MAX_POLICY_DELAY_NS, 2_592_000_000_000_000);
    let mut f = factory();
    created(&mut f, "alice.testnet", "month", Some(2_592_000_000_000_000), None);
}

#[test]
fn charter_is_funded_with_deposit_minus_registry_fee() {
    let mut f = factory();
    testing_env!(ctx("alice.testnet", NearToken::from_millinear(1234), 100).build());
    f.create_charter("shop".into(), None, None).detach();
    let receipts = near_sdk::test_utils::get_created_receipts();
    let batch = receipts.iter().find(|r| r.receiver_id == acc("shop.charters.testnet")).expect("batch receipt");
    let transfers: Vec<u128> = batch.actions.iter().filter_map(|a| match a {
        near_sdk::mock::MockAction::Transfer { deposit, .. } => Some(deposit.as_yoctonear()),
        _ => None,
    }).collect();
    assert_eq!(transfers, vec![NearToken::from_millinear(1224).as_yoctonear()]);
}
