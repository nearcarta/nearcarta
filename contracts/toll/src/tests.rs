//! Visitor crossings: any Base address, the contract cap, the row budget, and one refund.
use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, Gas, NearToken};
use serde_json::json;

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
    Oath::new(acc("owner.test"), acc("v1.signer-prod.near"), "base-1".into(), 84532,
        "0xABCDEF0000000000000000000000000000000001".into(), "00".into(), vec![],
        U128(100), U128(150), U128(10), None, None, None, None)
}
fn deposit(pred: &str, yocto: u128) {
    let mut b = ctx(pred);
    b.attached_deposit(NearToken::from_yoctonear(yocto));
    testing_env!(b.build());
}
fn price(o: &mut Oath) {
    set("owner.test");
    o.set_price(acc("board.test"), U128(5), U128(2), vec![Split { account: acc("contributor.test"), bps: 2500 }], false,
        "0x3333333333333333333333333333333333333333".into(), U128(1000), 0);
}
fn open(o: &mut Oath, owner: &str, action: u64, asset: &str, to: &str, amount: u128, budget: u128) -> u64 {
    deposit("board.test", 5);
    o.cross(acc(owner), action, "base".into(), asset.into(), to.into(), U128(amount), U128(budget))
}

#[test]
fn policy_has_no_allow_list() {
    let o = toll();
    assert_eq!(o.policy()["allow_to"], json!([]));
    assert_eq!(o.policy()["recipients"], json!("visitor"));
    assert_eq!(o.policy()["path"], json!("base-1"));
}

#[test]
#[should_panic(expected = "allow_to must be empty")]
fn an_allow_list_is_refused_at_init() {
    set("owner.test");
    let _ = Oath::new(acc("owner.test"), acc("v1.signer-prod.near"), "base-1".into(), 8453,
        "0xabcdef0000000000000000000000000000000001".into(), "00".into(), vec![TO.into()],
        U128(100), U128(150), U128(10), None, None, None, None);
}

#[test]
fn close_is_owner_only_and_needs_one_yocto() {
    let mut o = toll();
    let mut b = ctx("owner.test");
    b.attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(b.build());
    let _ = o.close();
}

#[test]
#[should_panic(expected = "only owner")]
fn close_by_stranger_panics() {
    let mut o = toll();
    let mut b = ctx("evil.test");
    b.attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(b.build());
    let _ = o.close();
}

#[test]
#[should_panic]
fn close_without_yocto_panics() {
    let mut o = toll();
    set("owner.test");
    let _ = o.close();
}

#[test]
fn two_rows_derive_two_paths_and_do_not_share_a_nonce() {
    let mut o = toll();
    price(&mut o);
    let a = open(&mut o, "visitor.test", 1, "native", OTHER, 10, 50);
    let b = open(&mut o, "other.test", 1, "native", TO, 10, 50);
    assert_eq!(o.address_of(acc("visitor.test"), "base".into())["path"], json!("row:visitor.test:base"));
    assert_eq!(o.address_of(acc("other.test"), "base".into())["path"], json!("row:other.test:base"));
    assert!(o.address_of(acc("visitor.test"), "base".into())["address"].is_null());
    set("visitor.test");
    let _ = o.sign_cross(a);
    set("other.test");
    let _ = o.sign_cross(b);
    let left = o.get_tx(0).unwrap();
    let right = o.get_tx(1).unwrap();
    assert_eq!(left.path.as_deref(), Some("row:visitor.test:base"));
    assert_eq!(right.path.as_deref(), Some("row:other.test:base"));
    assert_eq!(left.evm_nonce, Some(0));
    assert_eq!(right.evm_nonce, Some(0));
    assert_eq!(left.to, OTHER);
    assert_eq!(right.to, TO);
    assert_eq!(o.policy()["earned"], json!("0"));
}

#[test]
#[should_panic(expected = "REFUSED: value over per-tx cap")]
fn an_excessive_foreign_value_fails_before_a_signature() {
    let mut o = toll();
    price(&mut o);
    let _ = open(&mut o, "visitor.test", 1, "native", OTHER, 101, 200);
}

#[test]
#[should_panic(expected = "REFUSED: value over the row budget")]
fn a_row_budget_is_enforced() {
    let mut o = toll();
    price(&mut o);
    let _ = open(&mut o, "visitor.test", 1, "native", OTHER, 40, 30);
}

#[test]
fn a_usdc_order_keeps_the_token_and_does_not_sign_until_asked() {
    let mut o = toll();
    price(&mut o);
    let id = open(&mut o, "visitor.test", 7, "usdc", OTHER, 25, 100);
    assert_eq!(o.get_order(id).unwrap().status, "open");
    assert!(o.get_tx(0).is_none());
    set("visitor.test");
    let _ = o.sign_cross(id);
    let tx = o.get_tx(0).unwrap();
    assert_eq!(tx.token_used.as_deref(), Some("0x3333333333333333333333333333333333333333"));
    assert_eq!(tx.to, OTHER);
    assert_eq!(tx.path.as_deref(), Some("row:visitor.test:base"));
}

#[test]
#[should_panic(expected = "REFUSED: this crossing was already opened")]
fn the_same_action_cannot_be_opened_twice() {
    let mut o = toll();
    price(&mut o);
    let _ = open(&mut o, "visitor.test", 3, "native", OTHER, 1, 50);
    let _ = open(&mut o, "visitor.test", 3, "native", TO, 1, 50);
}

#[test]
#[should_panic(expected = "REFUSED: this crossing was already signed")]
fn a_crossing_cannot_be_signed_twice() {
    let mut o = toll();
    price(&mut o);
    let id = open(&mut o, "visitor.test", 4, "native", OTHER, 1, 50);
    set("visitor.test");
    let _ = o.sign_cross(id);
    let _ = o.sign_cross(id);
}

#[test]
fn a_failed_service_deposit_is_refunded_once() {
    let mut o = toll();
    price(&mut o);
    let id = open(&mut o, "visitor.test", 5, "native", OTHER, 1, 50);
    assert_eq!(o.policy()["service_held"], json!("5"));
    set("board.test");
    o.cancel_order(id);
    let _ = o.refund_order(id);
    assert_eq!(o.policy()["service_held"], json!("0"));
    assert_eq!(o.get_order(id).unwrap().status, "refunded");
}

#[test]
#[should_panic(expected = "REFUSED: this deposit was already refunded")]
fn a_second_refund_is_refused() {
    let mut o = toll();
    price(&mut o);
    let id = open(&mut o, "visitor.test", 6, "native", OTHER, 1, 50);
    set("board.test");
    o.cancel_order(id);
    let _ = o.refund_order(id);
    let _ = o.refund_order(id);
}

#[test]
#[should_panic(expected = "REFUSED: service deposits are still held")]
fn close_waits_while_a_deposit_is_held() {
    let mut o = toll();
    price(&mut o);
    let _ = open(&mut o, "visitor.test", 8, "native", OTHER, 1, 50);
    let mut b = ctx("owner.test");
    b.attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(b.build());
    let _ = o.close();
}

#[test]
#[should_panic(expected = "REFUSED: only the board can open a crossing")]
fn a_stranger_cannot_open_a_crossing() {
    let mut o = toll();
    price(&mut o);
    deposit("mallory.test", 5);
    let _ = o.cross(acc("visitor.test"), 1, "base".into(), "native".into(), OTHER.into(), U128(1), U128(50));
}

#[test]
#[should_panic(expected = "REFUSED: recipient must be an EVM address")]
fn a_short_recipient_is_refused() {
    let mut o = toll();
    price(&mut o);
    let _ = open(&mut o, "visitor.test", 1, "native", "0x1234", 1, 50);
}

#[test]
#[should_panic(expected = "attach at least 150 Tgas")]
fn sign_cross_needs_gas_for_the_signer() {
    let mut o = toll();
    price(&mut o);
    let id = open(&mut o, "visitor.test", 1, "native", OTHER, 1, 50);
    let mut b = ctx("visitor.test");
    b.prepaid_gas(Gas::from_tgas(10));
    testing_env!(b.build());
    let _ = o.sign_cross(id);
}

#[test]
#[should_panic(expected = "only owner")]
fn a_stranger_cannot_upgrade() {
    let o = toll();
    set("mallory.test");
    let _ = o.upgrade(near_sdk::json_types::Base64VecU8(vec![1]));
}

#[test]
#[should_panic(expected = "REFUSED: oath frozen")]
fn a_frozen_toll_refuses_a_crossing() {
    let mut o = toll();
    price(&mut o);
    set("owner.test");
    o.freeze();
    let _ = open(&mut o, "visitor.test", 1, "native", OTHER, 1, 50);
}

/// Board v2 (`propose_call_as` at a5d9bfe): a failed hold is `refund_action(owner, action_id)`
/// with the service deposit attached. The top-level `row_owner` argument is the owner.
/// `confirm_hold`, `cancel_hold` and `expire_sent` stay on the board.
#[test]
fn a_failed_crossing_promises_refund_action_for_that_row() {
    let mut o = toll();
    price(&mut o);
    let id = open(&mut o, "visitor.test", 9, "native", OTHER, 1, 50);
    assert_eq!(o.get_order(id).unwrap().row_owner, acc("visitor.test"));
    set("board.test");
    o.cancel_order(id);
    let _ = o.refund_order(id);
    let mut calls: Vec<(String, String, u128)> = vec![];
    for r in near_sdk::test_utils::get_created_receipts() {
        let to = r.receiver_id.to_string();
        for a in r.actions {
            if let near_sdk::mock::MockAction::FunctionCallWeight { method_name, args, attached_deposit, .. } = a {
                let name = String::from_utf8(method_name).unwrap_or_default();
                calls.push((format!("{to} {name}"), String::from_utf8(args).unwrap_or_default(), attached_deposit.as_yoctonear()));
            }
        }
    }
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, "board.test refund_action");
    assert_eq!(calls[0].2, 5);
    let args: serde_json::Value = serde_json::from_str(&calls[0].1).unwrap();
    assert_eq!(args["owner"], json!("visitor.test"));
    assert_eq!(args["action_id"], json!("9"));
    assert!(args.get("row_owner").is_none());
}
