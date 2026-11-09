//! Visitor toll. Any Base address from the visitor's request. No address allow list.
//! Safety comes from the visitor's own row: the board's per-action cap, daily budget and
//! reserved effect budget, plus `row_budget` on the call and the fixed gas limit here.
//! There is no contract-wide amount cap. The owner's `max_per_tx` and `max_token` are
//! retired: v8 stopped enforcing them, and `policy` reports them as null so no client
//! reintroduces a limit the visitor did not set.
//! The board opens `cross`. The row owner calls `sign_cross`. A failed deposit is
//! `refund_action` on the board. `upgrade` then `migrate` replaces this wasm in place.
mod rlp;
use near_sdk::json_types::{U128, U64};
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};
use serde_json::{json, Value};

/// Room `sign_cross` keeps for the signed transaction and derived address `on_signed` stores.
const SIGNED_TX_BYTES: u64 = 512;

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct TxRec {
    pub to: String, pub value: U128, pub nonce: u64, pub status: String,
    pub unsigned_hash: String, pub raw_signed: Option<String>, pub tx_hash: Option<String>,
    pub path: Option<String>, pub evm_nonce: Option<u64>, pub asset: Option<String>,
    pub row_owner: Option<String>, pub token_used: Option<String>,
}
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Oath {
    owner: AccountId, mpc: AccountId, path: String, chain_id: u64, foreign_address: String,
    max_per_tx: u128, budget: u128, max_fee_cap: u128, next_nonce: u64, frozen: bool,
    txs: LookupMap<u64, TxRec>,
    orders: LookupMap<u64, Order>, next_order: u64,
    row_nonce: LookupMap<String, u64>, row_spent: LookupMap<String, u128>,
    derived: LookupMap<String, String>, liabilities: LookupMap<u64, Liab>,
    actions: LookupMap<String, u64>, tx_order: LookupMap<u64, u64>,
    service_held: u128, earned: u128, surplus: u128, price: Option<Price>,
}
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Split { pub account: AccountId, pub bps: u16 }
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Price { pub board: AccountId, pub fee: U128, pub cost: U128, pub splits: Vec<Split>, pub paused: bool, pub usdc: String, pub max_token: U128, pub hold_ns: U64 }
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Order { pub id: u64, pub action_id: u64, pub row_owner: AccountId, pub chain: String, pub path: String, pub asset: String, pub to: String, pub amount: U128, pub fee: U128, pub status: String, pub evm_nonce: u64, pub tx_nonce: Option<u64>, pub opened_at: U64 }
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Liab { pub row_owner: AccountId, pub amount: U128, pub refunded: bool }

fn row_path(owner: &AccountId) -> String { format!("row:{owner}:base") }
fn spend_key(owner: &AccountId, asset: &str) -> String { format!("{owner}#base#{asset}") }
fn action_key(owner: &AccountId, action_id: u64) -> String { format!("{owner}#{action_id}") }
fn hx(b: &[u8]) -> String { hex::encode(b) }
fn unhex(s: &str) -> Vec<u8> { hex::decode(s.trim_start_matches("0x")).expect("bad hex") }
fn evm_addr(raw: &str) -> String {
    let to = raw.trim().to_lowercase();
    let h = to.strip_prefix("0x").unwrap_or("");
    require!(h.len() == 40 && h.chars().all(|c| c.is_ascii_hexdigit()), "REFUSED: recipient must be an EVM address");
    to
}
pub fn erc20_transfer_data(to: &str, value: u128) -> Vec<u8> {
    let mut d = vec![0xa9, 0x05, 0x9c, 0xbb];
    d.extend([0u8; 12]); d.extend(unhex(to));
    d.extend([0u8; 16]); d.extend(value.to_be_bytes());
    d
}
const ERC20_GAS_CAP: u64 = 100_000;

#[near]
impl Oath {
    #[init]
    pub fn new(owner: AccountId, mpc: AccountId, path: String, chain_id: u64, foreign_address: String,
               fx_root_key: String, allow_to: Vec<String>, max_per_tx: U128, budget: U128, max_fee_cap: U128,
               verify_chain: Option<String>, token: Option<String>, dao: Option<AccountId>, gate: Option<String>) -> Self {
        let _ = (fx_root_key, verify_chain);
        require!(allow_to.is_empty(), "allow_to must be empty");
        require!(token.is_none() && dao.is_none() && gate.is_none(), "this toll has no gate");
        require!(chain_id == 8453 || chain_id == 84532, "chain_id does not belong to Base");
        Self { owner, mpc, path, chain_id, foreign_address: foreign_address.to_lowercase(),
            max_per_tx: max_per_tx.0, budget: budget.0, max_fee_cap: max_fee_cap.0, next_nonce: 0, frozen: false,
            txs: LookupMap::new(b"t"), orders: LookupMap::new(b"o"), next_order: 0,
            row_nonce: LookupMap::new(b"r"), row_spent: LookupMap::new(b"s"), derived: LookupMap::new(b"d"),
            liabilities: LookupMap::new(b"l"), actions: LookupMap::new(b"a"), tx_order: LookupMap::new(b"x"),
            service_held: 0, earned: 0, surplus: 0, price: None }
    }
    fn assert_owner(&self) { require!(env::predecessor_account_id() == self.owner, "only owner"); }
    /// Writes that add bytes, and the surplus payout, must leave the held service deposits
    /// refundable. The bytes are staked from the same balance, so a crossing whose records cost
    /// more than its fee, or a surplus payout that took the stake's cover, could leave a
    /// `refund_order` without balance. `out` is NEAR about to leave or bytes still to come.
    fn check_float(&mut self, out: u128) {
        self.txs.flush(); self.orders.flush(); self.row_nonce.flush(); self.row_spent.flush();
        self.derived.flush(); self.liabilities.flush(); self.actions.flush(); self.tx_order.flush();
        let stake = env::storage_usage() as u128 * env::storage_byte_cost().as_yoctonear();
        let need = stake.saturating_add(self.service_held).saturating_add(out);
        require!(env::account_balance().as_yoctonear() >= need, "ERR_FLOAT");
    }
    pub fn freeze(&mut self) { self.assert_owner(); self.frozen = true; }
    /// Unfreezing reopens crossings, so it needs the owner's full-access key (1 yocto).
    #[payable]
    pub fn unfreeze(&mut self) { near_sdk::assert_one_yocto(); self.assert_owner(); self.frozen = false; }
    #[payable]
    pub fn close(&mut self) -> Promise {
        near_sdk::assert_one_yocto();
        self.assert_owner();
        // Every open or signing crossing holds its fee in `service_held` (`cross` refuses a fee
        // below the price, and the price is above 0), so this one check covers them all. The
        // loop over every order it replaces grew with each crossing and could outgrow the gas.
        require!(self.service_held == 0, "REFUSED: service deposits are still held");
        Promise::new(env::current_account_id()).delete_account(self.owner.clone())
    }
    pub fn policy(&self) -> Value {
        json!({"owner": self.owner, "mpc": self.mpc, "path": self.path, "chain_id": self.chain_id,
            "foreign_address": self.foreign_address, "allow_to": [],
            // Null means "no contract-wide limit". The visitor's /setup row is the cap.
            "max_per_tx": Value::Null, "budget": Value::Null,
            "spent": "0", "max_fee_cap": self.max_fee_cap.to_string(),
            "next_nonce": self.next_nonce, "frozen": self.frozen, "verify_chain": "Base",
            "asset": "native", "dao": Value::Null, "gate": Value::Null, "cross": Value::Null,
            "recipients": "visitor", "price": self.price,
            "service_held": self.service_held.to_string(), "earned": self.earned.to_string(), "surplus": self.surplus.to_string()})
    }
    /// The service price. `max_token` is retired: it is stored for the record but no
    /// longer enforced, so a visitor's row is the only limit on a USDC crossing.
    #[payable]
    pub fn set_price(&mut self, board: AccountId, fee: U128, cost: U128, splits: Vec<Split>, paused: bool, usdc: String, max_token: U128, hold_ns: U64) {
        near_sdk::assert_one_yocto();
        self.assert_owner();
        require!(fee.0 > 0 && cost.0 <= fee.0, "cost must sit inside the fee");
        let mut bps = 0u32;
        for s in &splits { require!(s.bps > 0, "split share must be set"); bps += s.bps as u32; }
        require!(bps <= 10_000, "split is over 100%");
        self.price = Some(Price { board, fee, cost, splits, paused, usdc: evm_addr(&usdc), max_token, hold_ns });
    }
    pub fn address_of(&self, row_owner: AccountId, chain: String) -> Value {
        require!(chain.eq_ignore_ascii_case("base"), "REFUSED: that chain is not on this toll");
        let path = row_path(&row_owner);
        json!({"path": path, "address": self.derived.get(&path).cloned()})
    }
    pub fn get_order(&self, id: u64) -> Option<Order> { self.orders.get(&id).cloned() }
    pub fn get_tx(&self, nonce: u64) -> Option<TxRec> { self.txs.get(&nonce).cloned() }
    /// The board opens a crossing. This does not call the signer, so it fits the 30 Tgas
    /// `propose_call_as` forward. `row_owner` is the top-level field the board injects.
    /// A nested `row_owner` is not a parameter of this method. The predecessor must be the board.
    #[payable]
    pub fn cross(&mut self, row_owner: AccountId, action_id: u64, chain: String, asset: String, to: String, amount: U128, row_budget: U128) -> u64 {
        let price = self.price.clone().unwrap_or_else(|| env::panic_str("REFUSED: this toll has no price"));
        require!(env::predecessor_account_id() == price.board, "REFUSED: only the board can open a crossing");
        require!(!self.frozen && !price.paused, "REFUSED: oath frozen");
        let dep = env::attached_deposit().as_yoctonear();
        require!(dep >= price.fee.0, "REFUSED: the crossing paid less than the toll");
        require!(chain.eq_ignore_ascii_case("base"), "REFUSED: that chain is not on this toll");
        let asset_l = asset.to_lowercase();
        require!(asset_l == "native" || asset_l == "usdc", "REFUSED: asset must be native or usdc");
        let to = evm_addr(&to);
        require!(amount.0 > 0, "REFUSED: amount must be set");
        // No contract-wide cap. The visitor's row is the only amount authority, and the
        // board refuses a value over the effect budget it reserved before this call.
        // `row_budget` is the visitor's own number for this crossing.
        require!(amount.0 <= row_budget.0, "REFUSED: value over the row budget");
        let key = action_key(&row_owner, action_id);
        require!(!self.actions.contains_key(&key), "REFUSED: this crossing was already opened");
        let spent_key = spend_key(&row_owner, &asset_l);
        let spent = self.row_spent.get(&spent_key).copied().unwrap_or(0);
        require!(spent + amount.0 <= row_budget.0, "REFUSED: the row budget is spent");
        let id = self.next_order;
        self.next_order = id + 1;
        let path = row_path(&row_owner);
        self.actions.insert(key, id);
        self.row_spent.insert(spent_key, spent + amount.0);
        self.service_held += dep;
        self.orders.insert(id, Order { id, action_id, row_owner, chain: "base".into(), path, asset: asset_l, to, amount, fee: U128(dep), status: "open".into(), evm_nonce: 0, tx_nonce: None, opened_at: U64(env::block_timestamp()) });
        self.check_float(0);
        id
    }
    pub fn sign_cross(&mut self, id: u64) -> Promise {
        require!(env::prepaid_gas() >= Gas::from_tgas(150), "attach at least 150 Tgas");
        let caller = env::predecessor_account_id();
        require!(caller != env::current_account_id(), "REFUSED: the toll account cannot sign this crossing");
        let mut order = self.orders.get(&id).cloned().unwrap_or_else(|| env::panic_str("REFUSED: no such crossing"));
        require!(order.row_owner == caller, "REFUSED: this crossing is not yours");
        require!(order.status == "open", "REFUSED: this crossing was already signed");
        let evm_nonce = self.row_nonce.get(&order.path).copied().unwrap_or(0);
        self.row_nonce.insert(order.path.clone(), evm_nonce + 1);
        order.evm_nonce = evm_nonce;
        order.status = "signing".into();
        let price = self.price.clone().expect("price");
        let token = if order.asset == "usdc" { Some(price.usdc) } else { None };
        let (fee, prio) = (U128(self.max_fee_cap), U128(self.max_fee_cap / 5));
        let gas = if token.is_some() { 60_000 } else { 21000 };
        let tx = self.sign(order.to.clone(), order.amount, fee, prio, gas, order.path.clone(), evm_nonce, order.asset.clone(), caller.to_string(), token, id);
        order.tx_nonce = Some(self.next_nonce - 1);
        self.orders.insert(id, order);
        // `on_signed` writes the signed transaction later and must not fail for lack of balance.
        self.check_float(SIGNED_TX_BYTES as u128 * env::storage_byte_cost().as_yoctonear());
        tx
    }
    pub fn cancel_order(&mut self, id: u64) {
        let price = self.price.clone().unwrap_or_else(|| env::panic_str("REFUSED: this toll has no price"));
        require!(env::predecessor_account_id() == price.board, "REFUSED: only the board can cancel a crossing");
        let order = self.orders.get(&id).cloned().unwrap_or_else(|| env::panic_str("REFUSED: no such crossing"));
        require!(order.status == "open", "REFUSED: this crossing was already signed");
        require!(env::block_timestamp() >= order.opened_at.0.saturating_add(price.hold_ns.0), "REFUSED: the hold has not ended");
        self.fail_order(id);
    }
    /// One refund of a failed service deposit. The promise is `refund_action` on the board.
    /// `confirm_hold`, `cancel_hold` and `expire_sent` are board methods. This shop does not implement them.
    /// A successful `cross` lets the board clear the hold in `on_called_as`, so this refund
    /// only lands while that hold is still present.
    pub fn refund_order(&mut self, id: u64) -> Promise {
        let price = self.price.clone().unwrap_or_else(|| env::panic_str("REFUSED: this toll has no price"));
        require!(env::predecessor_account_id() == price.board, "REFUSED: only the board can refund a crossing");
        let mut liab = self.liabilities.get(&id).cloned().unwrap_or_else(|| env::panic_str("REFUSED: nothing is owed"));
        require!(!liab.refunded, "REFUSED: this deposit was already refunded");
        let action_id = self.orders.get(&id).map(|o| o.action_id).unwrap_or_else(|| env::panic_str("REFUSED: no such crossing"));
        liab.refunded = true;
        self.service_held -= liab.amount.0;
        self.liabilities.insert(id, liab.clone());
        if let Some(mut order) = self.orders.get(&id).cloned() { order.status = "refunded".into(); self.orders.insert(id, order); }
        Promise::new(price.board).function_call("refund_action".to_string(), json!({"owner": liab.row_owner, "action_id": action_id.to_string()}).to_string().into_bytes(), NearToken::from_yoctonear(liab.amount.0), Gas::from_tgas(20))
    }
    #[payable]
    pub fn withdraw_surplus(&mut self, amount: U128) -> Promise {
        near_sdk::assert_one_yocto();
        self.assert_owner();
        require!(amount.0 > 0 && amount.0 <= self.surplus, "REFUSED: that is more than the surplus");
        self.surplus -= amount.0;
        let price = self.price.clone().unwrap_or_else(|| env::panic_str("REFUSED: this toll has no price"));
        let mut assigned = 0u128;
        let mut parts: Vec<(AccountId, u128)> = vec![];
        for s in &price.splits {
            let share = amount.0 * s.bps as u128 / 10_000;
            if share > 0 { parts.push((s.account.clone(), share)); assigned += share; }
        }
        let rest = amount.0 - assigned;
        if rest > 0 { parts.push((self.owner.clone(), rest)); }
        self.check_float(amount.0);
        let mut it = parts.into_iter();
        let (account, yocto) = it.next().expect("a surplus has a payee");
        let mut p = Promise::new(account).transfer(NearToken::from_yoctonear(yocto));
        for (account, yocto) in it { p = p.and(Promise::new(account).transfer(NearToken::from_yoctonear(yocto))); }
        p
    }
    fn fail_order(&mut self, id: u64) {
        let mut order = match self.orders.get(&id).cloned() { Some(o) => o, None => return };
        if order.status == "failed" || order.status == "refunded" { return; }
        let key = spend_key(&order.row_owner, &order.asset);
        let spent = self.row_spent.get(&key).copied().unwrap_or(0);
        self.row_spent.insert(key, spent.saturating_sub(order.amount.0));
        if self.liabilities.get(&id).is_none() {
            self.liabilities.insert(id, Liab { row_owner: order.row_owner.clone(), amount: order.fee, refunded: false });
        }
        order.status = "failed".into();
        self.orders.insert(id, order);
    }
    #[payable]
    pub fn upgrade(&mut self, code: near_sdk::json_types::Base64VecU8) -> Promise {
        near_sdk::assert_one_yocto();
        self.assert_owner();
        require!(!code.0.is_empty(), "empty code");
        Promise::new(env::current_account_id()).deploy_contract(code.0)
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(15)).migrate())
    }
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self { env::state_read().expect("no state") }
    fn sign(&mut self, to: String, value: U128, max_fee_per_gas: U128, max_priority_fee_per_gas: U128, gas_limit: u64, path: String, evm_nonce: u64, asset: String, row_owner: String, token: Option<String>, order_id: u64) -> Promise {
        require!(!self.frozen, "REFUSED: oath frozen");
        let to = to.to_lowercase();
        require!(max_fee_per_gas.0 <= self.max_fee_cap && max_priority_fee_per_gas.0 <= max_fee_per_gas.0, "REFUSED: gas fee over cap");
        match token.as_deref() {
            None => require!(gas_limit <= 21000, "REFUSED: only plain transfers (gas 21000)"),
            Some(_) => require!(gas_limit <= ERC20_GAS_CAP, "REFUSED: gas limit over ERC-20 cap"),
        }
        let nonce = self.next_nonce;
        let fields = fields_for(self.chain_id, token.as_deref(), evm_nonce, max_priority_fee_per_gas.0, max_fee_per_gas.0, gas_limit, &to, value.0);
        let mut pre = vec![0x02u8];
        pre.extend(rlp::enc_list(&fields));
        let h = env::keccak256(&pre);
        self.next_nonce += 1;
        self.txs.insert(nonce, TxRec { to: to.clone(), value, nonce, status: "signing".into(), unsigned_hash: hx(&h), raw_signed: None, tx_hash: None, path: Some(path.clone()), evm_nonce: Some(evm_nonce), asset: Some(asset), row_owner: Some(row_owner), token_used: token.clone() });
        self.tx_order.insert(nonce, order_id);
        let args = json!({"request": {"path": path, "payload_v2": {"Ecdsa": hx(&h)}, "domain_id": 0}});
        Promise::new(self.mpc.clone()).function_call("sign".to_string(), args.to_string().into_bytes(), NearToken::from_yoctonear(1), Gas::from_tgas(50))
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(30)).on_signed(nonce, max_fee_per_gas, max_priority_fee_per_gas, gas_limit))
    }
    #[private]
    pub fn on_signed(&mut self, nonce: u64, max_fee_per_gas: U128, max_priority_fee_per_gas: U128, gas_limit: u64, #[callback_result] sig: Result<Value, PromiseError>) -> Option<TxRec> {
        let _ = (max_fee_per_gas, max_priority_fee_per_gas);
        let mut rec = self.txs.get(&nonce).cloned().expect("no rec");
        let sig = match sig { Ok(v) => v, Err(_) => {
            rec.status = "failed".into();
            self.txs.insert(nonce, rec.clone());
            if let Some(id) = self.tx_order.get(&nonce).copied() { self.fail_order(id); }
            return Some(rec);
        }};
        let big_r = unhex(sig["big_r"]["affine_point"].as_str().unwrap());
        let s = unhex(sig["s"]["scalar"].as_str().unwrap());
        let v = sig["recovery_id"].as_u64().unwrap() as u8;
        let r = &big_r[1..33];
        let mut rs = [0u8; 64]; rs[..32].copy_from_slice(r); rs[32..].copy_from_slice(&s);
        let h: [u8; 32] = unhex(&rec.unsigned_hash).try_into().unwrap();
        let pk = env::ecrecover(&h, &rs, v, true).expect("ecrecover failed");
        let addr = format!("0x{}", hx(&env::keccak256(&pk)[12..]));
        if let Some(path) = rec.path.clone() {
            match self.derived.get(&path).cloned() {
                Some(prev) => require!(addr == prev, "signature does not recover to the row address"),
                None => { self.derived.insert(path, addr); }
            }
        }
        let n = rec.evm_nonce.unwrap_or(nonce);
        let token = rec.token_used.clone();
        let mut f = fields_for(self.chain_id, token.as_deref(), n, max_priority_fee_per_gas.0, max_fee_per_gas.0, gas_limit, &rec.to, rec.value.0);
        if let Some(id) = self.tx_order.get(&nonce).copied() {
            if let Some(mut order) = self.orders.get(&id).cloned() {
                if order.status == "signing" {
                    let fee = order.fee.0;
                    let cost = self.price.as_ref().map(|p| p.cost.0.min(fee)).unwrap_or(0);
                    if self.service_held >= fee { self.service_held -= fee; }
                    self.earned += fee;
                    self.surplus += fee - cost;
                    order.status = "signed".into();
                    self.orders.insert(id, order);
                }
            }
        }
        f.push(rlp::enc_uint(v as u128));
        f.push(rlp::enc_bytes(rlp::strip(r)));
        f.push(rlp::enc_bytes(rlp::strip(&s)));
        let mut raw = vec![0x02u8]; raw.extend(rlp::enc_list(&f));
        let txh = env::keccak256(&raw);
        rec.status = "signed".into(); rec.raw_signed = Some(format!("0x{}", hx(&raw))); rec.tx_hash = Some(format!("0x{}", hx(&txh)));
        self.txs.insert(nonce, rec.clone());
        Some(rec)
    }
}
fn fields_for(chain_id: u64, token: Option<&str>, nonce: u64, prio: u128, maxfee: u128, gas: u64, to: &str, value: u128) -> Vec<Vec<u8>> {
    let (evm_to, evm_value, data) = match token {
        None => (unhex(to), value, vec![]),
        Some(t) => (unhex(t), 0, erc20_transfer_data(to, value)),
    };
    vec![rlp::enc_uint(chain_id as u128), rlp::enc_uint(nonce as u128), rlp::enc_uint(prio), rlp::enc_uint(maxfee),
         rlp::enc_uint(gas as u128), rlp::enc_bytes(&evm_to), rlp::enc_uint(evm_value), rlp::enc_bytes(&data), rlp::enc_list(&[])]
}

#[cfg(test)]
mod tests;
