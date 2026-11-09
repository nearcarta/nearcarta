#![cfg_attr(not(test), no_std)]
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
//! lives under the `CALLS` storage key, not inside `STATE`. `propose_call`
//! caps the NEAR deposit only. A foreign asset needs `propose_call_as`.
//! Effect budgets, in-flight holds and the side reserve live under `ACTS`.
//! The policy epoch, the confirm key and the upgrade timer live under `META`.
//! Neither key is inside `STATE`, so a row opened by the previous wasm still loads.
//! The refusal strings, the window rule and the sealed-rule commitment match
//! the oath charter (`oath-hidden-v1`, clause id `pay`).

extern crate alloc;

mod v2;
use v2::{decode_acts, decode_meta, encode_acts};
use near_sdk::json_types::{U128, U64};
use near_sdk::store::LookupMap;
use near_sdk::{env, require, AccountId, Gas, NearToken, Promise};
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec;
use alloc::vec::Vec;

/// A few rows, not a tree. One call touches one visitor.
struct Map<K, V> { v: Vec<(K, V)> }
impl<K: PartialEq, V> Map<K, V> {
    fn new() -> Self { Self { v: Vec::new() } }
    fn len(&self) -> usize { self.v.len() }
    fn is_empty(&self) -> bool { self.v.is_empty() }
    fn contains_key(&self, k: &K) -> bool { self.v.iter().any(|(a, _)| a == k) }
    fn get(&self, k: &K) -> Option<&V> { self.v.iter().find(|(a, _)| a == k).map(|(_, v)| v) }
    fn get_mut(&mut self, k: &K) -> Option<&mut V> { self.v.iter_mut().find(|(a, _)| a == k).map(|(_, v)| v) }
    fn insert(&mut self, k: K, val: V) -> Option<V> {
        if let Some((_, slot)) = self.v.iter_mut().find(|(a, _)| a == &k) { return Some(core::mem::replace(slot, val)); }
        self.v.push((k, val));
        None
    }
    fn remove(&mut self, k: &K) -> Option<V> {
        let i = self.v.iter().position(|(a, _)| a == k)?;
        Some(self.v.swap_remove(i).1)
    }
    fn retain(&mut self, mut f: impl FnMut(&K, &V) -> bool) { self.v.retain(|(k, v)| f(k, v)); }
    fn entry(&mut self, k: K) -> Ent<'_, K, V> { Ent { map: self, key: Some(k) } }
    fn keys(&self) -> impl Iterator<Item = &K> { self.v.iter().map(|(k, _)| k) }
    fn values(&self) -> impl Iterator<Item = &V> { self.v.iter().map(|(_, v)| v) }
}
impl<'a, K, V> IntoIterator for &'a Map<K, V> {
    type Item = (&'a K, &'a V);
    type IntoIter = MapIter<'a, K, V>;
    fn into_iter(self) -> Self::IntoIter { MapIter { map: self, i: 0 } }
}
struct MapIter<'a, K, V> { map: &'a Map<K, V>, i: usize }
impl<'a, K, V> Iterator for MapIter<'a, K, V> {
    type Item = (&'a K, &'a V);
    fn next(&mut self) -> Option<Self::Item> {
        let pair = self.map.v.get(self.i)?;
        self.i += 1;
        Some((&pair.0, &pair.1))
    }
}
struct Ent<'a, K, V> { map: &'a mut Map<K, V>, key: Option<K> }
impl<'a, K: PartialEq, V> Ent<'a, K, V> {
    fn or_insert(&mut self, val: V) -> &mut V {
        let k = self.key.take().expect("entry");
        if let Some(i) = self.map.v.iter().position(|(a, _)| a == &k) { return &mut self.map.v[i].1; }
        self.map.v.push((k, val));
        let n = self.map.v.len() - 1;
        &mut self.map.v[n].1
    }
}
struct Set<T> { v: Vec<T> }
impl<T: PartialEq> Set<T> {
    fn new() -> Self { Self { v: Vec::new() } }
    fn insert(&mut self, t: T) -> bool {
        if self.v.iter().any(|x| x == &t) { return false; }
        self.v.push(t);
        true
    }
}

/// 0.04 NEAR, 4000 bytes of trie per row. 3000 could not hold a row that covers every shop
/// the city drives through the board (8 receivers, 17 pairs locks 3423 B with the 1400 B reserve).
///
/// It was 0.02 (2000 bytes), which the shops outgrew. Measured on mainnet 2026-11-08 with a
/// clean seven-pair Town Hall row: 1858 bytes locked with the 600-byte side reserve, and the
/// per-action hold `propose_call_as` writes needed more than the row had left, so Post job
/// panicked ERR_DEPOSIT before the shop was ever reached. The same wall stops the toll
/// crossing and every held payment. The cap is what the visitor deposits and gets back on
/// close, so raising it costs a visitor nothing that is not returned.
pub const MAX_ROW_YOCTO: u128 = 40_000_000_000_000_000_000_000;
pub const MAX_RECEIVERS: usize = 8;
/// `set_calls` dedupes (receiver, method) and stops at this many. Pay receivers stay at 8.
pub const MAX_CALLS: usize = 24;
/// The bytes `set_calls` prepays so the small side records a row needs LATER are already
/// paid for: an effect budget, and the per-action hold `propose_call_as` writes.
///
/// Measured on mainnet 2026-11-08, row `8ccd5d33…`, with a clean seven-pair Hall row at
/// 1858 bytes locked. Pressing Post job in the city wrote the hold record and panicked
/// ERR_DEPOSIT: the write cost more than the 600-byte reserve the row had prepaid, and the
/// board charges the excess to the row, which had 142 bytes of room and no attached deposit
/// because `propose_call_as` runs from the session key. A visitor could therefore never post
/// a job, cross the toll, or hold anything on a row that was not nearly empty.
///
/// The hold record is the largest side write: it carries the receiver, the method, the whole
/// argument blob and the effect list. 1400 bytes covers a 600-byte reserve plus an 800-byte
/// hold, and it is still paid out of the 0.02 NEAR row cap, so the row itself must have room.
pub const SIDE_RESERVE_BYTES: u64 = 1400;
/// Extra bytes on top of the measured `storage_usage` growth. A later trie
/// record must not be paid from the contract's own stake.
pub const STORAGE_MARGIN_BYTES: u64 = 32;
pub const MAX_OPEN_HOLDS: usize = 2;
/// One day. `stage_upgrade` cannot be applied before this, and a hold cannot
/// be signed to expire later than this.
pub const UPGRADE_DELAY_NS: u64 = 86_400_000_000_000;
pub const HOLD_MAX_NS: u64 = 86_400_000_000_000;
pub const CALL_AS_VERSION: &str = "2";
const NS_PER_MIN: u64 = 60_000_000_000;
const NS_PER_DAY: u64 = 86_400 * NS_PER_MIN;
/// Callbacks used to get 8 Tgas. Loading every row then failed, the refund
/// never ran, and the hold blocked close and reap. 20 Tgas is the floor.
const GAS_CALLBACK: Gas = Gas::from_tgas(20);

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

#[derive(Clone)]
pub struct EffectIn {
    pub chain: String,
    pub asset: String,
    pub to: String,
    pub value: u128,
    pub fee: u128,
}

#[derive(Clone)]
struct EffectCap {
    chain: String,
    asset: String,
    receiver: String,
    value_cap: u128,
    value_spent: u128,
    fee_cap: u128,
    fee_spent: u128,
}

#[derive(Clone)]
struct Hold {
    receiver: AccountId,
    method: String,
    args: Vec<u8>,
    amount: u128,
    day: u64,
    effects: Vec<EffectIn>,
    expires: u64,
    pending: bool,
    /// Policy epoch and confirm key at the moment the hold was signed.
    /// `confirm_hold` refuses when either has moved.
    epoch: u64,
    confirm: [u8; 32],
}

pub struct Board {
    owner: AccountId,
    rows: Map<AccountId, Row>,
    keys: Map<[u8; 32], AccountId>,
    count: u32,
    calls: Map<AccountId, CallPolicy>,
    effects: Map<AccountId, Vec<EffectCap>>,
    holds: Map<(AccountId, u64), Hold>,
    credit: Map<AccountId, u128>,
    confirm: Map<AccountId, [u8; 32]>,
    epoch: Map<AccountId, u64>,
    network: String,
    upgrade_hash: [u8; 32],
    upgrade_eta: u64,
    upgrade_set: bool,
    /// Global liability. Used when `partial` is set and the maps hold one row.
    owed: u128,
    hold_count: u32,
    /// True when this value was loaded from keyed storage and does not contain every row.
    partial: bool,
    dropped_rows: Vec<AccountId>,
    dropped_keys: Vec<[u8; 32]>,
    /// Hold ids loaded from storage, so a save can delete the ones that were removed.
    seen_holds: Vec<(AccountId, u64)>,
}

fn blank(owner: AccountId) -> Board {
    board_from(owner, Map::new(), Map::new(), 0, Map::new())
}
fn board_from(owner: AccountId, rows: Map<AccountId, Row>, keys: Map<[u8; 32], AccountId>, count: u32, calls: Map<AccountId, CallPolicy>) -> Board {
    Board {
        owner, rows, keys, count, calls,
        effects: Map::new(), holds: Map::new(), credit: Map::new(),
        confirm: Map::new(), epoch: Map::new(), network: "mainnet".into(),
        upgrade_hash: [0; 32], upgrade_eta: 0, upgrade_set: false,
        owed: 0, hold_count: 0, partial: false, dropped_rows: Vec::new(), dropped_keys: Vec::new(),
        seen_holds: Vec::new(),
    }
}

impl Board {
    pub fn new() -> Self {
        board_from(env::predecessor_account_id(), Map::new(), Map::new(), 0, Map::new())
    }

    /// Open this visitor's row. `fund` stays as spendable balance.
    /// Deposit past the row's storage and that fund is transferred back.
    pub fn open_charter(&mut self, rules: RulesIn, agent: String, fund: U128) {
        let me = env::predecessor_account_id();
        require!(!self.row_exists(&me), "ERR_EXISTS");
        let rules = rules_from(rules);
        let pk = parse_pk(&agent);
        require!(!self.key_taken(&pk), "ERR_KEY_USED");
        let attached = env::attached_deposit().as_yoctonear();
        let before = env::storage_usage();
        self.rows.insert(me.clone(), Row {
            rules, agent: pk, frozen: false, seal: None, nonce: 0, day: today(),
            spent: 0, count: 0, balance: 0, storage_locked: 0,
        });
        self.keys.insert(pk, me.clone());
        self.count += 1;
        let cost = self.measured_growth(&me, before);
        if cost == 0 || cost > MAX_ROW_YOCTO || attached < cost + fund.0 {
            self.rows.remove(&me);
            self.keys.remove(&pk);
            self.count -= 1;
            self.erase_owner(&me);
            kv_del(b"k", &hex32(&pk));
            if cost == 0 { env::panic_str("ERR_STORAGE"); }
            if cost > MAX_ROW_YOCTO { env::panic_str("ERR_ROW_TOO_BIG"); }
            env::panic_str("ERR_DEPOSIT");
        }
        let row = self.rows.get_mut(&me).unwrap();
        row.storage_locked = cost;
        row.balance = fund.0;
        self.owe((cost + fund.0) as i128);
        refund(&me, attached - cost - fund.0);
    }

    pub fn set_rules(&mut self, rules: RulesIn) {
        full_key();
        let me = env::predecessor_account_id();
        self.hydrate(&me);
        let rules = rules_from(rules);
        let before = self.baseline(&me);
        self.rows.get_mut(&me).expect("ERR_NO_CHARTER").rules = rules;
        self.bump_epoch(&me);
        self.charge(&me, before);
    }

    pub fn set_frozen(&mut self, frozen: bool) {
        if !frozen { full_key(); }
        let me = env::predecessor_account_id();
        self.hydrate(&me);
        self.rows.get_mut(&me).expect("ERR_NO_CHARTER").frozen = frozen;
        refund(&me, env::attached_deposit().as_yoctonear());
    }

    /// Store sha256 of the hidden rule. The rule text is not stored.
    /// Empty clears it. The text is `oath-hidden-v1` with clause id `pay`.
    pub fn set_seal(&mut self, commitment: String) {
        full_key();
        let me = env::predecessor_account_id();
        self.hydrate(&me);
        let seal = if commitment.is_empty() { None } else { Some(parse_hex32(&commitment)) };
        let before = self.baseline(&me);
        self.rows.get_mut(&me).expect("ERR_NO_CHARTER").seal = seal;
        self.charge(&me, before);
    }

    pub fn set_agent(&mut self, agent: String) {
        full_key();
        let me = env::predecessor_account_id();
        self.hydrate(&me);
        let pk = parse_pk(&agent);
        require!(self.key_owner(&pk).map(|o| o == me).unwrap_or(true), "ERR_KEY_USED");
        let before = self.baseline(&me);
        let old = self.rows.get(&me).expect("ERR_NO_CHARTER").agent;
        self.keys.remove(&old);
        if old != pk { self.dropped_keys.push(old); }
        self.keys.insert(pk, me.clone());
        self.rows.get_mut(&me).unwrap().agent = pk;
        self.bump_epoch(&me);
        self.charge(&me, before);
    }

    pub fn fund(&mut self) {
        let me = env::predecessor_account_id();
        self.hydrate(&me);
        let row = self.rows.get_mut(&me).expect("ERR_NO_CHARTER");
        let add = env::attached_deposit().as_yoctonear();
        row.balance += add;
        self.owe(add as i128);
    }

    pub fn close_charter(&mut self) -> Promise {
        let me = env::predecessor_account_id();
        self.hydrate(&me);
        self.release(me)
    }

    /// Owner closes one visitor's row. The stake and the unspent balance go to
    /// that visitor, the same as `close_charter`. After the last row, `reap` can run.
    pub fn force_close(&mut self, visitor: AccountId) -> Promise {
        full_key();
        require!(env::predecessor_account_id() == self.owner, "ERR_NOT_OWNER");
        self.hydrate(&visitor);
        self.release(visitor)
    }

    fn release(&mut self, who: AccountId) -> Promise {
        require!(!self.holds.keys().any(|(o, _)| o == &who), "ERR_IN_FLIGHT");
        let before = self.baseline(&who);
        let row = self.rows.remove(&who).expect("ERR_NO_CHARTER");
        self.keys.remove(&row.agent);
        self.dropped_rows.push(who.clone());
        self.dropped_keys.push(row.agent);
        self.owe(-((row.balance + row.storage_locked) as i128));
        self.calls.remove(&who);
        self.effects.remove(&who);
        let hold_ids: Vec<u64> = self.holds.keys().filter(|(o, _)| o == &who).map(|(_, id)| *id).collect();
        for id in &hold_ids {
            self.holds.remove(&(who.clone(), *id));
            kv_del(b"h", &format!("{}/{}", who.as_str(), id));
        }
        // The unspent reserve is refunded below. It is part of `storage_locked` (`set_calls`
        // adds it there), so the line above already took it out of `owed`. Subtracting it a
        // second time only hid the double count in `charge_acts` and the hold path, and with a
        // second row open it would push `owed` under what that row is really owed.
        let credit = self.credit.remove(&who).unwrap_or(0);
        self.confirm.remove(&who);
        self.epoch.remove(&who);
        self.count -= 1;
        // With no row left nothing can be owed: every balance, stake and reserve went back at
        // its own close. The running `owed` can drift above that, because a side record the
        // reserve paid for was added to it a second time. On mainnet 2026-11-09 it read
        // 0.00483 NEAR with 0 rows, and `reap` refused ERR_LIABILITY. Settle it to the truth here.
        let holds_clear = if self.partial { self.hold_count == 0 } else { self.holds.is_empty() };
        if self.count == 0 && holds_clear { self.owed = 0; }
        self.flush_owner(&who);
        let freed_bytes = before.saturating_sub(env::storage_usage());
        // The margin charged on the way in is not stored, so it is not in this
        // drop. It stays with the contract.
        let back = freed_bytes as u128 * price() + credit + row.balance + env::attached_deposit().as_yoctonear();
        require!(back > 0, "ERR_REFUND");
        Promise::new(who).transfer(NearToken::from_yoctonear(back))
    }

    pub fn propose(&mut self, owner: AccountId, receiver: AccountId, amount: U128, signature: String, reveal: Option<Reveal>) -> Promise {
        self.hydrate(&owner);
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
        self.owe(-(amount as i128));
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

    /// Callback. Only this board may call it (the export checks too), so a stranger cannot
    /// put spent NEAR back on a row.
    pub fn on_paid(&mut self, owner: AccountId, amount: U128, day: U64) {
        require!(env::predecessor_account_id() == env::current_account_id(), "ERR_PRIVATE");
        self.hydrate(&owner);
        if near_sdk::is_promise_success() { return; }
        let found = if let Some(row) = self.rows.get_mut(&owner) {
            row.balance += amount.0;
            if row.day == day.0 {
                row.spent = row.spent.saturating_sub(amount.0);
                row.count = row.count.saturating_sub(1);
            }
            true
        } else { false };
        if found { self.owe(amount.0 as i128); }
    }

    /// The visitor names which (receiver, method) pairs the agent may call, and the session ceiling.
    /// `propose` is unchanged. An empty list clears the policy.
    pub fn set_calls(&mut self, rules: Vec<(AccountId, String, u128)>, session_cap: u128) {
        full_key();
        let me = env::predecessor_account_id();
        self.hydrate(&me);
        require!(self.rows.contains_key(&me), "ERR_NO_CHARTER");
        require!(rules.len() <= MAX_CALLS, "ERR_RECEIVERS");
        let mut seen = Set::new();
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
        let before = self.baseline(&me);
        if parsed.is_empty() {
            self.calls.remove(&me);
        } else {
            self.calls.insert(me.clone(), CallPolicy { rules: parsed, session_cap, session_spent: spent });
        }
        self.bump_epoch(&me);
        self.charge_calls_and_reserve(&me, before);
    }

    /// A signed function call. The message covers the method and sha256(args). The deposit
    /// comes from the row. A failed call is returned by `on_called`.
    pub fn propose_call(&mut self, owner: AccountId, receiver: AccountId, method: String, args: Vec<u8>, deposit: U128, signature: String) -> Promise {
        self.hydrate(&owner);
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
        require!(in_window(row.rules.window_start_min, row.rules.window_end_min), "outside_time_window");
        require!(deposit >= row.rules.min_amount, "below_min_amount");
        // `stamp` pays this contract and the method returns the NEAR to the same row.
        // It is not a shop, so it does not need to be on the payee list.
        let stamp = receiver == env::current_account_id() && method == "stamp";
        require!(stamp || row.rules.receivers.contains(&receiver), "receiver_not_allowlisted");
        require!(args.len() <= 2048, "ERR_ARGS");
        // Shops trust a top-level `row_owner` when the predecessor is this board. This path
        // forwards `args` as signed, so a row could name ANOTHER visitor (or a keeper) there and
        // act as them. `propose_call_as` overwrites the field; here it is refused outright.
        refuse_row_owner(&args);
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
        self.owe(-(deposit as i128));
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

    /// Called only by `propose_call` on this contract. The attached deposit goes
    /// back onto the same row. The daily counters stay spent: the stamp was allowed.
    pub fn stamp(&mut self, owner: AccountId) {
        require!(env::predecessor_account_id() == env::current_account_id(), "ERR_PRIVATE");
        self.hydrate(&owner);
        let add = env::attached_deposit().as_yoctonear();
        let row = self.rows.get_mut(&owner).expect("ERR_NO_CHARTER");
        row.balance += add;
        self.owe(add as i128);
    }

    /// Callback. Only this board may call it (the export checks too), so a stranger cannot
    /// put spent NEAR back on a row.
    pub fn on_called(&mut self, owner: AccountId, amount: U128, day: U64) {
        require!(env::predecessor_account_id() == env::current_account_id(), "ERR_PRIVATE");
        self.hydrate(&owner);
        if near_sdk::is_promise_success() { return; }
        let found = if let Some(row) = self.rows.get_mut(&owner) {
            row.balance += amount.0;
            if row.day == day.0 {
                row.spent = row.spent.saturating_sub(amount.0);
                row.count = row.count.saturating_sub(1);
            }
            true
        } else { false };
        if let Some(policy) = self.calls.get_mut(&owner) {
            policy.session_spent = policy.session_spent.saturating_sub(amount.0);
        }
        if found { self.owe(amount.0 as i128); }
    }

    pub fn call_message(&self, owner: AccountId, receiver: AccountId, method: String, args: Vec<u8>, deposit: U128, nonce: U64) -> String {
        call_text(&owner, &receiver, &method, &args, deposit.0, nonce.0)
    }

    pub fn reap(&mut self) -> Promise {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "ERR_ONE_YOCTO");
        require!(env::predecessor_account_id() == self.owner, "ERR_NOT_OWNER");
        require!(self.count == 0, "ERR_NONEMPTY");
        let holds_clear = if self.partial { self.hold_count == 0 } else { self.holds.is_empty() };
        require!(holds_clear && self.liabilities() == 0, "ERR_LIABILITY");
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

    /// Write the visitor's current keys if this VM has not seen them yet.
    /// A unit test resets the trie between calls. Mainnet does not, so this
    /// read is the only cost there.
    fn baseline(&mut self, me: &AccountId) -> u64 {
        if self.rows.contains_key(me) && !kv_has(b"r", me.as_str()) {
            let row = self.rows.get(me).unwrap().clone();
            persist_owner(self, me, &row);
        }
        env::storage_usage()
    }

    fn flush_owner(&mut self, me: &AccountId) {
        if let Some(row) = self.rows.get(me).cloned() {
            persist_owner(self, me, &row);
        } else {
            self.erase_owner(me);
        }
        for pk in &self.dropped_keys { kv_del(b"k", &hex32(pk)); }
        let stale: Vec<(AccountId, u64)> = self.seen_holds.iter().cloned().filter(|(o, id)| !self.holds.contains_key(&(o.clone(), *id))).collect();
        for (owner, id) in stale { kv_del(b"h", &format!("{}/{}", owner.as_str(), id)); }
    }

    fn erase_owner(&self, me: &AccountId) {
        kv_del(b"r", me.as_str());
        kv_del(b"c", me.as_str());
        kv_del(b"e", me.as_str());
        kv_del(b"s", me.as_str());
        let ids: Vec<u64> = self.holds.keys().filter(|(o, _)| o == me).map(|(_, id)| *id).collect();
        for id in ids { kv_del(b"h", &format!("{}/{}", me.as_str(), id)); }
    }

    /// Bytes `storage_usage` grew while this visitor's keys were written, plus the margin.
    fn measured_growth(&mut self, me: &AccountId, before: u64) -> u128 {
        self.flush_owner(me);
        let after = env::storage_usage();
        if after <= before { return 0; }
        (after - before + STORAGE_MARGIN_BYTES) as u128 * price()
    }

    fn charge(&mut self, me: &AccountId, before: u64) {
        let attached = env::attached_deposit().as_yoctonear();
        self.flush_owner(me);
        let after = env::storage_usage();
        if after > before {
            let cost = (after - before + STORAGE_MARGIN_BYTES) as u128 * price();
            require!(attached >= cost, "ERR_DEPOSIT");
            let row = self.rows.get_mut(me).unwrap();
            require!(row.storage_locked + cost <= MAX_ROW_YOCTO, "ERR_ROW_TOO_BIG");
            row.storage_locked += cost;
            self.owe(cost as i128);
            refund(me, attached - cost);
        } else {
            let freed = (before - after) as u128 * price();
            if let Some(row) = self.rows.get_mut(me) {
                row.storage_locked = row.storage_locked.saturating_sub(freed);
            }
            self.owe(-(freed as i128));
            refund(me, freed + attached);
        }
    }

    fn owe(&mut self, delta: i128) {
        if !self.partial || delta == 0 { return; }
        if delta > 0 { self.owed = self.owed.saturating_add(delta as u128); }
        else { self.owed = self.owed.saturating_sub((-delta) as u128); }
    }
}

fn push_u128(s: &mut String, mut n: u128) {
    if n == 0 { s.push('0'); return; }
    let mut buf = [0u8; 40];
    let mut i = 40;
    while n > 0 { i -= 1; buf[i] = b'0' + (n % 10) as u8; n /= 10; }
    s.push_str(core::str::from_utf8(&buf[i..]).unwrap());
}

/// JSON object args may not carry a top-level `row_owner` (any spelling the parser decodes
/// to that key). Non-JSON args carry no field a shop could read as the row owner.
fn refuse_row_owner(args: &[u8]) {
    let first = args.iter().copied().find(|b| !b.is_ascii_whitespace());
    if first != Some(b'{') { return; }
    let text = core::str::from_utf8(args).unwrap_or_else(|_| env::panic_str("ERR_ARGS"));
    if let Val::Obj(pairs) = parse(text) {
        require!(!pairs.iter().any(|(k, _)| k == "row_owner"), "ERR_ROW_OWNER");
    }
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
    let mut seen = Set::new();
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

/// Changes that loosen a row, swap its keys, or move the owner's NEAR need a full-access key:
/// a function-call key cannot attach a deposit, so a leaked browser session key cannot
/// rewrite a row's receivers or caps. Tightening (`tighten_*`, freezing) stays key-free so a
/// kill switch never waits for a wallet. The yocto is refunded with the rest of the deposit.
fn full_key() {
    require!(env::attached_deposit().as_yoctonear() >= 1, "ERR_ONE_YOCTO");
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
    let mut rows = Map::new();
    for _ in 0..n { let k = r.acc(); rows.insert(k, r.row()); }
    let m = r.u32() as usize;
    require!(m <= 10_000, "ERR_STATE");
    let mut keys = Map::new();
    for _ in 0..m { let k = r.bytes32(); keys.insert(k, r.acc()); }
    let count = r.u32();
    require!(r.i == raw.len(), "ERR_STATE");
    board_from(owner, rows, keys, count, Map::new())
}

fn encode_calls(m: &Map<AccountId, CallPolicy>) -> Vec<u8> {
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
fn decode_calls(raw: &[u8]) -> Map<AccountId, CallPolicy> {
    let mut r = Rd { s: raw, i: 0 };
    let n = r.u32() as usize;
    require!(n <= 10_000, "ERR_STATE");
    let mut out = Map::new();
    for _ in 0..n {
        let owner = r.acc();
        let k = r.u32() as usize;
        require!(k <= MAX_CALLS, "ERR_STATE");
        let mut rules = Vec::with_capacity(k);
        for _ in 0..k {
            rules.push(CallRule { receiver: r.acc(), method: r.string(), cap: r.u128() });
        }
        out.insert(owner, CallPolicy { rules, session_cap: r.u128(), session_spent: r.u128() });
    }
    require!(r.i == raw.len(), "ERR_STATE");
    out
}

fn kv(prefix: &[u8]) -> LookupMap<String, Vec<u8>> { LookupMap::new(prefix.to_vec()) }
fn kv_get(prefix: &[u8], key: &str) -> Option<Vec<u8>> { kv(prefix).get(&key.to_string()).cloned() }
fn kv_has(prefix: &[u8], key: &str) -> bool { kv(prefix).contains_key(&key.to_string()) }
fn kv_set(prefix: &[u8], key: &str, val: Vec<u8>) { let mut m = kv(prefix); m.insert(key.to_string(), val); m.flush(); }
fn kv_del(prefix: &[u8], key: &str) { let mut m = kv(prefix); m.remove(&key.to_string()); m.flush(); }

fn row_bytes(r: &Row) -> Vec<u8> { let mut o = Vec::new(); put_row(&mut o, r); o }
fn row_from(raw: &[u8]) -> Row { let mut r = Rd { s: raw, i: 0 }; let row = r.row(); require!(r.i == raw.len(), "ERR_STATE"); row }

fn write_head(b: &Board) {
    let owed = if b.partial { b.owed } else { b.liabilities() };
    let holds = if b.partial { b.hold_count } else { b.holds.len() as u32 };
    let mut o = Vec::new();
    put_u32(&mut o, 2);
    put_acc(&mut o, &b.owner);
    put_u32(&mut o, b.count);
    put_u128(&mut o, owed);
    put_u32(&mut o, holds);
    put_str(&mut o, &b.network);
    o.extend_from_slice(&b.upgrade_hash);
    put_u64(&mut o, b.upgrade_eta);
    o.push(u8::from(b.upgrade_set));
    env::storage_write(b"HEAD", &o);
}
fn read_head() -> Board {
    let raw = env::storage_read(b"HEAD").unwrap_or_else(|| env::panic_str("ERR_NO_STATE"));
    let mut r = Rd { s: &raw, i: 0 };
    require!(r.u32() == 2, "ERR_STATE");
    let mut b = blank(r.acc());
    b.count = r.u32();
    b.owed = r.u128();
    b.hold_count = r.u32();
    b.network = r.string();
    b.upgrade_hash = r.bytes32();
    b.upgrade_eta = r.u64();
    b.upgrade_set = r.u8() == 1;
    require!(r.i == raw.len(), "ERR_STATE");
    b.partial = true;
    b
}

impl Board {
    fn row_exists(&self, id: &AccountId) -> bool {
        self.rows.contains_key(id) || (self.partial && kv_has(b"r", id.as_str()))
    }
    fn key_owner(&self, pk: &[u8; 32]) -> Option<AccountId> {
        if let Some(o) = self.keys.get(pk) { return Some(o.clone()); }
        if !self.partial { return None; }
        kv_get(b"k", &hex32(pk)).map(|raw| {
            let mut r = Rd { s: &raw, i: 0 };
            let id = r.acc();
            require!(r.i == raw.len(), "ERR_STATE");
            id
        })
    }
    fn key_taken(&self, pk: &[u8; 32]) -> bool { self.key_owner(pk).is_some() }

    /// Load one visitor. A callback then reads that row, not every row on the board.
    fn hydrate(&mut self, owner: &AccountId) {
        if !self.partial || self.rows.contains_key(owner) { return; }
        if let Some(raw) = kv_get(b"r", owner.as_str()) {
            let row = row_from(&raw);
            let mut k = Vec::new();
            put_acc(&mut k, owner);
            kv_get(b"k", &hex32(&row.agent)).map(|raw| {
                let mut r = Rd { s: &raw, i: 0 };
                let id = r.acc();
                if id == *owner { self.keys.insert(row.agent, id); }
            });
            self.rows.insert(owner.clone(), row);
        }
        if let Some(raw) = kv_get(b"c", owner.as_str()) {
            let mut one = decode_calls(&raw);
            if let Some(p) = one.remove(owner) { self.calls.insert(owner.clone(), p); }
        }
        if let Some(raw) = kv_get(b"e", owner.as_str()) {
            let mut tmp = blank(self.owner.clone());
            decode_acts(&mut tmp, &raw);
            if let Some(caps) = tmp.effects.remove(owner) { self.effects.insert(owner.clone(), caps); }
        }
        if let Some(raw) = kv_get(b"s", owner.as_str()) {
            let mut r = Rd { s: &raw, i: 0 };
            let epoch = r.u64();
            if epoch != 0 { self.epoch.insert(owner.clone(), epoch); }
            if r.u8() == 1 { self.confirm.insert(owner.clone(), r.bytes32()); }
            let credit = r.u128();
            if credit != 0 { self.credit.insert(owner.clone(), credit); }
            let n = r.u32() as usize;
            require!(n <= MAX_OPEN_HOLDS, "ERR_STATE");
            for _ in 0..n {
                let id = r.u64();
                self.seen_holds.push((owner.clone(), id));
                let key = format!("{}/{}", owner.as_str(), id);
                if let Some(hb) = kv_get(b"h", &key) {
                    let mut tmp = blank(self.owner.clone());
                    decode_acts(&mut tmp, &hb);
                    if let Some(h) = tmp.holds.remove(&(owner.clone(), id)) { self.holds.insert((owner.clone(), id), h); }
                }
            }
            require!(r.i == raw.len(), "ERR_STATE");
        }
    }
}

fn save(b: &Board) {
    write_head(b);
    for (id, row) in &b.rows { persist_owner(b, id, row); }
    for id in &b.dropped_rows {
        kv_del(b"r", id.as_str());
        kv_del(b"c", id.as_str());
        kv_del(b"e", id.as_str());
        kv_del(b"s", id.as_str());
    }
    for pk in &b.dropped_keys { kv_del(b"k", &hex32(pk)); }
    for (owner, id) in &b.seen_holds {
        if !b.holds.contains_key(&(owner.clone(), *id)) {
            kv_del(b"h", &format!("{}/{}", owner.as_str(), id));
        }
    }
    env::storage_remove(b"STATE");
    env::storage_remove(b"CALLS");
    env::storage_remove(b"ACTS");
    env::storage_remove(b"META");
}

fn persist_owner(b: &Board, id: &AccountId, row: &Row) {
    kv_set(b"r", id.as_str(), row_bytes(row));
    let mut key = Vec::new();
    put_acc(&mut key, id);
    kv_set(b"k", &hex32(&row.agent), key);
    if let Some(p) = b.calls.get(id) {
        let mut one = Map::new();
        one.insert(id.clone(), p.clone());
        kv_set(b"c", id.as_str(), encode_calls(&one));
    } else { kv_del(b"c", id.as_str()); }
    if let Some(caps) = b.effects.get(id) {
        let mut tmp = blank(b.owner.clone());
        tmp.effects.insert(id.clone(), caps.clone());
        kv_set(b"e", id.as_str(), encode_acts(&tmp));
    } else { kv_del(b"e", id.as_str()); }
    let mut holds = Vec::new();
    for ((owner, hid), h) in &b.holds {
        if owner != id { continue; }
        let mut tmp = blank(b.owner.clone());
        tmp.holds.insert((owner.clone(), *hid), h.clone());
        kv_set(b"h", &format!("{}/{}", id.as_str(), hid), encode_acts(&tmp));
        holds.push(*hid);
    }
    let epoch = b.epoch.get(id).copied().unwrap_or(0);
    let confirm = b.confirm.get(id).copied();
    let credit = b.credit.get(id).copied().unwrap_or(0);
    if epoch == 0 && confirm.is_none() && credit == 0 && holds.is_empty() {
        kv_del(b"s", id.as_str());
    } else {
        let mut o = Vec::new();
        put_u64(&mut o, epoch);
        match confirm { Some(pk) => { o.push(1); o.extend_from_slice(&pk); } None => o.push(0) }
        put_u128(&mut o, credit);
        put_u32(&mut o, holds.len() as u32);
        for id in &holds { put_u64(&mut o, *id); }
        kv_set(b"s", id.as_str(), o);
    }
}

fn load() -> Board {
    if env::storage_has_key(b"HEAD") { return read_head(); }
    let raw = env::storage_read(b"STATE").unwrap_or_else(|| env::panic_str("ERR_NO_STATE"));
    let mut b = decode(&raw);
    if let Some(raw) = env::storage_read(b"CALLS") { b.calls = decode_calls(&raw); }
    if let Some(raw) = env::storage_read(b"ACTS") { decode_acts(&mut b, &raw); }
    if let Some(raw) = env::storage_read(b"META") { decode_meta(&mut b, &raw); }
    b.partial = false;
    b.owed = b.liabilities();
    b.hold_count = b.holds.len() as u32;
    b
}
fn input_str() -> String {
    String::from_utf8(env::input().unwrap_or_default()).unwrap_or_else(|_| env::panic_str("ERR_ARGS"))
}
fn ret(s: &str) { env::value_return(s.as_bytes()); }

#[no_mangle]
pub extern "C" fn new() {
    // Without this, anyone could call `new` on the live board: it rewrote HEAD with the caller as
    // owner and zero rows and zero liabilities, and `reap` then paid the whole balance to them.
    require!(!env::storage_has_key(b"HEAD") && !env::storage_has_key(b"STATE"), "ERR_INIT");
    save(&Board::new());
}

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
pub extern "C" fn stamp() {
    let v = parse(&input_str());
    let mut b = load();
    b.stamp(v.need("owner").account());
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
    let mut b = load();
    b.hydrate(&owner);
    match b.get_charter(owner) {
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
            b'n' => { self.word(b"null"); Val::Null }
            b't' => { self.word(b"true"); Val::Bool(true) }
            b'f' => { self.word(b"false"); Val::Bool(false) }
            b'"' => Val::Str(self.str()),
            b'[' => self.arr(),
            b'{' => self.obj(),
            b'-' | b'0'..=b'9' => self.num(),
            _ => env::panic_str("ERR_ARGS"),
        }
    }
    fn word(&mut self, w: &[u8]) {
        require!(self.i + w.len() <= self.s.len() && &self.s[self.i..self.i + w.len()] == w, "ERR_ARGS");
        self.i += w.len();
    }
    fn str(&mut self) -> String {
        self.eat(b'"');
        let mut raw = Vec::new();
        while self.i < self.s.len() {
            let c = self.s[self.i];
            self.i += 1;
            if c == b'"' { return String::from_utf8(raw).unwrap_or_else(|_| env::panic_str("ERR_ARGS")); }
            if c != b'\\' { raw.push(c); continue; }
            require!(self.i < self.s.len(), "ERR_ARGS");
            let e = self.s[self.i];
            self.i += 1;
            let byte = match e {
                b'"' | b'\\' | b'/' => e,
                b'b' => 0x08,
                b'f' => 0x0c,
                b'n' => b'\n',
                b'r' => b'\r',
                b't' => b'\t',
                b'u' => {
                    require!(self.i + 4 <= self.s.len(), "ERR_ARGS");
                    let hex = core::str::from_utf8(&self.s[self.i..self.i + 4]).unwrap_or_else(|_| env::panic_str("ERR_ARGS"));
                    self.i += 4;
                    let u = u32::from_str_radix(hex, 16).unwrap_or_else(|_| env::panic_str("ERR_ARGS"));
                    let ch = char::from_u32(u).unwrap_or_else(|| env::panic_str("ERR_ARGS"));
                    let mut buf = [0u8; 4];
                    raw.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                    continue;
                }
                _ => env::panic_str("ERR_ARGS"),
            };
            raw.push(byte);
        }
        env::panic_str("ERR_ARGS")
    }
    fn num(&mut self) -> Val {
        let a = self.i;
        if self.s[self.i] == b'-' {
            self.i += 1;
            require!(self.i < self.s.len() && self.s[self.i].is_ascii_digit(), "ERR_ARGS");
        }
        require!(self.i < self.s.len() && self.s[self.i].is_ascii_digit(), "ERR_ARGS");
        if self.s[self.i] == b'0' {
            self.i += 1;
            require!(self.i >= self.s.len() || !self.s[self.i].is_ascii_digit(), "ERR_ARGS");
        } else {
            while self.i < self.s.len() && self.s[self.i].is_ascii_digit() { self.i += 1; }
        }
        if self.i < self.s.len() && matches!(self.s[self.i], b'.' | b'e' | b'E') { env::panic_str("ERR_ARGS"); }
        Val::Num(String::from_utf8(self.s[a..self.i].to_vec()).unwrap())
    }
    fn arr(&mut self) -> Val { self.eat(b'['); let mut a = Vec::new(); if self.peek() != b']' { loop { a.push(self.val()); if self.peek() != b',' { break; } self.i += 1; } } self.eat(b']'); Val::Arr(a) }
    fn obj(&mut self) -> Val { self.eat(b'{'); let mut o = Vec::new(); if self.peek() != b'}' { loop { let k = self.str(); self.eat(b':'); o.push((k, self.val())); if self.peek() != b',' { break; } self.i += 1; } } self.eat(b'}'); Val::Obj(o) }
}
#[cfg(test)]
#[allow(unused_must_use)]
mod tests {
    use super::*;
    use super::v2::{acts_len, inject_row_owner};
    use ed25519_dalek::{Signer, SigningKey};
    use near_sdk::mock::MockAction;
    use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
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

    /// The mainnet test row: an implicit owner, every receiver the city drives through the board
    /// (Hall, Arena, House, Toll, Guard, wrap.near for Ferry/Payouts, native USDC for the Payouts
    /// storage sponsor, and one NEAR payee) and every pair those shops send, plus the board stamp.
    /// It must fit the row with the 1400-byte side reserve, or the reopen would fail after gas.
    #[test]
    fn a_row_with_every_board_shop_fits_the_row_cap() {
        let owner = "8ccd5d33d2e8eb2d27eef13a7a0c88ae2ea9209c002fa7f27ed6021592393bb9";
        go("nearcarta.near", 0, 0);
        let mut c = Board::new();
        let (_sk, pk) = keypair(9);
        let usdc = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
        let (th, ar, ho) = ("townhall.nearcarta.near", "arena.nearcarta.near", "house.nearcarta.near");
        let shops = [th, ar, ho, "toll.nearcarta.near", "guard.nearcarta.near", "wrap.near", usdc, "nearcarta.near"];
        let mut r = rules((0, 0), 8);
        r.receivers = shops.iter().map(|s| acc(s)).collect();
        r.per_action_cap = U128(NEAR / 1000);
        r.daily_budget = U128(NEAR / 100);
        go(owner, MAX_ROW_YOCTO, 0);
        c.open_charter(r, pk, U128(NEAR / 200));
        let pairs = [
            (th, "post_job"), (th, "bid"), (th, "counter"), (th, "accept"), (th, "deliver"), (th, "review"), (th, "refund"),
            (ar, "fund"), (ho, "house_session_check_in"), (ho, "house_session_prepare_send"),
            ("toll.nearcarta.near", "cross"), ("guard.nearcarta.near", "pay"),
            ("wrap.near", "near_deposit"), ("wrap.near", "ft_transfer"), ("wrap.near", "storage_deposit"),
            (usdc, "storage_deposit"), ("charters.nearcarta.near", "stamp"),
        ];
        go(owner, 5 * NEAR / 100, 0);
        c.set_calls(pairs.iter().map(|(a, m)| (acc(a), m.to_string(), NEAR / 1000)).collect(), NEAR / 100);
        let v = c.get_charter(acc(owner)).unwrap();
        assert!(v.storage_locked.0 <= MAX_ROW_YOCTO, "row {}", v.storage_locked.0);
        eprintln!("every-shop row storage_locked {}", v.storage_locked.0);
    }

    /// A drifted `owed` cannot block the teardown: closing the last row settles it to zero.
    #[test]
    fn closing_the_last_row_settles_a_drifted_ledger_and_reap_runs() {
        let (mut c, _sk, _pk) = boot();
        c.owed += 4_830_000_000_000_000_000_000;
        go(ALICE, 0, 0);
        c.close_charter();
        assert_eq!(c.owed, 0);
        go("nearcarta.near", 1, 0);
        c.reap();
    }

    /// `simulate` answers a board stamp the way the send path treats it.
    #[test]
    fn simulate_lets_the_board_stamp_through_without_a_payee_entry() {
        let (mut c, _sk, _pk) = boot();
        go(ALICE, 5 * NEAR / 100, 0);
        c.set_calls(vec![(acc("charters.nearcarta.near"), "stamp".to_string(), NEAR / 1000)], NEAR / 100);
        go(ALICE, 0, 0);
        let a = c.simulate(acc(ALICE), acc("charters.nearcarta.near"), "stamp".into(), U128(NEAR / 2000), vec![]);
        assert!(a.contains("\"allowed\""), "{a}");
        let b = c.simulate(acc(ALICE), acc(OTHER), "stamp".into(), U128(NEAR / 2000), vec![]);
        assert!(b.contains("receiver_not_allowlisted"), "{b}");
    }

    /// Setting an effect budget and clearing it again must never pay out more than went in.
    /// Before the fix, the bytes a reserve-paid record freed went back to the reserve AND to
    /// the visitor as cash, so each set/clear cycle paid the row free NEAR from the board.
    #[test]
    fn an_effect_set_and_clear_cycle_pays_nothing_out() {
        let (mut c, _, _) = boot();
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_calls(vec![(acc(SHOP), "cross".into(), NEAR / 50)], NEAR / 10);
        let credit0 = c.side_credit(&acc(ALICE));
        let mut paid = 0u128;
        for i in 0..6 {
            go(ALICE, 1, 0);
            c.set_effects(vec![effect("base", "usdc", &format!("0x{:040x}", i), 10, 1)]);
            paid += transfers_to(ALICE).iter().sum::<u128>();
            go(ALICE, 1, 0);
            c.set_effects(vec![]);
            paid += transfers_to(ALICE).iter().sum::<u128>();
        }
        // Each call attached the full-key yocto and got exactly that back, nothing more.
        assert_eq!(paid, 12, "a reserve-paid record that is freed goes back to the reserve, not to the visitor");
        assert!(c.side_credit(&acc(ALICE)) <= credit0, "and the reserve never grows past what was prepaid");
    }

    /// The running `owed` of a partially loaded board must equal what the rows really hold,
    /// after every kind of write, not only after the last row closes.
    #[test]
    fn the_partial_ledger_matches_the_rows_after_effects_and_holds() {
        let (c, sk, _) = boot();
        save(&c);
        let truth = |b: &Board| b.rows.values().fold(0u128, |a, r| a + r.balance + r.storage_locked)
            + b.holds.values().fold(0u128, |a, h| a + h.amount);
        go(ALICE, MAX_ROW_YOCTO, 0);
        let mut b = load();
        b.hydrate(&acc(ALICE));
        b.owed = truth(&b);
        let hall: Vec<(AccountId, String, u128)> = ["post_job", "refund"].iter().map(|m| (acc(SHOP), (*m).to_string(), NEAR / 50)).collect();
        b.set_calls(hall, NEAR / 10);
        assert_eq!(b.owed, truth(&b), "after set_calls");
        save(&b);
        go(ALICE, 1, 0);
        let mut b = load();
        b.hydrate(&acc(ALICE));
        b.set_effects(vec![effect("base", "usdc", "0xabc", 10, 1)]);
        assert_eq!(b.owed, truth(&b), "after a reserve-paid effect budget");
        save(&b);
        go(ALICE, 1, 0);
        let mut b = load();
        b.hydrate(&acc(ALICE));
        b.set_effects(vec![]);
        assert_eq!(b.owed, truth(&b), "after clearing it");
        save(&b);
        go(ALICE, 0, 0);
        let mut b = load();
        b.hydrate(&acc(ALICE));
        let deposit = NEAR / 2000;
        let sig = sign_as(&sk, &b, ALICE, SHOP, "post_job", "{}", deposit, 1_000_000, Vec::new(), true);
        b.propose_call_as(acc(ALICE), acc(SHOP), "post_job".into(), "{}".into(), U128(deposit), U64(1_000_000), Vec::new(), true, sig);
        assert_eq!(b.owed, truth(&b), "after a held call");
        let id = b.holds.keys().next().unwrap().1;
        b.cancel_hold(U64(id));
        assert_eq!(b.owed, truth(&b), "after the hold is dropped");
        save(&b);
        go(ALICE, 0, 0);
        let mut b = load();
        b.hydrate(&acc(ALICE));
        assert_eq!(b.owed, truth(&b), "before close");
        save(&b);
        // A second row stays open, so the count==0 settle cannot hide a drift: the close
        // must leave `owed` at exactly what the other row holds.
        go(BOB, MAX_ROW_YOCTO, 0);
        let mut b = load();
        let (_, pk2) = keypair(9);
        b.open_charter(rules((0, 0), 4), pk2, U128(NEAR / 1000));
        b.set_calls(vec![(acc(SHOP), "post_job".into(), NEAR / 50)], NEAR / 10);
        save(&b);
        go(ALICE, 0, 0);
        let mut b = load();
        b.hydrate(&acc(ALICE));
        b.hydrate(&acc(BOB));
        b.close_charter();
        assert_eq!(b.owed, truth(&b), "close drops exactly what the closed row held");
        assert!(b.owed > 0, "and the open row is still owed");
    }

    #[test]
    fn a_stranger_cannot_call_the_payment_callbacks() {
        let (mut c, _, _) = boot();
        go(OTHER, 0, 0);
        let err = catch_unwind(AssertUnwindSafe(|| { c.on_paid(acc(ALICE), U128(NEAR), U64(0)); })).unwrap_err();
        assert!(refuse(err).contains("ERR_PRIVATE"));
        let err = catch_unwind(AssertUnwindSafe(|| { c.on_called(acc(ALICE), U128(NEAR), U64(0)); })).unwrap_err();
        assert!(refuse(err).contains("ERR_PRIVATE"));
    }

    #[test]
    fn loosening_a_row_needs_a_full_access_key_and_freezing_does_not() {
        let (mut c, _, _) = boot();
        go(ALICE, 0, 0);
        c.set_frozen(true);
        let err = catch_unwind(AssertUnwindSafe(|| { c.set_frozen(false); })).unwrap_err();
        assert!(refuse(err).contains("ERR_ONE_YOCTO"));
        let err = catch_unwind(AssertUnwindSafe(|| { c.set_rules(rules((0, 0), 9)); })).unwrap_err();
        assert!(refuse(err).contains("ERR_ONE_YOCTO"));
        let err = catch_unwind(AssertUnwindSafe(|| { c.set_calls(vec![(acc(OTHER), "x".into(), NEAR)], NEAR); })).unwrap_err();
        assert!(refuse(err).contains("ERR_ONE_YOCTO"));
        go(ALICE, 1, 0);
        c.set_frozen(false);
        assert_eq!(transfers_to(ALICE), vec![1], "the yocto comes back");
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
    fn storage_fees_cover_rows_of_different_sizes_and_the_free_balance_holds() {
        go(ALICE, MAX_ROW_YOCTO, 0);
        let mut c = Board::new();
        let cash0 = env::account_balance().as_yoctonear() as i128;
        let mut deposits: i128 = 0;
        let mut floor = cash0 - env::storage_usage() as i128 * price() as i128;
        let mut seen: u128 = 0;
        for n in [1usize, 8] {
            let usage = env::storage_usage();
            let mut wide = rules((0, 0), 4);
            wide.receivers = (0..n).map(|i| acc(&format!("shop{i}.near"))).collect();
            c.open_charter(wide, keypair((7 + n) as u8).1, U128(NEAR / 1000));
            deposits += MAX_ROW_YOCTO as i128;
            let grown = env::storage_usage() - usage;
            let locked = c.get_charter(acc(ALICE)).unwrap().storage_locked.0;
            assert!(locked >= grown as u128 * price(), "{n} receivers locked {locked} for {grown} bytes");
            seen = transfers_to(ALICE).into_iter().sum();
            let held = c.get_charter(acc(ALICE)).unwrap().balance.0 as i128;
            let free = cash0 + deposits - seen as i128 - held - env::storage_usage() as i128 * price() as i128;
            assert!(free >= floor, "{n} receivers free {free} below {floor}");
            floor = free;
            c.close_charter();
            deposits += MAX_ROW_YOCTO as i128;
            seen = transfers_to(ALICE).into_iter().sum();
            let free = cash0 + deposits - seen as i128 - env::storage_usage() as i128 * price() as i128;
            assert!(free >= floor, "close of {n} receivers free {free} below {floor}");
            floor = free;
            assert!(c.get_charter(acc(ALICE)).is_none());
            assert!(env::storage_usage() <= usage + 64, "closed row left storage behind");
        }
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
        go(ALICE, MAX_ROW_YOCTO, 100 * NS_PER_MIN);
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
        go(ALICE, MAX_ROW_YOCTO, 0);
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
        go(ALICE, 1, NS_PER_DAY);
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
        go(ALICE, 1, 0);
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
        let margin = STORAGE_MARGIN_BYTES as u128 * price();
        assert_eq!(transfers_to(ALICE).last().copied(), Some(locked - margin + NEAR / 1000));
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
        go(ALICE, 1, 0);
        let err = catch_unwind(AssertUnwindSafe(|| { c.force_close(acc(BOB)); })).unwrap_err();
        let msg = refuse(err);
        assert!(msg.contains("ERR_NOT_OWNER"), "{msg}");
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().balance.0, NEAR / 1000);
        assert_eq!(c.get_charter(acc(BOB)).unwrap().storage_locked.0, bob_locked);
        go("nearcarta.near", 1, 0);
        c.force_close(acc(ALICE));
        assert!(c.get_charter(acc(ALICE)).is_none());
        let margin = STORAGE_MARGIN_BYTES as u128 * price();
        assert_eq!(transfers_to(ALICE).last().copied(), Some(locked - margin + NEAR / 1000 + 1), "the owner's yocto rides along");
        let bob = c.get_charter(acc(BOB)).unwrap();
        assert_eq!(bob.balance.0, NEAR / 500);
        assert_eq!(bob.storage_locked.0, bob_locked);
        go("nearcarta.near", 1, 0);
        let err = catch_unwind(AssertUnwindSafe(|| { c.reap(); })).unwrap_err();
        assert!(refuse(err).contains("ERR_NONEMPTY"));
        go("nearcarta.near", 1, 0);
        c.force_close(acc(BOB));
        assert_eq!(transfers_to(BOB).last().copied(), Some(bob_locked - margin + NEAR / 500 + 1));
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
    fn a_spoofed_row_owner_through_propose_call_is_refused() {
        let (mut c, sk, _) = boot();
        allow(&mut c, NEAR / 1000, NEAR / 100);
        let bad = br#"{"x":"1","row_owner":"bob.near"}"#;
        go(ALICE, 0, 0);
        let sig = sign_call(&sk, &c, "near_deposit", bad, NEAR / 2000);
        let r = catch_unwind(AssertUnwindSafe(|| {
            c.propose_call(acc(ALICE), acc(SHOP), "near_deposit".into(), bad.to_vec(), U128(NEAR / 2000), sig.clone());
        }));
        assert!(r.is_err(), "a top-level row_owner must be refused");
        // A nested row_owner and plain args still go through.
        call(&mut c, &sk, "near_deposit", br#"{"memo":{"row_owner":"bob.near"}}"#, NEAR / 2000);
        call(&mut c, &sk, "near_deposit", b"{}", NEAR / 2000);
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
            .prepaid_gas(Gas::from_tgas(100))
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
        assert!(msg.contains("receiver_not_allowlisted"), "{msg}");
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

        go(ALICE, 1, 0);
        c.set_rules(RulesIn { expires_at: U64(1), ..rules((0, 0), 4) });
        go(ALICE, 0, 50);
        allow(&mut c, NEAR / 500, NEAR / 100);
        go(ALICE, 0, 50);
        let sig = sign_call(&sk, &c, "near_deposit", args, deposit);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose_call(acc(ALICE), acc(SHOP), "near_deposit".into(), args.to_vec(), U128(deposit), sig);
        })).unwrap_err();
        assert!(refuse(err).contains("clause_expired"));

        go(ALICE, 1, 0);
        c.set_rules(rules((0, 0), 4));
        go(ALICE, 0, 0);
        c.set_frozen(true);
        go(ALICE, 0, 0);
        let sig = sign_call(&sk, &c, "near_deposit", args, deposit);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose_call(acc(ALICE), acc(SHOP), "near_deposit".into(), args.to_vec(), U128(deposit), sig);
        })).unwrap_err();
        assert!(refuse(err).contains("frozen"));
        go(ALICE, 1, 0);
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

    fn effect(chain: &str, asset: &str, to: &str, value: u128, fee: u128) -> EffectIn {
        EffectIn { chain: chain.into(), asset: asset.into(), to: to.into(), value, fee }
    }

    fn sign_confirm(sk: &SigningKey, c: &Board, owner: &str, id: u64) -> String {
        hex32_n(&sk.sign(c.confirm_message(acc(owner), U64(id)).as_bytes()).to_bytes())
    }

    fn sign_as(sk: &SigningKey, c: &Board, owner: &str, receiver: &str, method: &str, args: &str, deposit: u128, expiry: u64, effects: Vec<EffectIn>, hold: bool) -> String {
        let nonce = c.get_charter(acc(owner)).unwrap().nonce.0;
        let msg = c.call_as_message(acc(owner), acc(receiver), method.into(), args.into(), U128(deposit), U64(nonce), U64(expiry), effects, hold);
        hex32_n(&sk.sign(msg.as_bytes()).to_bytes())
    }

    fn open_bob(c: &mut Board) {
        go(BOB, MAX_ROW_YOCTO, 0);
        c.open_charter(rules((0, 0), 4), keypair(9).1, U128(NEAR / 500));
    }

    #[test]
    fn the_call_as_envelope_overwrites_only_the_top_level_owner() {
        let (c, _, _) = boot();
        let args = r#"{"amount":"1","note":{"row_owner":"mallory.near"}}"#;
        let msg = c.call_as_message(acc(ALICE), acc(SHOP), "ft_transfer".into(), args.into(), U128(1), U64(0), U64(99), vec![], false);
        assert_eq!(msg, "board-call-as-v1|mainnet|charters.nearcarta.near|2|alice.near|shop.nearcarta.near|ft_transfer|b99351d51b134e460c661fda6f7bfedf1ed9ba92d887028a142a14469a2308f3|1|0|99|0|-|exec");
        assert_eq!(inject_row_owner(args, &acc(ALICE)), r#"{"amount":"1","note":{"row_owner":"mallory.near"},"row_owner":"alice.near"}"#);
        for bad in [r#"["nope"]"#, "null", r#""str""#, "1", r#"{"row_owner":"a.near","row_owner":"b.near"}"#, r#"{"a":"1","a":"2"}"#] {
            let err = catch_unwind(AssertUnwindSafe(|| inject_row_owner(bad, &acc(ALICE)))).unwrap_err();
            assert!(refuse(err).contains("ERR_ARGS"), "{bad}");
        }
    }

    #[test]
    fn two_visitors_spend_only_their_own_row_and_no_second_contract_is_created() {
        let (mut c, alice_sk, _) = boot();
        open_bob(&mut c);
        let (bob_sk, _) = keypair(9);
        let deposit = NEAR / 2000;
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_calls(vec![(acc(SHOP), "ft_transfer".into(), NEAR / 500)], NEAR / 200);
        go(BOB, MAX_ROW_YOCTO, 0);
        c.set_calls(vec![(acc(SHOP), "ft_transfer".into(), NEAR / 500)], NEAR / 200);
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_effects(vec![effect("base", "usdc", "0xabc", 1_000, 10)]);
        go(BOB, MAX_ROW_YOCTO, 0);
        c.set_effects(vec![effect("base", "usdc", "0xabc", 50, 5)]);
        let bob_bal = c.get_charter(acc(BOB)).unwrap().balance.0;
        let bob_epoch = c.epoch_of(&acc(BOB));
        let expiry = 1_000_000_000_000;
        let effects = vec![effect("base", "usdc", "0xabc", 25, 1)];
        go(ALICE, 0, 0);
        let sig = sign_as(&alice_sk, &c, ALICE, SHOP, "ft_transfer", r#"{"amount":"1","note":{"row_owner":"mallory.near"}}"#, deposit, expiry, effects.clone(), false);
        c.propose_call_as(acc(ALICE), acc(SHOP), "ft_transfer".into(), r#"{"amount":"1","note":{"row_owner":"mallory.near"}}"#.into(), U128(deposit), U64(expiry), effects, false, sig);
        let alice = c.get_charter(acc(ALICE)).unwrap();
        assert_eq!(alice.balance.0, NEAR / 1000 - deposit);
        assert_eq!(alice.nonce.0, 1);
        assert_eq!(c.effect_spent(&acc(ALICE), "base", "usdc", "0xabc"), (25, 1));
        assert_eq!(c.get_charter(acc(BOB)).unwrap().balance.0, bob_bal);
        assert_eq!(c.get_charter(acc(BOB)).unwrap().nonce.0, 0);
        assert_eq!(c.effect_spent(&acc(BOB), "base", "usdc", "0xabc"), (0, 0));
        assert_eq!(c.epoch_of(&acc(BOB)), bob_epoch);
        let forwarded = get_created_receipts().into_iter().flat_map(|r| r.actions).find_map(|a| match a {
            MockAction::FunctionCallWeight { method_name, args, attached_deposit, .. } if method_name == b"ft_transfer" && attached_deposit.as_yoctonear() == deposit => Some(String::from_utf8(args).unwrap()),
            _ => None,
        }).expect("shop call");
        assert_eq!(forwarded, r#"{"amount":"1","note":{"row_owner":"mallory.near"},"row_owner":"alice.near"}"#);
        assert_eq!(c.get_config().rows, 2);
        go(BOB, 0, 0);
        let sig = sign_as(&bob_sk, &c, BOB, SHOP, "ft_transfer", r#"{"amount":"1"}"#, deposit, expiry, vec![effect("base", "usdc", "0xabc", 1_000, 1)], false);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose_call_as(acc(BOB), acc(SHOP), "ft_transfer".into(), r#"{"amount":"1"}"#.into(), U128(deposit), U64(expiry), vec![effect("base", "usdc", "0xabc", 1_000, 1)], false, sig);
        })).unwrap_err();
        assert!(refuse(err).contains("ERR_EFFECT"), "bob cannot spend alice's budget or past his own");
        assert_eq!(c.get_charter(acc(BOB)).unwrap().balance.0, bob_bal);
    }

    #[test]
    fn foreign_effects_are_capped_and_propose_call_does_not_admit_one() {
        let (mut c, sk, _) = boot();
        let deposit = NEAR / 10_000;
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_calls(vec![(acc(SHOP), "ft_transfer".into(), NEAR / 500)], NEAR / 200);
        let expiry = 50u64;
        go(ALICE, 0, 0);
        let args = "{}";
        let sig = sign_as(&sk, &c, ALICE, SHOP, "ft_transfer", args, deposit, expiry, vec![effect("base", "usdc", "0xabc", 1_000_000, 1)], false);
        let before = get_created_receipts().len();
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose_call_as(acc(ALICE), acc(SHOP), "ft_transfer".into(), args.into(), U128(deposit), U64(expiry), vec![effect("base", "usdc", "0xabc", 1_000_000, 1)], false, sig);
        })).unwrap_err();
        assert!(refuse(err).contains("ERR_EFFECT"));
        assert_eq!(get_created_receipts().len(), before, "no shop call without a budget");
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().balance.0, NEAR / 1000);
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_effects(vec![effect("base", "usdc", "0xabc", 10, 1)]);
        go(ALICE, 0, 0);
        let sig = sign_as(&sk, &c, ALICE, SHOP, "ft_transfer", args, deposit, expiry, vec![effect("base", "usdc", "0xabc", 11, 1)], false);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose_call_as(acc(ALICE), acc(SHOP), "ft_transfer".into(), args.into(), U128(deposit), U64(expiry), vec![effect("base", "usdc", "0xabc", 11, 1)], false, sig);
        })).unwrap_err();
        assert!(refuse(err).contains("ERR_EFFECT"), "over the value budget");
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_calls(vec![(acc(SHOP), "ft_transfer".into(), NEAR / 50)], NEAR / 50);
        go(ALICE, 0, 0);
        let big = NEAR / 100;
        let sig = sign_as(&sk, &c, ALICE, SHOP, "ft_transfer", args, big, expiry, vec![effect("base", "usdc", "0xabc", 1, 1)], false);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose_call_as(acc(ALICE), acc(SHOP), "ft_transfer".into(), args.into(), U128(big), U64(expiry), vec![effect("base", "usdc", "0xabc", 1, 1)], false, sig);
        })).unwrap_err();
        assert!(refuse(err).contains("over_per_action_cap"), "the NEAR deposit still counts");
    }

    #[test]
    fn signatures_reject_replay_stale_epoch_and_the_wrong_domain() {
        let (mut c, sk, _) = boot();
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_calls(vec![(acc(SHOP), "ft_transfer".into(), NEAR / 500)], NEAR / 200);
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_effects(vec![effect("base", "usdc", "0xabc", 100, 10)]);
        let deposit = NEAR / 2000;
        let expiry = 1_000_000u64;
        let effects = vec![effect("base", "usdc", "0xabc", 2, 1)];
        let args = "{}";
        go(ALICE, 0, 0);
        let used = sign_as(&sk, &c, ALICE, SHOP, "ft_transfer", args, deposit, expiry, effects.clone(), false);
        c.propose_call_as(acc(ALICE), acc(SHOP), "ft_transfer".into(), args.into(), U128(deposit), U64(expiry), effects.clone(), false, used.clone());
        go(ALICE, 0, 0);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose_call_as(acc(ALICE), acc(SHOP), "ft_transfer".into(), args.into(), U128(deposit), U64(expiry), effects.clone(), false, used);
        })).unwrap_err();
        assert!(refuse(err).contains("ERR_BAD_SIG"), "replay");
        go(ALICE, 0, 0);
        let stale = sign_as(&sk, &c, ALICE, SHOP, "ft_transfer", args, deposit, expiry, effects.clone(), false);
        c.tighten_rules(RulesIn { per_action_cap: U128(NEAR / 1000), ..rules((0, 0), 4) }, false);
        go(ALICE, 0, 0);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose_call_as(acc(ALICE), acc(SHOP), "ft_transfer".into(), args.into(), U128(deposit), U64(expiry), effects.clone(), false, stale);
        })).unwrap_err();
        assert!(refuse(err).contains("ERR_BAD_SIG"), "epoch moved");
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().nonce.0, 1, "a rejected signature does not burn the nonce");
        let nonce = c.get_charter(acc(ALICE)).unwrap().nonce.0;
        let mut forged = c.call_as_message(acc(ALICE), acc(SHOP), "ft_transfer".into(), args.into(), U128(deposit), U64(nonce), U64(expiry), effects.clone(), false);
        forged = forged.replacen("mainnet", "testnet", 1);
        let bad = hex32_n(&sk.sign(forged.as_bytes()).to_bytes());
        go(ALICE, 0, 0);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose_call_as(acc(ALICE), acc(SHOP), "ft_transfer".into(), args.into(), U128(deposit), U64(expiry), effects, false, bad);
        })).unwrap_err();
        assert!(refuse(err).contains("ERR_BAD_SIG"), "domain");
    }

    #[test]
    fn calls_stop_at_24_pairs_and_tightening_cannot_grant_or_reset() {
        let (mut c, sk, _) = boot();
        let mut many = Vec::new();
        for i in 0..24 {
            many.push((acc(&format!("s{i}.near")), "m".into(), NEAR / 500));
        }
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_calls(many.clone(), NEAR / 100);
        assert_eq!(c.call_count(&acc(ALICE)), 24);
        let bytes = c.calls_encoded_len();
        let locked = c.get_charter(acc(ALICE)).unwrap().storage_locked.0;
        // 24 short pairs, plus the row and the side reserve, stay inside the row cap.
        // `bytes` is the in-memory encode. `locked` is the trie bytes the write actually used.
        // The locked figure rose from 19.94 to 27.94 NEAR-worth when SIDE_RESERVE_BYTES went
        // from 600 to 1400: the extra 800 bytes is exactly the hold record `propose_call_as`
        // writes later, and 24 pairs is the contract's ceiling on a row.
        assert_eq!(bytes, 836);
        assert_eq!(locked, 27_940_000_000_000_000_000_000);
        many.push((acc("s24.near"), "m".into(), NEAR / 500));
        go(ALICE, MAX_ROW_YOCTO, 0);
        let err = catch_unwind(AssertUnwindSafe(|| c.set_calls(many, NEAR / 100))).unwrap_err();
        assert!(refuse(err).contains("ERR_RECEIVERS"));
        go(ALICE, MAX_ROW_YOCTO, 0);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.set_calls(vec![(acc("s0.near"), "m".into(), NEAR / 500), (acc("s0.near"), "m".into(), NEAR / 500)], NEAR / 100);
        })).unwrap_err();
        assert!(refuse(err).contains("ERR_RECEIVERS"), "duplicate pair");
        let spent_before = c.get_charter(acc(ALICE)).unwrap().spent_today.0;
        let nonce = c.get_charter(acc(ALICE)).unwrap().nonce.0;
        go(ALICE, 0, 0);
        c.tighten_calls(vec![(acc("s0.near"), "m".into(), NEAR / 1000)], NEAR / 200);
        assert_eq!(c.call_count(&acc(ALICE)), 1);
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().nonce.0, nonce);
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().spent_today.0, spent_before);
        go(ALICE, 0, 0);
        let err = catch_unwind(AssertUnwindSafe(|| c.tighten_calls(vec![(acc("s1.near"), "m".into(), 1)], 1))).unwrap_err();
        assert!(refuse(err).contains("ERR_LOOSEN"), "cannot grant a method");
        go(ALICE, 0, 0);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.tighten_rules(RulesIn { per_action_cap: U128(NEAR / 100), daily_budget: U128(NEAR / 100), ..rules((0, 0), 4) }, false);
        })).unwrap_err();
        assert!(refuse(err).contains("ERR_LOOSEN"));
        go(ALICE, 0, 0);
        c.tighten_rules(RulesIn { per_action_cap: U128(NEAR / 1000), daily_budget: U128(NEAR / 400), expires_at: U64(10), ..rules((10, 20), 2) }, true);
        let row = c.get_charter(acc(ALICE)).unwrap();
        assert!(row.frozen);
        assert_eq!(row.nonce.0, nonce);
        assert_eq!(row.expires_at.0, 10);
        go(ALICE, 1, 0);
        c.set_rules(rules((0, 0), 4));
        assert!(c.get_charter(acc(ALICE)).unwrap().frozen, "tighten's freeze stays through a rules edit");
        go(ALICE, 1, 0);
        c.set_frozen(false);
        assert!(!c.get_charter(acc(ALICE)).unwrap().frozen);
        let _ = sk;
    }

    #[test]
    fn a_confirm_key_is_not_the_agent_and_a_refund_cannot_be_spoofed() {
        let (mut c, agent, _) = boot();
        open_bob(&mut c);
        let (confirm, confirm_pk) = keypair(11);
        go(ALICE, 1, 0);
        let err = catch_unwind(AssertUnwindSafe(|| c.set_confirm_key(keypair(7).1))).unwrap_err();
        assert!(refuse(err).contains("ERR_CONFIRM"));
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_confirm_key(confirm_pk);
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_calls(vec![(acc(SHOP), "ft_transfer".into(), NEAR / 500)], NEAR / 200);
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_effects(vec![effect("base", "usdc", "0xabc", 100, 10)]);
        let deposit = NEAR / 2000;
        let expiry = 100u64;
        let effects = vec![effect("base", "usdc", "0xabc", 4, 1)];
        let args = "{}";
        go(ALICE, 0, 0);
        let sig = sign_as(&agent, &c, ALICE, SHOP, "ft_transfer", args, deposit, expiry, effects.clone(), true);
        let receipts_before = get_created_receipts().len();
        c.propose_call_as(acc(ALICE), acc(SHOP), "ft_transfer".into(), args.into(), U128(deposit), U64(expiry), effects, true, sig);
        assert_eq!(get_created_receipts().len(), receipts_before, "a hold does not call the shop");
        assert_eq!(c.effect_spent(&acc(ALICE), "base", "usdc", "0xabc"), (4, 1));
        let id = 0u64;
        go(ALICE, 0, 0);
        let agent_msg = c.confirm_message(acc(ALICE), U64(id));
        let agent_sig = hex32_n(&agent.sign(agent_msg.as_bytes()).to_bytes());
        let err = catch_unwind(AssertUnwindSafe(|| { c.confirm_hold(acc(ALICE), U64(id), agent_sig); })).unwrap_err();
        assert!(refuse(err).contains("ERR_BAD_SIG"), "the agent key is not human approval");
        go(ALICE, 0, 0);
        let ok = hex32_n(&confirm.sign(c.confirm_message(acc(ALICE), U64(id)).as_bytes()).to_bytes());
        c.confirm_hold(acc(ALICE), U64(id), ok);
        let called = get_created_receipts().into_iter().flat_map(|r| r.actions).any(|a| matches!(a, MockAction::FunctionCallWeight { method_name, .. } if method_name == b"ft_transfer"));
        assert!(called);
        let bob_bal = c.get_charter(acc(BOB)).unwrap().balance.0;
        go(OTHER, deposit, 0);
        let err = catch_unwind(AssertUnwindSafe(|| c.refund_action(acc(ALICE), U64(id)))).unwrap_err();
        assert!(refuse(err).contains("ERR_REFUND"));
        go(SHOP, deposit, 0);
        c.refund_action(acc(ALICE), U64(id));
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().balance.0, NEAR / 1000);
        assert_eq!(c.effect_spent(&acc(ALICE), "base", "usdc", "0xabc"), (0, 0));
        assert_eq!(c.get_charter(acc(BOB)).unwrap().balance.0, bob_bal);
        go(SHOP, deposit, 0);
        let err = catch_unwind(AssertUnwindSafe(|| c.refund_action(acc(ALICE), U64(id)))).unwrap_err();
        assert!(refuse(err).contains("ERR_ACTION"), "replay");
        go(SHOP, NEAR, 0);
        let err = catch_unwind(AssertUnwindSafe(|| c.fund())).unwrap_err();
        assert!(refuse(err).contains("ERR_NO_CHARTER"), "a transfer to the board is not a row refund");
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().balance.0, NEAR / 1000);
    }

    #[test]
    fn failure_timeout_and_settle_release_only_that_action() {
        let (mut c, sk, _) = boot();
        open_bob(&mut c);
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_calls(vec![(acc(SHOP), "ft_transfer".into(), NEAR / 500)], NEAR / 50);
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_effects(vec![effect("base", "usdc", "0xabc", 100, 10)]);
        let deposit = NEAR / 2000;
        let expiry = 100u64;
        let effects = vec![effect("base", "usdc", "0xabc", 3, 1)];
        go(ALICE, 0, 0);
        let sig = sign_as(&sk, &c, ALICE, SHOP, "ft_transfer", "{}", deposit, expiry, effects.clone(), false);
        c.propose_call_as(acc(ALICE), acc(SHOP), "ft_transfer".into(), "{}".into(), U128(deposit), U64(expiry), effects, false, sig);
        let bal = c.get_charter(acc(ALICE)).unwrap().balance.0;
        go(SHOP, 0, 0);
        let err = catch_unwind(AssertUnwindSafe(|| c.on_called_as(acc(ALICE), U64(0)))).unwrap_err();
        assert!(refuse(err).contains("ERR_PRIVATE"), "the shop cannot pretend to be the callback");
        let mut b = VMContextBuilder::new();
        b.current_account_id(acc("charters.nearcarta.near"))
            .predecessor_account_id(acc("charters.nearcarta.near"))
            .prepaid_gas(Gas::from_tgas(30))
            .account_balance(NearToken::from_near(30));
        testing_env!(b.build(), test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Failed]);
        c.on_called_as(acc(ALICE), U64(0));
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().balance.0, bal + deposit);
        assert_eq!(c.effect_spent(&acc(ALICE), "base", "usdc", "0xabc"), (0, 0));
        c.on_called_as(acc(ALICE), U64(0));
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().balance.0, bal + deposit, "replay does not pay twice");
        let effects = vec![effect("base", "usdc", "0xabc", 3, 1)];
        go(ALICE, 0, 0);
        let sig = sign_as(&sk, &c, ALICE, SHOP, "ft_transfer", "{}", deposit, expiry, effects.clone(), true);
        c.propose_call_as(acc(ALICE), acc(SHOP), "ft_transfer".into(), "{}".into(), U128(deposit), U64(expiry), effects, true, sig);
        go(ALICE, 0, 50);
        let err = catch_unwind(AssertUnwindSafe(|| c.refund_action(acc(ALICE), U64(1)))).unwrap_err();
        assert!(refuse(err).contains("ERR_REFUND"), "too early");
        go(ALICE, 0, expiry + 1);
        c.refund_action(acc(ALICE), U64(1));
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().balance.0, NEAR / 1000);
        assert_eq!(c.get_charter(acc(BOB)).unwrap().balance.0, NEAR / 500);
        go(ALICE, 0, 0);
        let effects = vec![effect("base", "usdc", "0xabc", 3, 1)];
        let sig = sign_as(&sk, &c, ALICE, SHOP, "ft_transfer", "{}", deposit, 1_000_000, effects.clone(), false);
        c.propose_call_as(acc(ALICE), acc(SHOP), "ft_transfer".into(), "{}".into(), U128(deposit), U64(1_000_000), effects, false, sig);
        go(SHOP, 0, 0);
        c.settle(acc(ALICE), U64(2));
        go(SHOP, deposit, 0);
        let err = catch_unwind(AssertUnwindSafe(|| c.refund_action(acc(ALICE), U64(2)))).unwrap_err();
        assert!(refuse(err).contains("ERR_ACTION"), "settled");
        assert_eq!(c.effect_spent(&acc(ALICE), "base", "usdc", "0xabc"), (3, 1), "settle keeps the reservation");
    }

    #[test]
    fn an_anchor_on_the_live_header_load_still_finds_the_visitors_row() {
        // The live board calls `read_head` (partial), not `decode(STATE)`. A row is loaded
        // only by `hydrate`, so `anchor` must hydrate or it panics ERR_NO_CHARTER.
        let (mut c, _, _) = boot();
        open_bob(&mut c);
        save(&c);
        let owed = c.liabilities();
        go(ALICE, 0, 5);
        let mut live = load();
        assert!(live.partial, "the deployed board reads the header");
        assert!(live.rows.is_empty(), "the live load holds no rows yet");
        live.anchor("statement".into(), "ab".repeat(32), "saltsalt".into());
        let logs = get_logs();
        assert!(logs.iter().any(|l| l.contains("\"event\":\"anchor\"") && l.contains("\"owner\":\"alice.near\"") && l.contains("\"kind\":\"statement\"")), "the anchor event names the visitor");
        assert!(logs.iter().all(|l| !l.contains("saltsalt")), "the salt is not logged");
        assert_eq!(live.liabilities(), owed, "an anchor moves no money");
        assert_eq!(live.get_charter(acc(ALICE)).unwrap().balance.0, c.get_charter(acc(ALICE)).unwrap().balance.0);
        // A visitor with no row is still refused, not silently anchored.
        go("mallory.near", 0, 5);
        let mut other = load();
        let err = catch_unwind(AssertUnwindSafe(|| other.anchor("statement".into(), "ab".repeat(32), "saltsalt".into()))).unwrap_err();
        assert!(refuse(err).contains("ERR_NO_CHARTER"));
    }

    #[test]
    fn anchor_stores_nothing_and_migrate_keeps_both_rows() {
        let (mut c, _, _) = boot();
        open_bob(&mut c);
        let state = encode(&c);
        let owed = c.liabilities();
        go(ALICE, 0, 5);
        c.anchor("note".into(), "ab".repeat(32), "saltsalt".into());
        let logs = get_logs();
        assert!(logs.iter().any(|l| l.contains("\"event\":\"anchor\"") && l.contains("\"owner\":\"alice.near\"") && !l.contains("saltsalt") && !l.contains(&"ab".repeat(32))));
        assert_eq!(encode(&c), state);
        assert_eq!(c.liabilities(), owed);
        go(ALICE, 0, 5);
        let err = catch_unwind(AssertUnwindSafe(|| c.anchor("note".into(), "ab".repeat(32), "".into()))).unwrap_err();
        assert!(refuse(err).contains("ERR_SALT"), "a raw digest is not the default");
        let alice_bal = c.get_charter(acc(ALICE)).unwrap().balance.0;
        let bob_bal = c.get_charter(acc(BOB)).unwrap().balance.0;
        let nonce = c.get_charter(acc(ALICE)).unwrap().nonce.0;
        go("charters.nearcarta.near", 0, 5);
        c.migrate();
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().balance.0, alice_bal);
        assert_eq!(c.get_charter(acc(BOB)).unwrap().balance.0, bob_bal);
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().nonce.0, nonce);
        assert_eq!(encode(&c), state);
        go(ALICE, 1, 0);
        let err = catch_unwind(AssertUnwindSafe(|| c.stage_upgrade("11".repeat(32)))).unwrap_err();
        assert!(refuse(err).contains("ERR_NOT_OWNER"));
        let code = vec![0x11, 0x22, 0x33, 0x44];
        go("nearcarta.near", 1, 0);
        c.stage_upgrade(hex32(&env::sha256_array(&code)));
        let staged = get_logs();
        assert!(staged.iter().any(|l| l.contains("\"event\":\"stage_upgrade\"")), "{staged:?}");
        let eta = c.upgrade_eta();
        assert_eq!(eta, UPGRADE_DELAY_NS, "the delay is one day");
        go("nearcarta.near", 1, eta - 1);
        let err = catch_unwind(AssertUnwindSafe(|| { c.upgrade(code.clone()); })).unwrap_err();
        assert!(refuse(err).contains("ERR_UPGRADE"), "too early");
        go("nearcarta.near", 1, eta);
        let err = catch_unwind(AssertUnwindSafe(|| { c.upgrade(vec![0x22]); })).unwrap_err();
        assert!(refuse(err).contains("ERR_UPGRADE"), "hash");
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().balance.0, alice_bal);
        go("nearcarta.near", 1, eta);
        c.upgrade(code.clone());
        assert!(!c.upgrade_set, "the staged hash cannot be replayed");
        let receipts = get_created_receipts();
        let batch = receipts.iter().find(|r| r.receiver_id == acc("charters.nearcarta.near")).expect("self receipt");
        let deployed = batch.actions.iter().any(|a| matches!(a, MockAction::DeployContract { code: wasm, .. } if wasm == &code));
        let migrates = batch.actions.iter().any(|a| matches!(a, MockAction::FunctionCallWeight { method_name, .. } if method_name == b"migrate"));
        assert!(deployed && migrates, "deploy and migrate share one receipt");
        assert_eq!(receipts.len(), 1, "no second receipt");
        assert!(c.liabilities() > 0);
        go("nearcarta.near", 1, 0);
        let err = catch_unwind(AssertUnwindSafe(|| { c.reap(); })).unwrap_err();
        let msg = refuse(err);
        assert!(msg.contains("ERR_NONEMPTY") || msg.contains("ERR_LIABILITY"), "{msg}");
        go(ALICE, 0, 0);
        c.close_charter();
        let alice_back = transfers_to(ALICE).last().copied().expect("alice refund");
        assert!(alice_back >= alice_bal);
        go(BOB, 0, 0);
        c.close_charter();
        assert!(transfers_to(BOB).last().copied().unwrap() >= bob_bal);
        assert_eq!(c.liabilities(), 0);
        go("nearcarta.near", 1, 0);
        c.reap();
        let deleted = get_created_receipts().into_iter().flat_map(|r| r.actions).any(|a| matches!(a, MockAction::DeleteAccount { beneficiary_id, .. } if beneficiary_id == acc("nearcarta.near")));
        assert!(deleted, "teardown pays the owner");
    }

    #[test]
    fn live_rows_round_trip_through_v2_storage_without_changing_state() {
        go("nearcarta.near", 0, 0);
        let raw = include_bytes!("../testdata/mainnet-state.bin");
        let live = decode(raw);
        assert_eq!(encode(&live), raw.as_slice());
        assert_eq!(acts_len(&live), 0);
        let owners: Vec<_> = live.rows.keys().cloned().collect();
        let balances: Vec<_> = owners.iter().map(|o| live.get_charter(o.clone()).unwrap().balance.0).collect();
        let owed = live.liabilities();
        save(&live);
        let mut back = load();
        assert!(back.partial, "a callback loads the header, not every row");
        assert!(back.rows.is_empty());
        assert_eq!(back.get_config().rows, 2);
        assert_eq!(back.liabilities(), owed);
        for (owner, balance) in owners.iter().zip(balances) {
            back.hydrate(owner);
            assert_eq!(back.get_charter(owner.clone()).unwrap().balance.0, balance);
        }
        assert_eq!(back.rows.len(), owners.len());
    }

    #[test]
    fn one_thousand_rows_stay_keyed_and_a_callback_reads_one() {
        let mut ctx = VMContextBuilder::new();
        ctx.current_account_id(acc("charters.nearcarta.near"))
            .predecessor_account_id(acc("nearcarta.near"))
            .prepaid_gas(Gas::from_tgas(10_000))
            .account_balance(NearToken::from_near(50));
        testing_env!(ctx.build());
        let mut c = Board::new();
        let rules = Rules {
            receivers: vec![acc(SHOP)], per_action_cap: NEAR, daily_budget: NEAR,
            max_actions_per_day: 4, window_start_min: 0, window_end_min: 0, min_amount: 0, expires_at: 0,
        };
        for i in 0..1001u32 {
            let id: AccountId = format!("v{i}.near").parse().unwrap();
            let mut agent = [0u8; 32];
            agent[..4].copy_from_slice(&i.to_le_bytes());
            c.keys.insert(agent, id.clone());
            c.rows.insert(id, Row {
                rules: rules.clone(), agent, frozen: false, seal: None, nonce: 0, day: 0,
                spent: 0, count: 0, balance: 7 + i as u128, storage_locked: 3,
            });
            c.count += 1;
        }
        save(&c);
        let mut back = load();
        assert_eq!(back.count, 1001);
        assert!(back.rows.is_empty());
        let one: AccountId = "v1000.near".parse().unwrap();
        back.hydrate(&one);
        assert_eq!(back.rows.len(), 1);
        assert_eq!(back.get_charter(one).unwrap().balance.0, 7 + 1000);
        assert_eq!(back.liabilities(), c.liabilities());
    }

    #[test]
    fn a_stamp_returns_the_near_and_still_spends_the_daily_slot() {
        let (mut c, sk, _) = boot();
        let deposit = NEAR / 2000;
        let board = "charters.nearcarta.near";
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_calls(vec![(acc(board), "stamp".into(), NEAR / 500)], NEAR / 200);
        let before = c.get_charter(acc(ALICE)).unwrap().balance.0;
        go(ALICE, 0, 0);
        let msg = c.call_message(acc(ALICE), acc(board), "stamp".into(), format!(r#"{{"owner":"{ALICE}"}}"#).into_bytes(), U128(deposit), U64(0));
        let sig = hex32_n(&sk.sign(msg.as_bytes()).to_bytes());
        c.propose_call(acc(ALICE), acc(board), "stamp".into(), format!(r#"{{"owner":"{ALICE}"}}"#).into_bytes(), U128(deposit), sig);
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().balance.0, before - deposit);
        go(board, deposit, 0);
        c.stamp(acc(ALICE));
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().balance.0, before);
        let mut b = VMContextBuilder::new();
        b.current_account_id(acc(board)).predecessor_account_id(acc(board)).prepaid_gas(Gas::from_tgas(30)).account_balance(NearToken::from_near(30));
        testing_env!(b.build(), test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Successful(vec![])]);
        c.on_called(acc(ALICE), U128(deposit), U64(0));
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().balance.0, before, "a successful stamp is not refunded twice");
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().spent_today.0, deposit);
        let _ = sig;
    }

    #[test]
    fn a_sent_hold_can_expire_without_a_refund() {
        let (mut c, sk, _) = boot();
        let deposit = NEAR / 2000;
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_calls(vec![(acc(SHOP), "ft_transfer".into(), NEAR / 500)], NEAR / 200);
        let expiry = 1_000u64;
        go(ALICE, 0, 0);
        let sig = sign_as(&sk, &c, ALICE, SHOP, "ft_transfer", "{}", deposit, expiry, vec![], false);
        c.propose_call_as(acc(ALICE), acc(SHOP), "ft_transfer".into(), "{}".into(), U128(deposit), U64(expiry), vec![], false, sig);
        let left = c.get_charter(acc(ALICE)).unwrap().balance.0;
        go(ALICE, 0, 0);
        let err = catch_unwind(AssertUnwindSafe(|| c.expire_sent(acc(ALICE), U64(0)))).unwrap_err();
        assert!(refuse(err).contains("ERR_EXPIRY"));
        go(SHOP, 0, expiry + 1);
        let err = catch_unwind(AssertUnwindSafe(|| c.expire_sent(acc(ALICE), U64(0)))).unwrap_err();
        assert!(refuse(err).contains("ERR_NOT_OWNER"), "the shop cannot expire it");
        go(ALICE, 0, expiry + 1);
        c.expire_sent(acc(ALICE), U64(0));
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().balance.0, left, "delivered, so no refund");
        assert!(c.holds.is_empty());
        go("nearcarta.near", 0, expiry + 1);
        let err = catch_unwind(AssertUnwindSafe(|| c.expire_sent(acc(ALICE), U64(0)))).unwrap_err();
        assert!(refuse(err).contains("ERR_ACTION"));
    }

    #[test]
    fn confirm_rechecks_freeze_expiry_epoch_and_the_confirm_key() {
        let (mut c, sk, _) = boot();
        let deposit = NEAR / 2000;
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_calls(vec![(acc(SHOP), "ft_transfer".into(), NEAR / 500)], NEAR / 200);
        let confirm = keypair(4);
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_confirm_key(confirm.1.clone());
        let expiry = 50_000u64;
        go(ALICE, 0, 0);
        let sig = sign_as(&sk, &c, ALICE, SHOP, "ft_transfer", "{}", deposit, expiry, vec![], true);
        c.propose_call_as(acc(ALICE), acc(SHOP), "ft_transfer".into(), "{}".into(), U128(deposit), U64(expiry), vec![], true, sig);
        go(ALICE, 0, 0);
        c.set_frozen(true);
        let present = sign_confirm(&confirm.0, &c, ALICE, 0);
        let err = catch_unwind(AssertUnwindSafe(|| { c.confirm_hold(acc(ALICE), U64(0), present.clone()); })).unwrap_err();
        assert!(refuse(err).contains("frozen"));
        go(ALICE, 1, 0);
        c.set_frozen(false);
        c.rows.get_mut(&acc(ALICE)).unwrap().rules.expires_at = 10;
        go(ALICE, 0, 11);
        let err = catch_unwind(AssertUnwindSafe(|| { c.confirm_hold(acc(ALICE), U64(0), present.clone()); })).unwrap_err();
        assert!(refuse(err).contains("clause_expired"));
        c.rows.get_mut(&acc(ALICE)).unwrap().rules.expires_at = 0;
        go(ALICE, 1, 11);
        let (agent2, pk2) = keypair(8);
        c.set_agent(pk2);
        let err = catch_unwind(AssertUnwindSafe(|| { c.confirm_hold(acc(ALICE), U64(0), present.clone()); })).unwrap_err();
        assert!(refuse(err).contains("ERR_EPOCH"));
        let sig = sign_as(&agent2, &c, ALICE, SHOP, "ft_transfer", "{}", deposit, expiry, vec![], true);
        go(ALICE, 0, 11);
        c.propose_call_as(acc(ALICE), acc(SHOP), "ft_transfer".into(), "{}".into(), U128(deposit), U64(expiry), vec![], true, sig);
        go(ALICE, MAX_ROW_YOCTO, 11);
        c.set_confirm_key(keypair(5).1);
        let err = catch_unwind(AssertUnwindSafe(|| { c.confirm_hold(acc(ALICE), U64(1), present); })).unwrap_err();
        assert!(refuse(err).contains("ERR_CONFIRM"), "a rotated confirm key does not sign the old hold");
    }

    #[test]
    fn the_row_owner_can_cancel_a_pending_hold_and_expiry_is_capped() {
        let (mut c, sk, _) = boot();
        let deposit = NEAR / 2000;
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_calls(vec![(acc(SHOP), "ft_transfer".into(), NEAR / 500)], NEAR / 200);
        let before = c.get_charter(acc(ALICE)).unwrap().balance.0;
        go(ALICE, 0, 0);
        let too_late = HOLD_MAX_NS + 1;
        let sig = sign_as(&sk, &c, ALICE, SHOP, "ft_transfer", "{}", deposit, too_late, vec![], true);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose_call_as(acc(ALICE), acc(SHOP), "ft_transfer".into(), "{}".into(), U128(deposit), U64(too_late), vec![], true, sig);
        })).unwrap_err();
        assert!(refuse(err).contains("ERR_EXPIRY"));
        let expiry = 80_000u64;
        let sig = sign_as(&sk, &c, ALICE, SHOP, "ft_transfer", "{}", deposit, expiry, vec![], true);
        c.propose_call_as(acc(ALICE), acc(SHOP), "ft_transfer".into(), "{}".into(), U128(deposit), U64(expiry), vec![], true, sig);
        assert!(c.get_charter(acc(ALICE)).unwrap().balance.0 < before);
        go(SHOP, 0, 1);
        let err = catch_unwind(AssertUnwindSafe(|| c.cancel_hold(U64(0)))).unwrap_err();
        assert!(refuse(err).contains("ERR_ACTION"), "only the row owner cancels");
        go(ALICE, 0, 1);
        c.cancel_hold(U64(0));
        assert_eq!(c.get_charter(acc(ALICE)).unwrap().balance.0, before);
        assert!(c.holds.is_empty());
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
    #[test]
    fn a_row_that_carries_a_full_call_list_can_still_hold_an_effect_budget() {
        // Measured on mainnet 2026-11-07: a four-shop row is exactly full at five pairs
        // (2000/2000), so `set_effects` was refused ERR_ROW_TOO_BIG and no visitor could ever
        // pass the toll. `set_calls` already charges a 600-byte SIDE_RESERVE_BYTES for exactly
        // this kind of write and stores it as `credit`; `set_effects` charged the row again
        // instead of spending it. The reserve is the room an effect budget is meant to use.
        let (mut c, _, _) = boot();
        let many: Vec<(AccountId, String, u128)> = vec![
            (acc("toll.nearcarta.near"), "cross".into(), NEAR / 50),
            (acc("guard.nearcarta.near"), "pay".into(), NEAR / 50),
            (acc("house.nearcarta.near"), "house_session_check_in".into(), NEAR / 50),
            (acc("house.nearcarta.near"), "house_session_prepare_send".into(), NEAR / 50),
            (acc("arena.nearcarta.near"), "ft_transfer".into(), NEAR / 50),
        ];
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_calls(many, NEAR / 10);
        let credit = c.side_credit(&acc(ALICE));
        assert!(credit > 0, "set_calls leaves a side reserve to spend");
        // The effect budget must come out of that reserve, not out of the row's own bytes.
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_effects(vec![effect("base", "usdc", "0x0000000000000000000000000000000000000001", 10_000, 1_000)]);
        assert_eq!(c.effect_spent(&acc(ALICE), "base", "usdc", "0x0000000000000000000000000000000000000001"), (0, 0));
        assert!(c.side_credit(&acc(ALICE)) < credit, "the effect record was paid from the reserve");
        let row = c.get_charter(acc(ALICE)).unwrap();
        assert!(row.storage_locked.0 <= MAX_ROW_YOCTO, "the row stays inside its 0.02 NEAR allowance");
    }

    #[test]
    fn simulate_answers_in_the_same_words_the_send_would_use() {
        // A free read so an agent plans before it signs. Every branch here mirrors a `require!`
        // in propose_call_as; if one drifts, a caller gets told a call is fine and then refused.
        let (mut c, _sk, _) = boot();
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_calls(vec![(acc(SHOP), "cross".into(), NEAR / 100)], NEAR / 10);
        let cap = c.get_charter(acc(ALICE)).unwrap().per_action_cap.0;
        // Allowed: inside every rule.
        let ok = c.simulate(acc(ALICE), acc(SHOP), "cross".into(), U128(NEAR / 2000), vec![]);
        assert!(ok.contains("\"ok\":true"), "{ok}");
        assert!(ok.contains("allowed"), "{ok}");
        // A pair that is not on the list.
        let pair = c.simulate(acc(ALICE), acc(SHOP), "ft_transfer".into(), U128(NEAR / 2000), vec![]);
        assert!(pair.contains("method_not_allowlisted"), "{pair}");
        // A receiver that is not on the list.
        let who = c.simulate(acc(ALICE), acc(OTHER), "cross".into(), U128(NEAR / 2000), vec![]);
        assert!(who.contains("receiver_not_allowlisted"), "{who}");
        // Over the per-action cap, and the numbers are reported.
        let over = c.simulate(acc(ALICE), acc(SHOP), "cross".into(), U128(cap + NEAR / 1000), vec![]);
        assert!(over.contains("over_per_action_cap"), "{over}");
        assert!(over.contains(&cap.to_string()), "the limit is named: {over}");
        // No row at all.
        let none = c.simulate(acc(BOB), acc(SHOP), "cross".into(), U128(1), vec![]);
        assert!(none.contains("no_charter"), "{none}");
        // The read changed nothing.
        let before = c.get_charter(acc(ALICE)).unwrap();
        let _ = c.simulate(acc(ALICE), acc(SHOP), "cross".into(), U128(NEAR / 2000), vec![]);
        let after = c.get_charter(acc(ALICE)).unwrap();
        assert_eq!(before.nonce.0, after.nonce.0);
        assert_eq!(before.spent_today.0, after.spent_today.0);
        assert_eq!(before.actions_today, after.actions_today);
        assert_eq!(before.balance.0, after.balance.0);
    }

    #[test]
    fn a_shop_call_with_no_value_is_not_held_to_the_smallest_payment() {
        // `min_amount` is the smallest payment the visitor allows. A Town Hall `bid`, `accept`,
        // `deliver`, `review` or `refund` carries no value at all, so measuring it against the
        // minimum refused every step after `post_job`. Measured on mainnet 2026-11-08: the row
        // had min_amount 0.0001 NEAR and `bid` with a zero deposit answered below_min_amount.
        let (mut c, sk, _) = boot();
        let hall = ["post_job", "bid", "deliver", "review"].iter()
            .map(|m| (acc(SHOP), (*m).to_string(), NEAR / 50)).collect::<Vec<_>>();
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_calls(hall, NEAR / 10);
        let expiry = 1_000_000u64;
        // A zero-value call is allowed ...
        go(ALICE, 0, 0);
        let sig = sign_as(&sk, &c, ALICE, SHOP, "bid", "{}", 0, expiry, Vec::new(), true);
        c.propose_call_as(acc(ALICE), acc(SHOP), "bid".into(), "{}".into(), U128(0), U64(expiry), Vec::new(), true, sig);
        // ... while a real payment below the minimum is still refused.
        go(ALICE, 0, 0);
        let small = NEAR / 20_000;
        let sig2 = sign_as(&sk, &c, ALICE, SHOP, "post_job", "{}", small, expiry, Vec::new(), true);
        let err = catch_unwind(AssertUnwindSafe(|| {
            c.propose_call_as(acc(ALICE), acc(SHOP), "post_job".into(), "{}".into(), U128(small), U64(expiry), Vec::new(), true, sig2);
        })).unwrap_err();
        assert!(refuse(err).contains("below_min_amount"), "a small payment is still refused");
    }

    #[test]
    fn a_row_that_carries_a_shop_list_can_still_write_a_hold() {
        // The failure this pins was measured in the deployed city on 2026-11-08: a clean
        // seven-pair Town Hall row (1858 bytes, 142 spare) posted a job, `propose_call_as`
        // wrote the per-action hold record, and the board panicked ERR_DEPOSIT. The write cost
        // more than the side reserve the row had prepaid, and `propose_call_as` runs from the
        // session key with no attached deposit, so there was nothing to charge the excess to.
        // Every held payment, the toll crossing and the Town Hall post were blocked by this.
        let (mut c, sk, _) = boot();
        let hall: Vec<(AccountId, String, u128)> = ["post_job", "bid", "counter", "accept", "deliver", "review", "refund"]
            .iter()
            .map(|m| (acc(SHOP), (*m).to_string(), NEAR / 50))
            .collect();
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_calls(hall, NEAR / 10);
        let locked = c.get_charter(acc(ALICE)).unwrap().storage_locked.0;
        assert!(locked < MAX_ROW_YOCTO, "the shop list leaves room in the row");
        let credit = c.side_credit(&acc(ALICE));
        assert!(credit > 0, "set_calls prepaid the side reserve");
        // A hold, not an effect budget: this is the write a shop makes per action.
        let deposit = NEAR / 2000;
        let expiry = 1_000_000u64;
        go(ALICE, 0, 0);
        let sig = sign_as(&sk, &c, ALICE, SHOP, "post_job", "{}", deposit, expiry, Vec::new(), true);
        c.propose_call_as(acc(ALICE), acc(SHOP), "post_job".into(), "{}".into(), U128(deposit), U64(expiry), Vec::new(), true, sig);
        assert!(c.side_credit(&acc(ALICE)) < credit, "the hold record was paid from the reserve");
        let row = c.get_charter(acc(ALICE)).unwrap();
        assert!(row.storage_locked.0 <= MAX_ROW_YOCTO, "the row stays inside its allowance");
    }

    #[test]
    fn clearing_and_re_setting_an_effect_budget_does_not_burn_the_reserve() {
        // `set_effects([])` removes the record and frees the bytes, but the reserve it was paid
        // from has to come back, or the next `set_effects` finds nothing to spend and fails
        // ERR_DEPOSIT on a row that owes nothing. A visitor adding a Base address after a first
        // visit is exactly this cycle.
        let (mut c, _, _) = boot();
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_calls(vec![(acc(SHOP), "cross".into(), NEAR / 50)], NEAR / 10);
        let credit0 = c.side_credit(&acc(ALICE));
        assert!(credit0 > 0, "set_calls leaves a reserve");
        let locked0 = c.get_charter(acc(ALICE)).unwrap().storage_locked.0;
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_effects(vec![effect("base", "usdc", "0xabc", 10, 1)]);
        let credit1 = c.side_credit(&acc(ALICE));
        assert!(credit1 < credit0, "the first budget spent the reserve");
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_effects(vec![]);
        let credit2 = c.side_credit(&acc(ALICE));
        // Clearing gives the bytes back to the reserve they came from, so the credit is
        // restored toward what `set_calls` originally left, and the row's locked bytes are
        // untouched because they never paid for the record.
        assert!(credit2 > credit1, "clearing returns the reserved bytes");
        assert!(credit2 <= credit0 + NEAR / 1_000_000, "and never more than was reserved");
        // The record was paid from the reserve, so it never raised storage_locked. Freeing it
        // must therefore not lower storage_locked either: the row's bytes are unchanged.
        let locked2 = c.get_charter(acc(ALICE)).unwrap().storage_locked.0;
        assert_eq!(locked2, locked0, "clearing a reserve-paid record must not lower the row's locked bytes");
        // And the row can take a budget again without a deposit it does not owe.
        go(ALICE, MAX_ROW_YOCTO, 0);
        c.set_effects(vec![effect("base", "native", "0xdef", 10, 1)]);
        assert_eq!(c.effect_spent(&acc(ALICE), "base", "native", "0xdef"), (0, 0));
        let row = c.get_charter(acc(ALICE)).unwrap();
        assert!(row.storage_locked.0 <= MAX_ROW_YOCTO);
    }

}
