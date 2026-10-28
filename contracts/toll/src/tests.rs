//! Unit tests: every refusal in `pay` (allowlist, per-tx cap, budget, freeze, fee cap, gas) and the
//! reserve/rollback of `spent` around the MPC sign callback.
use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, PromiseResult, RuntimeFeesConfig};
use std::collections::HashMap;

const TO: &str = "0x1111111111111111111111111111111111111111";
const OTHER: &str = "0x2222222222222222222222222222222222222222";
fn acc(s: &str) -> AccountId { s.parse().unwrap() }
fn ctx(pred: &str) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("toll.test")).predecessor_account_id(acc(pred)).signer_account_id(acc(pred))
        .prepaid_gas(Gas::from_tgas(300)).account_balance(NearToken::from_near(10));
    b
}
fn set(pred: &str) { testing_env!(ctx(pred).build()); }
fn toll() -> Oath {
    set("owner.test");
    Oath::new(acc("owner.test"), acc("v1.signer-prod.testnet"), "toll".into(), 84532,
        "0xABCDEF0000000000000000000000000000000001".into(), "00".into(), vec![TO.to_uppercase().replace("0X", "0x")],
        U128(100), U128(150), U128(10))
}
fn pay(o: &mut Oath, to: &str, v: u128) -> Promise { o.pay(to.into(), U128(v), U128(5), U128(1), 21000) }
fn spent(o: &Oath) -> String { o.policy()["spent"].as_str().unwrap().to_string() }

#[test]
fn allowlisted_payment_under_cap_reserves_and_requests_signature() {
    let mut o = toll();
    let _ = pay(&mut o, TO, 60);
    assert_eq!(spent(&o), "60");
    assert_eq!(o.policy()["next_nonce"], json!(1));
    let rec = o.get_tx(0).unwrap();
    assert_eq!((rec.status.as_str(), rec.to.as_str(), rec.value.0), ("signing", TO, 60));
    assert_eq!(rec.unsigned_hash.len(), 64);
}

#[test]
fn agent_key_on_the_contract_account_may_pay() {
    let mut o = toll();
    set("toll.test");
    let _ = pay(&mut o, TO, 1);
    assert_eq!(spent(&o), "1");
}

#[test]
#[should_panic(expected = "caller not owner/agent")]
fn stranger_cannot_pay() { let mut o = toll(); set("mallory.test"); let _ = pay(&mut o, TO, 1); }

#[test]
#[should_panic(expected = "REFUSED: recipient not in oath allowlist")]
fn recipient_outside_allowlist_refused() { let mut o = toll(); let _ = pay(&mut o, OTHER, 1); }

#[test]
fn allowlist_is_case_insensitive() { let mut o = toll(); let _ = pay(&mut o, &TO.to_uppercase().replace("0X", "0x"), 1); assert_eq!(spent(&o), "1"); }

#[test]
#[should_panic(expected = "REFUSED: value over per-tx cap")]
fn over_per_tx_cap_refused() { let mut o = toll(); let _ = pay(&mut o, TO, 101); }

#[test]
fn cap_is_inclusive() { let mut o = toll(); let _ = pay(&mut o, TO, 100); assert_eq!(spent(&o), "100"); }

#[test]
#[should_panic(expected = "REFUSED: budget exhausted")]
fn budget_counts_reserved_spend() { let mut o = toll(); let _ = pay(&mut o, TO, 100); let _ = pay(&mut o, TO, 51); }

#[test]
#[should_panic(expected = "REFUSED: oath frozen")]
fn frozen_refuses() { let mut o = toll(); o.freeze(); let _ = pay(&mut o, TO, 1); }

#[test]
fn unfreeze_reopens() { let mut o = toll(); o.freeze(); o.unfreeze(); let _ = pay(&mut o, TO, 1); }

#[test]
#[should_panic(expected = "only owner")]
fn only_owner_freezes() { let mut o = toll(); set("toll.test"); o.freeze(); }

#[test]
#[should_panic(expected = "REFUSED: gas fee over cap")]
fn fee_over_cap_refused() { let mut o = toll(); let _ = o.pay(TO.into(), U128(1), U128(11), U128(1), 21000); }

#[test]
#[should_panic(expected = "REFUSED: gas fee over cap")]
fn priority_fee_above_max_fee_refused() { let mut o = toll(); let _ = o.pay(TO.into(), U128(1), U128(5), U128(6), 21000); }

#[test]
#[should_panic(expected = "REFUSED: only plain transfers (gas 21000)")]
fn contract_call_gas_refused() { let mut o = toll(); let _ = o.pay(TO.into(), U128(1), U128(5), U128(1), 21001); }

#[test]
fn failed_signature_releases_the_reservation() {
    let mut o = toll();
    let _ = pay(&mut o, TO, 60);
    testing_env!(ctx("toll.test").build(), near_sdk::test_vm_config(), RuntimeFeesConfig::test(), HashMap::default(), vec![PromiseResult::Failed]);
    let rec = o.on_signed(0, U128(5), U128(1), 21000, Err(PromiseError::Failed)).unwrap();
    assert_eq!(rec.status, "failed");
    assert_eq!(spent(&o), "0");
}

#[test]
#[should_panic(expected = "not settleable")]
fn unsigned_tx_cannot_settle() { let mut o = toll(); let _ = pay(&mut o, TO, 1); let _ = o.settle(0, "00".repeat(32)); }
