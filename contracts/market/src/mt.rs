//! NEP-245 multi token: core, batch, transfer_call with resolve, metadata,
//! enumeration and events. Approvals are not supported.
use crate::shops::{esc, Ev};
use crate::{Contract, ContractExt};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde::Serialize;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, Promise, PromiseOrValue};

pub const MAX_BATCH: usize = 16;
pub const GAS_ON_TRANSFER: Gas = Gas::from_tgas(30);
pub const GAS_RESOLVE_BASE: Gas = Gas::from_tgas(10);
pub const GAS_RESOLVE_PER_TOKEN: Gas = Gas::from_tgas(2);
pub const SHARE: &str = "share:";

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct TokenMeta {
    pub title: String,
    pub description: String,
    /// good, item or share
    pub kind: String,
    pub icon: Option<String>,
}

#[near(serializers = [json])]
pub struct MtToken {
    pub token_id: String,
    pub owner_id: Option<AccountId>,
}

#[near(serializers = [json])]
pub struct ContractMeta {
    pub spec: String,
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub base_uri: Option<String>,
}

#[near(serializers = [json])]
pub struct BaseMeta {
    pub id: String,
    pub name: String,
    pub symbol: Option<String>,
    pub icon: Option<String>,
    pub decimals: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    pub copies: Option<U64>,
    pub reference_hash: Option<String>,
}

#[near(serializers = [json])]
pub struct TokenMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub media: Option<String>,
    pub media_hash: Option<String>,
    pub issued_at: Option<String>,
    pub expires_at: Option<String>,
    pub starts_at: Option<String>,
    pub updated_at: Option<String>,
    pub extra: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

#[near(serializers = [json])]
pub struct MetadataAll {
    pub base: BaseMeta,
    pub token: TokenMetadata,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct OnTransfer<'a> {
    sender_id: &'a AccountId,
    previous_owner_ids: &'a [AccountId],
    token_ids: &'a [String],
    amounts: &'a [U128],
    msg: &'a str,
}

#[near]
impl Contract {
    /// Owner only. Registers a token id with its metadata. Only registered ids are minted.
    pub fn register_token(&mut self, token_id: String, meta: TokenMeta) {
        self.only_owner();
        require!(valid_id(&token_id), "ERR_TOKEN_ID");
        require!(matches!(meta.kind.as_str(), "good" | "item" | "share"), "ERR_KIND");
        require!(meta.title.len() <= 48 && meta.description.len() <= 200, "ERR_META");
        self.tokens.insert(token_id, meta);
    }

    #[payable]
    pub fn mt_transfer(&mut self, receiver_id: AccountId, token_id: String, amount: U128, approval: Option<(AccountId, u64)>, memo: Option<String>) {
        near_sdk::assert_one_yocto();
        require!(approval.is_none(), "ERR_APPROVALS_UNSUPPORTED");
        let from = self.me();
        self.user_moves(&from, &receiver_id, &[token_id], &[amount], memo.as_deref());
    }

    #[payable]
    pub fn mt_batch_transfer(&mut self, receiver_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>, approvals: Option<Vec<Option<(AccountId, u64)>>>, memo: Option<String>) {
        near_sdk::assert_one_yocto();
        require!(approvals.map(|v| v.iter().all(|a| a.is_none())).unwrap_or(true), "ERR_APPROVALS_UNSUPPORTED");
        let from = self.me();
        self.user_moves(&from, &receiver_id, &token_ids, &amounts, memo.as_deref());
    }

    #[payable]
    pub fn mt_transfer_call(&mut self, receiver_id: AccountId, token_id: String, amount: U128, approval: Option<(AccountId, u64)>, memo: Option<String>, msg: String) -> PromiseOrValue<Vec<U128>> {
        near_sdk::assert_one_yocto();
        require!(approval.is_none(), "ERR_APPROVALS_UNSUPPORTED");
        self.mt_call(receiver_id, vec![token_id], vec![amount], memo, msg)
    }

    #[payable]
    pub fn mt_batch_transfer_call(&mut self, receiver_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>, approvals: Option<Vec<Option<(AccountId, u64)>>>, memo: Option<String>, msg: String) -> PromiseOrValue<Vec<U128>> {
        near_sdk::assert_one_yocto();
        require!(approvals.map(|v| v.iter().all(|a| a.is_none())).unwrap_or(true), "ERR_APPROVALS_UNSUPPORTED");
        self.mt_call(receiver_id, token_ids, amounts, memo, msg)
    }

    /// Returns what the receiver kept. A refund is at most what the receiver still holds.
    #[private]
    pub fn mt_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>, approvals: Option<Vec<Option<(AccountId, u64)>>>) -> Vec<U128> {
        let _ = approvals;
        let unused: Vec<U128> = match env::promise_result_checked(0, 64 * MAX_BATCH) {
            Ok(v) => near_sdk::serde_json::from_slice::<Vec<U128>>(&v)
                .ok()
                .filter(|u| u.len() == amounts.len())
                .unwrap_or_else(|| amounts.clone()),
            Err(_) => amounts.clone(),
        };
        let mut kept = Vec::with_capacity(token_ids.len());
        let mut back_ids = Vec::new();
        let mut back_amounts = Vec::new();
        for ((t, a), u) in token_ids.iter().zip(&amounts).zip(&unused) {
            let have = self.bal(&receiver_id, t);
            let back = u.0.min(a.0).min(have);
            if back > 0 {
                self.debit(&receiver_id, t, back);
                self.credit(&sender_id, t, back);
                back_ids.push(t.clone());
                back_amounts.push(back);
            }
            kept.push(U128(a.0 - back));
        }
        if !back_ids.is_empty() {
            transfer_event(&receiver_id, &sender_id, &back_ids, &back_amounts, Some("refund"));
        }
        kept
    }

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128 {
        U128(self.bal(&account_id, &token_id))
    }

    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<String>) -> Vec<U128> {
        token_ids.iter().map(|t| U128(self.bal(&account_id, t))).collect()
    }

    pub fn mt_supply(&self, token_id: String) -> Option<U128> {
        self.tokens.get(&token_id).map(|_| U128(self.supply.get(&token_id).copied().unwrap_or(0)))
    }

    pub fn mt_batch_supply(&self, token_ids: Vec<String>) -> Vec<Option<U128>> {
        token_ids.into_iter().map(|t| self.mt_supply(t)).collect()
    }

    pub fn mt_token(&self, token_ids: Vec<String>) -> Vec<Option<MtToken>> {
        token_ids
            .into_iter()
            .map(|t| self.tokens.get(&t).map(|_| MtToken { token_id: t.clone(), owner_id: None }))
            .collect()
    }

    // ---------- metadata ----------

    pub fn mt_metadata_contract(&self) -> ContractMeta {
        ContractMeta {
            spec: "mt-1.0.0".into(),
            name: "Nearcarta Market Day".into(),
            description: Some("Goods, items and shop shares of the city of Nearcarta".into()),
            icon: None,
            base_uri: None,
        }
    }

    pub fn mt_metadata_token_all(&self, token_ids: Vec<String>) -> Vec<Option<MetadataAll>> {
        token_ids.into_iter().map(|t| self.meta_all(&t)).collect()
    }

    pub fn mt_metadata_token_by_token_id(&self, token_ids: Vec<String>) -> Vec<Option<TokenMetadata>> {
        token_ids.into_iter().map(|t| self.meta_all(&t).map(|m| m.token)).collect()
    }

    pub fn mt_metadata_base_by_token_id(&self, token_ids: Vec<String>) -> Vec<Option<BaseMeta>> {
        token_ids.into_iter().map(|t| self.meta_all(&t).map(|m| m.base)).collect()
    }

    // ---------- enumeration ----------

    pub fn mt_tokens(&self, from_index: Option<U128>, limit: Option<u32>) -> Vec<MtToken> {
        let from = from_index.map(|v| v.0 as usize).unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100) as usize;
        self.tokens.keys().skip(from).take(limit).map(|t| MtToken { token_id: t.clone(), owner_id: None }).collect()
    }

    pub fn mt_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u32>) -> Vec<MtToken> {
        let from = from_index.map(|v| v.0 as usize).unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100) as usize;
        self.owned
            .get(&account_id)
            .map(|v| v.iter().skip(from).take(limit).map(|t| MtToken { token_id: t.clone(), owner_id: Some(account_id.clone()) }).collect())
            .unwrap_or_default()
    }
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b':' || b == b'-')
}

pub fn transfer_event(from: &AccountId, to: &AccountId, ids: &[String], amounts: &[u128], memo: Option<&str>) {
    let ids_json: Vec<String> = ids.iter().map(|t| format!("\"{}\"", esc(t))).collect();
    let am_json: Vec<String> = amounts.iter().map(|a| format!("\"{a}\"")).collect();
    let mut e = Ev::new()
        .s("old_owner_id", from.as_str())
        .s("new_owner_id", to.as_str())
        .raw("token_ids", &format!("[{}]", ids_json.join(",")))
        .raw("amounts", &format!("[{}]", am_json.join(",")));
    if let Some(m) = memo {
        e = e.s("memo", m);
    }
    e.nep245("mt_transfer");
}

impl Contract {
    pub(crate) fn bal(&self, who: &AccountId, token: &str) -> u128 {
        self.balances.get(&(who.clone(), token.to_string())).copied().unwrap_or(0)
    }

    pub(crate) fn credit(&mut self, who: &AccountId, token: &str, amount: u128) {
        let have = self.bal(who, token);
        if have == 0 {
            let mut list = self.owned.get(who).cloned().unwrap_or_default();
            if !list.iter().any(|t| t == token) {
                list.push(token.to_string());
                self.owned.insert(who.clone(), list);
            }
        }
        self.balances.insert((who.clone(), token.to_string()), have + amount);
    }

    pub(crate) fn debit(&mut self, who: &AccountId, token: &str, amount: u128) {
        let have = self.bal(who, token);
        require!(amount > 0 && have >= amount, "ERR_BALANCE");
        if have == amount {
            self.balances.remove(&(who.clone(), token.to_string()));
            if let Some(list) = self.owned.get(who).cloned() {
                let list: Vec<String> = list.into_iter().filter(|t| t != token).collect();
                if list.is_empty() { self.owned.remove(who); } else { self.owned.insert(who.clone(), list); }
            }
        } else {
            self.balances.insert((who.clone(), token.to_string()), have - amount);
        }
    }

    pub(crate) fn mint(&mut self, to: &AccountId, token: &str, amount: u128, memo: &str) {
        require!(amount > 0 && self.tokens.get(token).is_some(), "ERR_TOKEN");
        self.credit(to, token, amount);
        let s = self.supply.get(token).copied().unwrap_or(0);
        self.supply.insert(token.to_string(), s + amount);
        Ev::new().s("owner_id", to.as_str()).one(token, amount).s("memo", memo).nep245("mt_mint");
    }

    pub(crate) fn burn(&mut self, from: &AccountId, token: &str, amount: u128, memo: &str) {
        self.debit(from, token, amount);
        let s = self.supply.get(token).copied().unwrap_or(0);
        self.supply.insert(token.to_string(), s - amount);
        Ev::new().s("owner_id", from.as_str()).one(token, amount).s("memo", memo).nep245("mt_burn");
    }

    /// An in-game move with one event.
    pub(crate) fn move_one(&mut self, from: &AccountId, to: &AccountId, token: &str, amount: u128, memo: &str) {
        require!(from != to, "ERR_SELF_TRANSFER");
        self.debit(from, token, amount);
        self.credit(to, token, amount);
        transfer_event(from, to, &[token.to_string()], &[amount], Some(memo));
    }

    /// Player transfers: shares stay put, batches are capped, storage is charged to the sender.
    fn user_moves(&mut self, from: &AccountId, to: &AccountId, ids: &[String], amounts: &[U128], memo: Option<&str>) {
        require!(!ids.is_empty() && ids.len() <= MAX_BATCH && ids.len() == amounts.len(), "ERR_BATCH");
        require!(from != to, "ERR_SELF_TRANSFER");
        let before = self.mark();
        let mut raw = Vec::with_capacity(ids.len());
        for (t, a) in ids.iter().zip(amounts) {
            require!(!t.starts_with(SHARE), "ERR_SHARE_LOCKED");
            self.debit(from, t, a.0);
            self.credit(to, t, a.0);
            raw.push(a.0);
        }
        transfer_event(from, to, ids, &raw, memo);
        self.settle_storage(from, before);
    }

    fn mt_call(&mut self, receiver_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>, memo: Option<String>, msg: String) -> PromiseOrValue<Vec<U128>> {
        let n = token_ids.len() as u64;
        let resolve = GAS_RESOLVE_BASE.saturating_add(Gas::from_gas(GAS_RESOLVE_PER_TOKEN.as_gas() * n));
        let need = GAS_ON_TRANSFER.saturating_add(resolve).saturating_add(Gas::from_tgas(10));
        require!(env::prepaid_gas() >= need, "ERR_GAS: attach more gas for transfer_call");
        let from = self.me();
        self.user_moves(&from, &receiver_id, &token_ids, &amounts, memo.as_deref());
        let prev: Vec<AccountId> = token_ids.iter().map(|_| from.clone()).collect();
        let args = near_sdk::serde_json::to_vec(&OnTransfer {
            sender_id: &from, previous_owner_ids: &prev, token_ids: &token_ids, amounts: &amounts, msg: &msg,
        })
        .expect("ERR_JSON");
        Promise::new(receiver_id.clone())
            .function_call("mt_on_transfer".to_string(), args, NearToken::from_yoctonear(0), GAS_ON_TRANSFER)
            .then(Self::ext(env::current_account_id()).with_static_gas(resolve).mt_resolve_transfer(from, receiver_id, token_ids, amounts, None))
            .into()
    }

    fn meta_all(&self, t: &str) -> Option<MetadataAll> {
        let m = self.tokens.get(t)?;
        Some(MetadataAll {
            base: BaseMeta {
                id: t.to_string(), name: m.title.clone(), symbol: None, icon: m.icon.clone(),
                decimals: Some("0".into()), base_uri: None, reference: None, copies: None, reference_hash: None,
            },
            token: TokenMetadata {
                title: Some(m.title.clone()), description: Some(m.description.clone()), media: None, media_hash: None,
                issued_at: None, expires_at: None, starts_at: None, updated_at: None,
                extra: Some(format!("{{\"kind\":\"{}\"}}", m.kind)), reference: None, reference_hash: None,
            },
        })
    }
}
