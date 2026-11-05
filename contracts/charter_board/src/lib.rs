//! One mainnet contract, one row per visitor.
//!
//! The row holds the allowlist, the per-payment cap, the daily budget and count,
//! the time window, the freeze flag, the sealed-rule commitment and the agent
//! public key. The visitor pays for the bytes that row adds to this contract's
//! state, and only those bytes, up to 0.02 NEAR. `close_charter` deletes the row
//! and sends that storage stake plus the unspent balance back to the visitor.
//!
//! `force_close(visitor)` is the owner path: it deletes that visitor's row and
//! sends the same refund to the visitor, so a row left open cannot block `reap`.
//! `reap` (1 yoctoNEAR, contract owner, and only when no row is open) deletes
//! the account. The wasm stake returns to the owner. Gas is the only burn.
//!
//! There is no access key on this account. The agent key is checked as a
//! signature, so one visitor's key cannot spend another visitor's row.
//! `propose` is unchanged. `propose_call` is a second method: the visitor
//! allowlists (receiver, method) pairs with `set_calls`, and that policy
//! lives under the `CALLS` storage key, not inside `STATE`.
//! The refusal strings, the window rule and the sealed-rule commitment match
//! the oath charter (`oath-hidden-v1`, clause id `pay`).

use near_sdk::json_types::{U128, U64};
use near_sdk::{env, require, AccountId, Gas, NearToken, Promise};
use std::collections::{BTreeMap, BTreeSet};

/// 0.02 NEAR. A row whose storage costs more than this is refused.
pub const MAX_ROW_YOCTO: u128 = 20_000_000_000_000_000_000_000;
pub const MAX_RECEIVERS: usize = 8;
const NS_PER_MIN: u64 = 60_000_000_000;
const NS_PER_DAY: u64 = 86_400 * NS_PER_MIN;
const GAS_CALLBACK: Gas = Gas::from_tgas(8);

#[derive(Clone)]
pub struct Rules {
    pub receivers: Vec<AccountId>,
    pub per_action_cap: u128,
    pub daily_budget: u128,
    pub max_actions_per_day: u32,
    pub window_start_min: u16,
    pub window_end_min: u16,
    pub min_amount: u128,
    pub expires_at: u64,
}

#[derive(Clone)]
pub struct RulesIn {
    pub receivers: Vec<AccountId>,
    pub per_action_cap: U128,
    pub daily_budget: U128,
    pub max_actions_per_day: u32,
    pub window_start_min: u16,
    pub window_end_min: u16,
    pub min_amount: U128,
    pub expires_at: U64,
}

#[derive(Clone)]
struct Row {
    rules: Rules,
    agent: [u8; 32],
    frozen: bool,
    seal: Option<[u8; 32]>,
    nonce: u64,
    day: u64,
    spent: u128,
    count: u32,
    balance: u128,
    storage_locked: u128,
}

#[derive(Clone)]
pub struct Reveal {
    pub max_amount: Option<U128>,
    pub deny: Vec<AccountId>,
    pub salt: String,
}

/// One allowed function call. `cap` is the most NEAR that call may attach.
#[derive(Clone)]
struct CallRule {
    receiver: AccountId,
    method: String,
    cap: u128,
}

/// Call rules sit beside the row. They are not part of the v1 STATE blob,
/// so a row opened by the current wasm still loads.
#[derive(Clone)]
struct CallPolicy {
    rules: Vec<CallRule>,
    session_cap: u128,
    session_spent: u128,
}

pub struct CharterView {
    pub owner: AccountId,
    pub receivers: Vec<AccountId>,
    pub per_action_cap: U128,
    pub daily_budget: U128,
    pub max_actions_per_day: u32,
    pub window_start_min: u16,
    pub window_end_min: u16,
    pub min_amount: U128,
    pub expires_at: U64,
    pub frozen: bool,
    pub sealed: bool,
    pub agent: String,
    pub nonce: U64,
    pub balance: U128,
    pub storage_locked: U128,
    pub spent_today: U128,
    pub actions_today: u32,
}

pub struct Config {
    pub owner: AccountId,
    pub rows: u32,
    pub max_row_yocto: U128,
    pub byte_yocto: U128,
}

pub struct Board {
    owner: AccountId,
    rows: BTreeMap<AccountId, Row>,
    keys: BTreeMap<[u8; 32], AccountId>,
    count: u32,
    calls: BTreeMap<AccountId, CallPolicy>,
}

impl Board {
    pub fn new() -> Self {
        Self { owner: env::predecessor_account_id(), rows: BTreeMap::new(), keys: BTreeMap::new(), count: 0, calls: BTreeMap::new() }
    }

    /// Open this visitor's row. `fund` stays as spendable balance.
    /// Deposit past the row's storage and that fund is transferred back.
    pub fn open_charter(&mut self, rules: RulesIn, agent: String, fund: U128) {
        let me = env::predecessor_account_id();
        require!(!self.rows.contains_key(&me), "ERR_EXISTS");
        let rules = rules_from(rules);
        let pk = parse_pk(&agent);
        require!(!self.keys.contains_key(&pk), "ERR_KEY_USED");
        let attached = env::attached_deposit().as_yoctonear();
        let before = self.bytes();
        self.rows.insert(me.clone(), Row {
            rules, agent: pk, frozen: false, seal: None, nonce: 0, day: today(),
            spent: 0, count: 0, balance: 0, storage_locked: 0,
        });
        self.keys.insert(pk, me.clone());
        self.count += 1;
        let cost = self.grew(before);
        if cost == 0 || cost > MAX_ROW_YOCTO || attached < cost + fund.0 {
            self.rows.remove(&me);
            self.keys.remove(&pk);
            self.count -= 1;
            if cost == 0 { env::panic_str("ERR_STORAGE"); }
            if cost > MAX_ROW_YOCTO { env::panic_str("ERR_ROW_TOO_BIG"); }
            env::panic_str("ERR_DEPOSIT");
        }
        let row = self.rows.get_mut(&me).unwrap();
        row.storage_locked = cost;
        row.balance = fund.0;
        refund(&me, attached - cost - fund.0);
    }

    pub fn set_rules(&mut self, rules: RulesIn) {
        let me = env::predecessor_account_id();
        let rules = rules_from(rules);
        let before = self.bytes();
        self.rows.get_mut(&me).expect("ERR_NO_CHARTER").rules = rules;
        self.charge(&me, before);
    }

    pub fn set_frozen(&mut self, frozen: bool) {
        let me = env::predecessor_account_id();
        self.rows.get_mut(&me).expect("ERR_NO_CHARTER").frozen = frozen;
        refund(&me, env::attached_deposit().as_yoctonear());
    }

    /// Store sha256 of the hidden rule. The rule text is not stored.
    /// Empty clears it. The text is `oath-hidden-v1` with clause id `pay`.
    pub fn set_seal(&mut self, commitment: String) {
        let me = env::predecessor_account_id();
        let seal = if commitment.is_empty() { None } else { Some(parse_hex32(&commitment)) };
        let before = self.bytes();
        self.rows.get_mut(&me).expect("ERR_NO_CHARTER").seal = seal;
        self.charge(&me, before);
    }

    pub fn set_agent(&mut self, agent: String) {
        let me = env::predecessor_account_id();
        let pk = parse_pk(&agent);
        require!(self.keys.get(&pk).map(|o| o == &me).unwrap_or(true), "ERR_KEY_USED");
        let before = self.bytes();
        let old = self.rows.get(&me).expect("ERR_NO_CHARTER").agent;
        self.keys.remove(&old);
        self.keys.insert(pk, me.clone());
        self.rows.get_mut(&me).unwrap().agent = pk;
        self.charge(&me, before);
    }

    pub fn fund(&mut self) {
        let me = env::predecessor_account_id();
        let row = self.rows.get_mut(&me).expect("ERR_NO_CHARTER");
        row.balance += env::attached_deposit().as_yoctonear();
    }

    pub fn close_charter(&mut self) -> Promise {
        self.release(env::predecessor_account_id())
    }

    /// Owner closes one visitor's row. The stake and the unspent balance go to
    /// that visitor, the same as `close_charter`. After the last row, `reap` can run.
    pub fn force_close(&mut self, visitor: AccountId) -> Promise {
        require!(env::predecessor_account_id() == self.owner, "ERR_NOT_OWNER");
        self.release(visitor)
    }

    fn release(&mut self, who: AccountId) -> Promise {
        let before = self.bytes();
        let calls_before = encode_calls(&self.calls).len() as u64;
        let row = self.rows.remove(&who).expect("ERR_NO_CHARTER");
        self.keys.remove(&row.agent);
        self.calls.remove(&who);
        self.count -= 1;
        let freed = self.shrank(before);
        let calls_after = encode_calls(&self.calls).len() as u64;
        let calls_freed = (calls_before - calls_after) as u128 * price();
        let back = freed + calls_freed + row.balance + env::attached_deposit().as_yoctonear();
        require!(back > 0, "ERR_REFUND");
        Promise::new(who).transfer(NearToken::from_yoctonear(back))
    }

    pub fn propose(&mut self, owner: AccountId, receiver: AccountId, amount: U128, signature: String, reveal: Option<Reveal>) -> Promise {
        let mut row = self.rows.get(&owner).cloned().expect("ERR_NO_CHARTER");
        let amount = amount.0;
        require!(signature.len() == 128, "ERR_BAD_SIG");
        let sig = parse_hex_n::<64>(&signature);
        let msg = proposal_text(&owner, &receiver, amount, row.nonce);
        require!(env::ed25519_verify(&sig, msg.as_bytes(), &row.agent), "ERR_BAD_SIG");
        require!(!row.frozen, "frozen");
        if row.rules.expires_at != 0 {
            require!(env::block_timestamp() <= row.rules.expires_at, "clause_expired");
        }
        require!(row.rules.receivers.contains(&receiver), "receiver_not_allowlisted");
        require!(amount > 0, "zero_amount");
        require!(amount >= row.rules.min_amount, "below_min_amount");
        require!(in_window(row.rules.window_start_min, row.rules.window_end_min), "outside_time_window");
        require!(amount <= row.rules.per_action_cap, "over_per_action_cap");
        let day = today();
        if row.day != day { row.day = day; row.spent = 0; row.count = 0; }
        let next = row.spent.checked_add(amount).expect("ERR_AMOUNT");
        require!(next <= row.rules.daily_budget, "over_daily_budget");
        require!(row.count < row.rules.max_actions_per_day, "over_daily_action_count");
        if let Some(seal) = row.seal {
            let reveal = reveal.as_ref().expect("ERR_SEAL");
            require!(seal_bytes(reveal) == seal, "ERR_SEAL");
            require!(!reveal.deny.contains(&receiver), "hidden_rule_receiver");
            if let Some(max) = reveal.max_amount { require!(amount <= max.0, "hidden_rule_cap"); }
        }
        require!(row.balance >= amount, "ERR_BALANCE");
        row.balance -= amount;
        row.spent = next;
        row.count += 1;
        row.nonce += 1;
        self.rows.insert(owner.clone(), row);
        let mut args = String::from("{\"owner\":\"");
        args.push_str(owner.as_str());
        args.push_str("\",\"amount\":\"");
        push_u128(&mut args, amount);
        args.push_str("\",\"day\":\"");
        push_u128(&mut args, day as u128);
        args.push_str("\"}");
        Promise::new(receiver).transfer(NearToken::from_yoctonear(amount)).then(
            Promise::new(env::current_account_id()).function_call(
                "on_paid", args.into_bytes(), NearToken::from_yoctonear(0), GAS_CALLBACK,
            ),
        )
    }

    pub fn on_paid(&mut self, owner: AccountId, amount: U128, day: U64) {
        if near_sdk::is_promise_success() { return; }
        let Some(row) = self.rows.get_mut(&owner) else { return; };
        row.balance += amount.0;
        if row.day == day.0 {
            row.spent = row.spent.saturating_sub(amount.0);
            row.count = row.count.saturating_sub(1);
        }
    }

    /// The visitor names which (receiver, method) pairs the agent may call, and the session ceiling.
    /// `propose` is unchanged. An empty list clears the policy.
    pub fn set_calls(&mut self, rules: Vec<(AccountId, String, u128)>, session_cap: u128) {
        let me = env::predecessor_account_id();
        require!(self.rows.contains_key(&me), "ERR_NO_CHARTER");
        require!(rules.len() <= MAX_RECEIVERS, "ERR_RECEIVERS");
        let mut seen = BTreeSet::new();
        let mut parsed = Vec::new();
        for (receiver, method, cap) in rules {
            require!((1..=64).contains(&method.len()), "ERR_METHOD");
            require!(method.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'), "ERR_METHOD");
            require!(cap > 0, "ERR_CAP");
            require!(seen.insert((receiver.clone(), method.clone())), "ERR_RECEIVERS");
            parsed.push(CallRule { receiver, method, cap });
        }
        let spent = self.calls.get(&me).map(|p| p.session_spent).unwrap_or(0);
        require!(spent <= session_cap, "ERR_CAP");
        let before = encode_calls(&self.calls).len() as u64;
        if parsed.is_empty() {
            self.calls.remove(&me);
        } else {
            self.calls.insert(me.clone(), CallPolicy { rules: parsed, session_cap, session_spent: spent });
        }
        self.charge_len(&me, before, encode_calls(&self.calls).len() as u64);
    }

    /// A signed function call. The message covers the method and sha256(args). The deposit
    /// comes from the row. A failed call is returned by `on_called`.
    pub fn propose_call(&mut self, owner: AccountId, receiver: AccountId, method: String, args: Vec<u8>, deposit: U128, signature: String) -> Promise {
        let mut row = self.rows.get(&owner).cloned().expect("ERR_NO_CHARTER");
        let deposit = deposit.0;
        require!(signature.len() == 128, "ERR_BAD_SIG");
        let sig = parse_hex_n::<64>(&signature);
        let msg = call_text(&owner, &receiver, &method, &args, deposit, row.nonce);
        require!(env::ed25519_verify(&sig, msg.as_bytes(), &row.agent), "ERR_BAD_SIG");
        require!(!row.frozen, "frozen");
        if row.rules.expires_at != 0 {
            require!(env::block_timestamp() <= row.rules.expires_at, "clause_expired");
        }
        require!(args.len() <= 2048, "ERR_ARGS");
        require!((1..=64).contains(&method.len()), "ERR_METHOD");
        let Some(policy) = self.calls.get(&owner) else { env::panic_str("method_not_allowlisted"); };
        let Some(rule) = policy.rules.iter().find(|r| r.receiver == receiver && r.method == method) else { env::panic_str("method_not_allowlisted"); };
        require!(deposit <= rule.cap, "over_shop_cap");
        let next_session = policy.session_spent.checked_add(deposit).expect("ERR_AMOUNT");
        require!(next_session <= policy.session_cap, "over_session_cap");
        require!(deposit <= row.rules.per_action_cap, "over_per_action_cap");
        let day = today();
        if row.day != day { row.day = day; row.spent = 0; row.count = 0; }
        let next = row.spent.checked_add(deposit).expect("ERR_AMOUNT");
        require!(next <= row.rules.daily_budget, "over_daily_budget");
        require!(row.count < row.rules.max_actions_per_day, "over_daily_action_count");
        require!(row.balance >= deposit, "ERR_BALANCE");
        row.balance -= deposit;
        row.spent = next;
        row.count += 1;
        row.nonce += 1;
        self.rows.insert(owner.clone(), row);
        let mut policy = self.calls.get(&owner).unwrap().clone();
        policy.session_spent = next_session;
        self.calls.insert(owner.clone(), policy);
        let mut cb = String::from("{\"owner\":\"");
        cb.push_str(owner.as_str());
        cb.push_str("\",\"amount\":\"");
        push_u128(&mut cb, deposit);
        cb.push_str("\",\"day\":\"");
        push_u128(&mut cb, day as u128);
        cb.push_str("\"}");
        Promise::new(receiver).function_call(
            method, args, NearToken::from_yoctonear(deposit), Gas::from_tgas(30),
        ).then(Promise::new(env::current_account_id()).function_call(
            "on_called", cb.into_bytes(), NearToken::from_yoctonear(0), GAS_CALLBACK,
        ))
    }

    pub fn on_called(&mut self, owner: AccountId, amount: U128, day: U64) {
        if near_sdk::is_promise_success() { return; }
        let Some(row) = self.rows.get_mut(&owner) else { return; };
        row.balance += amount.0;
        if row.day == day.0 {
            row.spent = row.spent.saturating_sub(amount.0);
            row.count = row.count.saturating_sub(1);
        }
        if let Some(policy) = self.calls.get_mut(&owner) {
            policy.session_spent = policy.session_spent.saturating_sub(amount.0);
        }
    }

    pub fn call_message(&self, owner: AccountId, receiver: AccountId, method: String, args: Vec<u8>, deposit: U128, nonce: U64) -> String {
        call_text(&owner, &receiver, &method, &args, deposit.0, nonce.0)
    }

    pub fn reap(&mut self) -> Promise {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "ERR_ONE_YOCTO");
        require!(env::predecessor_account_id() == self.owner, "ERR_NOT_OWNER");
        require!(self.count == 0, "ERR_NONEMPTY");
        Promise::new(env::current_account_id()).delete_account(self.owner.clone())
    }

    pub fn get_config(&self) -> Config {
        Config {
            owner: self.owner.clone(),
            rows: self.count,
            max_row_yocto: U128(MAX_ROW_YOCTO),
            byte_yocto: U128(price()),
        }
    }

    pub fn get_charter(&self, owner: AccountId) -> Option<CharterView> {
        let row = self.rows.get(&owner)?;
        let (spent, count) = if row.day == today() { (row.spent, row.count) } else { (0, 0) };
        Some(CharterView {
            owner,
            receivers: row.rules.receivers.clone(),
            per_action_cap: U128(row.rules.per_action_cap),
            daily_budget: U128(row.rules.daily_budget),
            max_actions_per_day: row.rules.max_actions_per_day,
            window_start_min: row.rules.window_start_min,
            window_end_min: row.rules.window_end_min,
            min_amount: U128(row.rules.min_amount),
            expires_at: U64(row.rules.expires_at),
            frozen: row.frozen,
            sealed: row.seal.is_some(),
            agent: hex32(&row.agent),
            nonce: U64(row.nonce),
            balance: U128(row.balance),
            storage_locked: U128(row.storage_locked),
            spent_today: U128(spent),
            actions_today: count,
        })
    }

    pub fn proposal_message(&self, owner: AccountId, receiver: AccountId, amount: U128, nonce: U64) -> String {
        proposal_text(&owner, &receiver, amount.0, nonce.0)
    }

    pub fn state_bytes(&self) -> u64 { self.bytes() }

    fn bytes(&self) -> u64 { encode(self).len() as u64 }

    fn grew(&self, before: u64) -> u128 {
        let after = self.bytes();
        require!(after >= before, "ERR_STORAGE");
        (after - before) as u128 * price()
    }

    fn shrank(&self, before: u64) -> u128 {
        let after = self.bytes();
        require!(before >= after, "ERR_STORAGE");
        (before - after) as u128 * price()
    }

    fn charge_len(&mut self, me: &AccountId, before: u64, after: u64) {
        let attached = env::attached_deposit().as_yoctonear();
        if after > before {
            let cost = (after - before) as u128 * price();
            require!(attached >= cost, "ERR_DEPOSIT");
            let row = self.rows.get_mut(me).unwrap();
            require!(row.storage_locked + cost <= MAX_ROW_YOCTO, "ERR_ROW_TOO_BIG");
            row.storage_locked += cost;
            refund(me, attached - cost);
        } else {
            let freed = (before - after) as u128 * price();
            if let Some(row) = self.rows.get_mut(me) {
                row.storage_locked = row.storage_locked.saturating_sub(freed);
            }
            refund(me, freed + attached);
        }
    }

    fn charge(&mut self, me: &AccountId, before: u64) {
        let attached = env::attached_deposit().as_yoctonear();
        let after = self.bytes();
        if after > before {
            let cost = (after - before) as u128 * price();
            require!(attached >= cost, "ERR_DEPOSIT");
            let row = self.rows.get_mut(me).unwrap();
            require!(row.storage_locked + cost <= MAX_ROW_YOCTO, "ERR_ROW_TOO_BIG");
            row.storage_locked += cost;
            refund(me, attached - cost);
        } else {
            let freed = (before - after) as u128 * price();
            if let Some(row) = self.rows.get_mut(me) {
                row.storage_locked = row.storage_locked.saturating_sub(freed);
            }
            refund(me, freed + attached);
        }
    }
}

fn push_u128(s: &mut String, mut n: u128) {
    if n == 0 { s.push('0'); return; }
    let mut buf = [0u8; 40];
    let mut i = 40;
    while n > 0 { i -= 1; buf[i] = b'0' + (n % 10) as u8; n /= 10; }
    s.push_str(core::str::from_utf8(&buf[i..]).unwrap());
}

fn call_text(owner: &AccountId, receiver: &AccountId, method: &str, args: &[u8], deposit: u128, nonce: u64) -> String {
    let mut s = String::from("board-call-v1|");
    s.push_str(env::current_account_id().as_str());
    s.push('|'); s.push_str(owner.as_str());
    s.push('|'); s.push_str(receiver.as_str());
    s.push('|'); s.push_str(method);
    s.push('|'); s.push_str(&hex32(&env::sha256_array(args)));
    s.push('|'); push_u128(&mut s, deposit);
    s.push('|'); push_u128(&mut s, nonce as u128);
    s
}

fn proposal_text(owner: &AccountId, receiver: &AccountId, amount: u128, nonce: u64) -> String {
    let mut s = String::from("board-v1|");
    s.push_str(env::current_account_id().as_str());
    s.push('|'); s.push_str(owner.as_str());
    s.push('|'); s.push_str(receiver.as_str());
    s.push('|'); push_u128(&mut s, amount);
    s.push('|'); push_u128(&mut s, nonce as u128);
    s
}

pub fn seal_text(reveal: &Reveal) -> String {
    let mut s = String::from("oath-hidden-v1|");
    s.push_str(env::current_account_id().as_str());
    s.push_str("|pay|");
    match reveal.max_amount { Some(m) => push_u128(&mut s, m.0), None => s.push_str("none") }
    s.push('|');
    for (i, a) in reveal.deny.iter().enumerate() { if i > 0 { s.push(','); } s.push_str(a.as_str()); }
    s.push('|'); s.push_str(&reveal.salt);
    s
}

fn seal_bytes(reveal: &Reveal) -> [u8; 32] {
    require!((8..=64).contains(&reveal.salt.len()), "ERR_SEAL");
    require!(reveal.salt.bytes().all(|b| b.is_ascii_alphanumeric()), "ERR_SEAL");
    require!(reveal.deny.len() <= MAX_RECEIVERS, "ERR_SEAL");
    env::sha256_array(seal_text(reveal).as_bytes())
}

fn rules_from(r: RulesIn) -> Rules {
    require!((1..=MAX_RECEIVERS).contains(&r.receivers.len()), "ERR_RECEIVERS");
    let mut seen = BTreeSet::new();
    for a in &r.receivers {
        require!(a.as_str().len() <= 64 && seen.insert(a.clone()), "ERR_RECEIVERS");
    }
    require!(r.per_action_cap.0 > 0, "ERR_CAP");
    require!(r.daily_budget.0 >= r.per_action_cap.0, "ERR_BUDGET");
    require!((1..=1000).contains(&r.max_actions_per_day), "ERR_COUNT");
    require!(r.window_start_min < 1440 && r.window_end_min < 1440, "ERR_WINDOW");
    require!(r.min_amount.0 > 0 && r.min_amount.0 <= r.per_action_cap.0, "ERR_MIN");
    Rules {
        receivers: r.receivers,
        per_action_cap: r.per_action_cap.0,
        daily_budget: r.daily_budget.0,
        max_actions_per_day: r.max_actions_per_day,
        window_start_min: r.window_start_min,
        window_end_min: r.window_end_min,
        min_amount: r.min_amount.0,
        expires_at: r.expires_at.0,
    }
}

fn today() -> u64 { env::block_timestamp() / NS_PER_DAY }

fn in_window(start: u16, end: u16) -> bool {
    if start == end { return true; }
    let minute = ((env::block_timestamp() / NS_PER_MIN) % 1440) as u16;
    if start < end { minute >= start && minute < end } else { minute >= start || minute < end }
}

fn price() -> u128 { env::storage_byte_cost().as_yoctonear() }
fn refund(to: &AccountId, amount: u128) {
    if amount > 0 { let _ = Promise::new(to.clone()).transfer(NearToken::from_yoctonear(amount)); }
}

fn parse_pk(s: &str) -> [u8; 32] {
    if let Some(rest) = s.strip_prefix("ed25519:") {
        let v = b58decode(rest);
        require!(v.len() == 32, "ERR_KEY");
        v.try_into().unwrap()
    } else {
        parse_hex32(s)
    }
}
fn parse_hex32(s: &str) -> [u8; 32] { parse_hex_n::<32>(s) }
fn parse_hex_n<const N: usize>(s: &str) -> [u8; N] {
    require!(s.len() == N * 2, "ERR_HEX");
    let mut out = [0u8; N];
    for i in 0..N {
        out[i] = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap_or_else(|_| env::panic_str("ERR_HEX"));
    }
    out
}
fn hex32(b: &[u8; 32]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(64);
    for x in b {
        s.push(H[(x >> 4) as usize] as char);
        s.push(H[(x & 15) as usize] as char);
    }
    s
}
fn b58decode(s: &str) -> Vec<u8> {
    const A: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    require!(!s.is_empty() && s.len() <= 50, "ERR_KEY");
    let mut n = vec![0u8];
    for c in s.bytes() {
        let d = A.iter().position(|&x| x == c).unwrap_or_else(|| env::panic_str("ERR_KEY")) as u32;
        let mut carry = d;
        for b in n.iter_mut() {
            let v = (*b as u32) * 58 + carry;
            *b = (v & 0xff) as u8;
            carry = v >> 8;
        }
        while carry > 0 { n.push((carry & 0xff) as u8); carry >>= 8; }
    }
    let zeros = s.bytes().take_while(|&c| c == b'1').count();
    let mut out = vec![0u8; zeros];
    out.extend(n.into_iter().rev());
    if out.first() == Some(&0) && zeros == 0 { out.remove(0); }
    out
}

fn encode(b: &Board) -> Vec<u8> {
    let mut o = Vec::new();
    put_acc(&mut o, &b.owner);
    put_u32(&mut o, b.rows.len() as u32);
    for (k, v) in &b.rows { put_acc(&mut o, k); put_row(&mut o, v); }
    put_u32(&mut o, b.keys.len() as u32);
    for (k, v) in &b.keys { o.extend_from_slice(k); put_acc(&mut o, v); }
    put_u32(&mut o, b.count);
    o
}
fn put_u16(o: &mut Vec<u8>, n: u16) { o.extend_from_slice(&n.to_le_bytes()); }
fn put_u32(o: &mut Vec<u8>, n: u32) { o.extend_from_slice(&n.to_le_bytes()); }
fn put_u64(o: &mut Vec<u8>, n: u64) { o.extend_from_slice(&n.to_le_bytes()); }
fn put_u128(o: &mut Vec<u8>, n: u128) { o.extend_from_slice(&n.to_le_bytes()); }
fn put_str(o: &mut Vec<u8>, s: &str) { put_u32(o, s.len() as u32); o.extend_from_slice(s.as_bytes()); }
fn put_acc(o: &mut Vec<u8>, a: &AccountId) { put_str(o, a.as_str()); }
fn put_rules(o: &mut Vec<u8>, r: &Rules) {
    put_u32(o, r.receivers.len() as u32);
    for a in &r.receivers { put_acc(o, a); }
    put_u128(o, r.per_action_cap); put_u128(o, r.daily_budget); put_u32(o, r.max_actions_per_day);
    put_u16(o, r.window_start_min); put_u16(o, r.window_end_min); put_u128(o, r.min_amount); put_u64(o, r.expires_at);
}
fn put_row(o: &mut Vec<u8>, r: &Row) {
    put_rules(o, &r.rules); o.extend_from_slice(&r.agent); o.push(u8::from(r.frozen));
    match r.seal { None => o.push(0), Some(s) => { o.push(1); o.extend_from_slice(&s); } }
    put_u64(o, r.nonce); put_u64(o, r.day); put_u128(o, r.spent); put_u32(o, r.count); put_u128(o, r.balance); put_u128(o, r.storage_locked);
}
struct Rd<'a> { s: &'a [u8], i: usize }
impl Rd<'_> {
    fn take(&mut self, n: usize) -> &[u8] {
        require!(self.i + n <= self.s.len(), "ERR_STATE");
        let b = &self.s[self.i..self.i + n]; self.i += n; b
    }
    fn u8(&mut self) -> u8 { self.take(1)[0] }
    fn u16(&mut self) -> u16 { u16::from_le_bytes(self.take(2).try_into().unwrap()) }
    fn u32(&mut self) -> u32 { u32::from_le_bytes(self.take(4).try_into().unwrap()) }
    fn u64(&mut self) -> u64 { u64::from_le_bytes(self.take(8).try_into().unwrap()) }
    fn u128(&mut self) -> u128 { u128::from_le_bytes(self.take(16).try_into().unwrap()) }
    fn bytes32(&mut self) -> [u8; 32] { self.take(32).try_into().unwrap() }
    fn string(&mut self) -> String {
        let n = self.u32() as usize;
        String::from_utf8(self.take(n).to_vec()).unwrap_or_else(|_| env::panic_str("ERR_STATE"))
    }
    fn acc(&mut self) -> AccountId { self.string().parse().unwrap_or_else(|_| env::panic_str("ERR_STATE")) }
    fn rules(&mut self) -> Rules {
        let n = self.u32() as usize;
        require!(n <= MAX_RECEIVERS, "ERR_STATE");
        let mut receivers = Vec::with_capacity(n);
        for _ in 0..n { receivers.push(self.acc()); }
        Rules { receivers, per_action_cap: self.u128(), daily_budget: self.u128(), max_actions_per_day: self.u32(),
            window_start_min: self.u16(), window_end_min: self.u16(), min_amount: self.u128(), expires_at: self.u64() }
    }
    fn row(&mut self) -> Row {
        let rules = self.rules(); let agent = self.bytes32(); let frozen = self.u8() == 1;
        let seal = match self.u8() { 0 => None, 1 => Some(self.bytes32()), _ => env::panic_str("ERR_STATE") };
        Row { rules, agent, frozen, seal, nonce: self.u64(), day: self.u64(), spent: self.u128(), count: self.u32(), balance: self.u128(), storage_locked: self.u128() }
    }
}
fn decode(raw: &[u8]) -> Board {
    let mut r = Rd { s: raw, i: 0 };
    let owner = r.acc();
    let n = r.u32() as usize;
    require!(n <= 10_000, "ERR_STATE");
    let mut rows = BTreeMap::new();
    for _ in 0..n { let k = r.acc(); rows.insert(k, r.row()); }
    let m = r.u32() as usize;
    require!(m <= 10_000, "ERR_STATE");
    let mut keys = BTreeMap::new();
    for _ in 0..m { let k = r.bytes32(); keys.insert(k, r.acc()); }
    let count = r.u32();
    require!(r.i == raw.len(), "ERR_STATE");
    Board { owner, rows, keys, count, calls: BTreeMap::new() }
}

fn encode_calls(m: &BTreeMap<AccountId, CallPolicy>) -> Vec<u8> {
    let mut o = Vec::new();
    put_u32(&mut o, m.len() as u32);
    for (owner, p) in m {
        put_acc(&mut o, owner);
        put_u32(&mut o, p.rules.len() as u32);
        for rule in &p.rules {
            put_acc(&mut o, &rule.receiver);
            put_str(&mut o, &rule.method);
            put_u128(&mut o, rule.cap);
        }
        put_u128(&mut o, p.session_cap);
        put_u128(&mut o, p.session_spent);
    }
    o
}
fn decode_calls(raw: &[u8]) -> BTreeMap<AccountId, CallPolicy> {
    let mut r = Rd { s: raw, i: 0 };
    let n = r.u32() as usize;
    require!(n <= 10_000, "ERR_STATE");
    let mut out = BTreeMap::new();
    for _ in 0..n {
        let owner = r.acc();
        let k = r.u32() as usize;
        require!(k <= MAX_RECEIVERS, "ERR_STATE");
        let mut rules = Vec::with_capacity(k);
        for _ in 0..k {
            rules.push(CallRule { receiver: r.acc(), method: r.string(), cap: r.u128() });
        }
        out.insert(owner, CallPolicy { rules, session_cap: r.u128(), session_spent: r.u128() });
    }
    require!(r.i == raw.len(), "ERR_STATE");
    out
}

fn save(b: &Board) {
    env::storage_write(b"STATE", &encode(b));
    let calls = encode_calls(&b.calls);
    if b.calls.is_empty() { env::storage_remove(b"CALLS"); }
    else { env::storage_write(b"CALLS", &calls); }
}
fn load() -> Board {
    let raw = env::storage_read(b"STATE").unwrap_or_else(|| env::panic_str("ERR_NO_STATE"));
    let mut b = decode(&raw);
    if let Some(raw) = env::storage_read(b"CALLS") { b.calls = decode_calls(&raw); }
    b
}
fn input_str() -> String {
    String::from_utf8(env::input().unwrap_or_default()).unwrap_or_else(|_| env::panic_str("ERR_ARGS"))
}
fn ret(s: &str) { env::value_return(s.as_bytes()); }

#[no_mangle]
pub extern "C" fn new() { save(&Board::new()); }

#[no_mangle]
pub extern "C" fn open_charter() {
    let v = parse(&input_str());
    let mut b = load();
    b.open_charter(rules_json(v.need("rules")), v.need("agent").string(), U128(v.need("fund").u128()));
    save(&b);
}
#[no_mangle]
pub extern "C" fn set_rules() { let v = parse(&input_str()); let mut b = load(); b.set_rules(rules_json(&v.need("rules"))); save(&b); }
#[no_mangle]
pub extern "C" fn set_frozen() { let v = parse(&input_str()); let mut b = load(); b.set_frozen(v.need("frozen").bool()); save(&b); }
#[no_mangle]
pub extern "C" fn set_seal() { let v = parse(&input_str()); let mut b = load(); b.set_seal(v.need("commitment").string()); save(&b); }
#[no_mangle]
pub extern "C" fn set_agent() { let v = parse(&input_str()); let mut b = load(); b.set_agent(v.need("agent").string()); save(&b); }
#[no_mangle]
pub extern "C" fn fund() { let mut b = load(); b.fund(); save(&b); }
#[no_mangle]
pub extern "C" fn close_charter() { let mut b = load(); let _ = b.close_charter(); save(&b); }
#[no_mangle]
pub extern "C" fn force_close() {
    let v = parse(&input_str());
    let mut b = load();
    let _ = b.force_close(v.need("visitor").account());
    save(&b);
}
#[no_mangle]
pub extern "C" fn propose() {
    let v = parse(&input_str());
    let mut b = load();
    let _ = b.propose(v.need("owner").account(), v.need("receiver").account(), U128(v.need("amount").u128()), v.need("signature").string(), reveal_json(v.get("reveal")));
    save(&b);
}
#[no_mangle]
pub extern "C" fn set_calls() {
    let v = parse(&input_str());
    let mut rules = Vec::new();
    for item in v.need("calls").arr() {
        let o = item.obj();
        rules.push((o.need("receiver").account(), o.need("method").string(), o.need("cap").u128()));
    }
    let mut b = load();
    b.set_calls(rules, v.need("session_cap").u128());
    save(&b);
}
#[no_mangle]
pub extern "C" fn propose_call() {
    let v = parse(&input_str());
    let mut b = load();
    let _ = b.propose_call(
        v.need("owner").account(), v.need("receiver").account(), v.need("method").string(),
        v.need("args").string().into_bytes(), U128(v.need("deposit").u128()), v.need("signature").string(),
    );
    save(&b);
}
#[no_mangle]
pub extern "C" fn on_called() {
    require!(env::predecessor_account_id() == env::current_account_id(), "ERR_PRIVATE");
    let v = parse(&input_str());
    let mut b = load();
    b.on_called(v.need("owner").account(), U128(v.need("amount").u128()), U64(v.need("day").u128() as u64));
    save(&b);
}
#[no_mangle]
pub extern "C" fn call_message() {
    let v = parse(&input_str());
    let b = load();
    ret(&b.call_message(
        v.need("owner").account(), v.need("receiver").account(), v.need("method").string(),
        v.need("args").string().into_bytes(), U128(v.need("deposit").u128()), U64(v.need("nonce").u128() as u64),
    ));
}
#[no_mangle]
pub extern "C" fn on_paid() {
    require!(env::predecessor_account_id() == env::current_account_id(), "ERR_PRIVATE");
    let v = parse(&input_str());
    let mut b = load();
    b.on_paid(v.need("owner").account(), U128(v.need("amount").u128()), U64(v.need("day").u128() as u64));
    save(&b);
}
#[no_mangle]
pub extern "C" fn reap() { let mut b = load(); let _ = b.reap(); save(&b); }
#[no_mangle]
pub extern "C" fn get_config() {
    let c = load().get_config();
    let mut s = String::from("{\"owner\":\"");
    s.push_str(c.owner.as_str());
    s.push_str("\",\"rows\":"); push_u128(&mut s, c.rows as u128);
    s.push_str(",\"max_row_yocto\":\""); push_u128(&mut s, c.max_row_yocto.0);
    s.push_str("\",\"byte_yocto\":\""); push_u128(&mut s, c.byte_yocto.0);
    s.push_str("\"}");
    ret(&s);
}
#[no_mangle]
pub extern "C" fn get_charter() {
    let v = parse(&input_str());
    let owner = v.need("owner").account();
    match load().get_charter(owner) {
        None => ret("null"),
        Some(c) => {
            let mut s = String::from("{\"owner\":\"");
            s.push_str(c.owner.as_str());
            s.push_str("\",\"receivers\":[");
            for (i, a) in c.receivers.iter().enumerate() { if i > 0 { s.push(','); } s.push('"'); s.push_str(a.as_str()); s.push('"'); }
            s.push_str("],\"per_action_cap\":\""); push_u128(&mut s, c.per_action_cap.0);
            s.push_str("\",\"daily_budget\":\""); push_u128(&mut s, c.daily_budget.0);
            s.push_str("\",\"max_actions_per_day\":"); push_u128(&mut s, c.max_actions_per_day as u128);
            s.push_str(",\"window_start_min\":"); push_u128(&mut s, c.window_start_min as u128);
            s.push_str(",\"window_end_min\":"); push_u128(&mut s, c.window_end_min as u128);
            s.push_str(",\"min_amount\":\""); push_u128(&mut s, c.min_amount.0);
            s.push_str("\",\"expires_at\":\""); push_u128(&mut s, c.expires_at.0 as u128);
            s.push_str("\",\"frozen\":"); s.push_str(if c.frozen { "true" } else { "false" });
            s.push_str(",\"sealed\":"); s.push_str(if c.sealed { "true" } else { "false" });
            s.push_str(",\"agent\":\""); s.push_str(&c.agent);
            s.push_str("\",\"nonce\":\""); push_u128(&mut s, c.nonce.0 as u128);
            s.push_str("\",\"balance\":\""); push_u128(&mut s, c.balance.0);
            s.push_str("\",\"storage_locked\":\""); push_u128(&mut s, c.storage_locked.0);
            s.push_str("\",\"spent_today\":\""); push_u128(&mut s, c.spent_today.0);
            s.push_str("\",\"actions_today\":"); push_u128(&mut s, c.actions_today as u128);
            s.push('}');
            ret(&s);
        }
    }
}
#[no_mangle]
pub extern "C" fn proposal_message() {
    let v = parse(&input_str());
    let b = load();
    ret(&b.proposal_message(v.need("owner").account(), v.need("receiver").account(), U128(v.need("amount").u128()), U64(v.need("nonce").u128() as u64)));
}

fn rules_json(v: &Val) -> RulesIn {
    let o = v.obj();
    RulesIn {
        receivers: o.need("receivers").arr().iter().map(|x| x.account()).collect(),
        per_action_cap: U128(o.need("per_action_cap").u128()),
        daily_budget: U128(o.need("daily_budget").u128()),
        max_actions_per_day: o.need("max_actions_per_day").u128() as u32,
        window_start_min: o.need("window_start_min").u128() as u16,
        window_end_min: o.need("window_end_min").u128() as u16,
        min_amount: U128(o.need("min_amount").u128()),
        expires_at: U64(o.get("expires_at").map(|x| x.u128()).unwrap_or(0) as u64),
    }
}
fn reveal_json(v: Option<&Val>) -> Option<Reveal> {
    let Some(v) = v else { return None; };
    if matches!(v, Val::Null) { return None; }
    let o = v.obj();
    Some(Reveal {
        max_amount: match o.get("max_amount") { None => None, Some(Val::Null) => None, Some(x) => Some(U128(x.u128())) },
        deny: o.get("deny").map(|d| d.arr().iter().map(|x| x.account()).collect()).unwrap_or_default(),
        salt: o.need("salt").string(),
    })
}

enum Val { Null, Bool(bool), Num(String), Str(String), Arr(Vec<Val>), Obj(Vec<(String, Val)>) }
impl Val {
    fn obj(&self) -> &Self { self }
    fn need(&self, k: &str) -> &Val { self.get(k).unwrap_or_else(|| env::panic_str("ERR_ARGS")) }
    fn get(&self, k: &str) -> Option<&Val> {
        match self { Val::Obj(o) => o.iter().find(|(n, _)| n == k).map(|(_, v)| v), _ => env::panic_str("ERR_ARGS") }
    }
    fn string(&self) -> String { match self { Val::Str(s) => s.clone(), _ => env::panic_str("ERR_ARGS") } }
    fn bool(&self) -> bool { match self { Val::Bool(b) => *b, _ => env::panic_str("ERR_ARGS") } }
    fn arr(&self) -> &Vec<Val> { match self { Val::Arr(a) => a, _ => env::panic_str("ERR_ARGS") } }
    fn account(&self) -> AccountId { self.string().parse().unwrap_or_else(|_| env::panic_str("ERR_ARGS")) }
    fn u128(&self) -> u128 {
        match self {
            Val::Num(s) | Val::Str(s) => s.parse().unwrap_or_else(|_| env::panic_str("ERR_ARGS")),
            _ => env::panic_str("ERR_ARGS"),
        }
    }
}
fn parse(s: &str) -> Val { let mut p = J { s: s.as_bytes(), i: 0 }; let v = p.val(); p.skip(); require!(p.i == p.s.len(), "ERR_ARGS"); v }
struct J<'a> { s: &'a [u8], i: usize }
impl J<'_> {
    fn skip(&mut self) { while self.i < self.s.len() && self.s[self.i].is_ascii_whitespace() { self.i += 1; } }
    fn peek(&mut self) -> u8 { self.skip(); if self.i >= self.s.len() { env::panic_str("ERR_ARGS"); } self.s[self.i] }
    fn eat(&mut self, c: u8) { require!(self.peek() == c, "ERR_ARGS"); self.i += 1; }
    fn val(&mut self) -> Val {
        match self.peek() {
            b'n' => { self.i += 4; Val::Null }
            b't' => { self.i += 4; Val::Bool(true) }
            b'f' => { self.i += 5; Val::Bool(false) }
            b'"' => Val::Str(self.str()),
            b'[' => self.arr(),
            b'{' => self.obj(),
            b'-' | b'0'..=b'9' => self.num(),
            _ => env::panic_str("ERR_ARGS"),
        }
    }
    fn str(&mut self) -> String {
        self.eat(b'"');
        let mut o = String::new();
        while self.i < self.s.len() {
            let c = self.s[self.i]; self.i += 1;
            if c == b'"' { return o; }
            if c == b'\\' { let n = self.s[self.i]; self.i += 1; o.push(n as char); } else { o.push(c as char); }
        }
        env::panic_str("ERR_ARGS")
    }
    fn num(&mut self) -> Val {
        let a = self.i;
        if self.s[self.i] == b'-' { self.i += 1; }
        while self.i < self.s.len() && self.s[self.i].is_ascii_digit() { self.i += 1; }
        Val::Num(String::from_utf8(self.s[a..self.i].to_vec()).unwrap())
    }
    fn arr(&mut self) -> Val { self.eat(b'['); let mut a = Vec::new(); if self.peek() != b']' { loop { a.push(self.val()); if self.peek() != b',' { break; } self.i += 1; } } self.eat(b']'); Val::Arr(a) }
    fn obj(&mut self) -> Val { self.eat(b'{'); let mut o = Vec::new(); if self.peek() != b'}' { loop { let k = self.str(); self.eat(b':'); o.push((k, self.val())); if self.peek() != b',' { break; } self.i += 1; } } self.eat(b'}'); Val::Obj(o) }
}
#[cfg(test)]
#[allow(unused_must_use)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use near_sdk::mock::MockAction;
    use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
    use near_sdk::{testing_env, test_vm_config, Gas, PromiseResult, RuntimeFeesConfig};
    use std::panic::{catch_unwind, AssertUnwindSafe};

    const ALICE: &str = "alice.near";
    const BOB: &str = "bob.near";
    const SHOP: &str = "shop.nearcarta.near";
    const OTHER: &str = "other.near";
    const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

    fn acc(s: &str) -> AccountId { s.parse().unwrap() }

    fn go(pred: &str, deposit: u128, ts: u64) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(acc("charters.nearcarta.near"))
            .predecessor_account_id(acc(pred))
            .signer_account_id(acc(pred))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .prepaid_gas(Gas::from_tgas(200))
            .account_balance(NearToken::from_near(30))
            .block_timestamp(ts);
        testing_env!(b.build());
    }

    fn keypair(byte: u8) -> (SigningKey, String) {
        let sk = SigningKey::from_bytes(&[byte; 32]);
        let pk = hex32(sk.verifying_key().as_bytes());
        (sk, pk)
    }

    fn rules(window: (u16, u16), per_day: u32) -> RulesIn {
        RulesIn {
            receivers: vec![acc(SHOP)],
            per_action_cap: U128(NEAR / 500),
            daily_budget: U128(NEAR / 200),
            max_actions_per_day: per_day,
            window_start_min: window.0,
            window_end_min: window.1,
            min_amount: U128(NEAR / 10_000),
            expires_at: U64(0),
        }
    }

    fn boot() -> (Board, SigningKey, String) {
        go("nearcarta.near", 0, 0);
        let mut c = Board::new();
        let (sk, pk) = keypair(7);
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.open_charter(rules((0, 0), 4), pk, U128(NEAR / 1000));
        (c, sk, keypair(7).1)
    }

    fn sign(sk: &SigningKey, c: &Board, owner: &str, receiver: &str, amount: u128) -> (String, String) {
        let nonce = c.get_charter(acc(owner)).unwrap().nonce.0;
        let msg = c.proposal_message(acc(owner), acc(receiver), U128(amount), U64(nonce));
        let sig = hex32_n(&sk.sign(msg.as_bytes()).to_bytes());
        (msg, sig)
    }

    fn hex32_n(b: &[u8]) -> String {
        const H: &[u8; 16] = b"0123456789abcdef";
        let mut s = String::new();
        for x in b { s.push(H[(x >> 4) as usize] as char); s.push(H[(x & 15) as usize] as char); }
        s
    }

    fn refuse(err: Box<dyn std::any::Any + Send>) -> String {
        if let Some(s) = err.downcast_ref::<&str>() { return (*s).to_string(); }
        if let Some(s) = err.downcast_ref::<String>() { return s.clone(); }
        "unreadable panic".into()
    }

    fn transfers_to(id: &str) -> Vec<u128> {
        get_created_receipts().into_iter().filter(|r| r.receiver_id == acc(id)).flat_map(|r| {
            r.actions.into_iter().filter_map(|a| match a {
                MockAction::Transfer { deposit, .. } => Some(deposit.as_yoctonear()),
                _ => None,
            }).collect::<Vec<_>>()
        }).collect()
    }

    #[test]
    fn init_state_is_inside_the_deploy_allowance() {
        go("nearcarta.near", 0, 0);
        let before = env::storage_usage();
        let c = Board::new();
        let delta = env::storage_usage() - before;
        let state = c.state_bytes() as usize;
        assert!(delta <= 8192, "init storage {delta} bytes");
        assert_eq!(state, 30, "init state bytes");
        assert_eq!(c.get_config().owner, acc("nearcarta.near"));
        assert_eq!(c.get_config().rows, 0);
        assert_eq!(c.get_config().max_row_yocto.0, MAX_ROW_YOCTO);
    }

    #[test]
    fn a_row_costs_at_most_0_02_near_and_the_rest_is_refunded() {
        let (c, _, pk) = boot();
        let v = c.get_charter(acc(ALICE)).unwrap();
        assert!(v.storage_locked.0 <= MAX_ROW_YOCTO, "row {}", v.storage_locked.0);
        assert!(v.storage_locked.0 > 0);
        assert_eq!(v.balance.0, NEAR / 1000);
        assert_eq!(v.agent, pk);
        let back = transfers_to(ALICE);
        assert_eq!(back, vec![MAX_ROW_YOCTO - v.storage_locked.0 - NEAR / 1000]);
        let bytes = v.storage_locked.0 / (NEAR / 100_000);
        assert!(bytes <= 2000, "{bytes} bytes");
        assert!(v.storage_locked.0 + NEAR / 1000 <= MAX_ROW_YOCTO);
    }

    #[test]
    fn an_allowed_payment_moves_only_that_visitors_balance() {
        let (mut c, sk, _) = boot();
        go(BOB, MAX_ROW_YOCTO, 0);
        c.open_charter(rules((0, 0), 4), keypair(9).1, U128(NEAR / 500));
        let bob_before = c.get_charter(acc(BOB)).unwrap().balance.0;
        let amount = NEAR / 2000;
        go(ALICE, 0, 0);
        let (_, sig) = sign(&sk, &c, ALICE, SHOP, amount);
        c.propose(acc(ALICE), acc(SHOP), U128(amount), sig, None);
        let alice = c.get_charter(acc(ALICE)).unwrap();
        let bob = c.get_charter(acc(BOB)).unwrap();
        assert_eq!(alice.balance.0, NEAR / 1000 - amount);
        assert_eq!(alice.spent_today.0, amount);
        assert_eq!(alice.actions_today, 1);
        assert_eq!(alice.nonce.0, 1);
        assert_eq!(bob.balance.0, bob_before);
        assert_eq!(bob.spent_today.0, 0);
        assert_eq!(transfers_to(SHOP), vec![amount]);
    }

    #[test]
    fn refusals_leave_both_rows_untouched() {
        let (mut c, sk, _) = boot();
        go(BOB, MAX_ROW_YOCTO, 0);
        c.open_charter(rules((0, 0), 4), keypair(9).1, U128(NEAR / 500));
        let alice_bal = c.get_charter(acc(ALICE)).unwrap().balance.0;
        let bob_bal = c.get_charter(acc(BOB)).unwrap().balance.0;
        let cases: Vec<(&str, u128, &str, u64)> = vec![
            (SHOP, 0, "zero_amount", 0),
            (SHOP, NEAR / 20_000, "below_min_amount", 0),
            (OTHER, NEAR / 2000, "receiver_not_allowlisted", 0),
            (SHOP, NEAR / 100, "over_per_action_cap", 0),
        ];
        for (receiver, amount, reason, ts) in cases {
            go(ALICE, 0, ts);
            let (_, sig) = sign(&sk, &c, ALICE, receiver, amount);
            let err = catch_unwind(AssertUnwindSafe(|| {
                c.propose(acc(ALICE), acc(receiver), U128(amount), sig, None);
            })).unwrap_err();
            let msg = refuse(err);
            assert!(msg.contains(reason), "{msg}");
        }
        go(ALICE, 0, 100 * NS_PER_MIN);
        c.set_rules(rules((0, 50), 4));
        go(ALICE, 0, 100 * NS_PER_MIN);
        let (_, sig) = sign(&sk, &c, ALICE, SHOP, NEAR / 2000);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose(acc(ALICE), acc(SHOP), U128(NEAR / 2000), sig, None);
        })).unwrap_err();
        let msg = refuse(err);
        assert!(msg.contains("outside_time_window"), "{msg}");
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().balance.0, alice_bal);
        assert_eq!(c.get_charter(acc(BOB)).unwrap().balance.0, bob_bal);
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().nonce.0, 0);
    }

    #[test]
    fn daily_budget_count_freeze_and_expiry_refuse() {
        let (mut c, sk, _) = boot();
        let amount = NEAR / 2000;
        go(ALICE, 0, 0);
        c.set_rules(RulesIn {
            per_action_cap: U128(amount),
            daily_budget: U128(amount),
            max_actions_per_day: 4,
            ..rules((0, 0), 4)
        });
        go(ALICE, 0, 0);
        let (_, sig) = sign(&sk, &c, ALICE, SHOP, amount);
        c.propose(acc(ALICE), acc(SHOP), U128(amount), sig, None);
        go(ALICE, 0, 0);
        let (_, sig) = sign(&sk, &c, ALICE, SHOP, amount);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose(acc(ALICE), acc(SHOP), U128(amount), sig, None);
        })).unwrap_err();
        let msg = refuse(err);
        assert!(msg.contains("over_daily_budget"), "{msg}");
        go(ALICE, 0, NS_PER_DAY);
        let (_, sig) = sign(&sk, &c, ALICE, SHOP, amount);
        c.propose(acc(ALICE), acc(SHOP), U128(amount), sig, None);
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().actions_today, 1);
        go(ALICE, 0, NS_PER_DAY);
        c.set_rules(RulesIn { max_actions_per_day: 1, per_action_cap: U128(amount), daily_budget: U128(NEAR / 100), ..rules((0, 0), 1) });
        go(ALICE, 0, NS_PER_DAY);
        let (_, sig) = sign(&sk, &c, ALICE, SHOP, amount);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose(acc(ALICE), acc(SHOP), U128(amount), sig, None);
        })).unwrap_err();
        let msg = refuse(err);
        assert!(msg.contains("over_daily_action_count"), "{msg}");
        go(ALICE, 0, NS_PER_DAY);
        c.set_frozen(true);
        go(ALICE, 0, NS_PER_DAY * 2);
        let (_, sig) = sign(&sk, &c, ALICE, SHOP, amount);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose(acc(ALICE), acc(SHOP), U128(amount), sig, None);
        })).unwrap_err();
        let msg = refuse(err);
        assert!(msg.contains("frozen"), "{msg}");
        go(ALICE, 0, 0);
        c.set_frozen(false);
        let mut expiring = rules((0, 0), 4);
        expiring.expires_at = U64(50);
        c.set_rules(expiring);
        go(ALICE, 0, 51);
        let (_, sig) = sign(&sk, &c, ALICE, SHOP, amount);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose(acc(ALICE), acc(SHOP), U128(amount), sig, None);
        })).unwrap_err();
        let msg = refuse(err);
        assert!(msg.contains("clause_expired"), "{msg}");
    }

    #[test]
    fn the_wrong_key_and_another_visitors_key_are_refused() {
        let (mut c, sk, _) = boot();
        go(BOB, MAX_ROW_YOCTO, 0);
        let (bob_sk, _) = keypair(9);
        c.open_charter(rules((0, 0), 4), keypair(9).1, U128(NEAR / 1000));
        go(ALICE, 0, 0);
        let (_, bad) = sign(&bob_sk, &c, ALICE, SHOP, NEAR / 2000);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose(acc(ALICE), acc(SHOP), U128(NEAR / 2000), bad, None);
        })).unwrap_err();
        let msg = refuse(err);
        assert!(msg.contains("ERR_BAD_SIG"), "{msg}");
        let (_, sig) = sign(&sk, &c, BOB, SHOP, NEAR / 2000);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose(acc(BOB), acc(SHOP), U128(NEAR / 2000), sig, None);
        })).unwrap_err();
        let msg = refuse(err);
        assert!(msg.contains("ERR_BAD_SIG"), "{msg}");
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().balance.0, NEAR / 1000);
        assert_eq!(c.get_charter(acc(BOB)).unwrap().balance.0, NEAR / 1000);
    }

    #[test]
    fn a_sealed_rule_hides_the_text_and_still_refuses() {
        let (mut c, sk, _) = boot();
        let reveal = Reveal { max_amount: Some(U128(NEAR / 5000)), deny: vec![acc(OTHER)], salt: "saltvalue1".into() };
        go(ALICE, MAX_ROW_YOCTO, 0);
        let commitment = hex32(&env::sha256_array(seal_text(&reveal).as_bytes()));
        assert!(commitment.len() == 64);
        c.set_seal(commitment);
        assert!(c.get_charter(acc(ALICE)).unwrap().sealed);
        go(ALICE, 0, 0);
        let (_, sig) = sign(&sk, &c, ALICE, SHOP, NEAR / 2000);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose(acc(ALICE), acc(SHOP), U128(NEAR / 2000), sig, None);
        })).unwrap_err();
        let msg = refuse(err);
        assert!(msg.contains("ERR_SEAL"), "{msg}");
        go(ALICE, 0, 0);
        let (_, sig) = sign(&sk, &c, ALICE, SHOP, NEAR / 2000);
        let wrong = Reveal { salt: "othersalt1".into(), ..reveal.clone() };
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose(acc(ALICE), acc(SHOP), U128(NEAR / 2000), sig, Some(wrong));
        })).unwrap_err();
        let msg = refuse(err);
        assert!(msg.contains("ERR_SEAL"), "{msg}");
        go(ALICE, 0, 0);
        let (_, sig) = sign(&sk, &c, ALICE, SHOP, NEAR / 2000);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose(acc(ALICE), acc(SHOP), U128(NEAR / 2000), sig, Some(reveal.clone()));
        })).unwrap_err();
        let msg = refuse(err);
        assert!(msg.contains("hidden_rule_cap"), "{msg}");
        let mut wide = rules((0, 0), 4);
        wide.receivers = vec![acc(SHOP), acc(OTHER)];
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_rules(wide);
        go(ALICE, 0, 0);
        let (_, sig) = sign(&sk, &c, ALICE, OTHER, NEAR / 10_000);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose(acc(ALICE), acc(OTHER), U128(NEAR / 10_000), sig, Some(reveal.clone()));
        })).unwrap_err();
        let msg = refuse(err);
        assert!(msg.contains("hidden_rule_receiver"), "{msg}");
        go(ALICE, 0, 0);
        let (_, sig) = sign(&sk, &c, ALICE, SHOP, NEAR / 10_000);
        c.propose(acc(ALICE), acc(SHOP), U128(NEAR / 10_000), sig, Some(reveal));
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().spent_today.0, NEAR / 10_000);
    }

    #[test]
    fn close_refunds_the_row_stake_and_the_unspent_balance() {
        go("nearcarta.near", 0, 0);
        let mut c = Board::new();
        let after_new = c.state_bytes();
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.open_charter(rules((0, 0), 4), keypair(7).1, U128(NEAR / 1000));
        let locked = c.get_charter(acc(ALICE)).unwrap().storage_locked.0;
        go(BOB, MAX_ROW_YOCTO, 0);
        c.open_charter(rules((0, 0), 4), keypair(9).1, U128(NEAR / 500));
        let bob_locked = c.get_charter(acc(BOB)).unwrap().storage_locked.0;
        go(ALICE, 0, 0);
        c.close_charter();
        assert!(c.get_charter(acc(ALICE)).is_none());
        assert_eq!(transfers_to(ALICE).last().copied(), Some(locked + NEAR / 1000));
        let bob = c.get_charter(acc(BOB)).unwrap();
        assert_eq!(bob.balance.0, NEAR / 500);
        assert_eq!(bob.storage_locked.0, bob_locked);
        go(BOB, 0, 0);
        c.close_charter();
        assert_eq!(c.count, 0);
        assert_eq!(c.state_bytes(), after_new, "state bytes after close");
    }

    #[test]
    fn force_close_refunds_that_visitor_and_then_the_owner_can_reap() {
        go("nearcarta.near", 0, 0);
        let mut c = Board::new();
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.open_charter(rules((0, 0), 4), keypair(7).1, U128(NEAR / 1000));
        let locked = c.get_charter(acc(ALICE)).unwrap().storage_locked.0;
        go(BOB, MAX_ROW_YOCTO, 0);
        c.open_charter(rules((0, 0), 4), keypair(9).1, U128(NEAR / 500));
        let bob_locked = c.get_charter(acc(BOB)).unwrap().storage_locked.0;
        let before = encode(&c);
        assert_eq!(decode(&before).get_charter(acc(ALICE)).unwrap().balance.0, NEAR / 1000);
        go(ALICE, 0, 0);
        let err = catch_unwind(AssertUnwindSafe(|| { c.force_close(acc(BOB)); })).unwrap_err();
        let msg = refuse(err);
        assert!(msg.contains("ERR_NOT_OWNER"), "{msg}");
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().balance.0, NEAR / 1000);
        assert_eq!(c.get_charter(acc(BOB)).unwrap().storage_locked.0, bob_locked);
        go("nearcarta.near", 0, 0);
        c.force_close(acc(ALICE));
        assert!(c.get_charter(acc(ALICE)).is_none());
        assert_eq!(transfers_to(ALICE).last().copied(), Some(locked + NEAR / 1000));
        let bob = c.get_charter(acc(BOB)).unwrap();
        assert_eq!(bob.balance.0, NEAR / 500);
        assert_eq!(bob.storage_locked.0, bob_locked);
        go("nearcarta.near", 1, 0);
        let err = catch_unwind(AssertUnwindSafe(|| { c.reap(); })).unwrap_err();
        assert!(refuse(err).contains("ERR_NONEMPTY"));
        go("nearcarta.near", 0, 0);
        c.force_close(acc(BOB));
        assert_eq!(transfers_to(BOB).last().copied(), Some(bob_locked + NEAR / 500));
        assert_eq!(c.count, 0);
        go("nearcarta.near", 1, 0);
        c.reap();
        let receipts = get_created_receipts();
        assert!(receipts.iter().any(|r| r.actions.iter().any(|a| matches!(a, MockAction::DeleteAccount { beneficiary_id, .. } if beneficiary_id == &acc("nearcarta.near")))));
    }

    #[test]
    fn a_failed_transfer_returns_the_balance_and_the_owner_cannot_reap_early() {
        let (mut c, sk, _) = boot();
        let amount = NEAR / 2000;
        go(ALICE, 0, 0);
        let (_, sig) = sign(&sk, &c, ALICE, SHOP, amount);
        c.propose(acc(ALICE), acc(SHOP), U128(amount), sig, None);
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().balance.0, NEAR / 1000 - amount);
        let mut b = VMContextBuilder::new();
        b.current_account_id(acc("charters.nearcarta.near"))
            .predecessor_account_id(acc("charters.nearcarta.near"))
            .prepaid_gas(Gas::from_tgas(30))
            .account_balance(NearToken::from_near(30));
        testing_env!(b.build(), test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Failed]);
        c.on_paid(acc(ALICE), U128(amount), U64(0));
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().balance.0, NEAR / 1000);
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().spent_today.0, 0);
        go("nearcarta.near", 1, 0);
        let err = catch_unwind(AssertUnwindSafe(|| { c.reap(); })).unwrap_err();
        let msg = refuse(err);
        assert!(msg.contains("ERR_NONEMPTY"), "{msg}");
        go(ALICE, 0, 0);
        c.close_charter();
        go(ALICE, 1, 0);
        let err = catch_unwind(AssertUnwindSafe(|| { c.reap(); })).unwrap_err();
        let msg = refuse(err);
        assert!(msg.contains("ERR_NOT_OWNER"), "{msg}");
        go("nearcarta.near", 0, 0);
        let err = catch_unwind(AssertUnwindSafe(|| { c.reap(); })).unwrap_err();
        let msg = refuse(err);
        assert!(msg.contains("ERR_ONE_YOCTO"), "{msg}");
        go("nearcarta.near", 1, 0);
        c.reap();
        let receipts = get_created_receipts();
        assert!(receipts.iter().any(|r| r.actions.iter().any(|a| matches!(a, MockAction::DeleteAccount { beneficiary_id, .. } if beneficiary_id == &acc("nearcarta.near")))));
    }

    #[test]
    fn an_ed25519_prefixed_key_binds_the_same_row() {
        go("nearcarta.near", 0, 0);
        let mut c = Board::new();
        let sk = SigningKey::from_bytes(&[3u8; 32]);
        let raw = sk.verifying_key().to_bytes();
        let agent = format!("ed25519:{}", b58encode(&raw));
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.open_charter(rules((0, 0), 2), agent, U128(0));
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().agent, hex32(&raw));
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().balance.0, 0);
        go(ALICE, NEAR / 1000, 0);
        c.fund();
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().balance.0, NEAR / 1000);
    }

    #[test]
    fn state_roundtrips_and_wallet_json_parses() {
        let (c, _, _) = boot();
        let back = decode(&encode(&c));
        let a = c.get_charter(acc(ALICE)).unwrap();
        let b = back.get_charter(acc(ALICE)).unwrap();
        assert_eq!((a.balance.0, a.storage_locked.0, a.agent.clone(), a.receivers.clone()), (b.balance.0, b.storage_locked.0, b.agent, b.receivers));
        assert_eq!(c.proposal_message(acc(ALICE), acc(SHOP), U128(1), U64(0)), "board-v1|charters.nearcarta.near|alice.near|shop.nearcarta.near|1|0");
        let raw = r#"{"rules":{"receivers":["shop.nearcarta.near"],"per_action_cap":"2000000000000000000000","daily_budget":"5000000000000000000000","max_actions_per_day":4,"window_start_min":0,"window_end_min":0,"min_amount":"100000000000000000000","expires_at":"0"},"agent":"00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff","fund":"1000"}"#;
        let v = parse(raw);
        let rules = rules_json(v.need("rules"));
        assert_eq!(rules.receivers[0], acc(SHOP));
        assert_eq!(rules.per_action_cap.0, 2_000_000_000_000_000_000_000);
        assert_eq!(v.need("fund").u128(), 1000);
        assert!(v.get("missing").is_none());
    }

    fn allow(c: &mut Board, shop_cap: u128, session_cap: u128) {
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_calls(vec![(acc(SHOP), "near_deposit".into(), shop_cap)], session_cap);
    }

    fn sign_call(sk: &SigningKey, c: &Board, method: &str, args: &[u8], deposit: u128) -> String {
        let nonce = c.get_charter(acc(ALICE)).unwrap().nonce.0;
        let msg = c.call_message(acc(ALICE), acc(SHOP), method.into(), args.to_vec(), U128(deposit), U64(nonce));
        hex32_n(&sk.sign(msg.as_bytes()).to_bytes())
    }

    fn call(c: &mut Board, sk: &SigningKey, method: &str, args: &[u8], deposit: u128) -> String {
        go(ALICE, 0, 0);
        let sig = sign_call(sk, c, method, args, deposit);
        c.propose_call(acc(ALICE), acc(SHOP), method.into(), args.to_vec(), U128(deposit), sig.clone());
        sig
    }

    #[test]
    fn a_v1_row_still_pays_and_a_call_is_not_allowlisted_until_set() {
        let (c, sk, _) = boot();
        let raw = encode(&c);
        let mut old = decode(&raw);
        assert!(old.calls.is_empty());
        let amount = NEAR / 2000;
        go(ALICE, 0, 0);
        let (_, sig) = sign(&sk, &old, ALICE, SHOP, amount);
        old.propose(acc(ALICE), acc(SHOP), U128(amount), sig, None);
        assert_eq!(old.get_charter(acc(ALICE)).unwrap().balance.0, NEAR / 1000 - amount);
        assert_eq!(old.proposal_message(acc(ALICE), acc(SHOP), U128(1), U64(0)), "board-v1|charters.nearcarta.near|alice.near|shop.nearcarta.near|1|0");
        go(ALICE, 0, 0);
        let sig = sign_call(&sk, &old, "near_deposit", b"{}", NEAR / 2000);
        let err = catch_unwind(AssertUnwindSafe(|| {
            old.propose_call(acc(ALICE), acc(SHOP), "near_deposit".into(), b"{}".to_vec(), U128(NEAR / 2000), sig);
        })).unwrap_err();
        assert!(refuse(err).contains("method_not_allowlisted"));
        assert_eq!(encode(&c).len(), raw.len());
        let _ = c;
    }

    #[test]
    fn the_live_state_dump_still_decodes_and_propose_is_unchanged() {
        let raw = include_bytes!("../testdata/mainnet-state.bin");
        let mut live = decode(raw);
        assert_eq!(encode(&live), raw.as_slice());
        assert!(live.calls.is_empty());
        assert_eq!(live.get_config().rows, 2);
        assert_eq!(live.get_config().owner, acc("nearcarta.near"));
        let owner = "8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8";
        let row = live.get_charter(acc(owner)).unwrap();
        assert_eq!(row.receivers, vec![acc("charter.nearcarta.near"), acc("toll.nearcarta.near")]);
        assert_eq!(row.per_action_cap.0, 4_000_000_000_000_000_000_000);
        assert_eq!(row.nonce.0, 3);
        assert_eq!(row.balance.0, 3_000_000_000_000_000_000_000);
        assert!(!row.frozen);
        assert_eq!(row.agent, "9cecd259f3873c451010e8b7949114dcfd7c7229316f50146f39d872b5b50b94");
        let mut b = VMContextBuilder::new();
        b.current_account_id(acc("board.nearcarta.near"))
            .predecessor_account_id(acc(owner))
            .prepaid_gas(Gas::from_tgas(30))
            .account_balance(NearToken::from_near(30));
        testing_env!(b.build());
        assert_eq!(
            live.proposal_message(acc(owner), acc("toll.nearcarta.near"), U128(1), U64(3)),
            "board-v1|board.nearcarta.near|8e20273edb5dd279e4414cd962f023daa15c8b04450d4a4905f6aae074e661c8|toll.nearcarta.near|1|3"
        );
        let err = catch_unwind(AssertUnwindSafe(|| {
            live.propose(acc(owner), acc("toll.nearcarta.near"), U128(1), "00".repeat(64), None);
        })).unwrap_err();
        assert!(refuse(err).contains("ERR_BAD_SIG"));
        assert_eq!(live.get_charter(acc(owner)).unwrap().balance.0, row.balance.0);
        assert_eq!(live.get_charter(acc(owner)).unwrap().nonce.0, 3);
        assert_eq!(encode(&live), raw.as_slice());

        let sk = SigningKey::from_bytes(&[9u8; 32]);
        live.rows.get_mut(&acc(owner)).unwrap().agent = sk.verifying_key().to_bytes();
        let stored_day = live.rows.get(&acc(owner)).unwrap().day;
        let when = if stored_day == 0 { NS_PER_DAY } else { 1 };
        assert!(when <= row.expires_at.0);
        let amount = row.min_amount.0;
        b.block_timestamp(when);
        testing_env!(b.build());
        let call_msg = live.call_message(acc(owner), acc("wrap.near"), "near_deposit".into(), b"{}".to_vec(), U128(amount), U64(3));
        let call_sig = hex32_n(&sk.sign(call_msg.as_bytes()).to_bytes());
        let err = catch_unwind(AssertUnwindSafe(|| {
            live.propose_call(acc(owner), acc("wrap.near"), "near_deposit".into(), b"{}".to_vec(), U128(amount), call_sig);
        })).unwrap_err();
        let msg = refuse(err);
        assert!(msg.contains("method_not_allowlisted"), "{msg}");
        assert_eq!(live.get_charter(acc(owner)).unwrap().balance.0, row.balance.0);
        let (_, sig) = sign(&sk, &live, owner, "toll.nearcarta.near", amount);
        live.propose(acc(owner), acc("toll.nearcarta.near"), U128(amount), sig, None);
        assert_eq!(live.get_charter(acc(owner)).unwrap().balance.0, row.balance.0 - amount);
        assert_eq!(live.get_charter(acc(owner)).unwrap().nonce.0, 4);
    }

    #[test]
    fn propose_call_covers_allow_wrong_key_replay_allowlist_caps_expiry_freeze_and_refund() {
        let (mut c, sk, _) = boot();
        let args = b"{}";
        let deposit = NEAR / 2000;
        allow(&mut c, deposit, NEAR / 1000);
        let before = c.get_charter(acc(ALICE)).unwrap().balance.0;
        let used = call(&mut c, &sk, "near_deposit", args, deposit);
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().balance.0, before - deposit);
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().nonce.0, 1);
        let receipts = get_created_receipts();
        assert!(receipts.iter().any(|r| r.receiver_id == acc(SHOP) && r.actions.iter().any(|a| matches!(a, MockAction::FunctionCallWeight { method_name, attached_deposit, .. } if method_name == b"near_deposit" && attached_deposit.as_yoctonear() == deposit))));

        go(ALICE, 0, 0);
        let bad = SigningKey::from_bytes(&[8u8; 32]);
        let sig = sign_call(&bad, &c, "near_deposit", args, deposit);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose_call(acc(ALICE), acc(SHOP), "near_deposit".into(), args.to_vec(), U128(deposit), sig);
        })).unwrap_err();
        assert!(refuse(err).contains("ERR_BAD_SIG"));
        go(ALICE, 0, 0);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose_call(acc(ALICE), acc(SHOP), "near_deposit".into(), args.to_vec(), U128(deposit), used);
        })).unwrap_err();
        assert!(refuse(err).contains("ERR_BAD_SIG"), "replayed nonce");

        go(ALICE, 0, 0);
        let sig = sign_call(&sk, &c, "ft_transfer", args, deposit);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose_call(acc(ALICE), acc(SHOP), "ft_transfer".into(), args.to_vec(), U128(deposit), sig);
        })).unwrap_err();
        assert!(refuse(err).contains("method_not_allowlisted"));

        go(ALICE, 0, 0);
        let sig = sign_call(&sk, &c, "near_deposit", args, deposit * 2);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose_call(acc(ALICE), acc(SHOP), "near_deposit".into(), args.to_vec(), U128(deposit * 2), sig);
        })).unwrap_err();
        assert!(refuse(err).contains("over_shop_cap"));

        allow(&mut c, NEAR / 500, deposit);
        go(ALICE, 0, 0);
        let sig = sign_call(&sk, &c, "near_deposit", args, deposit * 2);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose_call(acc(ALICE), acc(SHOP), "near_deposit".into(), args.to_vec(), U128(deposit * 2), sig);
        })).unwrap_err();
        let msg = refuse(err);
        assert!(msg.contains("over_session_cap"), "{msg}");

        go(ALICE, 0, 0);
        c.set_rules(RulesIn { expires_at: U64(1), ..rules((0, 0), 4) });
        go(ALICE, 0, 50);
        allow(&mut c, NEAR / 500, NEAR / 100);
        go(ALICE, 0, 50);
        let sig = sign_call(&sk, &c, "near_deposit", args, deposit);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose_call(acc(ALICE), acc(SHOP), "near_deposit".into(), args.to_vec(), U128(deposit), sig);
        })).unwrap_err();
        assert!(refuse(err).contains("clause_expired"));

        go(ALICE, 0, 0);
        c.set_rules(rules((0, 0), 4));
        go(ALICE, 0, 0);
        c.set_frozen(true);
        go(ALICE, 0, 0);
        let sig = sign_call(&sk, &c, "near_deposit", args, deposit);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose_call(acc(ALICE), acc(SHOP), "near_deposit".into(), args.to_vec(), U128(deposit), sig);
        })).unwrap_err();
        assert!(refuse(err).contains("frozen"));
        go(ALICE, 0, 0);
        c.set_frozen(false);

        allow(&mut c, NEAR / 500, NEAR / 100);
        let bal = c.get_charter(acc(ALICE)).unwrap().balance.0;
        let spent = c.calls.get(&acc(ALICE)).unwrap().session_spent;
        call(&mut c, &sk, "near_deposit", args, deposit);
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().balance.0, bal - deposit);
        let mut b = VMContextBuilder::new();
        b.current_account_id(acc("charters.nearcarta.near"))
            .predecessor_account_id(acc("charters.nearcarta.near"))
            .prepaid_gas(Gas::from_tgas(30))
            .account_balance(NearToken::from_near(30));
        testing_env!(b.build(), test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Failed]);
        c.on_called(acc(ALICE), U128(deposit), U64(0));
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().balance.0, bal);
        assert_eq!(c.calls.get(&acc(ALICE)).unwrap().session_spent, spent);
    }

    fn b58encode(data: &[u8]) -> String {
        const A: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
        let zeros = data.iter().take_while(|b| **b == 0).count();
        let mut n = data.iter().fold(vec![0u8], |mut acc, &b| {
            let mut carry = b as u32;
            for d in acc.iter_mut() {
                let v = (*d as u32) * 256 + carry;
                *d = (v % 58) as u8;
                carry = v / 58;
            }
            while carry > 0 { acc.push((carry % 58) as u8); carry /= 58; }
            acc
        });
        n.reverse();
        "1".repeat(zeros) + &n.into_iter().map(|d| A[d as usize] as char).collect::<String>()
    }
}
