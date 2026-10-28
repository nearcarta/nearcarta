//! Charter factory: anyone creates their own oath charter as `<name>.<factory>`.
//!
//! The charter code is the reproducible oath build, published once on chain as a
//! NEAR global contract (NEP-591) and referenced here by its immutable code hash.
//! A new charter account gets CreateAccount + Transfer + UseGlobalContract(hash) +
//! `new(owner = caller)` in one atomic receipt. No access key is added, so the
//! charter starts with zero keys; the caller governs it through the oath methods.
//!
//! The factory has no owner and no admin method. After `new`, its own full-access
//! key is deleted, so the pinned code hash and the rules below cannot change.

use near_sdk::json_types::{Base58CryptoHash, U128, U64};
use near_sdk::serde_json::json;
use near_sdk::store::{LookupMap, LookupSet, Vector};
use near_sdk::{env, near, require, AccountId, CryptoHash, Gas, NearToken, PanicOnDefault, Promise};

/// Kept by the factory from each deposit to pay for the registry entry.
pub const REGISTRY_FEE: NearToken = NearToken::from_millinear(10);
pub const DEFAULT_MIN_DEPOSIT: NearToken = NearToken::from_millinear(300);
/// Upper bound so a failed create can always be refunded from the factory float.
pub const MAX_DEPOSIT: NearToken = NearToken::from_near(5);
pub const MAX_PER_OWNER: usize = 5;
pub const GAS_INIT: Gas = Gas::from_tgas(30);
pub const GAS_CALLBACK: Gas = Gas::from_tgas(20);
/// create_charter itself + the batch receipt + the callback.
pub const MIN_GAS_CREATE: Gas = Gas::from_tgas(80);

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Charter {
    pub owner: AccountId,
    pub created_at: U64,
    pub index: u32,
}

#[near(serializers = [json])]
pub struct Config {
    pub code_hash: Base58CryptoHash,
    pub min_deposit: U128,
    pub max_deposit: U128,
    pub registry_fee: U128,
    pub max_per_owner: u32,
    pub count: u32,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Factory {
    code_hash: CryptoHash,
    min_deposit: u128,
    list: Vector<AccountId>,
    charters: LookupMap<AccountId, Charter>,
    by_owner: LookupMap<AccountId, Vec<AccountId>>,
    pending: LookupSet<AccountId>,
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard": "nearcarta-charters", "version": "1.0.0", "event": event, "data": [data]})
    ));
}

/// 2..=24 chars of [a-z0-9-_], starting and ending with [a-z0-9]. No dots, so the
/// charter is always a direct sub-account of the factory.
pub fn valid_name(name: &str) -> bool {
    let b = name.as_bytes();
    let edge = |c: u8| c.is_ascii_lowercase() || c.is_ascii_digit();
    (2..=24).contains(&b.len())
        && edge(b[0])
        && edge(b[b.len() - 1])
        && b.iter().all(|&c| edge(c) || c == b'-' || c == b'_')
        && !name.contains("--")
        && !name.contains("__")
}

#[near]
impl Factory {
    #[init]
    #[private]
    pub fn new(code_hash: Base58CryptoHash, min_deposit: Option<U128>) -> Self {
        let min = min_deposit.map(|m| m.0).unwrap_or(DEFAULT_MIN_DEPOSIT.as_yoctonear());
        require!(min > REGISTRY_FEE.as_yoctonear() && min <= MAX_DEPOSIT.as_yoctonear(), "ERR_MIN_DEPOSIT");
        Self {
            code_hash: code_hash.into(),
            min_deposit: min,
            list: Vector::new(b"l"),
            charters: LookupMap::new(b"c"),
            by_owner: LookupMap::new(b"o"),
            pending: LookupSet::new(b"p"),
        }
    }

    /// Creates `<name>.<factory>` running the pinned oath code, owned by the caller.
    /// The attached deposit minus REGISTRY_FEE becomes the charter's balance.
    #[payable]
    pub fn create_charter(&mut self, name: String) -> Promise {
        require!(valid_name(&name), "ERR_NAME");
        require!(env::prepaid_gas() >= MIN_GAS_CREATE, "ERR_LOW_GAS");
        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit >= self.min_deposit, "ERR_DEPOSIT_LOW");
        require!(deposit <= MAX_DEPOSIT.as_yoctonear(), "ERR_DEPOSIT_HIGH");
        let account: AccountId = format!("{name}.{}", env::current_account_id()).parse().expect("ERR_ACCOUNT_ID");
        require!(!self.charters.contains_key(&account), "ERR_TAKEN");
        require!(!self.pending.contains(&account), "ERR_PENDING");
        let owner = env::predecessor_account_id();
        let owned = self.by_owner.get(&owner).map(|v| v.len()).unwrap_or(0);
        require!(owned < MAX_PER_OWNER, "ERR_OWNER_LIMIT");
        self.pending.insert(account.clone());
        emit("charter_requested", json!({"charter": account, "owner": owner, "deposit": U128(deposit)}));
        let init = json!({"owner": owner, "dao": null, "policy_delay_ns": null, "storage_reserve": null});
        Promise::new(account.clone())
            .create_account()
            .transfer(NearToken::from_yoctonear(deposit - REGISTRY_FEE.as_yoctonear()))
            .use_global_contract(self.code_hash)
            .function_call("new".to_string(), init.to_string().into_bytes(), NearToken::from_yoctonear(0), GAS_INIT)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_created(account, owner, U128(deposit)),
            )
    }

    /// Registers the charter if the batch succeeded; otherwise refunds the full deposit.
    #[private]
    pub fn on_created(&mut self, charter: AccountId, owner: AccountId, deposit: U128) -> bool {
        self.pending.remove(&charter);
        if env::promise_result_checked(0, 1024).is_ok() {
            let index = self.list.len();
            self.list.push(charter.clone());
            let c = Charter { owner: owner.clone(), created_at: U64(env::block_timestamp()), index };
            self.charters.insert(charter.clone(), c);
            let mut v = self.by_owner.get(&owner).cloned().unwrap_or_default();
            v.push(charter.clone());
            self.by_owner.insert(owner.clone(), v);
            emit("charter_created", json!({
                "charter": charter, "owner": owner, "index": index,
                "code_hash": Base58CryptoHash::from(self.code_hash),
            }));
            true
        } else {
            emit("charter_failed", json!({"charter": charter, "owner": owner, "refund": deposit}));
            Promise::new(owner).transfer(NearToken::from_yoctonear(deposit.0)).detach();
            false
        }
    }

    // ---------------- views ----------------
    pub fn get_config(&self) -> Config {
        Config {
            code_hash: self.code_hash.into(),
            min_deposit: U128(self.min_deposit),
            max_deposit: U128(MAX_DEPOSIT.as_yoctonear()),
            registry_fee: U128(REGISTRY_FEE.as_yoctonear()),
            max_per_owner: MAX_PER_OWNER as u32,
            count: self.list.len(),
        }
    }
    pub fn get_charter(&self, account_id: AccountId) -> Option<Charter> { self.charters.get(&account_id).cloned() }
    pub fn is_charter(&self, account_id: AccountId) -> bool { self.charters.contains_key(&account_id) }
    pub fn charters_of(&self, owner: AccountId) -> Vec<AccountId> { self.by_owner.get(&owner).cloned().unwrap_or_default() }
    pub fn list(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<(AccountId, Charter)> {
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100);
        (from..self.list.len().min(from.saturating_add(limit)))
            .filter_map(|i| self.list.get(i).cloned())
            .filter_map(|a| self.charters.get(&a).cloned().map(|c| (a, c)))
            .collect()
    }
}

#[cfg(test)]
mod tests;
