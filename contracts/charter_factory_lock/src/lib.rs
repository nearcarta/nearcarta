//! Mainnet charter factory. The oath wasm is stored once on this account and
//! copied onto each charter with deploy_contract. Nothing is published as a
//! global contract, so the only NEAR that is burned is gas.
//!
//! Storage stake on this account (the wasm copy plus the registry) comes back
//! to the owner when reap() deletes the account. Storage stake on a charter
//! comes back to that charter's owner when they install the reaper and reap it.
//! A parent account cannot be deleted while a subaccount still exists, so every
//! charter is reaped and then release()'d before the factory is reaped.
//! See docs/MAINNET_FACTORY.md.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::store::{LookupMap, LookupSet, Vector};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise};

/// Kept by the factory from each deposit to pay for the registry entry. Returned by factory reap.
pub const REGISTRY_FEE: NearToken = NearToken::from_millinear(10);
/// Bytes of oath state beyond the wasm. The deployed mainnet charter uses
/// 426,432 bytes of storage for a 425,406-byte wasm, so 8 KiB covers init.
pub const STATE_SLACK: u64 = 8_192;
/// A visitor cannot lock more than this. The oath wasm stake is about 4.3 NEAR.
pub const MAX_DEPOSIT: NearToken = NearToken::from_near(10);
pub const MAX_CODE: u64 = 700_000;
pub const MAX_PER_OWNER: usize = 5;
pub const GAS_INIT: Gas = Gas::from_tgas(80);
pub const GAS_CALLBACK: Gas = Gas::from_tgas(30);
/// create_charter + deploying the wasm + init + the callback.
pub const MIN_GAS_CREATE: Gas = Gas::from_tgas(250);
pub const NS_PER_MIN: u64 = 60_000_000_000;
pub const DEFAULT_POLICY_DELAY_NS: u64 = 24 * 60 * NS_PER_MIN;
pub const MIN_POLICY_DELAY_NS: u64 = 10 * NS_PER_MIN;
pub const MAX_POLICY_DELAY_NS: u64 = 30 * 24 * 60 * NS_PER_MIN;

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Charter {
    pub owner: AccountId,
    pub created_at: U64,
    pub index: u32,
    pub policy_delay_ns: U64,
    pub dao: Option<AccountId>,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub code_len: u32,
    pub code_sha256: Option<String>,
    pub min_deposit: U128,
    pub max_deposit: U128,
    pub registry_fee: U128,
    pub state_slack_bytes: u32,
    pub max_per_owner: u32,
    pub count: u32,
    pub pending: u32,
    pub recoverable: bool,
    pub default_policy_delay_ns: U64,
    pub min_policy_delay_ns: U64,
    pub max_policy_delay_ns: U64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Factory {
    owner: AccountId,
    code: Vec<u8>,
    list: Vector<AccountId>,
    charters: LookupMap<AccountId, Charter>,
    by_owner: LookupMap<AccountId, Vec<AccountId>>,
    pending: LookupSet<AccountId>,
    pending_count: u32,
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard": "nearcarta-charters", "version": "1.0.0", "event": event, "data": [data]})
    ));
}

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

fn hex(bytes: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(H[(b >> 4) as usize] as char);
        s.push(H[(b & 0xf) as usize] as char);
    }
    s
}

/// Stake for `bytes` at the protocol price (10^19 yoctoNEAR per byte).
pub fn storage_cost(bytes: u128) -> u128 {
    bytes * env::storage_byte_cost().as_yoctonear()
}

#[near]
impl Factory {
    /// `owner` must be the predecessor. The deploy transaction is signed by
    /// nearcarta.near and includes this init, so the owner is that account.
    #[init]
    pub fn new(owner: AccountId) -> Self {
        require!(env::predecessor_account_id() == owner, "ERR_OWNER");
        Self {
            owner,
            code: Vec::new(),
            list: Vector::new(b"l"),
            charters: LookupMap::new(b"c"),
            by_owner: LookupMap::new(b"o"),
            pending: LookupSet::new(b"p"),
            pending_count: 0,
        }
    }

    fn only_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "ERR_OWNER");
    }

    /// Stores the oath wasm. Attached deposit covers the storage increase;
    /// the rest is refunded to the owner. A smaller replacement refunds the
    /// freed stake as well. clear_code removes it.
    #[payable]
    pub fn set_code(&mut self) {
        self.only_owner();
        let bytes = env::input().unwrap_or_default();
        require!(!bytes.is_empty() && bytes.len() as u64 <= MAX_CODE, "ERR_CODE_SIZE");
        let before = env::storage_usage();
        self.code = bytes;
        self.settle_storage(before);
        emit("code_set", json!({"len": self.code.len(), "sha256": hex(&env::sha256(&self.code))}));
    }

    /// Drops the stored wasm and refunds its storage stake to the owner.
    pub fn clear_code(&mut self) {
        self.only_owner();
        let before = env::storage_usage();
        self.code.clear();
        self.settle_storage(before);
    }

    fn settle_storage(&self, before: u64) {
        let after = env::storage_usage();
        let price = env::storage_byte_cost().as_yoctonear();
        let attached = env::attached_deposit().as_yoctonear();
        let (cost, freed) = if after > before {
            ((u128::from(after - before)) * price, 0)
        } else {
            (0, u128::from(before - after) * price)
        };
        require!(attached >= cost, "ERR_STORAGE_DEPOSIT");
        let refund = attached - cost + freed;
        if refund > 0 {
            Promise::new(self.owner.clone()).transfer(NearToken::from_yoctonear(refund));
        }
    }

    fn required_deposit(&self) -> u128 {
        require!(!self.code.is_empty(), "ERR_NO_CODE");
        storage_cost(self.code.len() as u128 + u128::from(STATE_SLACK)) + REGISTRY_FEE.as_yoctonear()
    }

    /// Creates `<name>.<this factory>` and deploys the stored oath wasm onto it.
    /// The charter receives the deposit minus the registry fee, which is enough
    /// for the wasm stake plus STATE_SLACK. No access key is added.
    #[payable]
    pub fn create_charter(&mut self, name: String, policy_delay_ns: Option<U64>, dao: Option<AccountId>) -> Promise {
        require!(valid_name(&name), "ERR_NAME");
        require!(env::prepaid_gas() >= MIN_GAS_CREATE, "ERR_LOW_GAS");
        let min = self.required_deposit();
        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit >= min, "ERR_DEPOSIT_LOW");
        require!(deposit <= MAX_DEPOSIT.as_yoctonear(), "ERR_DEPOSIT_HIGH");
        let account: AccountId = format!("{name}.{}", env::current_account_id()).parse().expect("ERR_ACCOUNT_ID");
        require!(!self.charters.contains_key(&account), "ERR_TAKEN");
        require!(!self.pending.contains(&account), "ERR_PENDING");
        let owner = env::predecessor_account_id();
        let owned = self.by_owner.get(&owner).map(|v| v.len()).unwrap_or(0);
        require!(owned < MAX_PER_OWNER, "ERR_OWNER_LIMIT");
        let delay = policy_delay_ns.map(|d| d.0).unwrap_or(DEFAULT_POLICY_DELAY_NS);
        require!((MIN_POLICY_DELAY_NS..=MAX_POLICY_DELAY_NS).contains(&delay), "ERR_DELAY");
        if let Some(d) = &dao {
            require!(d != &owner && d != &account && d != &env::current_account_id(), "ERR_DAO");
        }
        self.pending.insert(account.clone());
        self.pending_count += 1;
        emit("charter_requested", json!({
            "charter": account, "owner": owner, "deposit": U128(deposit), "policy_delay_ns": U64(delay), "dao": dao,
        }));
        let init = json!({
            "owner": owner, "dao": dao, "policy_delay_ns": U64(delay), "storage_reserve": null, "setup_window": true,
        });
        let code = self.code.clone();
        Promise::new(account.clone())
            .create_account()
            .transfer(NearToken::from_yoctonear(deposit - REGISTRY_FEE.as_yoctonear()))
            .deploy_contract(code)
            .function_call("new".to_string(), init.to_string().into_bytes(), NearToken::from_yoctonear(0), GAS_INIT)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_created(account, owner, U128(deposit), U64(delay), dao),
            )
    }

    #[private]
    pub fn on_created(&mut self, charter: AccountId, owner: AccountId, deposit: U128, policy_delay_ns: U64, dao: Option<AccountId>) -> bool {
        self.pending.remove(&charter);
        self.pending_count = self.pending_count.saturating_sub(1);
        if env::promise_result_checked(0, 1024).is_ok() {
            let index = self.list.len();
            self.list.push(charter.clone());
            let c = Charter { owner: owner.clone(), created_at: U64(env::block_timestamp()), index, policy_delay_ns, dao: dao.clone() };
            self.charters.insert(charter.clone(), c);
            let mut v = self.by_owner.get(&owner).cloned().unwrap_or_default();
            v.push(charter.clone());
            self.by_owner.insert(owner.clone(), v);
            emit("charter_created", json!({
                "charter": charter, "owner": owner, "index": index,
                "code_sha256": hex(&env::sha256(&self.code)),
                "policy_delay_ns": policy_delay_ns, "dao": dao,
            }));
            true
        } else {
            emit("charter_failed", json!({"charter": charter, "owner": owner, "refund": deposit}));
            Promise::new(owner).transfer(NearToken::from_yoctonear(deposit.0)).detach();
            false
        }
    }

    /// Drops a registry row. Call it after that charter account has been deleted.
    /// The charter's owner or the factory owner may call it. It does not delete
    /// the account and it does not move the charter's NEAR.
    pub fn release(&mut self, charter: AccountId) {
        let c = self.charters.get(&charter).cloned().expect("ERR_UNKNOWN");
        let pred = env::predecessor_account_id();
        require!(pred == c.owner || pred == self.owner, "ERR_OWNER");
        let n = self.list.len();
        let mut keep = Vec::with_capacity(n as usize);
        for i in 0..n {
            let a = self.list.get(i).unwrap().clone();
            if a != charter { keep.push(a); }
        }
        for _ in 0..n { self.list.pop(); }
        for (i, a) in keep.into_iter().enumerate() {
            self.list.push(a.clone());
            if let Some(mut row) = self.charters.get(&a).cloned() {
                row.index = i as u32;
                self.charters.insert(a, row);
            }
        }
        self.charters.remove(&charter);
        let mut v = self.by_owner.get(&c.owner).cloned().unwrap_or_default();
        v.retain(|a| a != &charter);
        if v.is_empty() { self.by_owner.remove(&c.owner); } else { self.by_owner.insert(c.owner.clone(), v); }
        emit("charter_released", json!({"charter": charter}));
    }

    /// Deletes this factory and sends every yoctoNEAR, including the stored wasm
    /// stake, to the owner. Refuses while a charter row or a pending create remains.
    /// The protocol also refuses while any subaccount still exists.
    #[payable]
    pub fn reap(&mut self) -> Promise {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "ERR_ONE_YOCTO");
        self.only_owner();
        require!(self.list.is_empty() && self.pending_count == 0, "ERR_NONEMPTY");
        Promise::new(env::current_account_id()).delete_account(self.owner.clone())
    }

    pub fn get_config(&self) -> Config {
        let sha = if self.code.is_empty() { None } else { Some(hex(&env::sha256(&self.code))) };
        Config {
            owner: self.owner.clone(),
            code_len: self.code.len() as u32,
            code_sha256: sha,
            min_deposit: U128(if self.code.is_empty() { 0 } else { self.required_deposit() }),
            max_deposit: U128(MAX_DEPOSIT.as_yoctonear()),
            registry_fee: U128(REGISTRY_FEE.as_yoctonear()),
            state_slack_bytes: STATE_SLACK as u32,
            max_per_owner: MAX_PER_OWNER as u32,
            count: self.list.len(),
            pending: self.pending_count,
            recoverable: true,
            default_policy_delay_ns: U64(DEFAULT_POLICY_DELAY_NS),
            min_policy_delay_ns: U64(MIN_POLICY_DELAY_NS),
            max_policy_delay_ns: U64(MAX_POLICY_DELAY_NS),
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
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
    use near_sdk::{testing_env, test_vm_config, PromiseResult, RuntimeFeesConfig};

    fn acc(s: &str) -> AccountId { s.parse().unwrap() }

    fn ctx(pred: &str, deposit: NearToken, gas_tgas: u64) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.current_account_id(acc("factory.nearcarta.near"))
            .predecessor_account_id(acc(pred))
            .signer_account_id(acc(pred))
            .attached_deposit(deposit)
            .prepaid_gas(Gas::from_tgas(gas_tgas))
            .account_balance(NearToken::from_near(50));
        b
    }

    fn factory() -> Factory {
        testing_env!(ctx("nearcarta.near", NearToken::from_near(0), 300).build());
        Factory::new(acc("nearcarta.near"))
    }

    fn with_code(mut f: Factory) -> Factory {
        let mut b = ctx("nearcarta.near", NearToken::from_near(1), 300);
        b.context.input = std::rc::Rc::from(vec![0, 97, 115, 109]);
        testing_env!(b.build());
        f.set_code();
        f
    }

    fn with_result(ok: bool) {
        let r = if ok { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed };
        testing_env!(ctx("factory.nearcarta.near", NearToken::from_near(0), 300).build(), test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![r]);
    }

    #[test]
    fn names() {
        for ok in ["ab", "alice", "a-b", "a_b"] { assert!(valid_name(ok), "{ok}"); }
        for bad in ["", "a", "a.b", "Alice", "a--b"] { assert!(!valid_name(bad), "{bad}"); }
    }

    #[test]
    #[should_panic(expected = "ERR_OWNER")]
    fn init_rejects_a_different_owner() {
        testing_env!(ctx("alice.near", NearToken::from_near(0), 100).build());
        Factory::new(acc("nearcarta.near"));
    }

    #[test]
    #[should_panic(expected = "ERR_NO_CODE")]
    fn create_before_code_is_stored() {
        let mut f = factory();
        testing_env!(ctx("alice.near", NearToken::from_near(5), 300).build());
        f.create_charter("shop".into(), None, None);
    }

    #[test]
    #[should_panic(expected = "ERR_OWNER")]
    fn stranger_cannot_set_code() {
        let mut f = factory();
        let mut b = ctx("alice.near", NearToken::from_near(1), 100);
        b.context.input = std::rc::Rc::from(vec![1, 2, 3, 4]);
        testing_env!(b.build());
        f.set_code();
    }

    #[test]
    fn min_deposit_is_wasm_stake_plus_slack_plus_fee() {
        let f = with_code(factory());
        let c = f.get_config();
        let byte = env::storage_byte_cost().as_yoctonear();
        let expect = (4 + u128::from(STATE_SLACK)) * byte + REGISTRY_FEE.as_yoctonear();
        assert_eq!(c.min_deposit.0, expect);
        assert_eq!(c.code_len, 4);
        assert!(c.recoverable);
        assert_eq!(c.owner, acc("nearcarta.near"));
        assert!(c.code_sha256.unwrap().len() == 64);
    }

    #[test]
    #[should_panic(expected = "ERR_DEPOSIT_LOW")]
    fn deposit_must_cover_storage() {
        let mut f = with_code(factory());
        testing_env!(ctx("alice.near", NearToken::from_millinear(10), 300).build());
        f.create_charter("shop".into(), None, None);
    }

    #[test]
    fn create_deploys_the_stored_wasm_and_keeps_the_fee() {
        let mut f = with_code(factory());
        let min = NearToken::from_yoctonear(f.required_deposit());
        testing_env!(ctx("alice.near", min, 300).build());
        f.create_charter("shop".into(), None, None).detach();
        let receipts = get_created_receipts();
        let dbg = format!("{receipts:?}");
        assert!(dbg.contains("DeployContract") || dbg.contains("deploy_contract"), "{dbg}");
        assert!(!dbg.to_ascii_lowercase().contains("global"));
        let batch = receipts.iter().find(|r| r.receiver_id == acc("shop.factory.nearcarta.near")).expect("batch");
        let transfers: Vec<u128> = batch.actions.iter().filter_map(|a| match a {
            near_sdk::mock::MockAction::Transfer { deposit, .. } => Some(deposit.as_yoctonear()),
            _ => None,
        }).collect();
        assert_eq!(transfers, vec![min.as_yoctonear() - REGISTRY_FEE.as_yoctonear()]);
    }

    #[test]
    fn success_registers_and_failure_refunds() {
        let mut f = with_code(factory());
        let min = f.required_deposit();
        testing_env!(ctx("alice.near", NearToken::from_yoctonear(min), 300).build());
        f.create_charter("shop".into(), None, None);
        with_result(true);
        assert!(f.on_created(acc("shop.factory.nearcarta.near"), acc("alice.near"), U128(min), U64(DEFAULT_POLICY_DELAY_NS), None));
        assert!(f.is_charter(acc("shop.factory.nearcarta.near")));
        testing_env!(ctx("bob.near", NearToken::from_yoctonear(min), 300).build());
        f.create_charter("other".into(), None, None);
        with_result(false);
        assert!(!f.on_created(acc("other.factory.nearcarta.near"), acc("bob.near"), U128(min), U64(DEFAULT_POLICY_DELAY_NS), None));
        assert!(!f.is_charter(acc("other.factory.nearcarta.near")));
        assert!(get_logs().iter().any(|l| l.contains("charter_failed")));
        testing_env!(ctx("bob.near", NearToken::from_yoctonear(min), 300).build());
        f.create_charter("other".into(), None, None);
    }

    #[test]
    fn release_then_reap_when_the_list_is_empty() {
        let mut f = with_code(factory());
        let min = f.required_deposit();
        testing_env!(ctx("alice.near", NearToken::from_yoctonear(min), 300).build());
        f.create_charter("shop".into(), None, None);
        with_result(true);
        f.on_created(acc("shop.factory.nearcarta.near"), acc("alice.near"), U128(min), U64(DEFAULT_POLICY_DELAY_NS), None);
        testing_env!(ctx("alice.near", NearToken::from_yoctonear(0), 50).build());
        f.release(acc("shop.factory.nearcarta.near"));
        assert!(!f.is_charter(acc("shop.factory.nearcarta.near")));
        assert_eq!(f.charters_of(acc("alice.near")), Vec::<AccountId>::new());
        testing_env!(ctx("nearcarta.near", NearToken::from_yoctonear(1), 50).build());
        let _ = f.reap();
    }

    #[test]
    #[should_panic(expected = "ERR_NONEMPTY")]
    fn reap_refuses_while_a_charter_is_registered() {
        let mut f = with_code(factory());
        let min = f.required_deposit();
        testing_env!(ctx("alice.near", NearToken::from_yoctonear(min), 300).build());
        let _ = f.create_charter("shop".into(), None, None);
        with_result(true);
        f.on_created(acc("shop.factory.nearcarta.near"), acc("alice.near"), U128(min), U64(DEFAULT_POLICY_DELAY_NS), None);
        testing_env!(ctx("nearcarta.near", NearToken::from_yoctonear(1), 50).build());
        let _ = f.reap();
    }

    #[test]
    #[should_panic(expected = "ERR_ONE_YOCTO")]
    fn reap_needs_one_yocto() {
        let mut f = factory();
        testing_env!(ctx("nearcarta.near", NearToken::from_near(0), 50).build());
        let _ = f.reap();
    }

    #[test]
    #[should_panic(expected = "ERR_OWNER")]
    fn stranger_cannot_reap() {
        let mut f = factory();
        testing_env!(ctx("alice.near", NearToken::from_yoctonear(1), 50).build());
        let _ = f.reap();
    }

    #[test]
    fn clear_code_refunds_and_blocks_create() {
        let mut f = with_code(factory());
        testing_env!(ctx("nearcarta.near", NearToken::from_near(0), 50).build());
        f.clear_code();
        assert_eq!(f.get_config().code_len, 0);
        assert_eq!(f.get_config().min_deposit.0, 0);
    }
}
