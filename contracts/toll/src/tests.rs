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
        U128(100), U128(150), U128(10), None, None, None)
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
    Oath::new(acc("owner.test"), acc("v1.signer-prod.testnet"), "arb-1".into(), chain_id,
        "0xABCDEF0000000000000000000000000000000001".into(), "00".into(), vec![TO.into()],
        U128(100), U128(150), U128(10), Some(chain.into()), None, None)
}

#[test]
fn default_verify_chain_is_base() { assert_eq!(toll().policy()["verify_chain"], "Base"); }

#[test]
fn arbitrum_sepolia_instance() { let o = arb(421614, "Arbitrum"); assert_eq!(o.policy()["verify_chain"], "Arbitrum"); assert_eq!(o.policy()["chain_id"], 421614); }

#[test]
#[should_panic(expected = "chain_id does not belong to verify_chain")]
fn chain_id_must_match_verify_chain() { let _ = arb(84532, "Arbitrum"); }

#[test]
#[should_panic(expected = "verify_chain not supported")]
fn non_evm_or_unknown_verify_chain_refused() { let _ = arb(421614, "Solana"); }

// Real MPC proofs from v1.signer-prod.testnet (domain 3): the payload this contract rebuilds must hash
// to the payload_hash the network signed.
#[test]
fn payload_matches_real_base_sepolia_proof() {
    let b = crate::proof_payload(6, "0x86bab7a98f872cec2e60ac2a549d1154f7cb330b9aeb073ff191b57a42ef9054",
        "0xa800c2bbcf63fc22ef17020b725efd17b681682b7fa913c2d7603055c03b44e3");
    assert_eq!(hex::encode(near_sdk::env::sha256(&b)), "d8c7513c35354b6184108ad58a63430bf88934460f30fc1420ffa3d595506025");
}

#[test]
fn payload_matches_real_arbitrum_sepolia_proof() {
    let b = crate::proof_payload(7, "ee42361cea2ff228cc1703e91188acc8b39c412bb2bf09335c72169be7139ed7",
        "0x64ee2745f7637d236ceaa471fbebb4fd98621184acba8360f1595d49df73455c");
    assert_eq!(hex::encode(near_sdk::env::sha256(&b)), "6e6b1eb1dd56ee291e591de942f006b4ce40eb2476ba2456f1132ba77b9d1f48");
}

// ---------------- v3: ERC-20 (USDC) payouts and DAO-only unfreeze ----------------
const USDC: &str = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
/// USDC toll: cap 1 USDC per tx, budget 3 USDC (6 decimals), DAO set.
fn usdc() -> Oath {
    set("owner.test");
    Oath::new(acc("owner.test"), acc("v1.signer-prod.testnet"), "usdc-1".into(), 84532,
        "0xABCDEF0000000000000000000000000000000001".into(), "00".into(), vec![TO.into()],
        U128(1_000_000), U128(3_000_000), U128(10), None, Some(USDC.into()), Some(acc("dao.test")))
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
    let _ = Oath::new(acc("owner.test"), acc("v1.signer-prod.testnet"), "x".into(), 84532, "0x01".into(), "00".into(), vec![],
        U128(1), U128(1), U128(1), None, Some("0x1234".into()), None);
}
