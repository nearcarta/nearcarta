//! Test-only NEP-141-shaped token (R11): ft_transfer success/failure paths plus
//! NEP-145-style registration, so the oath's storage_balance_of check is exercised.
use near_sdk::json_types::U128;
use near_sdk::serde_json::{json, Value};
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault};
const STORAGE_FEE: u128 = 1_250_000_000_000_000_000_000;
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct T { b: LookupMap<AccountId, u128> }
#[near]
impl T {
    #[init]
    pub fn new() -> Self { Self { b: LookupMap::new(b"b") } }
    /// Mint registers the account.
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        let v = self.b.get(&account_id).copied().unwrap_or(0);
        self.b.insert(account_id, v + amount.0);
    }
    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> Value {
        let _ = registration_only;
        let a = account_id.unwrap_or_else(env::predecessor_account_id);
        if self.b.get(&a).is_none() { self.b.insert(a, 0); }
        json!({"total": U128(STORAGE_FEE), "available": U128(0)})
    }
    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<Value> {
        self.b.get(&account_id).map(|_| json!({"total": U128(STORAGE_FEE), "available": U128(0)}))
    }
    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "Requires attached deposit of exactly 1 yoctoNEAR");
        let s = env::predecessor_account_id();
        let sb = self.b.get(&s).copied().unwrap_or(0);
        require!(sb >= amount.0, "The account doesn't have enough balance");
        let r = *self.b.get(&receiver_id).expect("The account is not registered");
        self.b.insert(s.clone(), sb - amount.0);
        self.b.insert(receiver_id.clone(), r + amount.0);
        env::log_str(&format!("EVENT_JSON:{{\"standard\":\"nep141\",\"version\":\"1.0.0\",\"event\":\"ft_transfer\",\"data\":[{{\"old_owner_id\":\"{}\",\"new_owner_id\":\"{}\",\"amount\":\"{}\",\"memo\":{:?}}}]}}", s, receiver_id, amount.0, memo.unwrap_or_default()));
    }
    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 { U128(self.b.get(&account_id).copied().unwrap_or(0)) }
}
