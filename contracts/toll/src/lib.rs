//! oath-lab: a policy ("oath") contract that owns an EVM wallet (Base, Arbitrum, ...) via NEAR Chain Signatures.
//! One chain per instance: `chain_id` for the tx it signs, `verify_chain` for the MPC foreign-tx proof that settles it.
//! The agent can only *propose*; this contract checks the clauses, builds the EIP-1559 tx itself,
//! asks the MPC network to sign it (predecessor = this contract, so the key belongs to the oath),
//! and later settles it only on an MPC foreign-tx proof (verify_foreign_transaction).
//! v3: an optional ERC-20 `token` (e.g. Circle USDC). With a token set, `pay` builds
//! `token.transfer(to, value)` itself (EVM value 0), and the caps and budget count token units.
//! v3: an optional `dao`. With a DAO set, only the DAO can unfreeze (the owner can still freeze).
//! v4: an optional visitor `gate`. `pay_for(charter, action_id)` is open to anyone, but it signs only after
//! it has read, on chain, that `charter` was made by the gate's charter factory and that this charter's
//! own action `action_id` paid the toll fee in NEAR to the gate's payee with the gate's memo and settled.
//! v5: the gate holds a fixed list of charter factories (set once at init, no setter): a charter qualifies when
//! its parent account is on the list and that factory's is_charter says yes.
//! v6: `close()` lets the owner delete the account and take back all its NEAR (storage stake included).
//! Each charter action opens the gate once. The EVM payout is fixed by the gate (recipient, value, fees),
//! so a visitor can not choose where the oath's coins go; the oath's own caps and budget still apply.
mod rlp;
use near_sdk::json_types::{U128, U64};
use near_sdk::store::LookupMap;
use near_sdk::{env, log, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};
use serde_json::{json, Value};

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct TxRec {
    pub to: String,
    pub value: U128,
    pub nonce: u64,
    pub status: String, // signing | signed | failed | confirmed | refused_proof
    pub unsigned_hash: String,
    pub raw_signed: Option<String>,
    pub tx_hash: Option<String>,
    pub proof_payload_hash: Option<String>,
    pub path: Option<String>,
    pub evm_nonce: Option<u64>,
    pub asset: Option<String>,
    pub row_owner: Option<String>,
    pub token_used: Option<String>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Oath {
    owner: AccountId,
    mpc: AccountId,
    path: String,
    chain_id: u64,
    foreign_address: String,  // 0x.. derived for (this contract, path), checked on every signature
    fx_root_key: String,      // hex 64-byte uncompressed secp256k1 key of MPC ForeignTx domain
    allow_to: Vec<String>,
    max_per_tx: u128,
    budget: u128,
    spent: u128,
    max_fee_cap: u128,
    next_nonce: u64,
    frozen: bool,
    txs: LookupMap<u64, TxRec>,
    verify_chain: String,     // MPC ForeignChainRpcRequest variant name, e.g. "Base", "Arbitrum"
    token: Option<String>,    // v3: ERC-20 contract; None = native coin
    dao: Option<AccountId>,   // v3: if set, the only account that can unfreeze
    gate: Option<Gate>,       // v4: visitor gate; None = owner/agent only
    visits: LookupMap<String, u64>, // v4: "charter#action_id" -> EVM nonce it opened
    visit_of: LookupMap<u64, Visit>, // v4: EVM nonce -> the charter action that paid for it
    cross: Option<Cross>, // v7: board pass, then the visitor names the Base recipient
    passes: LookupMap<u64, PassRec>,
    next_pass: u64,
    book: LookupMap<AccountId, Vec<String>>, // optional recipients for one visitor; empty means any address
    orders: LookupMap<u64, Order>,
    next_order: u64,
    row_nonce: LookupMap<String, u64>,
    row_spent: LookupMap<String, u128>,
    derived: LookupMap<String, String>,
    liabilities: LookupMap<u64, Liab>,
    actions: LookupMap<String, u64>,
    tx_order: LookupMap<u64, u64>,
    service_held: u128,
    earned: u128,
    surplus: u128,
    price: Option<Price>,
}

/// v4: what a visitor's charter must have paid on NEAR, and the fixed EVM payout it buys.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Gate {
    pub factories: Vec<AccountId>, // v5: charters must come from one of these factories (parent account + is_charter)
    pub payee: AccountId,     // the charter action's receiver
    pub fee: U128,            // minimum NEAR (yocto) the action paid
    pub memo: String,         // the action's memo, e.g. "toll:base"
    pub evm_to: String,       // fixed EVM recipient (must be in allow_to)
    pub evm_value: U128,      // fixed EVM value (wei)
    pub max_fee_per_gas: U128,
    pub max_priority_fee_per_gas: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Visit { pub charter: AccountId, pub action_id: u64, pub by: AccountId }

/// v7: the board pass fee and the Base value. The visitor names the recipient on the call.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Cross {
    pub board: AccountId,
    pub pass_fee: U128,
    pub foreign_value: U128,
    pub max_fee_per_gas: U128,
    pub max_priority_fee_per_gas: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct PassRec { pub owner: AccountId, pub deposit: U128, pub used: bool }

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Split { pub account: AccountId, pub bps: u16 }

/// Service price. The foreign transfer is not part of this fee.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Price {
    pub board: AccountId,
    pub fee: U128,
    pub cost: U128,
    pub splits: Vec<Split>,
    pub paused: bool,
    pub usdc: String,
    pub max_token: U128,
    pub hold_ns: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Order {
    pub id: u64,
    pub action_id: u64,
    pub row_owner: AccountId,
    pub chain: String,
    pub path: String,
    pub asset: String,
    pub to: String,
    pub amount: U128,
    pub fee: U128,
    pub status: String,
    pub evm_nonce: u64,
    pub tx_nonce: Option<u64>,
    pub opened_at: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Liab { pub row_owner: AccountId, pub amount: U128, pub refunded: bool }

pub fn row_path(owner: &AccountId, chain: &str) -> String {
    require!(chain.eq_ignore_ascii_case("base"), "REFUSED: that chain is not on this toll");
    format!("row:{owner}:base")
}

fn spend_key(owner: &AccountId, chain: &str, asset: &str) -> String { format!("{owner}#{chain}#{asset}") }
fn action_key(owner: &AccountId, action_id: u64) -> String { format!("{owner}#{action_id}") }

/// v4: gas for the visitor callback (it starts the MPC sign: 50 Tgas + on_signed 30 Tgas).
pub const GATE_CB_GAS: u64 = 110;
pub const GATE_MIN_GAS: u64 = 150;
/// v5: at most this many factories on a gate.
pub const MAX_FACTORIES: usize = 8;

/// v5: the factory a charter claims to come from (its parent account), if that factory is on the gate's list.
pub fn charter_factory(g: &Gate, charter: &AccountId) -> Option<AccountId> {
    let parent = charter.as_str().split_once('.')?.1;
    g.factories.iter().find(|f| f.as_str() == parent).cloned()
}

/// v3: gas limit cap for an ERC-20 transfer (a USDC transfer uses about 40-60k).
pub const ERC20_GAS_CAP: u64 = 100_000;

/// ABI calldata for `transfer(address,uint256)`.
pub fn erc20_transfer_data(to: &str, value: u128) -> Vec<u8> {
    let mut d = vec![0xa9, 0x05, 0x9c, 0xbb];
    d.extend([0u8; 12]); d.extend(unhex(to));
    d.extend([0u8; 16]); d.extend(value.to_be_bytes());
    d
}

fn hx(b: &[u8]) -> String { hex::encode(b) }
fn visit_key(charter: &AccountId, id: u64) -> String { format!("{charter}#{id}") }

/// v4: the charter's own record must show the toll paid: receiver = payee, native NEAR, at least the fee,
/// the gate's memo, and status "confirmed" (the charter's transfer settled).
pub fn check_visit(g: &Gate, a: &Value) {
    require!(a["receiver"].as_str() == Some(g.payee.as_str()), "REFUSED: the action did not pay the toll payee");
    require!(a["asset"] == json!("Native"), "REFUSED: the toll is paid in NEAR");
    let amt: u128 = a["amount"].as_str().and_then(|x| x.parse().ok()).unwrap_or(0);
    require!(amt >= g.fee.0, "REFUSED: the action paid less than the toll");
    require!(a["memo"].as_str() == Some(g.memo.as_str()), "REFUSED: the action is not a toll payment");
    require!(a["status"].as_str() == Some("confirmed"), "REFUSED: the charter has not paid (action not confirmed)");
}
fn unhex(s: &str) -> Vec<u8> { hex::decode(s.trim_start_matches("0x")).expect("bad hex") }

fn evm_addr(raw: &str) -> String {
    let to = raw.trim().to_lowercase();
    let hex = to.strip_prefix("0x").unwrap_or("");
    require!(hex.len() == 40 && hex.chars().all(|c| c.is_ascii_hexdigit()), "REFUSED: recipient must be an EVM address");
    to
}

/// EVM chains the MPC network verifies (`v1.signer` get_available_foreign_chains), with the
/// borsh index of each in ForeignChainRpcRequest and the chain ids that belong to it.
pub fn evm_chain(name: &str) -> Option<(u8, [u64; 2])> {
    match name {
        "Bnb" => Some((5, [56, 97])),
        "Base" => Some((6, [8453, 84532])),
        "Arbitrum" => Some((7, [42161, 421614])),
        "Polygon" => Some((8, [137, 80002])),
        "Avalanche" => Some((13, [43114, 43113])),
        _ => None,
    }
}

/// borsh(ForeignTxSignPayload::V1{ <chain>{tx_id,[BlockHash],Finalized}, [Evm(BlockHash(bh))] }); the MPC signs sha256 of this.
pub fn proof_payload(chain_index: u8, tx_hash: &str, block_hash: &str) -> Vec<u8> {
    let mut b = vec![0u8, chain_index];
    b.extend(unhex(tx_hash));
    b.extend(1u32.to_le_bytes()); b.push(0); b.push(2);
    b.extend(1u32.to_le_bytes()); b.push(1); b.push(0);
    b.extend(unhex(block_hash));
    b
}

#[near]
impl Oath {
    #[init]
    pub fn new(owner: AccountId, mpc: AccountId, path: String, chain_id: u64, foreign_address: String,
               fx_root_key: String, allow_to: Vec<String>, max_per_tx: U128, budget: U128, max_fee_cap: U128,
               verify_chain: Option<String>, token: Option<String>, dao: Option<AccountId>, gate: Option<Gate>) -> Self {
        let verify_chain = verify_chain.unwrap_or_else(|| "Base".into());
        let (_, ids) = evm_chain(&verify_chain).expect("verify_chain not supported");
        require!(ids.contains(&chain_id), "chain_id does not belong to verify_chain");
        let token = token.map(|t| t.to_lowercase());
        if let Some(t) = &token { require!(t.len() == 42 && unhex(t).len() == 20, "token must be a 0x address"); }
        let allow_to: Vec<String> = allow_to.into_iter().map(|a| a.to_lowercase()).collect();
        let gate = gate.map(|mut g| {
            g.evm_to = g.evm_to.to_lowercase();
            require!(token.is_none(), "gate is for native-coin tolls");
            require!(allow_to.contains(&g.evm_to), "gate evm_to must be in allow_to");
            require!(g.evm_value.0 <= max_per_tx.0, "gate evm_value over per-tx cap");
            require!(g.max_fee_per_gas.0 <= max_fee_cap.0 && g.max_priority_fee_per_gas.0 <= g.max_fee_per_gas.0, "gate fees over cap");
            require!(g.fee.0 > 0 && !g.memo.is_empty(), "gate needs a fee and a memo");
            require!(!g.factories.is_empty() && g.factories.len() <= MAX_FACTORIES, "gate needs 1 to 8 factories");
            g
        });
        Self { owner, mpc, path, chain_id, foreign_address: foreign_address.to_lowercase(), fx_root_key,
               allow_to,
               max_per_tx: max_per_tx.0, budget: budget.0, spent: 0, max_fee_cap: max_fee_cap.0,
               next_nonce: 0, frozen: false, txs: LookupMap::new(b"t"), verify_chain, token, dao,
               gate, visits: LookupMap::new(b"v"), visit_of: LookupMap::new(b"w"),
               cross: None, passes: LookupMap::new(b"p"), next_pass: 0, book: LookupMap::new(b"b"),
               orders: LookupMap::new(b"o"), next_order: 0, row_nonce: LookupMap::new(b"r"), row_spent: LookupMap::new(b"s"),
               derived: LookupMap::new(b"d"), liabilities: LookupMap::new(b"l"), actions: LookupMap::new(b"a"),
               tx_order: LookupMap::new(b"x"), service_held: 0, earned: 0, surplus: 0, price: None }
    }

    fn assert_owner(&self) { require!(env::predecessor_account_id() == self.owner, "only owner"); }
    pub fn freeze(&mut self) {
        let c = env::predecessor_account_id();
        require!(c == self.owner || Some(&c) == self.dao.as_ref(), "only owner");
        self.frozen = true;
    }
    pub fn unfreeze(&mut self) {
        match &self.dao { Some(d) => require!(&env::predecessor_account_id() == d, "only dao unfreezes"), None => self.assert_owner() }
        self.frozen = false;
    }
    pub fn set_nonce(&mut self, nonce: u64) { self.assert_owner(); self.next_nonce = nonce; }
    /// v6: teardown. The owner (1 yocto, so a full-access key must sign) deletes this account and every
    /// yocto on it, including the storage stake, goes back to the owner. The account holds no full-access
    /// key, so this is the only way its locked NEAR comes back.
    #[payable]
    pub fn close(&mut self) -> Promise {
        near_sdk::assert_one_yocto();
        self.assert_owner();
        require!(self.service_held == 0, "REFUSED: service deposits are still held");
        for id in 0..self.next_order {
            if let Some(order) = self.orders.get(&id) {
                require!(order.status != "open" && order.status != "signing", "REFUSED: a crossing is still open");
            }
        }
        log!("close: deleting {} to {}", env::current_account_id(), self.owner);
        Promise::new(env::current_account_id()).delete_account(self.owner.clone())
    }

    pub fn policy(&self) -> Value {
        json!({"owner": self.owner, "mpc": self.mpc, "path": self.path, "chain_id": self.chain_id,
               "foreign_address": self.foreign_address, "allow_to": self.allow_to,
               "max_per_tx": self.max_per_tx.to_string(), "budget": self.budget.to_string(),
               "spent": self.spent.to_string(), "max_fee_cap": self.max_fee_cap.to_string(),
               "next_nonce": self.next_nonce, "frozen": self.frozen, "verify_chain": self.verify_chain,
               "asset": self.token.as_ref().map(|t| json!({"erc20": t})).unwrap_or(json!("native")), "dao": self.dao,
               "gate": self.gate, "cross": self.cross, "next_pass": self.next_pass, "recipients": "visitor",
               "price": self.price, "service_held": self.service_held.to_string(), "earned": self.earned.to_string(), "surplus": self.surplus.to_string()})
    }

    /// v7: the owner sets the board, the pass fee and the Base value. The recipient is not stored here.
    pub fn set_cross(&mut self, board: AccountId, pass_fee: U128, foreign_value: U128, max_fee_per_gas: U128, max_priority_fee_per_gas: U128) {
        self.assert_owner();
        require!(pass_fee.0 > 0, "pass fee must be set");
        require!(foreign_value.0 > 0 && foreign_value.0 <= self.max_per_tx, "foreign value over per-tx cap");
        require!(max_fee_per_gas.0 <= self.max_fee_cap && max_priority_fee_per_gas.0 <= max_fee_per_gas.0, "cross fees over cap");
        self.cross = Some(Cross { board, pass_fee, foreign_value, max_fee_per_gas, max_priority_fee_per_gas });
    }

    /// v7: one visitor's own recipient list. An empty list means any address. This is not a global allow list.
    pub fn set_book(&mut self, recipients: Vec<String>) {
        let caller = env::predecessor_account_id();
        require!(caller != env::current_account_id(), "REFUSED: the toll account cannot set a book");
        require!(recipients.len() <= 8, "at most 8 recipients");
        let mut out = vec![];
        for raw in recipients {
            let to = evm_addr(&raw);
            if !out.contains(&to) { out.push(to); }
        }
        self.book.insert(caller, out);
    }

    pub fn get_book(&self, owner: AccountId) -> Vec<String> { self.book.get(&owner).cloned().unwrap_or_default() }

    /// The owner publishes the service price. No recipient is stored.
    pub fn set_price(&mut self, board: AccountId, fee: U128, cost: U128, splits: Vec<Split>, paused: bool, usdc: String, max_token: U128, hold_ns: u64) {
        self.assert_owner();
        require!(fee.0 > 0 && cost.0 <= fee.0, "cost must sit inside the fee");
        let mut bps = 0u32;
        for s in &splits { require!(s.bps > 0, "split share must be set"); bps += s.bps as u32; }
        require!(bps <= 10_000, "split is over 100%");
        let usdc = evm_addr(&usdc);
        self.price = Some(Price { board, fee, cost, splits, paused, usdc, max_token, hold_ns });
    }

    pub fn address_of(&self, row_owner: AccountId, chain: String) -> Value {
        let path = row_path(&row_owner, &chain);
        json!({"path": path, "address": self.derived.get(&path).cloned()})
    }

    pub fn get_order(&self, id: u64) -> Option<Order> { self.orders.get(&id).cloned() }

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
        let chain_l = chain.to_lowercase();
        require!(chain_l == "base", "REFUSED: that chain is not on this toll");
        let asset_l = asset.to_lowercase();
        require!(asset_l == "native" || asset_l == "usdc", "REFUSED: asset must be native or usdc");
        let to = evm_addr(&to);
        if let Some(book) = self.book.get(&row_owner) {
            if !book.is_empty() { require!(book.iter().any(|a| a == &to), "REFUSED: that address is not in your book"); }
        }
        require!(amount.0 > 0, "REFUSED: amount must be set");
        let cap = if asset_l == "native" { self.max_per_tx } else { price.max_token.0 };
        require!(amount.0 <= cap, "REFUSED: value over per-tx cap");
        require!(amount.0 <= row_budget.0, "REFUSED: value over the row budget");
        let key = action_key(&row_owner, action_id);
        require!(!self.actions.contains_key(&key), "REFUSED: this crossing was already opened");
        let spent_key = spend_key(&row_owner, "base", &asset_l);
        let spent = self.row_spent.get(&spent_key).copied().unwrap_or(0);
        require!(spent + amount.0 <= row_budget.0, "REFUSED: the row budget is spent");
        let id = self.next_order;
        self.next_order = id + 1;
        let path = row_path(&row_owner, "base");
        self.actions.insert(key, id);
        self.row_spent.insert(spent_key, spent + amount.0);
        self.service_held += dep;
        log!("EVENT_JSON:{}", json!({"standard":"town-chronicle","event":"cross_opened","data":{"id":id,"owner":row_owner,"to":to}}));
        self.orders.insert(id, Order { id, action_id, row_owner, chain: "base".into(), path, asset: asset_l, to, amount, fee: U128(dep), status: "open".into(), evm_nonce: 0, tx_nonce: None, opened_at: env::block_timestamp() });
        id
    }

    /// The visitor signs the order the board already stored. The arguments cannot change the recipient or the amount.
    pub fn sign_cross(&mut self, id: u64) -> Promise {
        require!(env::prepaid_gas() >= Gas::from_tgas(GATE_MIN_GAS), "attach at least 150 Tgas");
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
        let tx = self.sign(order.to.clone(), order.amount, fee, prio, gas, false, order.path.clone(), Some(evm_nonce), Some(order.asset.clone()), Some(caller.to_string()), token, Some(id));
        order.tx_nonce = Some(self.next_nonce - 1);
        self.orders.insert(id, order);
        tx
    }

    pub fn cancel_order(&mut self, id: u64) {
        let price = self.price.clone().unwrap_or_else(|| env::panic_str("REFUSED: this toll has no price"));
        require!(env::predecessor_account_id() == price.board, "REFUSED: only the board can cancel a crossing");
        let order = self.orders.get(&id).cloned().unwrap_or_else(|| env::panic_str("REFUSED: no such crossing"));
        require!(order.status == "open", "REFUSED: this crossing was already signed");
        require!(env::block_timestamp() >= order.opened_at.saturating_add(price.hold_ns), "REFUSED: the hold has not ended");
        self.fail_order(id);
    }

    /// One refund of a failed service deposit. The promise is `refund_action` on the board:
    /// predecessor must be this shop, and the attached deposit must equal the hold.
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
        Promise::new(price.board).function_call(
            "refund_action".to_string(),
            json!({"owner": liab.row_owner, "action_id": action_id.to_string()}).to_string().into_bytes(),
            NearToken::from_yoctonear(liab.amount.0),
            Gas::from_tgas(20),
        )
    }

    pub fn withdraw_surplus(&mut self, amount: U128) -> Promise {
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
        let mut it = parts.into_iter();
        let (account, yocto) = it.next().expect("a surplus has a payee");
        let mut p = Promise::new(account).transfer(NearToken::from_yoctonear(yocto));
        for (account, yocto) in it { p = p.and(Promise::new(account).transfer(NearToken::from_yoctonear(yocto))); }
        p
    }

    fn fail_order(&mut self, id: u64) {
        let mut order = match self.orders.get(&id).cloned() { Some(o) => o, None => return };
        if order.status == "failed" || order.status == "refunded" { return; }
        let key = spend_key(&order.row_owner, &order.chain, &order.asset);
        let spent = self.row_spent.get(&key).copied().unwrap_or(0);
        self.row_spent.insert(key, spent.saturating_sub(order.amount.0));
        if self.liabilities.get(&id).is_none() {
            self.liabilities.insert(id, Liab { row_owner: order.row_owner.clone(), amount: order.fee, refunded: false });
        }
        order.status = "failed".into();
        self.orders.insert(id, order);
    }

    /// The owner deploys the next wasm. migrate reads this state back, so a later change does not recreate the account.
    pub fn upgrade(&self, code: near_sdk::json_types::Base64VecU8) -> Promise {
        self.assert_owner();
        require!(!code.0.is_empty(), "empty code");
        Promise::new(env::current_account_id()).deploy_contract(code.0)
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(15)).migrate())
    }

    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self { env::state_read().expect("no state") }

    pub fn get_pass(&self, id: u64) -> Option<PassRec> { self.passes.get(&id).cloned() }

    /// v7: the board attaches the pass fee. This does not call the MPC, so it fits a 30 Tgas forward.
    #[payable]
    pub fn accept_pass(&mut self, owner: AccountId) {
        let c = self.cross.clone().unwrap_or_else(|| env::panic_str("REFUSED: this toll has no visitor pass"));
        require!(env::predecessor_account_id() == c.board, "REFUSED: only the board can pay this pass");
        require!(!self.frozen, "REFUSED: oath frozen");
        let dep = env::attached_deposit().as_yoctonear();
        require!(dep >= c.pass_fee.0, "REFUSED: the pass paid less than the toll");
        let id = self.next_pass;
        self.next_pass = id + 1;
        self.passes.insert(id, PassRec { owner: owner.clone(), deposit: U128(dep), used: false });
        log!("EVENT_JSON:{}", json!({"standard":"town-chronicle","event":"pass_accepted","data":{"id":id,"owner":owner,"deposit":dep.to_string()}}));
    }

    /// v7 Path A: the visitor who holds an unused board pass names the recipient.
    /// The toll account itself cannot call this, so a key on this contract is not the signer.
    pub fn cross_after_board(&mut self, to: String) -> Promise {
        require!(env::prepaid_gas() >= Gas::from_tgas(GATE_MIN_GAS), "attach at least 150 Tgas");
        let caller = env::predecessor_account_id();
        require!(caller != env::current_account_id(), "REFUSED: the toll account cannot sign this crossing");
        require!(!self.frozen, "REFUSED: oath frozen");
        let c = self.cross.clone().unwrap_or_else(|| env::panic_str("REFUSED: this toll has no visitor pass"));
        let to = evm_addr(&to);
        if let Some(book) = self.book.get(&caller) {
            if !book.is_empty() { require!(book.iter().any(|a| a == &to), "REFUSED: that address is not in your book"); }
        }
        let id = (0..self.next_pass).find(|n| self.passes.get(n).is_some_and(|p| !p.used && p.owner == caller))
            .unwrap_or_else(|| env::panic_str("REFUSED: no board pass is waiting for you"));
        let mut rec = self.passes.get(&id).cloned().expect("no pass");
        rec.used = true;
        self.passes.insert(id, rec);
        log!("EVENT_JSON:{}", json!({"standard":"town-chronicle","event":"cross_signing","data":{"id":id,"owner":caller,"to":to}}));
        let path = row_path(&caller, "base");
        self.sign(to, c.foreign_value, c.max_fee_per_gas, c.max_priority_fee_per_gas, 21000, false, path, None, None, Some(caller.to_string()), None, None)
    }
    /// v4: the charter action that paid for EVM nonce `nonce`, if it came through the gate.
    pub fn get_visit(&self, nonce: u64) -> Option<Visit> { self.visit_of.get(&nonce).cloned() }
    /// v4: the EVM nonce a charter action opened, if any.
    pub fn visit_nonce(&self, charter: AccountId, action_id: U64) -> Option<u64> { self.visits.get(&visit_key(&charter, action_id.0)).copied() }
    pub fn get_tx(&self, nonce: u64) -> Option<TxRec> { self.txs.get(&nonce).cloned() }

    /// Agent entry point. Callable by the owner or by a function-call key on this account (the agent).
    pub fn pay(&mut self, to: String, value: U128, max_fee_per_gas: U128, max_priority_fee_per_gas: U128, gas_limit: u64) -> Promise {
        let caller = env::predecessor_account_id();
        require!(caller == self.owner || caller == env::current_account_id(), "caller not owner/agent");
        self.start_sign(to, value, max_fee_per_gas, max_priority_fee_per_gas, gas_limit)
    }

    /// v4: open to anyone. Reads the factory and the charter on chain, then signs the gate's fixed payout.
    pub fn pay_for(&mut self, charter: AccountId, action_id: U64) -> Promise {
        let g = self.gate.clone().unwrap_or_else(|| env::panic_str("REFUSED: this toll has no visitor gate"));
        require!(!self.frozen, "REFUSED: oath frozen");
        require!(!self.visits.contains_key(&visit_key(&charter, action_id.0)), "REFUSED: this charter action already opened the gate");
        require!(env::prepaid_gas() >= Gas::from_tgas(GATE_MIN_GAS), "attach at least 150 Tgas");
        let f = charter_factory(&g, &charter).unwrap_or_else(|| env::panic_str("REFUSED: not a charter from the gate's factories"));
        let a = Promise::new(f).function_call("is_charter".to_string(), json!({"account_id": charter}).to_string().into_bytes(), NearToken::from_yoctonear(0), Gas::from_tgas(5));
        let b = Promise::new(charter.clone()).function_call("get_action".to_string(), json!({"action_id": action_id}).to_string().into_bytes(), NearToken::from_yoctonear(0), Gas::from_tgas(10));
        a.and(b).then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(GATE_CB_GAS))
            .on_visit_checked(charter, action_id, env::predecessor_account_id()))
    }

    /// v4: both reads are back. Every check panics with REFUSED, so a refused visit changes nothing.
    #[private]
    pub fn on_visit_checked(&mut self, charter: AccountId, action_id: U64, by: AccountId,
                            #[callback_result] is_charter: Result<bool, PromiseError>,
                            #[callback_result] action: Result<Option<Value>, PromiseError>) -> Promise {
        let g = self.gate.clone().expect("no gate");
        require!(matches!(is_charter, Ok(true)), "REFUSED: not a charter from the gate's factories");
        let a = action.ok().flatten().unwrap_or_else(|| env::panic_str("REFUSED: the charter has no such action"));
        check_visit(&g, &a);
        let key = visit_key(&charter, action_id.0);
        require!(!self.visits.contains_key(&key), "REFUSED: this charter action already opened the gate");
        let nonce = self.next_nonce;
        self.visits.insert(key, nonce);
        self.visit_of.insert(nonce, Visit { charter: charter.clone(), action_id: action_id.0, by });
        log!("EVENT_JSON:{}", json!({"standard":"town-chronicle","event":"visit_paid","data":{"nonce":nonce,"charter":charter,"action_id":action_id}}));
        self.start_sign(g.evm_to.clone(), g.evm_value, g.max_fee_per_gas, g.max_priority_fee_per_gas, 21000)
    }

    fn start_sign(&mut self, to: String, value: U128, max_fee_per_gas: U128, max_priority_fee_per_gas: U128, gas_limit: u64) -> Promise {
        self.sign(to, value, max_fee_per_gas, max_priority_fee_per_gas, gas_limit, true, self.path.clone(), None, None, None, None, None)
    }

    fn sign(&mut self, to: String, value: U128, max_fee_per_gas: U128, max_priority_fee_per_gas: U128, gas_limit: u64, listed: bool, path: String, evm_nonce: Option<u64>, asset: Option<String>, row_owner: Option<String>, token: Option<String>, order_id: Option<u64>) -> Promise {
        require!(!self.frozen, "REFUSED: oath frozen");
        let to = to.to_lowercase();
        if listed { require!(self.allow_to.contains(&to), "REFUSED: recipient not in oath allowlist"); }
        if order_id.is_none() {
            require!(value.0 <= self.max_per_tx, "REFUSED: value over per-tx cap");
            require!(self.spent + value.0 <= self.budget, "REFUSED: budget exhausted");
        }
        require!(max_fee_per_gas.0 <= self.max_fee_cap && max_priority_fee_per_gas.0 <= max_fee_per_gas.0, "REFUSED: gas fee over cap");
        match token.as_deref().or(self.token.as_deref()) {
            None => require!(gas_limit <= 21000, "REFUSED: only plain transfers (gas 21000)"),
            Some(_) => require!(gas_limit <= ERC20_GAS_CAP, "REFUSED: gas limit over ERC-20 cap"),
        }
        let nonce = self.next_nonce;
        let evm_n = evm_nonce.unwrap_or(nonce);
        let fields = self.fields_for(self.chain_id, token.as_deref().or(self.token.as_deref()), evm_n, max_priority_fee_per_gas.0, max_fee_per_gas.0, gas_limit, &to, value.0);
        let mut pre = vec![0x02u8];
        pre.extend(rlp::enc_list(&fields));
        let h = env::keccak256(&pre);
        if order_id.is_none() { self.spent += value.0; }
        self.next_nonce += 1;
        self.txs.insert(nonce, TxRec { to: to.clone(), value, nonce, status: "signing".into(), unsigned_hash: hx(&h),
                                     raw_signed: None, tx_hash: None, proof_payload_hash: None, path: Some(path.clone()),
                                     evm_nonce: Some(evm_n), asset, row_owner, token_used: token.clone() });
        if let Some(id) = order_id { self.tx_order.insert(nonce, id); }
        log!("EVENT_JSON:{}", json!({"standard":"town-chronicle","event":"sign_requested","data":{"nonce":nonce,"to":to,"value":value,"payload":hx(&h),"path":path}}));
        let args = json!({"request": {"path": path, "payload_v2": {"Ecdsa": hx(&h)}, "domain_id": 0}});
        Promise::new(self.mpc.clone())
            .function_call("sign".to_string(), args.to_string().into_bytes(), NearToken::from_yoctonear(1), Gas::from_tgas(50))
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(30)).on_signed(nonce, max_fee_per_gas, max_priority_fee_per_gas, gas_limit))
    }

    /// `to`/`value` are the payout's recipient and amount; with a token the EVM tx goes to the token with value 0.
    fn fields(&self, nonce: u64, prio: u128, maxfee: u128, gas: u64, to: &str, value: u128) -> Vec<Vec<u8>> {
        self.fields_for(self.chain_id, self.token.as_deref(), nonce, prio, maxfee, gas, to, value)
    }
    fn fields_for(&self, chain_id: u64, token: Option<&str>, nonce: u64, prio: u128, maxfee: u128, gas: u64, to: &str, value: u128) -> Vec<Vec<u8>> {
        let (evm_to, evm_value, data) = match token {
            None => (unhex(to), value, vec![]),
            Some(t) => (unhex(t), 0, erc20_transfer_data(to, value)),
        };
        vec![rlp::enc_uint(chain_id as u128), rlp::enc_uint(nonce as u128), rlp::enc_uint(prio), rlp::enc_uint(maxfee),
             rlp::enc_uint(gas as u128), rlp::enc_bytes(&evm_to), rlp::enc_uint(evm_value), rlp::enc_bytes(&data), rlp::enc_list(&[])]
    }

    #[private]
    pub fn on_signed(&mut self, nonce: u64, max_fee_per_gas: U128, max_priority_fee_per_gas: U128, gas_limit: u64,
                     #[callback_result] sig: Result<Value, PromiseError>) -> Option<TxRec> {
        let mut rec = self.txs.get(&nonce).cloned().expect("no rec");
        let sig = match sig { Ok(v) => v, Err(_) => {
            rec.status = "failed".into();
            if self.tx_order.get(&nonce).is_none() { self.spent -= rec.value.0; }
            self.txs.insert(nonce, rec.clone());
            if let Some(id) = self.tx_order.get(&nonce).copied() { self.fail_order(id); }
            log!("EVENT_JSON:{}", json!({"standard":"town-chronicle","event":"sign_failed","data":{"nonce":nonce}}));
            return Some(rec); } };
        let big_r = unhex(sig["big_r"]["affine_point"].as_str().unwrap());
        let s = unhex(sig["s"]["scalar"].as_str().unwrap());
        let v = sig["recovery_id"].as_u64().unwrap() as u8;
        let r = &big_r[1..33];
        // check: the MPC signature recovers to the oath's own foreign address
        let mut rs = [0u8; 64]; rs[..32].copy_from_slice(r); rs[32..].copy_from_slice(&s);
        let h: [u8; 32] = unhex(&rec.unsigned_hash).try_into().unwrap();
        let pk = env::ecrecover(&h, &rs, v, true).expect("ecrecover failed");
        let addr = format!("0x{}", hx(&env::keccak256(&pk)[12..]));
        if let Some(path) = rec.path.clone() {
            if path != self.path {
                match self.derived.get(&path).cloned() {
                    Some(prev) => require!(addr == prev, "signature does not recover to the row address"),
                    None => { self.derived.insert(path, addr); }
                }
            } else {
                require!(addr == self.foreign_address, "signature does not recover to oath address");
            }
        } else {
            require!(addr == self.foreign_address, "signature does not recover to oath address");
        }
        let n = rec.evm_nonce.unwrap_or(nonce);
        let token = rec.token_used.clone();
        let mut f = self.fields_for(self.chain_id, token.as_deref().or(if rec.path.as_deref() == Some(self.path.as_str()) { self.token.as_deref() } else { None }), n, max_priority_fee_per_gas.0, max_fee_per_gas.0, gas_limit, &rec.to, rec.value.0);
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
        log!("EVENT_JSON:{}", json!({"standard":"town-chronicle","event":"signed","data":{"nonce":nonce,"tx_hash":rec.tx_hash}}));
        Some(rec)
    }

    /// Permissionless: anyone can ask the MPC network to attest that the oath's own tx is final on Base.
    pub fn settle(&mut self, nonce: u64, block_hash: String) -> Promise {
        let rec = self.txs.get(&nonce).cloned().expect("no rec");
        require!(rec.status == "signed" || rec.status == "refused_proof", "not settleable");
        let txh = rec.tx_hash.clone().unwrap();
        let mut req = serde_json::Map::new();
        req.insert(self.verify_chain.clone(), json!({"tx_id": txh.trim_start_matches("0x"), "extractors": ["BlockHash"], "finality": "Finalized"}));
        let args = json!({"request": {"request": Value::Object(req),
                                       "domain_id": 3, "payload_version": 1}});
        Promise::new(self.mpc.clone())
            .function_call("verify_foreign_transaction".to_string(), args.to_string().into_bytes(), NearToken::from_yoctonear(1), Gas::from_tgas(50))
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(30)).on_verified(nonce, block_hash))
    }

    #[private]
    pub fn on_verified(&mut self, nonce: u64, block_hash: String, #[callback_result] resp: Result<Value, PromiseError>) -> Option<TxRec> {
        let mut rec = self.txs.get(&nonce).cloned().expect("no rec");
        let resp = match resp { Ok(v) => v, Err(_) => { log!("EVENT_JSON:{}", json!({"standard":"town-chronicle","event":"proof_failed","data":{"nonce":nonce}})); return Some(rec); } };
        let (idx, _) = evm_chain(&self.verify_chain).unwrap();
        let expect = env::sha256(&proof_payload(idx, rec.tx_hash.as_ref().unwrap(), &block_hash));
        let got = resp["payload_hash"].as_str().unwrap_or("").to_string();
        // independent check of the MPC signature against the ForeignTx root key
        let big_r = unhex(resp["signature"]["big_r"]["affine_point"].as_str().unwrap());
        let s = unhex(resp["signature"]["s"]["scalar"].as_str().unwrap());
        let v = resp["signature"]["recovery_id"].as_u64().unwrap() as u8;
        let mut rs = [0u8; 64]; rs[..32].copy_from_slice(&big_r[1..33]); rs[32..].copy_from_slice(&s);
        let gh: [u8; 32] = unhex(&got).try_into().unwrap();
        let pk = env::ecrecover(&gh, &rs, v, false).map(|k| hx(&k)).unwrap_or_default();
        rec.proof_payload_hash = Some(got.clone());
        if hx(&expect) == got && pk == self.fx_root_key {
            rec.status = "confirmed".into();
            log!("EVENT_JSON:{}", json!({"standard":"town-chronicle","event":"confirmed","data":{"nonce":nonce,"tx_hash":rec.tx_hash,"block_hash":block_hash}}));
        } else {
            rec.status = "refused_proof".into();
            log!("EVENT_JSON:{}", json!({"standard":"town-chronicle","event":"proof_refused","data":{"nonce":nonce,"expected":hx(&expect),"got":got,"root_ok":pk == self.fx_root_key}}));
        }
        self.txs.insert(nonce, rec.clone());
        Some(rec)
    }
}

#[cfg(test)]
mod tests;
