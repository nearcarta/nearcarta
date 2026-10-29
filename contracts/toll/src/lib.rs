//! oath-lab: a policy ("oath") contract that owns an EVM wallet (Base Sepolia, Arbitrum Sepolia, ...) via NEAR Chain Signatures.
//! One chain per instance: `chain_id` for the tx it signs, `verify_chain` for the MPC foreign-tx proof that settles it.
//! The agent can only *propose*; this contract checks the clauses, builds the EIP-1559 tx itself,
//! asks the MPC network to sign it (predecessor = this contract, so the key belongs to the oath),
//! and later settles it only on an MPC foreign-tx proof (verify_foreign_transaction).
//! v3: an optional ERC-20 `token` (e.g. Circle USDC on Base Sepolia). With a token set, `pay` builds
//! `token.transfer(to, value)` itself (EVM value 0), and the caps and budget count token units.
//! v3: an optional `dao`. With a DAO set, only the DAO can unfreeze (the owner can still freeze).
//! v4: an optional visitor `gate`. `pay_for(charter, action_id)` is open to anyone, but it signs only after
//! it has read, on chain, that `charter` was made by the gate's charter factory and that this charter's
//! own action `action_id` paid the toll fee in NEAR to the gate's payee with the gate's memo and settled.
//! v5: the gate holds a fixed list of charter factories (set once at init, no setter): a charter qualifies when
//! its parent account is on the list and that factory's is_charter says yes.
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
}

/// v4: what a visitor's charter must have paid on NEAR, and the fixed EVM payout it buys.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Gate {
    pub factories: Vec<AccountId>, // v5: charters must come from one of these factories (parent account + is_charter)
    pub payee: AccountId,     // the charter action's receiver
    pub fee: U128,            // minimum NEAR (yocto) the action paid
    pub memo: String,         // the action's memo, e.g. "toll:base-sepolia"
    pub evm_to: String,       // fixed EVM recipient (must be in allow_to)
    pub evm_value: U128,      // fixed EVM value (wei)
    pub max_fee_per_gas: U128,
    pub max_priority_fee_per_gas: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Visit { pub charter: AccountId, pub action_id: u64, pub by: AccountId }

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

/// EVM chains the MPC network verifies (v1.signer-prod.testnet get_available_foreign_chains), with the
/// borsh index of each in ForeignChainRpcRequest and the chain ids (mainnet, testnet) that belong to it.
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
               gate, visits: LookupMap::new(b"v"), visit_of: LookupMap::new(b"w") }
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

    pub fn policy(&self) -> Value {
        json!({"owner": self.owner, "mpc": self.mpc, "path": self.path, "chain_id": self.chain_id,
               "foreign_address": self.foreign_address, "allow_to": self.allow_to,
               "max_per_tx": self.max_per_tx.to_string(), "budget": self.budget.to_string(),
               "spent": self.spent.to_string(), "max_fee_cap": self.max_fee_cap.to_string(),
               "next_nonce": self.next_nonce, "frozen": self.frozen, "verify_chain": self.verify_chain,
               "asset": self.token.as_ref().map(|t| json!({"erc20": t})).unwrap_or(json!("native")), "dao": self.dao,
               "gate": self.gate})
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
        require!(!self.frozen, "REFUSED: oath frozen");
        let to = to.to_lowercase();
        require!(self.allow_to.contains(&to), "REFUSED: recipient not in oath allowlist");
        require!(value.0 <= self.max_per_tx, "REFUSED: value over per-tx cap");
        require!(self.spent + value.0 <= self.budget, "REFUSED: budget exhausted");
        require!(max_fee_per_gas.0 <= self.max_fee_cap && max_priority_fee_per_gas.0 <= max_fee_per_gas.0, "REFUSED: gas fee over cap");
        match self.token {
            None => require!(gas_limit <= 21000, "REFUSED: only plain transfers (gas 21000)"),
            Some(_) => require!(gas_limit <= ERC20_GAS_CAP, "REFUSED: gas limit over ERC-20 cap"),
        }
        let nonce = self.next_nonce;
        let fields = self.fields(nonce, max_priority_fee_per_gas.0, max_fee_per_gas.0, gas_limit, &to, value.0);
        let mut pre = vec![0x02u8];
        pre.extend(rlp::enc_list(&fields));
        let h = env::keccak256(&pre);
        self.spent += value.0; // reserve
        self.next_nonce += 1;
        self.txs.insert(nonce, TxRec { to: to.clone(), value, nonce, status: "signing".into(), unsigned_hash: hx(&h),
                                     raw_signed: None, tx_hash: None, proof_payload_hash: None });
        log!("EVENT_JSON:{}", json!({"standard":"town-chronicle","event":"sign_requested","data":{"nonce":nonce,"to":to,"value":value,"payload":hx(&h)}}));
        let args = json!({"request": {"path": self.path, "payload_v2": {"Ecdsa": hx(&h)}, "domain_id": 0}});
        Promise::new(self.mpc.clone())
            .function_call("sign".to_string(), args.to_string().into_bytes(), NearToken::from_yoctonear(1), Gas::from_tgas(50))
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(30)).on_signed(nonce, max_fee_per_gas, max_priority_fee_per_gas, gas_limit))
    }

    /// `to`/`value` are the payout's recipient and amount; with a token the EVM tx goes to the token with value 0.
    fn fields(&self, nonce: u64, prio: u128, maxfee: u128, gas: u64, to: &str, value: u128) -> Vec<Vec<u8>> {
        let (evm_to, evm_value, data) = match &self.token {
            None => (unhex(to), value, vec![]),
            Some(t) => (unhex(t), 0, erc20_transfer_data(to, value)),
        };
        vec![rlp::enc_uint(self.chain_id as u128), rlp::enc_uint(nonce as u128), rlp::enc_uint(prio), rlp::enc_uint(maxfee),
             rlp::enc_uint(gas as u128), rlp::enc_bytes(&evm_to), rlp::enc_uint(evm_value), rlp::enc_bytes(&data), rlp::enc_list(&[])]
    }

    #[private]
    pub fn on_signed(&mut self, nonce: u64, max_fee_per_gas: U128, max_priority_fee_per_gas: U128, gas_limit: u64,
                     #[callback_result] sig: Result<Value, PromiseError>) -> Option<TxRec> {
        let mut rec = self.txs.get(&nonce).cloned().expect("no rec");
        let sig = match sig { Ok(v) => v, Err(_) => {
            rec.status = "failed".into(); self.spent -= rec.value.0; self.txs.insert(nonce, rec.clone());
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
        require!(addr == self.foreign_address, "signature does not recover to oath address");
        let mut f = self.fields(nonce, max_priority_fee_per_gas.0, max_fee_per_gas.0, gas_limit, &rec.to, rec.value.0);
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
