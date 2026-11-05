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
    Oath::new(acc("owner.test"), acc("v1.signer-prod.near"), "toll".into(), 84532,
        "0xABCDEF0000000000000000000000000000000001".into(), "00".into(), vec![TO.to_uppercase().replace("0X", "0x")],
        U128(100), U128(150), U128(10), None, None, None, None)
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

fn arb(chain_id: u64, chain: &str) -> Oath {
    set("owner.test");
    Oath::new(acc("owner.test"), acc("v1.signer-prod.near"), "arb-1".into(), chain_id,
        "0xABCDEF0000000000000000000000000000000001".into(), "00".into(), vec![TO.into()],
        U128(100), U128(150), U128(10), Some(chain.into()), None, None, None)
}

#[test]
fn default_verify_chain_is_base() { assert_eq!(toll().policy()["verify_chain"], "Base"); }

#[test]
fn arbitrum_chain_instance() { let o = arb(421614, "Arbitrum"); assert_eq!(o.policy()["verify_chain"], "Arbitrum"); assert_eq!(o.policy()["chain_id"], 421614); }

#[test]
#[should_panic(expected = "chain_id does not belong to verify_chain")]
fn chain_id_must_match_verify_chain() { let _ = arb(84532, "Arbitrum"); }

#[test]
#[should_panic(expected = "verify_chain not supported")]
fn non_evm_or_unknown_verify_chain_refused() { let _ = arb(421614, "Solana"); }

// Real MPC proofs from v1.signer-prod.near (domain 3): the payload this contract rebuilds must hash
// to the payload_hash the network signed.
#[test]
fn payload_matches_real_base_proof() {
    let b = crate::proof_payload(6, "0x86bab7a98f872cec2e60ac2a549d1154f7cb330b9aeb073ff191b57a42ef9054",
        "0xa800c2bbcf63fc22ef17020b725efd17b681682b7fa913c2d7603055c03b44e3");
    assert_eq!(hex::encode(near_sdk::env::sha256(&b)), "d8c7513c35354b6184108ad58a63430bf88934460f30fc1420ffa3d595506025");
}

#[test]
fn payload_matches_real_arbitrum_proof() {
    let b = crate::proof_payload(7, "ee42361cea2ff228cc1703e91188acc8b39c412bb2bf09335c72169be7139ed7",
        "0x64ee2745f7637d236ceaa471fbebb4fd98621184acba8360f1595d49df73455c");
    assert_eq!(hex::encode(near_sdk::env::sha256(&b)), "6e6b1eb1dd56ee291e591de942f006b4ce40eb2476ba2456f1132ba77b9d1f48");
}

// ---------------- v3: ERC-20 (USDC) payouts and DAO-only unfreeze ----------------
const USDC: &str = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
/// USDC toll: cap 1 USDC per tx, budget 3 USDC (6 decimals), DAO set.
fn usdc() -> Oath {
    set("owner.test");
    Oath::new(acc("owner.test"), acc("v1.signer-prod.near"), "usdc-1".into(), 84532,
        "0xABCDEF0000000000000000000000000000000001".into(), "00".into(), vec![TO.into()],
        U128(1_000_000), U128(3_000_000), U128(10), None, Some(USDC.into()), Some(acc("dao.test")), None)
}

#[test]
fn erc20_calldata_matches_abi_encoding() {
    assert_eq!(hx(&erc20_transfer_data(TO, 1_000_000)),
        "a9059cbb000000000000000000000000111111111111111111111111111111111111111100000000000000000000000000000000000000000000000000000000000f4240");
}

#[test]
fn usdc_payout_hash_matches_viem() {
    // viem serializeTransaction({eip1559, chainId 84532, nonce 0, prio 1, maxFee 5, gas 60000, to USDC, value 0, data transfer(TO, 1 USDC)})
    let mut o = usdc();
    let _ = o.pay(TO.into(), U128(1_000_000), U128(5), U128(1), 60_000);
    let rec = o.get_tx(0).unwrap();
    assert_eq!(rec.unsigned_hash, "644cc0d7af5fb45075ef793486cd85964ceb7381f09063badf26e09c12c0cc10");
    assert_eq!((rec.to.as_str(), rec.value.0), (TO, 1_000_000));
    assert_eq!(o.policy()["asset"]["erc20"], json!(USDC.to_lowercase()));
}

#[test]
#[should_panic(expected = "REFUSED: value over per-tx cap")]
fn usdc_over_cap_refused() { let mut o = usdc(); let _ = o.pay(TO.into(), U128(1_000_001), U128(5), U128(1), 60_000); }

#[test]
#[should_panic(expected = "REFUSED: recipient not in oath allowlist")]
fn usdc_recipient_outside_allowlist_refused() { let mut o = usdc(); let _ = o.pay(OTHER.into(), U128(1), U128(5), U128(1), 60_000); }

#[test]
#[should_panic(expected = "REFUSED: budget exhausted")]
fn usdc_budget_counts_token_units() {
    let mut o = usdc();
    for _ in 0..3 { let _ = o.pay(TO.into(), U128(1_000_000), U128(5), U128(1), 60_000); }
    let _ = o.pay(TO.into(), U128(1), U128(5), U128(1), 60_000);
}

#[test]
#[should_panic(expected = "REFUSED: gas limit over ERC-20 cap")]
fn usdc_gas_over_cap_refused() { let mut o = usdc(); let _ = o.pay(TO.into(), U128(1), U128(5), U128(1), 100_001); }

#[test]
#[should_panic(expected = "only dao unfreezes")]
fn with_a_dao_the_owner_cannot_unfreeze() { let mut o = usdc(); o.freeze(); o.unfreeze(); }

#[test]
fn dao_can_freeze_and_unfreeze() {
    let mut o = usdc();
    set("dao.test"); o.freeze();
    assert_eq!(o.policy()["frozen"], json!(true));
    o.unfreeze();
    set("owner.test");
    let _ = o.pay(TO.into(), U128(1), U128(5), U128(1), 60_000);
    assert_eq!(spent(&o), "1");
}

#[test]
#[should_panic(expected = "token must be a 0x address")]
fn bad_token_address_refused() {
    set("owner.test");
    let _ = Oath::new(acc("owner.test"), acc("v1.signer-prod.near"), "x".into(), 84532, "0x01".into(), "00".into(), vec![],
        U128(1), U128(1), U128(1), None, Some("0x1234".into()), None, None);
}

// ---------------- v4: the visitor gate (pay_for after the guest's own charter paid) ----------------
fn gate_cfg() -> Gate {
    Gate { factories: vec![acc("factory.test"), acc("old-factory.test")], payee: acc("cafe.test"), fee: U128(10), memo: "toll:base".into(),
           evm_to: TO.to_uppercase().replace("0X", "0x"), evm_value: U128(7), max_fee_per_gas: U128(5), max_priority_fee_per_gas: U128(1) }
}
fn gated() -> Oath {
    set("owner.test");
    Oath::new(acc("owner.test"), acc("v1.signer-prod.near"), "gate-1".into(), 84532,
        "0xABCDEF0000000000000000000000000000000001".into(), "00".into(), vec![TO.into()],
        U128(10), U128(20), U128(10), None, None, None, Some(gate_cfg()))
}
fn paid() -> Value { json!({"shop":"toll","clause_id":"pay","receiver":"cafe.test","amount":"10","status":"confirmed","asset":"Native","memo":"toll:base"}) }
fn visit(o: &mut Oath, id: u64, a: Value) -> Promise {
    set("toll.test");
    o.on_visit_checked(acc("guest-1.factory.test"), U64(id), acc("guest.test"), Ok(true), Ok(Some(a)))
}
fn with(k: &str, v: Value) -> Value { let mut a = paid(); a[k] = v; a }

#[test]
fn paid_charter_action_opens_the_gate_with_the_fixed_payout() {
    let mut o = gated();
    let _ = visit(&mut o, 3, paid());
    let rec = o.get_tx(0).unwrap();
    assert_eq!((rec.status.as_str(), rec.to.as_str(), rec.value.0), ("signing", TO, 7));
    let v = o.get_visit(0).unwrap();
    assert_eq!((v.charter.as_str(), v.action_id, v.by.as_str()), ("guest-1.factory.test", 3, "guest.test"));
    assert_eq!(o.visit_nonce(acc("guest-1.factory.test"), U64(3)), Some(0));
    assert_eq!(spent(&o), "7");
}

#[test]
fn gate_payout_hash_equals_the_owner_paying_the_same_tx() {
    let mut a = gated(); let _ = visit(&mut a, 0, paid());
    let mut b = gated(); set("owner.test"); let _ = b.pay(TO.into(), U128(7), U128(5), U128(1), 21000);
    assert_eq!(a.get_tx(0).unwrap().unsigned_hash, b.get_tx(0).unwrap().unsigned_hash);
}

#[test]
#[should_panic(expected = "REFUSED: this charter action already opened the gate")]
fn one_charter_action_opens_the_gate_once() { let mut o = gated(); let _ = visit(&mut o, 1, paid()); let _ = visit(&mut o, 1, paid()); }

#[test]
#[should_panic(expected = "REFUSED: this charter action already opened the gate")]
fn pay_for_refuses_a_used_action_before_any_call() {
    let mut o = gated(); let _ = visit(&mut o, 1, paid());
    set("guest.test"); let _ = o.pay_for(acc("guest-1.factory.test"), U64(1));
}

#[test]
fn another_action_of_the_same_charter_opens_it_again() {
    let mut o = gated(); let _ = visit(&mut o, 1, paid()); let _ = visit(&mut o, 2, paid());
    assert_eq!(o.policy()["next_nonce"], json!(2)); assert_eq!(spent(&o), "14");
}

#[test]
#[should_panic(expected = "REFUSED: budget exhausted")]
fn gate_payouts_count_against_the_oath_budget() { let mut o = gated(); for i in 0..3 { let _ = visit(&mut o, i, paid()); } }

#[test]
#[should_panic(expected = "REFUSED: not a charter from the gate's factories")]
fn non_factory_account_refused() {
    let mut o = gated(); set("toll.test");
    let _ = o.on_visit_checked(acc("fake.test"), U64(0), acc("guest.test"), Ok(false), Ok(Some(paid())));
}

#[test]
#[should_panic(expected = "REFUSED: not a charter from the gate's factories")]
fn failed_factory_read_refused() {
    let mut o = gated(); set("toll.test");
    let _ = o.on_visit_checked(acc("fake.test"), U64(0), acc("guest.test"), Err(PromiseError::Failed), Ok(Some(paid())));
}

#[test]
#[should_panic(expected = "REFUSED: the charter has no such action")]
fn missing_action_refused() {
    let mut o = gated(); set("toll.test");
    let _ = o.on_visit_checked(acc("guest-1.factory.test"), U64(9), acc("guest.test"), Ok(true), Ok(None));
}

#[test]
#[should_panic(expected = "REFUSED: the action did not pay the toll payee")]
fn action_to_another_receiver_refused() { let mut o = gated(); let _ = visit(&mut o, 0, with("receiver", json!("books.test"))); }

#[test]
#[should_panic(expected = "REFUSED: the toll is paid in NEAR")]
fn ft_action_refused() { let mut o = gated(); let _ = visit(&mut o, 0, with("asset", json!({"Ft": {"token": "usdc.test"}}))); }

#[test]
#[should_panic(expected = "REFUSED: the action paid less than the toll")]
fn underpaid_action_refused() { let mut o = gated(); let _ = visit(&mut o, 0, with("amount", json!("9"))); }

#[test]
fn fee_is_a_minimum() { let mut o = gated(); let _ = visit(&mut o, 0, with("amount", json!("11"))); assert_eq!(spent(&o), "7"); }

#[test]
#[should_panic(expected = "REFUSED: the action is not a toll payment")]
fn other_memo_refused() { let mut o = gated(); let _ = visit(&mut o, 0, with("memo", json!("coffee"))); }

#[test]
#[should_panic(expected = "REFUSED: the action is not a toll payment")]
fn no_memo_refused() { let mut o = gated(); let _ = visit(&mut o, 0, with("memo", Value::Null)); }

#[test]
#[should_panic(expected = "REFUSED: the charter has not paid (action not confirmed)")]
fn submitted_but_unsettled_action_refused() { let mut o = gated(); let _ = visit(&mut o, 0, with("status", json!("submitted"))); }

#[test]
#[should_panic(expected = "REFUSED: the charter has not paid (action not confirmed)")]
fn failed_transfer_refused() { let mut o = gated(); let _ = visit(&mut o, 0, with("status", json!("failed_released"))); }

#[test]
#[should_panic(expected = "REFUSED: oath frozen")]
fn frozen_gate_refuses_pay_for() { let mut o = gated(); o.freeze(); set("guest.test"); let _ = o.pay_for(acc("guest-1.factory.test"), U64(0)); }

#[test]
#[should_panic(expected = "REFUSED: oath frozen")]
fn frozen_while_reading_refuses_in_the_callback() { let mut o = gated(); o.freeze(); let _ = visit(&mut o, 0, paid()); }

#[test]
#[should_panic(expected = "REFUSED: this toll has no visitor gate")]
fn toll_without_gate_refuses_pay_for() { let mut o = toll(); set("guest.test"); let _ = o.pay_for(acc("guest-1.factory.test"), U64(0)); }

#[test]
#[should_panic(expected = "attach at least 150 Tgas")]
fn pay_for_needs_gas() {
    let mut o = gated();
    testing_env!(ctx("guest.test").prepaid_gas(Gas::from_tgas(149)).build());
    let _ = o.pay_for(acc("guest-1.factory.test"), U64(0));
}

#[test]
fn anyone_may_call_pay_for() { let mut o = gated(); set("guest.test"); let _ = o.pay_for(acc("guest-1.factory.test"), U64(0)); assert_eq!(o.policy()["next_nonce"], json!(0)); }

#[test]
#[should_panic(expected = "gate evm_to must be in allow_to")]
fn gate_recipient_must_be_allowlisted() {
    set("owner.test"); let mut g = gate_cfg(); g.evm_to = OTHER.into();
    let _ = Oath::new(acc("owner.test"), acc("v1.signer-prod.near"), "g".into(), 84532, "0x01".into(), "00".into(), vec![TO.into()],
        U128(10), U128(20), U128(10), None, None, None, Some(g));
}

#[test]
#[should_panic(expected = "gate evm_value over per-tx cap")]
fn gate_value_within_cap() {
    set("owner.test"); let mut g = gate_cfg(); g.evm_value = U128(11);
    let _ = Oath::new(acc("owner.test"), acc("v1.signer-prod.near"), "g".into(), 84532, "0x01".into(), "00".into(), vec![TO.into()],
        U128(10), U128(20), U128(10), None, None, None, Some(g));
}

#[test]
#[should_panic(expected = "gate fees over cap")]
fn gate_fees_within_cap() {
    set("owner.test"); let mut g = gate_cfg(); g.max_fee_per_gas = U128(11);
    let _ = Oath::new(acc("owner.test"), acc("v1.signer-prod.near"), "g".into(), 84532, "0x01".into(), "00".into(), vec![TO.into()],
        U128(10), U128(20), U128(10), None, None, None, Some(g));
}

#[test]
#[should_panic(expected = "gate is for native-coin tolls")]
fn gate_not_for_token_tolls() {
    set("owner.test");
    let _ = Oath::new(acc("owner.test"), acc("v1.signer-prod.near"), "g".into(), 84532, "0x01".into(), "00".into(), vec![TO.into()],
        U128(10), U128(20), U128(10), None, Some(USDC.into()), None, Some(gate_cfg()));
}

#[test]
fn policy_shows_the_gate() { let o = gated(); assert_eq!(o.policy()["gate"]["memo"], "toll:base"); assert_eq!(o.policy()["gate"]["evm_to"], TO); }

// ---------------- v5: a fixed list of factories ----------------
#[test]
fn charter_factory_is_the_parent_account_on_the_list() {
    let g = gate_cfg();
    assert_eq!(charter_factory(&g, &acc("guest-1.factory.test")).map(|a| a.to_string()), Some("factory.test".into()));
    assert_eq!(charter_factory(&g, &acc("guest-2.old-factory.test")).map(|a| a.to_string()), Some("old-factory.test".into()));
    assert_eq!(charter_factory(&g, &acc("guest.other.test")), None);
    assert_eq!(charter_factory(&g, &acc("a.guest-1.factory.test")), None); // grandchild: parent is guest-1.factory.test
    assert_eq!(charter_factory(&g, &acc("factory.test")), None);
}

#[test]
fn pay_for_accepts_a_charter_from_any_listed_factory() {
    for c in ["guest-2.old-factory.test", "guest-1.factory.test"] {
        let mut o = gated(); set("guest.test"); let _ = o.pay_for(acc(c), U64(0));
    }
}

#[test]
#[should_panic(expected = "REFUSED: not a charter from the gate's factories")]
fn pay_for_refuses_an_unlisted_factory_before_any_call() { let mut o = gated(); set("guest.test"); let _ = o.pay_for(acc("guest.other.test"), U64(0)); }

#[test]
fn visit_from_an_older_factory_opens_the_gate() {
    let mut o = gated(); set("toll.test");
    let _ = o.on_visit_checked(acc("guest-2.old-factory.test"), U64(4), acc("guest.test"), Ok(true), Ok(Some(paid())));
    assert_eq!(o.get_visit(0).unwrap().charter.as_str(), "guest-2.old-factory.test");
}

#[test]
#[should_panic(expected = "gate needs 1 to 8 factories")]
fn gate_without_factories_refused() {
    set("owner.test");
    let mut g = gate_cfg(); g.factories = vec![];
    let _ = Oath::new(acc("owner.test"), acc("v1.signer-prod.near"), "gate-1".into(), 84532,
        "0xABCDEF0000000000000000000000000000000001".into(), "00".into(), vec![TO.into()],
        U128(10), U128(20), U128(10), None, None, None, Some(g));
}

#[test]
fn policy_shows_the_factory_list() {
    let o = gated();
    assert_eq!(o.policy()["gate"]["factories"], json!(["factory.test", "old-factory.test"]));
}

#[test]
fn close_is_owner_only_and_needs_one_yocto() {
    let mut o = toll();
    let mut b = ctx("owner.test"); b.attached_deposit(NearToken::from_yoctonear(1)); testing_env!(b.build());
    let _ = o.close();
}
#[test]
#[should_panic(expected = "only owner")]
fn close_by_stranger_panics() {
    let mut o = toll();
    let mut b = ctx("evil.test"); b.attached_deposit(NearToken::from_yoctonear(1)); testing_env!(b.build());
    let _ = o.close();
}
#[test]
#[should_panic]
fn close_without_yocto_panics() {
    let mut o = toll();
    set("owner.test");
    let _ = o.close();
}
