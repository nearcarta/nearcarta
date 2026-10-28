//! oath-lab: a policy ("oath") contract that owns an EVM wallet (Base Sepolia, Arbitrum Sepolia, ...) via NEAR Chain Signatures.
//! One chain per instance: `chain_id` for the tx it signs, `verify_chain` for the MPC foreign-tx proof that settles it.
//! The agent can only *propose*; this contract checks the clauses, builds the EIP-1559 tx itself,
//! asks the MPC network to sign it (predecessor = this contract, so the key belongs to the oath),
//! and later settles it only on an MPC foreign-tx proof (verify_foreign_transaction).
mod rlp;
use near_sdk::json_types::U128;
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
}

fn hx(b: &[u8]) -> String { hex::encode(b) }
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
               verify_chain: Option<String>) -> Self {
        let verify_chain = verify_chain.unwrap_or_else(|| "Base".into());
        let (_, ids) = evm_chain(&verify_chain).expect("verify_chain not supported");
        require!(ids.contains(&chain_id), "chain_id does not belong to verify_chain");
        Self { owner, mpc, path, chain_id, foreign_address: foreign_address.to_lowercase(), fx_root_key,
               allow_to: allow_to.into_iter().map(|a| a.to_lowercase()).collect(),
               max_per_tx: max_per_tx.0, budget: budget.0, spent: 0, max_fee_cap: max_fee_cap.0,
               next_nonce: 0, frozen: false, txs: LookupMap::new(b"t"), verify_chain }
    }

    fn assert_owner(&self) { require!(env::predecessor_account_id() == self.owner, "only owner"); }
    pub fn freeze(&mut self) { self.assert_owner(); self.frozen = true; }
    pub fn unfreeze(&mut self) { self.assert_owner(); self.frozen = false; }
    pub fn set_nonce(&mut self, nonce: u64) { self.assert_owner(); self.next_nonce = nonce; }

    pub fn policy(&self) -> Value {
        json!({"owner": self.owner, "mpc": self.mpc, "path": self.path, "chain_id": self.chain_id,
               "foreign_address": self.foreign_address, "allow_to": self.allow_to,
               "max_per_tx": self.max_per_tx.to_string(), "budget": self.budget.to_string(),
               "spent": self.spent.to_string(), "max_fee_cap": self.max_fee_cap.to_string(),
               "next_nonce": self.next_nonce, "frozen": self.frozen, "verify_chain": self.verify_chain})
    }
    pub fn get_tx(&self, nonce: u64) -> Option<TxRec> { self.txs.get(&nonce).cloned() }

    /// Agent entry point. Callable by the owner or by a function-call key on this account (the agent).
    pub fn pay(&mut self, to: String, value: U128, max_fee_per_gas: U128, max_priority_fee_per_gas: U128, gas_limit: u64) -> Promise {
        let caller = env::predecessor_account_id();
        require!(caller == self.owner || caller == env::current_account_id(), "caller not owner/agent");
        require!(!self.frozen, "REFUSED: oath frozen");
        let to = to.to_lowercase();
        require!(self.allow_to.contains(&to), "REFUSED: recipient not in oath allowlist");
        require!(value.0 <= self.max_per_tx, "REFUSED: value over per-tx cap");
        require!(self.spent + value.0 <= self.budget, "REFUSED: budget exhausted");
        require!(max_fee_per_gas.0 <= self.max_fee_cap && max_priority_fee_per_gas.0 <= max_fee_per_gas.0, "REFUSED: gas fee over cap");
        require!(gas_limit <= 21000, "REFUSED: only plain transfers (gas 21000)");
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

    fn fields(&self, nonce: u64, prio: u128, maxfee: u128, gas: u64, to: &str, value: u128) -> Vec<Vec<u8>> {
        vec![rlp::enc_uint(self.chain_id as u128), rlp::enc_uint(nonce as u128), rlp::enc_uint(prio), rlp::enc_uint(maxfee),
             rlp::enc_uint(gas as u128), rlp::enc_bytes(&unhex(to)), rlp::enc_uint(value), rlp::enc_bytes(&[]), rlp::enc_list(&[])]
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
