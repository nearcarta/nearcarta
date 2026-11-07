//! Board v2, stored beside STATE.
//!
//! `propose_call` still moves NEAR only. A shop that spends a foreign asset
//! has to be called by `propose_call_as`, and only after this contract has
//! reserved a matching effect budget. The shop reads the top-level `row_owner`
//! this method writes, and it checks that its predecessor is the board.
//! A nested `row_owner` is not authority.
//!
//! The confirm key is not the agent key. The agent can ask for a hold. Only
//! the confirm key can sign `board-confirm-v1|...|present`. A compromised
//! browser that holds that key can sign it. There is no second wallet popup.
//!
//! Counters (`spent`, `nonce`, `session_spent`, effect `value_spent`) belong
//! to the row owner. A failed call or an authenticated refund releases that
//! owner's reservation and nobody else's. `fund` credits only the predecessor's
//! row, so a transfer back to the board is not a refund.

use super::*;
use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;

pub(crate) fn acts_len(b: &Board) -> u64 {
    if b.effects.is_empty() && b.holds.is_empty() { 0 } else { encode_acts(b).len() as u64 }
}

#[allow(dead_code)]
pub(crate) fn meta_empty(b: &Board) -> bool {
    b.epoch.is_empty() && b.confirm.is_empty() && !b.upgrade_set && b.credit.is_empty()
}

pub(crate) fn encode_acts(b: &Board) -> Vec<u8> {
    let mut o = Vec::new();
    put_u32(&mut o, b.effects.len() as u32);
    for (owner, caps) in &b.effects {
        put_acc(&mut o, owner);
        put_u32(&mut o, caps.len() as u32);
        for c in caps {
            put_str(&mut o, &c.chain);
            put_str(&mut o, &c.asset);
            put_str(&mut o, &c.receiver);
            put_u128(&mut o, c.value_cap);
            put_u128(&mut o, c.value_spent);
            put_u128(&mut o, c.fee_cap);
            put_u128(&mut o, c.fee_spent);
        }
    }
    put_u32(&mut o, b.holds.len() as u32);
    for ((owner, id), h) in &b.holds {
        put_acc(&mut o, owner);
        put_u64(&mut o, *id);
        put_acc(&mut o, &h.receiver);
        put_str(&mut o, &h.method);
        put_u32(&mut o, h.args.len() as u32);
        o.extend_from_slice(&h.args);
        put_u128(&mut o, h.amount);
        put_u64(&mut o, h.day);
        put_u32(&mut o, h.effects.len() as u32);
        for e in &h.effects {
            put_str(&mut o, &e.chain);
            put_str(&mut o, &e.asset);
            put_str(&mut o, &e.to);
            put_u128(&mut o, e.value);
            put_u128(&mut o, e.fee);
        }
        put_u64(&mut o, h.expires);
        o.push(u8::from(h.pending));
        put_u64(&mut o, h.epoch);
        o.extend_from_slice(&h.confirm);
    }
    o
}

pub(crate) fn decode_acts(b: &mut Board, raw: &[u8]) {
    let mut r = Rd { s: raw, i: 0 };
    let n = r.u32() as usize;
    require!(n <= 10_000, "ERR_STATE");
    for _ in 0..n {
        let owner = r.acc();
        let k = r.u32() as usize;
        require!(k <= MAX_CALLS, "ERR_STATE");
        let mut caps = Vec::with_capacity(k);
        for _ in 0..k {
            caps.push(EffectCap {
                chain: r.string(), asset: r.string(), receiver: r.string(),
                value_cap: r.u128(), value_spent: r.u128(), fee_cap: r.u128(), fee_spent: r.u128(),
            });
        }
        b.effects.insert(owner, caps);
    }
    let m = r.u32() as usize;
    require!(m <= 10_000, "ERR_STATE");
    for _ in 0..m {
        let owner = r.acc();
        let id = r.u64();
        let receiver = r.acc();
        let method = r.string();
        let n = r.u32() as usize;
        require!(n <= 2048, "ERR_STATE");
        let args = r.take(n).to_vec();
        let amount = r.u128();
        let day = r.u64();
        let k = r.u32() as usize;
        require!(k <= MAX_CALLS, "ERR_STATE");
        let mut effects = Vec::with_capacity(k);
        for _ in 0..k {
            effects.push(EffectIn { chain: r.string(), asset: r.string(), to: r.string(), value: r.u128(), fee: r.u128() });
        }
        let expires = r.u64();
        let pending = r.u8() == 1;
        let epoch = r.u64();
        let confirm = r.bytes32();
        b.holds.insert((owner, id), Hold { receiver, method, args, amount, day, effects, expires, pending, epoch, confirm });
    }
    require!(r.i == raw.len(), "ERR_STATE");
}

#[allow(dead_code)]
pub(crate) fn encode_meta(b: &Board) -> Vec<u8> {
    let mut o = Vec::new();
    put_u32(&mut o, b.epoch.len() as u32);
    for (k, v) in &b.epoch { put_acc(&mut o, k); put_u64(&mut o, *v); }
    put_u32(&mut o, b.confirm.len() as u32);
    for (k, v) in &b.confirm { put_acc(&mut o, k); o.extend_from_slice(v); }
    put_u32(&mut o, b.credit.len() as u32);
    for (k, v) in &b.credit { put_acc(&mut o, k); put_u128(&mut o, *v); }
    o.extend_from_slice(&b.upgrade_hash);
    put_u64(&mut o, b.upgrade_eta);
    o.push(u8::from(b.upgrade_set));
    o
}

pub(crate) fn decode_meta(b: &mut Board, raw: &[u8]) {
    let mut r = Rd { s: raw, i: 0 };
    let n = r.u32() as usize;
    require!(n <= 10_000, "ERR_STATE");
    for _ in 0..n { let k = r.acc(); b.epoch.insert(k, r.u64()); }
    let c = r.u32() as usize;
    require!(c <= 10_000, "ERR_STATE");
    for _ in 0..c { let k = r.acc(); b.confirm.insert(k, r.bytes32()); }
    let m = r.u32() as usize;
    require!(m <= 10_000, "ERR_STATE");
    for _ in 0..m { let k = r.acc(); b.credit.insert(k, r.u128()); }
    b.upgrade_hash = r.bytes32();
    b.upgrade_eta = r.u64();
    b.upgrade_set = r.u8() == 1;
    require!(r.i == raw.len(), "ERR_STATE");
}

fn token(s: &str) -> bool {
    (1..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-' | b':' | b'@'))
}

fn effects_canon(effects: &[EffectIn]) -> String {
    if effects.is_empty() { return "-".into(); }
    let mut s = String::new();
    for (i, e) in effects.iter().enumerate() {
        if i > 0 { s.push(';'); }
        s.push_str(&e.chain); s.push('|');
        s.push_str(&e.asset); s.push('|');
        s.push_str(&e.to); s.push('|');
        push_u128(&mut s, e.value); s.push('|');
        push_u128(&mut s, e.fee);
    }
    s
}

fn json_string(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' | '\\' => { o.push('\\'); o.push(c); }
            c if (c as u32) < 0x20 => {
                o.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

fn json_of(v: &Val) -> String {
    match v {
        Val::Null => "null".into(),
        Val::Bool(true) => "true".into(),
        Val::Bool(false) => "false".into(),
        Val::Num(s) => s.clone(),
        Val::Str(s) => json_string(s),
        Val::Arr(a) => {
            let mut s = String::from("[");
            for (i, x) in a.iter().enumerate() {
                if i > 0 { s.push(','); }
                s.push_str(&json_of(x));
            }
            s.push(']');
            s
        }
        Val::Obj(pairs) => {
            let mut seen = Set::new();
            let mut s = String::from("{");
            for (i, (k, val)) in pairs.iter().enumerate() {
                require!(seen.insert(k.clone()), "ERR_ARGS");
                if i > 0 { s.push(','); }
                s.push_str(&json_string(k));
                s.push(':');
                s.push_str(&json_of(val));
            }
            s.push('}');
            s
        }
    }
}

/// Top-level object only. Duplicate keys are rejected. An existing top-level
/// `row_owner` is replaced with `owner`. Nested keys are left as signed.
pub fn inject_row_owner(args: &str, owner: &AccountId) -> String {
    let v = parse(args);
    let Val::Obj(pairs) = v else { env::panic_str("ERR_ARGS"); };
    let mut seen = Set::new();
    for (k, _) in &pairs { require!(seen.insert(k.clone()), "ERR_ARGS"); }
    let mut out = String::from("{");
    let mut first = true;
    for (k, val) in &pairs {
        if k == "row_owner" { continue; }
        if !first { out.push(','); }
        first = false;
        out.push_str(&json_string(k));
        out.push(':');
        out.push_str(&json_of(val));
    }
    if !first { out.push(','); }
    out.push_str("\"row_owner\":");
    out.push_str(&json_string(owner.as_str()));
    out.push('}');
    out
}

fn check_effects(effects: &[EffectIn]) {
    require!(effects.len() <= MAX_CALLS, "ERR_EFFECT");
    for e in effects {
        require!(token(&e.chain) && token(&e.asset) && token(&e.to), "ERR_EFFECT");
    }
}

impl Board {
    pub fn bump_epoch(&mut self, owner: &AccountId) {
        let n = self.epoch.get(owner).copied().unwrap_or(0).saturating_add(1);
        self.epoch.insert(owner.clone(), n);
    }

    pub fn epoch_of(&self, owner: &AccountId) -> u64 {
        self.epoch.get(owner).copied().unwrap_or(0)
    }

    pub fn liabilities(&self) -> u128 {
        if self.partial { return self.owed; }
        let rows = self.rows.values().fold(0u128, |a, r| a.saturating_add(r.balance).saturating_add(r.storage_locked));
        let inflight = self.holds.values().fold(0u128, |a, h| a.saturating_add(h.amount));
        rows.saturating_add(inflight)
    }

    pub fn calls_encoded_len(&self) -> usize { encode_calls(&self.calls).len() }

    pub fn call_count(&self, owner: &AccountId) -> usize {
        self.calls.get(owner).map(|p| p.rules.len()).unwrap_or(0)
    }

    /// Bytes of side storage this row has prepaid. `propose_call_as` spends it
    /// on the in-flight hold. It is not a purse the agent can transfer.
    pub fn side_credit(&self, owner: &AccountId) -> u128 {
        self.credit.get(owner).copied().unwrap_or(0)
    }

    pub(crate) fn charge_calls_and_reserve(&mut self, me: &AccountId, before: u64) {
        self.flush_owner(me);
        let after = env::storage_usage();
        // The 600-byte side reserve is the cushion for this write. Adding the
        // per-write margin on top pushes a full call list past the row cap.
        let call_cost = if after > before { (after - before) as u128 * price() } else { 0 };
        let call_freed = if before > after { (before - after) as u128 * price() } else { 0 };
        let want = SIDE_RESERVE_BYTES as u128 * price();
        let have = self.credit.get(me).copied().unwrap_or(0);
        let reserve_need = want.saturating_sub(have);
        let row = self.rows.get_mut(me).unwrap();
        if call_freed > 0 { row.storage_locked = row.storage_locked.saturating_sub(call_freed); }
        require!(row.storage_locked.saturating_add(call_cost).saturating_add(reserve_need) <= MAX_ROW_YOCTO, "ERR_ROW_TOO_BIG");
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached.saturating_add(call_freed) >= call_cost.saturating_add(reserve_need), "ERR_DEPOSIT");
        row.storage_locked = row.storage_locked.saturating_add(call_cost).saturating_add(reserve_need);
        self.owe(call_cost as i128 + reserve_need as i128 - call_freed as i128);
        if reserve_need > 0 { *self.credit.entry(me.clone()).or_insert(0) += reserve_need; }
        refund(me, attached + call_freed - call_cost - reserve_need);
    }

    /// `set_calls` charges a SIDE_RESERVE_BYTES cushion and stores it as `credit` for exactly
    /// this kind of write: the small side records a row needs after its call list is settled
    /// (an effect budget, a hold). Charging the row's own 2000 bytes instead was measured on
    /// mainnet 2026-11-07 to refuse every shop-bearing row: a four-shop row is exactly full at
    /// five pairs, so `set_effects` panicked ERR_ROW_TOO_BIG and no visitor could pass the toll.
    /// Spend the reserve first, and only then the row's remaining room.
    fn charge_acts(&mut self, me: &AccountId, before: u64) {
        self.flush_owner(me);
        let after = env::storage_usage();
        if after <= before {
            let freed = (before - after) as u128 * price();
            if let Some(row) = self.rows.get_mut(me) { row.storage_locked = row.storage_locked.saturating_sub(freed); }
            self.owe(-(freed as i128));
            refund(me, freed + env::attached_deposit().as_yoctonear());
            return;
        }
        let cost = (after - before + STORAGE_MARGIN_BYTES) as u128 * price();
        let credit = self.credit.get(me).copied().unwrap_or(0);
        let from_reserve = credit.min(cost);
        let from_row = cost - from_reserve;
        // The reserve was prepaid by `set_calls`, so only the part that comes out of the row's
        // own room needs a deposit. Requiring the full cost made the setup batch fail
        // ERR_DEPOSIT even though the reserve already covered it.
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached >= from_row, "ERR_DEPOSIT");
        let row = self.rows.get_mut(me).unwrap();
        require!(row.storage_locked.saturating_add(from_row) <= MAX_ROW_YOCTO, "ERR_ROW_TOO_BIG");
        row.storage_locked += from_row;
        if from_reserve > 0 { *self.credit.get_mut(me).unwrap() -= from_reserve; }
        self.owe(cost as i128);
        refund(me, attached - from_row);
    }

    pub fn call_as_message(&self, owner: AccountId, receiver: AccountId, method: String, args: String, deposit: U128, nonce: U64, expiry: U64, effects: Vec<EffectIn>, hold: bool) -> String {
        let args_out = inject_row_owner(&args, &owner);
        check_effects(&effects);
        self.call_as_text(&owner, &receiver, &method, &args_out, deposit.0, nonce.0, expiry.0, &effects, hold)
    }

    fn call_as_text(&self, owner: &AccountId, receiver: &AccountId, method: &str, args_out: &str, deposit: u128, nonce: u64, expiry: u64, effects: &[EffectIn], hold: bool) -> String {
        let mut s = String::from("board-call-as-v1|");
        s.push_str(&self.network);
        s.push('|'); s.push_str(env::current_account_id().as_str());
        s.push('|'); s.push_str(CALL_AS_VERSION);
        s.push('|'); s.push_str(owner.as_str());
        s.push('|'); s.push_str(receiver.as_str());
        s.push('|'); s.push_str(method);
        s.push('|'); s.push_str(&hex32(&env::sha256_array(args_out.as_bytes())));
        s.push('|'); push_u128(&mut s, deposit);
        s.push('|'); push_u128(&mut s, nonce as u128);
        s.push('|'); push_u128(&mut s, expiry as u128);
        s.push('|'); push_u128(&mut s, self.epoch_of(owner) as u128);
        s.push('|'); s.push_str(&effects_canon(effects));
        s.push('|'); s.push_str(if hold { "hold" } else { "exec" });
        s
    }

    pub fn confirm_message(&self, owner: AccountId, action_id: U64) -> String {
        let h = self.holds.get(&(owner.clone(), action_id.0)).expect("ERR_ACTION");
        let digest = confirm_digest(&h.method, &h.args, h.amount, &effects_canon(&h.effects));
        confirm_text(&owner, action_id.0, &digest)
    }

    /// Owner setup. Raises or adds budgets. Spent counters carry over.
    pub fn set_effects(&mut self, effects: Vec<EffectIn>) {
        let me = env::predecessor_account_id();
        self.hydrate(&me);
        require!(self.rows.contains_key(&me), "ERR_NO_CHARTER");
        let next = self.normalize_caps(&me, effects, false);
        let before = self.baseline(&me);
        if next.is_empty() { self.effects.remove(&me); } else { self.effects.insert(me.clone(), next); }
        self.bump_epoch(&me);
        self.charge_acts(&me, before);
    }

    /// Smaller budgets only. A counter that has already been spent cannot be erased.
    pub fn tighten_effects(&mut self, effects: Vec<EffectIn>) {
        let me = env::predecessor_account_id();
        self.hydrate(&me);
        require!(self.rows.contains_key(&me), "ERR_NO_CHARTER");
        let next = self.normalize_caps(&me, effects, true);
        let before = self.baseline(&me);
        if next.is_empty() { self.effects.remove(&me); } else { self.effects.insert(me.clone(), next); }
        self.bump_epoch(&me);
        self.charge_acts(&me, before);
    }

    fn normalize_caps(&self, me: &AccountId, effects: Vec<EffectIn>, tighten: bool) -> Vec<EffectCap> {
        require!(effects.len() <= MAX_CALLS, "ERR_EFFECT");
        let old = self.effects.get(me).cloned().unwrap_or_default();
        let mut seen = Set::new();
        let mut out = Vec::new();
        for e in &effects {
            require!(token(&e.chain) && token(&e.asset) && token(&e.to), "ERR_EFFECT");
            require!(seen.insert((e.chain.clone(), e.asset.clone(), e.to.clone())), "ERR_EFFECT");
            let prev = old.iter().find(|c| c.chain == e.chain && c.asset == e.asset && c.receiver == e.to);
            if tighten { require!(prev.is_some(), "ERR_LOOSEN"); }
            let (spent_v, spent_f, cap_v, cap_f) = prev.map(|c| (c.value_spent, c.fee_spent, c.value_cap, c.fee_cap)).unwrap_or((0, 0, u128::MAX, u128::MAX));
            if tighten { require!(e.value <= cap_v && e.fee <= cap_f, "ERR_LOOSEN"); }
            require!(e.value >= spent_v && e.fee >= spent_f, "ERR_EFFECT");
            out.push(EffectCap { chain: e.chain.clone(), asset: e.asset.clone(), receiver: e.to.clone(), value_cap: e.value, value_spent: spent_v, fee_cap: e.fee, fee_spent: spent_f });
        }
        if tighten {
            for prev in &old {
                if prev.value_spent > 0 || prev.fee_spent > 0 {
                    require!(out.iter().any(|c| c.chain == prev.chain && c.asset == prev.asset && c.receiver == prev.receiver), "ERR_LOOSEN");
                }
            }
        }
        out
    }

    pub fn set_confirm_key(&mut self, key: String) {
        let me = env::predecessor_account_id();
        self.hydrate(&me);
        let agent = self.rows.get(&me).expect("ERR_NO_CHARTER").agent;
        let pk = parse_pk(&key);
        require!(pk != agent, "ERR_CONFIRM");
        let before = self.baseline(&me);
        self.confirm.insert(me.clone(), pk);
        self.bump_epoch(&me);
        self.charge(&me, before);
    }

    pub fn tighten_rules(&mut self, rules: RulesIn, freeze: bool) {
        let me = env::predecessor_account_id();
        self.hydrate(&me);
        let next = rules_from(rules);
        let row = self.rows.get_mut(&me).expect("ERR_NO_CHARTER");
        let old = row.rules.clone();
        require!(next.per_action_cap <= old.per_action_cap, "ERR_LOOSEN");
        require!(next.daily_budget <= old.daily_budget, "ERR_LOOSEN");
        require!(next.max_actions_per_day <= old.max_actions_per_day, "ERR_LOOSEN");
        require!(next.min_amount >= old.min_amount, "ERR_LOOSEN");
        require!(next.receivers.iter().all(|r| old.receivers.contains(r)), "ERR_LOOSEN");
        if old.expires_at != 0 { require!(next.expires_at != 0 && next.expires_at <= old.expires_at, "ERR_LOOSEN"); }
        require!(window_tighter(old.window_start_min, old.window_end_min, next.window_start_min, next.window_end_min), "ERR_LOOSEN");
        let nonce = row.nonce;
        let spent = row.spent;
        let day = row.day;
        let count = row.count;
        row.rules = next;
        if freeze { row.frozen = true; }
        require!(row.nonce == nonce && row.spent == spent && row.day == day && row.count == count, "ERR_STATE");
        // A tighter payee list or cap also binds shop calls. A call whose
        // receiver left the list is dropped. A call cap above the new
        // per-action cap is lowered. The session ceiling cannot fall under
        // what was already spent.
        self.bind_calls(&me);
        self.bump_epoch(&me);
        refund(&me, env::attached_deposit().as_yoctonear());
    }

    fn bind_calls(&mut self, me: &AccountId) {
        let Some(row) = self.rows.get(me) else { return; };
        let cap = row.rules.per_action_cap;
        let daily = row.rules.daily_budget;
        let allowed = row.rules.receivers.clone();
        let Some(old) = self.calls.get(me).cloned() else { return; };
        let mut rules = Vec::new();
        for rule in old.rules {
            if !allowed.contains(&rule.receiver) && rule.method != "stamp" { continue; }
            let next_cap = rule.cap.min(cap);
            if next_cap == 0 { continue; }
            rules.push(CallRule { receiver: rule.receiver, method: rule.method, cap: next_cap });
        }
        let session_cap = old.session_cap.min(daily).max(old.session_spent);
        if rules.is_empty() { self.calls.remove(me); }
        else { self.calls.insert(me.clone(), CallPolicy { rules, session_cap, session_spent: old.session_spent }); }
    }

    pub fn tighten_calls(&mut self, rules: Vec<(AccountId, String, u128)>, session_cap: u128) {
        let me = env::predecessor_account_id();
        self.hydrate(&me);
        let old = self.calls.get(&me).cloned().expect("method_not_allowlisted");
        require!(session_cap <= old.session_cap && old.session_spent <= session_cap, "ERR_LOOSEN");
        let mut seen = Set::new();
        let mut parsed = Vec::new();
        for (receiver, method, cap) in rules {
            let prev = old.rules.iter().find(|r| r.receiver == receiver && r.method == method).unwrap_or_else(|| env::panic_str("ERR_LOOSEN"));
            require!(cap > 0 && cap <= prev.cap, "ERR_LOOSEN");
            require!(seen.insert((receiver.clone(), method.clone())), "ERR_RECEIVERS");
            parsed.push(CallRule { receiver, method, cap });
        }
        let before = self.baseline(&me);
        if parsed.is_empty() { self.calls.remove(&me); }
        else { self.calls.insert(me.clone(), CallPolicy { rules: parsed, session_cap, session_spent: old.session_spent }); }
        // Tightening only shrinks. It must not ask for the side reserve again.
        self.bump_epoch(&me);
        self.charge(&me, before);
    }

    pub fn propose_call_as(&mut self, owner: AccountId, receiver: AccountId, method: String, args: String, deposit: U128, expiry: U64, effects: Vec<EffectIn>, hold: bool, signature: String) -> Option<Promise> {
        self.hydrate(&owner);
        // A deposit on this method is not the spend. The spend comes from the row.
        // Refund anything attached so a wallet's 1 yocto cannot stick to the contract.
        let attached = env::attached_deposit().as_yoctonear();
        if attached > 0 { refund(&env::predecessor_account_id(), attached); }
        let args_out = inject_row_owner(&args, &owner);
        require!(args_out.len() <= 2048, "ERR_ARGS");
        check_effects(&effects);
        let deposit = deposit.0;
        let now = env::block_timestamp();
        require!(expiry.0 != 0 && now <= expiry.0, "ERR_EXPIRY");
        require!(expiry.0 <= now.saturating_add(HOLD_MAX_NS), "ERR_EXPIRY");
        let mut row = self.rows.get(&owner).cloned().expect("ERR_NO_CHARTER");
        require!(signature.len() == 128, "ERR_BAD_SIG");
        let sig = parse_hex_n::<64>(&signature);
        let msg = self.call_as_text(&owner, &receiver, &method, &args_out, deposit, row.nonce, expiry.0, &effects, hold);
        require!(env::ed25519_verify(&sig, msg.as_bytes(), &row.agent), "ERR_BAD_SIG");
        require!(!row.frozen, "frozen");
        if row.rules.expires_at != 0 { require!(now <= row.rules.expires_at, "clause_expired"); }
        require!(in_window(row.rules.window_start_min, row.rules.window_end_min), "outside_time_window");
        require!(deposit >= row.rules.min_amount, "below_min_amount");
        require!(row.rules.receivers.contains(&receiver), "receiver_not_allowlisted");
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
        require!(self.holds.keys().filter(|(o, _)| o == &owner).count() < MAX_OPEN_HOLDS, "ERR_HOLDS");
        self.reserve_effects(&owner, &effects);
        let id = row.nonce;
        let storage_before = self.baseline(&owner);
        row.balance -= deposit;
        // The hold keeps this NEAR as a liability, so the global total does not move.
        row.spent = next;
        row.count += 1;
        row.nonce += 1;
        self.rows.insert(owner.clone(), row);
        let mut policy = self.calls.get(&owner).unwrap().clone();
        policy.session_spent = next_session;
        self.calls.insert(owner.clone(), policy);
        let confirm = self.confirm.get(&owner).copied().unwrap_or([0; 32]);
        let epoch = self.epoch_of(&owner);
        self.holds.insert((owner.clone(), id), Hold {
            receiver: receiver.clone(), method: method.clone(), args: args_out.into_bytes(),
            amount: deposit, day, effects: effects.clone(), expires: expiry.0, pending: hold,
            epoch, confirm,
        });
        if self.partial { self.hold_count += 1; }
        self.flush_owner(&owner);
        let grown = env::storage_usage().saturating_sub(storage_before);
        let cost = grown as u128 * price();
        let have = self.credit.get(&owner).copied().unwrap_or(0);
        if cost > have {
            self.holds.remove(&(owner.clone(), id));
            if self.partial { self.hold_count = self.hold_count.saturating_sub(1); }
            kv_del(b"h", &format!("{}/{}", owner.as_str(), id));
            self.release_effects(&owner, &effects);
            let row = self.rows.get_mut(&owner).unwrap();
            row.balance += deposit;
            if row.day == day {
                row.spent = row.spent.saturating_sub(deposit);
                row.count = row.count.saturating_sub(1);
            }
            row.nonce -= 1;
            self.calls.get_mut(&owner).unwrap().session_spent = self.calls.get(&owner).unwrap().session_spent.saturating_sub(deposit);
            env::panic_str("ERR_DEPOSIT");
        }
        if cost > 0 { *self.credit.get_mut(&owner).unwrap() -= cost; }
        if hold { None } else { Some(self.send_call(&owner, id)) }
    }

    fn send_call(&mut self, owner: &AccountId, id: u64) -> Promise {
        let h = self.holds.get_mut(&(owner.clone(), id)).expect("ERR_ACTION");
        h.pending = false;
        let receiver = h.receiver.clone();
        let method = h.method.clone();
        let args = h.args.clone();
        let amount = h.amount;
        let mut cb = String::from("{\"owner\":\"");
        cb.push_str(owner.as_str());
        cb.push_str("\",\"action_id\":\"");
        push_u128(&mut cb, id as u128);
        cb.push_str("\"}");
        Promise::new(receiver).function_call(method, args, NearToken::from_yoctonear(amount), Gas::from_tgas(30))
            .then(Promise::new(env::current_account_id()).function_call(
                "on_called_as", cb.into_bytes(), NearToken::from_yoctonear(0), GAS_CALLBACK,
            ))
    }

    pub fn confirm_hold(&mut self, owner: AccountId, action_id: U64, signature: String) -> Promise {
        self.hydrate(&owner);
        let h = self.holds.get(&(owner.clone(), action_id.0)).cloned().expect("ERR_ACTION");
        require!(h.pending, "ERR_CONFIRM");
        require!(env::block_timestamp() <= h.expires, "ERR_EXPIRY");
        let row = self.rows.get(&owner).expect("ERR_NO_CHARTER");
        require!(!row.frozen, "frozen");
        if row.rules.expires_at != 0 { require!(env::block_timestamp() <= row.rules.expires_at, "clause_expired"); }
        let key = self.confirm.get(&owner).copied().expect("ERR_CONFIRM");
        require!(key == h.confirm, "ERR_CONFIRM");
        require!(self.epoch_of(&owner) == h.epoch, "ERR_EPOCH");
        let digest = confirm_digest(&h.method, &h.args, h.amount, &effects_canon(&h.effects));
        let msg = confirm_text(&owner, action_id.0, &digest);
        require!(signature.len() == 128, "ERR_BAD_SIG");
        require!(env::ed25519_verify(&parse_hex_n::<64>(&signature), msg.as_bytes(), &key), "ERR_BAD_SIG");
        self.send_call(&owner, action_id.0)
    }

    /// The row owner drops a hold that was never sent. The NEAR returns to that row.
    pub fn cancel_hold(&mut self, action_id: U64) {
        let me = env::predecessor_account_id();
        self.hydrate(&me);
        let h = self.holds.get(&(me.clone(), action_id.0)).cloned().expect("ERR_ACTION");
        require!(h.pending, "ERR_ACTION");
        self.finish(&me, action_id.0, false);
    }

    /// A sent hold whose shop never settled. After `expires`, the row owner or
    /// the contract owner marks it delivered: no refund, the hold storage is freed.
    ///
    /// If the shop call fails and `on_called_as` runs out of gas, the protocol
    /// returns that NEAR to this account, and this method still drops the
    /// liability. Crediting the row here would also pay a call that succeeded
    /// when its callback ran out of gas. The hold stays a liability until a
    /// callback, a refund, or this expiry.
    /// Drops a hold whose shop call already left and whose expiry has passed.
    /// A callback that runs out of its 20 Tgas never tells us whether the shop
    /// kept the NEAR or refunded it. Crediting the row here would also pay a
    /// call that succeeded, so this does not. Keyed storage keeps that callback
    /// on one row, which is what the 20 Tgas is for.
    pub fn expire_sent(&mut self, owner: AccountId, action_id: U64) {
        self.hydrate(&owner);
        let pred = env::predecessor_account_id();
        require!(pred == owner || pred == self.owner, "ERR_NOT_OWNER");
        let h = self.holds.get(&(owner.clone(), action_id.0)).cloned().expect("ERR_ACTION");
        require!(!h.pending, "ERR_ACTION");
        require!(env::block_timestamp() > h.expires, "ERR_EXPIRY");
        let freed = self.free_hold(&owner, action_id.0);
        if freed > 0 { *self.credit.entry(owner).or_insert(0) += freed; }
        self.owe(-(h.amount as i128));
    }

    pub fn on_called_as(&mut self, owner: AccountId, action_id: U64) {
        require!(env::predecessor_account_id() == env::current_account_id(), "ERR_PRIVATE");
        self.hydrate(&owner);
        self.finish(&owner, action_id.0, true);
    }

    /// Shop refund of a call that already left, or the row owner reclaiming a hold
    /// that was never sent and has expired. The NEAR goes back to that row.
    pub fn refund_action(&mut self, owner: AccountId, action_id: U64) {
        self.hydrate(&owner);
        let h = self.holds.get(&(owner.clone(), action_id.0)).cloned().expect("ERR_ACTION");
        let pred = env::predecessor_account_id();
        if h.pending {
            require!(pred == owner && env::block_timestamp() > h.expires, "ERR_REFUND");
        } else {
            require!(pred == h.receiver, "ERR_REFUND");
            require!(env::attached_deposit().as_yoctonear() == h.amount, "ERR_REFUND");
        }
        self.finish(&owner, action_id.0, false);
    }

    pub fn settle(&mut self, owner: AccountId, action_id: U64) {
        self.hydrate(&owner);
        let h = self.holds.get(&(owner.clone(), action_id.0)).cloned().expect("ERR_ACTION");
        require!(!h.pending, "ERR_SETTLE");
        require!(env::predecessor_account_id() == h.receiver, "ERR_SETTLE");
        let freed = self.free_hold(&owner, action_id.0);
        if freed > 0 { *self.credit.entry(owner).or_insert(0) += freed; }
        self.owe(-(h.amount as i128));
    }

    fn free_hold(&mut self, owner: &AccountId, id: u64) -> u128 {
        let before = self.baseline(owner);
        self.holds.remove(&(owner.clone(), id));
        if self.partial { self.hold_count = self.hold_count.saturating_sub(1); }
        kv_del(b"h", &format!("{}/{}", owner.as_str(), id));
        self.flush_owner(owner);
        let after = env::storage_usage();
        if before > after { (before - after) as u128 * price() } else { 0 }
    }

    fn finish(&mut self, owner: &AccountId, id: u64, from_callback: bool) {
        let key = (owner.clone(), id);
        let Some(h) = self.holds.get(&key).cloned() else { return; };
        if from_callback && h.pending { return; }
        let freed = self.free_hold(owner, id);
        if freed > 0 { *self.credit.entry(owner.clone()).or_insert(0) += freed; }
        let restore = if from_callback { !near_sdk::is_promise_success() } else { true };
        if !restore { self.owe(-(h.amount as i128)); return; }
        self.restore_row(owner, h.amount, h.day);
        self.release_effects(owner, &h.effects);
        if let Some(p) = self.calls.get_mut(owner) {
            p.session_spent = p.session_spent.saturating_sub(h.amount);
        }
    }

    fn restore_row(&mut self, owner: &AccountId, amount: u128, day: u64) {
        let Some(row) = self.rows.get_mut(owner) else { return; };
        row.balance += amount;
        if row.day == day {
            row.spent = row.spent.saturating_sub(amount);
            row.count = row.count.saturating_sub(1);
        }
    }

    fn reserve_effects(&mut self, owner: &AccountId, effects: &[EffectIn]) {
        if effects.is_empty() { return; }
        let caps = self.effects.get(owner).unwrap_or_else(|| env::panic_str("ERR_EFFECT"));
        for e in effects {
            require!(e.value > 0 || e.fee > 0, "ERR_EFFECT");
            let cap = caps.iter().find(|c| c.chain == e.chain && c.asset == e.asset && c.receiver == e.to).unwrap_or_else(|| env::panic_str("ERR_EFFECT"));
            require!(cap.value_spent.saturating_add(e.value) <= cap.value_cap, "ERR_EFFECT");
            require!(cap.fee_spent.saturating_add(e.fee) <= cap.fee_cap, "ERR_EFFECT");
        }
        let caps = self.effects.get_mut(owner).unwrap();
        for e in effects {
            let cap = caps.iter_mut().find(|c| c.chain == e.chain && c.asset == e.asset && c.receiver == e.to).unwrap();
            cap.value_spent += e.value;
            cap.fee_spent += e.fee;
        }
    }

    fn release_effects(&mut self, owner: &AccountId, effects: &[EffectIn]) {
        if effects.is_empty() { return; }
        let Some(caps) = self.effects.get_mut(owner) else { return; };
        for e in effects {
            if let Some(cap) = caps.iter_mut().find(|c| c.chain == e.chain && c.asset == e.asset && c.receiver == e.to) {
                cap.value_spent = cap.value_spent.saturating_sub(e.value);
                cap.fee_spent = cap.fee_spent.saturating_sub(e.fee);
            }
        }
    }

    pub fn effect_spent(&self, owner: &AccountId, chain: &str, asset: &str, to: &str) -> (u128, u128) {
        self.effects.get(owner).and_then(|caps| caps.iter().find(|c| c.chain == chain && c.asset == asset && c.receiver == to)).map(|c| (c.value_spent, c.fee_spent)).unwrap_or((0, 0))
    }

    pub fn anchor(&mut self, kind: String, digest: String, salt: String) {
        let me = env::predecessor_account_id();
        // The live board loads the header, not every row (`read_head`). Without this the
        // visitor's own row is absent from memory and the call panics ERR_NO_CHARTER.
        self.hydrate(&me);
        require!(self.rows.contains_key(&me), "ERR_NO_CHARTER");
        require!((1..=32).contains(&kind.len()) && kind.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'), "ERR_KIND");
        let raw = parse_hex32(&digest);
        require!((8..=64).contains(&salt.len()) && salt.bytes().all(|b| b.is_ascii_alphanumeric()), "ERR_SALT");
        let mut preimage = salt.into_bytes();
        preimage.extend_from_slice(&raw);
        let commitment = hex32(&env::sha256_array(&preimage));
        let nonce = self.rows.get(&me).unwrap().nonce;
        let mut ev = String::from("EVENT_JSON:{\"standard\":\"nearcarta-board\",\"version\":\"2\",\"event\":\"anchor\",\"owner\":\"");
        ev.push_str(me.as_str());
        ev.push_str("\",\"kind\":\"");
        ev.push_str(&kind);
        ev.push_str("\",\"commitment\":\"");
        ev.push_str(&commitment);
        ev.push_str("\",\"nonce\":\"");
        push_u128(&mut ev, nonce as u128);
        ev.push_str("\",\"time\":\"");
        push_u128(&mut ev, env::block_timestamp() as u128);
        ev.push_str("\"}");
        env::log_str(&ev);
    }

    pub fn stage_upgrade(&mut self, code_hash: String) {
        require!(env::predecessor_account_id() == self.owner, "ERR_NOT_OWNER");
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "ERR_ONE_YOCTO");
        self.upgrade_hash = parse_hex32(&code_hash);
        self.upgrade_set = true;
        self.upgrade_eta = env::block_timestamp().saturating_add(UPGRADE_DELAY_NS);
        let mut ev = String::from("EVENT_JSON:{\"standard\":\"nearcarta-board\",\"version\":\"2\",\"event\":\"stage_upgrade\",\"eta\":\"");
        push_u128(&mut ev, self.upgrade_eta as u128);
        ev.push_str("\",\"code_hash\":\"");
        ev.push_str(&code_hash);
        ev.push_str("\"}");
        env::log_str(&ev);
        let owner = self.owner.clone();
        refund(&owner, 1);
    }

    pub fn upgrade_eta(&self) -> u64 { self.upgrade_eta }

    pub fn upgrade(&mut self, code: Vec<u8>) -> Promise {
        require!(env::predecessor_account_id() == self.owner, "ERR_NOT_OWNER");
        require!(self.upgrade_set, "ERR_UPGRADE");
        require!(env::block_timestamp() >= self.upgrade_eta, "ERR_UPGRADE");
        require!(env::sha256_array(&code) == self.upgrade_hash, "ERR_UPGRADE");
        self.upgrade_set = false;
        // One receipt: deploy, then migrate on the new code. A second receipt
        // could land on the old code if the first one failed halfway.
        Promise::new(env::current_account_id())
            .deploy_contract(code)
            .function_call("migrate", b"{}".to_vec(), NearToken::from_yoctonear(0), Gas::from_tgas(30))
    }

    /// Reads the rows already in memory and leaves them there. The callback
    /// after `upgrade` is the only caller.
    pub fn migrate(&mut self) {
        require!(env::predecessor_account_id() == env::current_account_id(), "ERR_PRIVATE");
        if self.network.is_empty() { self.network = "mainnet".into(); }
        let mut ev = String::from("EVENT_JSON:{\"standard\":\"nearcarta-board\",\"version\":\"2\",\"event\":\"migrate\",\"rows\":");
        push_u128(&mut ev, self.count as u128);
        ev.push_str(",\"liabilities\":\"");
        push_u128(&mut ev, self.liabilities());
        ev.push_str("\"}");
        env::log_str(&ev);
    }
}

fn window_tighter(old_s: u16, old_e: u16, new_s: u16, new_e: u16) -> bool {
    let old_all = old_s == old_e;
    let new_all = new_s == new_e;
    if new_all { return old_all; }
    if old_all { return new_s < new_e; }
    if old_s < old_e && new_s < new_e { return new_s >= old_s && new_e <= old_e; }
    old_s == new_s && old_e == new_e
}

fn confirm_digest(method: &str, args: &[u8], deposit: u128, effects: &str) -> [u8; 32] {
    let mut s = String::from(method);
    s.push('|');
    s.push_str(&hex32(&env::sha256_array(args)));
    s.push('|');
    push_u128(&mut s, deposit);
    s.push('|');
    s.push_str(effects);
    env::sha256_array(s.as_bytes())
}

fn confirm_text(owner: &AccountId, action_id: u64, digest: &[u8; 32]) -> String {
    let mut s = String::from("board-confirm-v1|");
    s.push_str(env::current_account_id().as_str());
    s.push('|'); s.push_str(owner.as_str());
    s.push('|'); push_u128(&mut s, action_id as u128);
    s.push('|'); s.push_str(&hex32(digest));
    s.push_str("|present");
    s
}

fn effects_json(v: &Val) -> Vec<EffectIn> {
    v.arr().iter().map(|item| {
        let o = item.obj();
        EffectIn {
            chain: o.need("chain").string(),
            asset: o.need("asset").string(),
            to: o.need("to").string(),
            value: o.need("value").u128(),
            fee: o.need("fee").u128(),
        }
    }).collect()
}

#[no_mangle]
pub extern "C" fn propose_call_as() {
    let v = parse(&input_str());
    let mut b = load();
    let _ = b.propose_call_as(
        v.need("owner").account(), v.need("receiver").account(), v.need("method").string(), v.need("args").string(),
        U128(v.need("deposit").u128()), U64(v.need("expiry").u128() as u64), effects_json(v.need("effects")),
        v.need("hold").bool(), v.need("signature").string(),
    );
    save(&b);
}
#[no_mangle]
pub extern "C" fn call_as_message() {
    let v = parse(&input_str());
    let mut b = load();
    let owner = v.need("owner").account();
    b.hydrate(&owner);
    ret(&b.call_as_message(
        v.need("owner").account(), v.need("receiver").account(), v.need("method").string(), v.need("args").string(),
        U128(v.need("deposit").u128()), U64(v.need("nonce").u128() as u64), U64(v.need("expiry").u128() as u64),
        effects_json(v.need("effects")), v.need("hold").bool(),
    ));
}
#[no_mangle]
pub extern "C" fn set_effects() {
    let v = parse(&input_str());
    let mut b = load();
    b.set_effects(effects_json(v.need("effects")));
    save(&b);
}
#[no_mangle]
pub extern "C" fn tighten_effects() {
    let v = parse(&input_str());
    let mut b = load();
    b.tighten_effects(effects_json(v.need("effects")));
    save(&b);
}
#[no_mangle]
pub extern "C" fn tighten_rules() {
    let v = parse(&input_str());
    let mut b = load();
    b.tighten_rules(rules_json(v.need("rules")), v.need("freeze").bool());
    save(&b);
}
#[no_mangle]
pub extern "C" fn tighten_calls() {
    let v = parse(&input_str());
    let mut rules = Vec::new();
    for item in v.need("calls").arr() {
        let o = item.obj();
        rules.push((o.need("receiver").account(), o.need("method").string(), o.need("cap").u128()));
    }
    let mut b = load();
    b.tighten_calls(rules, v.need("session_cap").u128());
    save(&b);
}
#[no_mangle]
pub extern "C" fn set_confirm_key() {
    let v = parse(&input_str());
    let mut b = load();
    b.set_confirm_key(v.need("key").string());
    save(&b);
}
#[no_mangle]
pub extern "C" fn confirm_hold() {
    let v = parse(&input_str());
    let mut b = load();
    let _ = b.confirm_hold(v.need("owner").account(), U64(v.need("action_id").u128() as u64), v.need("signature").string());
    save(&b);
}
#[no_mangle]
pub extern "C" fn confirm_message() {
    let v = parse(&input_str());
    let mut b = load();
    let owner = v.need("owner").account();
    b.hydrate(&owner);
    ret(&b.confirm_message(owner, U64(v.need("action_id").u128() as u64)));
}
#[no_mangle]
pub extern "C" fn on_called_as() {
    require!(env::predecessor_account_id() == env::current_account_id(), "ERR_PRIVATE");
    let v = parse(&input_str());
    let mut b = load();
    b.on_called_as(v.need("owner").account(), U64(v.need("action_id").u128() as u64));
    save(&b);
}
#[no_mangle]
pub extern "C" fn cancel_hold() {
    let v = parse(&input_str());
    let mut b = load();
    b.cancel_hold(U64(v.need("action_id").u128() as u64));
    save(&b);
}
#[no_mangle]
pub extern "C" fn expire_sent() {
    let v = parse(&input_str());
    let mut b = load();
    b.expire_sent(v.need("owner").account(), U64(v.need("action_id").u128() as u64));
    save(&b);
}
#[no_mangle]
pub extern "C" fn refund_action() {
    let v = parse(&input_str());
    let mut b = load();
    b.refund_action(v.need("owner").account(), U64(v.need("action_id").u128() as u64));
    save(&b);
}
#[no_mangle]
pub extern "C" fn settle() {
    let v = parse(&input_str());
    let mut b = load();
    b.settle(v.need("owner").account(), U64(v.need("action_id").u128() as u64));
    save(&b);
}
#[no_mangle]
pub extern "C" fn anchor() {
    let v = parse(&input_str());
    let mut b = load();
    // "Stores nothing" is about the trie, so compare storage usage rather than the
    // in-memory encode: the live load hydrates the visitor's row before the event.
    let before = env::storage_usage();
    b.anchor(v.need("kind").string(), v.need("digest").string(), v.need("salt").string());
    require!(env::storage_usage() == before, "ERR_STATE");
    save(&b);
}
#[no_mangle]
pub extern "C" fn stage_upgrade() {
    let v = parse(&input_str());
    let mut b = load();
    b.stage_upgrade(v.need("code_hash").string());
    save(&b);
}
#[no_mangle]
pub extern "C" fn upgrade() {
    let v = parse(&input_str());
    let code = parse_hex_bytes(&v.need("code").string());
    let mut b = load();
    let _ = b.upgrade(code);
    save(&b);
}
#[no_mangle]
pub extern "C" fn migrate() {
    let mut b = load();
    b.migrate();
    save(&b);
}
#[no_mangle]
pub extern "C" fn get_liabilities() {
    let mut s = String::new();
    push_u128(&mut s, load().liabilities());
    ret(&s);
}

fn parse_hex_bytes(s: &str) -> Vec<u8> {
    require!(s.len() % 2 == 0 && s.len() <= 400_000, "ERR_HEX");
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap_or_else(|_| env::panic_str("ERR_HEX"))).collect()
}
