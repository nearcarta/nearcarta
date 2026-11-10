//! Visitor crossings: any Base address, the visitor's row budget, and one refund.
//! There is no contract-wide amount cap: the row is the only amount authority.
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
    deposit("owner.test", 1);
    o.set_price(acc("board.test"), U128(5), U128(2), vec![Split { account: acc("contributor.test"), bps: 2500 }], false,
        "0x3333333333333333333333333333333333333333".into(), U128(1000), near_sdk::json_types::U64(0));
}
fn open(o: &mut Oath, owner: &str, action: u64, asset: &str, to: &str, amount: u128, budget: u128) -> u64 {
    deposit("board.test", 5);
    o.cross(acc(owner), action, "base".into(), asset.into(), to.into(), U128(amount), U128(budget))
}

#[test]
fn policy_reports_no_contract_wide_amount_cap() {
    let o = toll();
    assert_eq!(o.policy()["allow_to"], json!([]));
    assert_eq!(o.policy()["recipients"], json!("visitor"));
    assert_eq!(o.policy()["path"], json!("base-1"));
    // Null, not a number: a client must not turn this into a cap the visitor did not set.
    assert!(o.policy()["max_per_tx"].is_null());
    assert!(o.policy()["budget"].is_null());
}

/// The live v7 limit was 0.00001 ETH and 10 USDC, enforced contract-wide. A visitor
/// whose own row allowed more was refused. The row budget is now the only amount rule.
#[test]
fn an_amount_over_the_old_contract_cap_is_accepted_when_the_row_allows_it() {
    let mut o = toll();
    price(&mut o);
    let native = open(&mut o, "visitor.test", 1, "native", OTHER, 50_000_000_000_000, 50_000_000_000_000);
    assert_eq!(o.get_order(native).unwrap().amount.0, 50_000_000_000_000);
    let usdc = open(&mut o, "visitor.test", 2, "usdc", OTHER, 250_000_000, 250_000_000);
    assert_eq!(o.get_order(usdc).unwrap().amount.0, 250_000_000);
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
#[should_panic(expected = "REFUSED: value over the row budget")]
fn the_row_budget_is_the_only_amount_cap() {
    let mut o = toll();
    price(&mut o);
    // Well over the retired 0.00001 ETH contract cap, but over this row's own budget.
    let _ = open(&mut o, "visitor.test", 1, "native", OTHER, 50_000_000_000_001, 50_000_000_000_000);
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
    let mut o = toll();
    deposit("mallory.test", 1);
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

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn unfreezing_needs_a_full_access_key() {
    let mut o = toll();
    o.freeze();
    set("owner.test");
    o.unfreeze();
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn changing_the_price_needs_a_full_access_key() {
    let mut o = toll();
    set("owner.test");
    o.set_price(acc("board.test"), U128(5), U128(2), vec![], false,
        "0x3333333333333333333333333333333333333333".into(), U128(1000), near_sdk::json_types::U64(0));
}

#[test]
fn an_order_reports_its_open_time_as_a_string() {
    let mut o = toll();
    price(&mut o);
    let id = open(&mut o, "alice.test", 1, "native", OTHER, 10, 100);
    let v = serde_json::to_value(o.get_order(id).unwrap()).unwrap();
    assert!(v["opened_at"].is_string());
    deposit("owner.test", 1);
    o.unfreeze();
}

/// The surplus is the owner's, but the storage stake and the held service deposits come out
/// of the same balance. A payout that would leave either uncovered is refused.
#[test]
fn a_surplus_payout_cannot_take_the_stake_or_held_deposits() {
    let mut o = toll();
    price(&mut o);
    let _ = open(&mut o, "visitor.test", 1, "native", OTHER, 10, 10);
    let price_b = env::storage_byte_cost().as_yoctonear();
    let usage = env::storage_usage() as u128;
    o.surplus = 1_000;
    let mut b = ctx("owner.test");
    b.attached_deposit(NearToken::from_yoctonear(1)).storage_usage(usage as u64)
        // The attached yocto lands in the balance too, so this leaves exactly 999 spare.
        .account_balance(NearToken::from_yoctonear(usage * price_b + o.service_held + 998));
    testing_env!(b.build());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| { let _ = o.withdraw_surplus(U128(1_000)); }));
    assert!(r.is_err(), "999 yocto of spare cannot pay a 1000 yocto surplus");
    o.surplus = 999;
    let _ = o.withdraw_surplus(U128(999));
}

/// A crossing whose records cost more than the spare is refused, so the deposits already
/// held stay refundable.
#[test]
fn a_crossing_cannot_stake_away_the_held_deposits() {
    let mut o = toll();
    price(&mut o);
    let price_b = env::storage_byte_cost().as_yoctonear();
    let mut b = ctx("board.test");
    b.attached_deposit(NearToken::from_yoctonear(5));
    testing_env!(b.build());
    let usage = env::storage_usage() as u128;
    b.account_balance(NearToken::from_yoctonear(usage * price_b + 5 + 50 * price_b));
    testing_env!(b.build());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        o.cross(acc("visitor.test"), 1, "base".into(), "native".into(), OTHER.into(), U128(10), U128(10));
    }));
    assert!(r.is_err(), "an order record does not fit in 50 spare bytes");
}
