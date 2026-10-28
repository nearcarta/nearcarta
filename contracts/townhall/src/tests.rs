//! Unit tests: the DAO-only rule, the frozen path, caps, deny list, evidence and the role ladder.
use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

fn acc(s: &str) -> AccountId { s.parse().unwrap() }
fn set(pred: &str) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("townhall.test")).predecessor_account_id(acc(pred)).signer_account_id(acc(pred))
        .account_balance(NearToken::from_near(10)).prepaid_gas(Gas::from_tgas(300));
    testing_env!(b.build());
}
fn policy(per: u128, total: u128) -> Policy {
    Policy { per_reward_cap: U128(per), total_cap: U128(total), deny: vec![acc("banned.test")], role_threshold: 2,
        role: "council".into(), proposal_bond: U128(1) }
}
fn hall() -> TownHall { set("dao.test"); TownHall::new(acc("dao.test"), acc("agent.test"), policy(10, 15)) }
fn h(pre: &[u8]) -> String { hex::encode(env::sha256(pre)) }
fn post(t: &mut TownHall, pre: &[u8], amt: u128) { set("dao.test"); t.post_bounty(h(pre), U128(amt)); }
fn reward(t: &mut TownHall, to: &str, pre: &[u8]) { set("agent.test"); let _ = t.agent_reward(acc(to), Base64VecU8(pre.to_vec())); }

#[test]
fn agent_pays_a_posted_bounty_inside_the_rule() {
    let mut t = hall();
    post(&mut t, b"fixed-the-well", 10);
    reward(&mut t, "alice.test", b"fixed-the-well");
    assert_eq!(t.get_state()["spent"], json!("10"));
    assert_eq!(t.get_rewards(acc("alice.test")), 1);
    assert_eq!(t.get_bounties()[0].1.claimed_by, Some(acc("alice.test")));
}

#[test]
#[should_panic(expected = "ERR_FROZEN")]
fn frozen_hall_refuses_rewards() {
    let mut t = hall();
    post(&mut t, b"a", 1);
    set("dao.test"); t.freeze();
    reward(&mut t, "alice.test", b"a");
}

#[test]
#[should_panic(expected = "ERR_FROZEN")]
fn frozen_hall_refuses_role_proposals() {
    let mut t = hall();
    set("dao.test"); t.freeze();
    set("agent.test"); let _ = t.agent_propose_role(acc("alice.test"));
}

#[test]
fn freeze_is_recorded_in_state() { let mut t = hall(); set("dao.test"); t.freeze(); assert_eq!(t.get_state()["frozen"], json!(true)); }

#[test]
#[should_panic(expected = "ERR_NOT_DAO")]
fn only_the_dao_freezes() { let mut t = hall(); set("council.test"); t.freeze(); }

#[test]
#[should_panic(expected = "ERR_NOT_DAO")]
fn only_the_dao_sets_policy() { let mut t = hall(); set("agent.test"); t.set_policy(policy(1_000, 1_000)); }

#[test]
#[should_panic(expected = "ERR_NOT_AGENT")]
fn only_the_agent_pays() { let mut t = hall(); post(&mut t, b"a", 1); set("mallory.test"); let _ = t.agent_reward(acc("x.test"), Base64VecU8(b"a".to_vec())); }

#[test]
#[should_panic(expected = "ERR_OATH_PER_REWARD_CAP")]
fn over_per_reward_cap_refused() { let mut t = hall(); post(&mut t, b"a", 11); reward(&mut t, "alice.test", b"a"); }

#[test]
#[should_panic(expected = "ERR_OATH_TOTAL_CAP")]
fn total_cap_refused() { let mut t = hall(); post(&mut t, b"a", 10); post(&mut t, b"b", 6); reward(&mut t, "alice.test", b"a"); reward(&mut t, "bob.test", b"b"); }

#[test]
#[should_panic(expected = "ERR_OATH_DENY")]
fn denied_receiver_refused() { let mut t = hall(); post(&mut t, b"a", 1); reward(&mut t, "banned.test", b"a"); }

#[test]
#[should_panic(expected = "ERR_NO_EVIDENCE")]
fn unknown_preimage_refused() { let mut t = hall(); post(&mut t, b"a", 1); reward(&mut t, "alice.test", b"forged"); }

#[test]
#[should_panic(expected = "ERR_ALREADY_CLAIMED")]
fn bounty_pays_once() { let mut t = hall(); post(&mut t, b"a", 1); reward(&mut t, "alice.test", b"a"); reward(&mut t, "bob.test", b"a"); }

#[test]
fn new_policy_version_resets_spent() {
    let mut t = hall();
    post(&mut t, b"a", 10); reward(&mut t, "alice.test", b"a");
    set("dao.test"); assert_eq!(t.set_policy(policy(10, 15)), 2);
    assert_eq!(t.get_state()["spent"], json!("0"));
}

#[test]
#[should_panic(expected = "ERR_NOT_ENOUGH_REPUTATION")]
fn role_needs_threshold_rewards() { let mut t = hall(); post(&mut t, b"a", 1); reward(&mut t, "alice.test", b"a"); set("agent.test"); let _ = t.agent_propose_role(acc("alice.test")); }

#[test]
#[should_panic(expected = "ERR_ALREADY_PROPOSED")]
fn role_proposed_once() {
    let mut t = hall();
    for p in [&b"a"[..], &b"b"[..]] { post(&mut t, p, 1); reward(&mut t, "alice.test", p); }
    set("agent.test"); let _ = t.agent_propose_role(acc("alice.test"));
    let _ = t.agent_propose_role(acc("alice.test"));
}
