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
    f.create_charter("alice".into());
}

#[test]
#[should_panic(expected = "ERR_DEPOSIT_HIGH")]
fn deposit_too_high() {
    let mut f = factory();
    testing_env!(ctx("alice.testnet", NearToken::from_millinear(5001), 100).build());
    f.create_charter("alice".into());
}

#[test]
#[should_panic(expected = "ERR_LOW_GAS")]
fn gas_floor() {
    let mut f = factory();
    testing_env!(ctx("alice.testnet", NearToken::from_near(1), 79).build());
    f.create_charter("alice".into());
}

#[test]
#[should_panic(expected = "ERR_NAME")]
fn bad_name() {
    let mut f = factory();
    testing_env!(ctx("alice.testnet", NearToken::from_near(1), 100).build());
    f.create_charter("a.b".into());
}

#[test]
#[should_panic(expected = "ERR_PENDING")]
fn pending_name_is_reserved() {
    let mut f = factory();
    testing_env!(ctx("alice.testnet", NearToken::from_near(1), 100).build());
    f.create_charter("shop".into());
    testing_env!(ctx("bob.testnet", NearToken::from_near(1), 100).build());
    f.create_charter("shop".into());
}

#[test]
fn success_registers() {
    let mut f = factory();
    testing_env!(ctx("alice.testnet", NearToken::from_near(1), 100).build());
    f.create_charter("shop".into());
    with_result("charters.testnet", true);
    assert!(f.on_created(acc("shop.charters.testnet"), acc("alice.testnet"), U128(NearToken::from_near(1).as_yoctonear())));
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
    f.create_charter("shop".into());
    with_result("charters.testnet", true);
    f.on_created(acc("shop.charters.testnet"), acc("alice.testnet"), U128(1));
    testing_env!(ctx("bob.testnet", NearToken::from_near(1), 100).build());
    f.create_charter("shop".into());
}

#[test]
fn failure_refunds_and_frees_name() {
    let mut f = factory();
    testing_env!(ctx("alice.testnet", NearToken::from_near(1), 100).build());
    f.create_charter("shop".into());
    with_result("charters.testnet", false);
    assert!(!f.on_created(acc("shop.charters.testnet"), acc("alice.testnet"), U128(NearToken::from_near(1).as_yoctonear())));
    assert!(!f.is_charter(acc("shop.charters.testnet")));
    assert!(get_logs().iter().any(|l| l.contains("\"charter_failed\"")));
    // the name is free again
    testing_env!(ctx("bob.testnet", NearToken::from_near(1), 100).build());
    f.create_charter("shop".into());
}

#[test]
#[should_panic(expected = "ERR_OWNER_LIMIT")]
fn owner_limit() {
    let mut f = factory();
    for i in 0..=MAX_PER_OWNER {
        let name = format!("shop{i}");
        testing_env!(ctx("alice.testnet", NearToken::from_near(1), 100).build());
        f.create_charter(name.clone());
        with_result("charters.testnet", true);
        f.on_created(format!("{name}.charters.testnet").parse().unwrap(), acc("alice.testnet"), U128(1));
    }
}

#[test]
fn list_paging() {
    let mut f = factory();
    for (i, who) in ["a1.testnet", "a2.testnet", "a3.testnet"].iter().enumerate() {
        let name = format!("c{i}");
        testing_env!(ctx(who, NearToken::from_near(1), 100).build());
        f.create_charter(name.clone());
        with_result("charters.testnet", true);
        f.on_created(format!("{name}.charters.testnet").parse().unwrap(), acc(who), U128(1));
    }
    assert_eq!(f.list(Some(1), Some(1))[0].0, acc("c1.charters.testnet"));
    assert_eq!(f.list(Some(2), Some(10)).len(), 1);
    assert_eq!(f.list(Some(9), None).len(), 0);
}
