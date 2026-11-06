//! House deed v2: a NEP-171 NFT (NEP-177 metadata, NEP-178 approvals, NEP-181 enumeration) that IS the house.
//! Each deed carries a purse of NEAR held by this contract and one spending rule (a cap per payment).
//! Whoever holds the deed controls the purse: `house_pay` is allowed only for the current owner, needs 1 yocto
//! (a full wallet approval, never a function-call key) and stays under the deed's cap. Transfer the deed and the
//! purse and the rule move with it; the old owner is refused from then on. Anyone may `house_fund` a deed.
//! Any account may mint one deed (token_id = minter account id). No owner, no admin, no upgrade method; the account
//! is deployed with no access key.
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, NonFungibleTokenEnumeration, Token, TokenId};
use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
use near_contract_standards::non_fungible_token::core::{NonFungibleTokenCore, NonFungibleTokenResolver};
use near_sdk::collections::{LazyOption, LookupMap};
use near_sdk::json_types::{U128, U64};
use near_sdk::{assert_one_yocto, env, log, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, PromiseResult};
use std::collections::HashMap;

/// The purse and rule bound to one deed.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Purse { pub balance: U128, pub cap: U128, pub paid: U128, pub pays: u32, pub refused_note: Option<String> }

/// Inheritance on one deed. Time is `env::block_timestamp` nanoseconds. Nothing fires by itself.
/// A demo may use a 60 second window. The owner can cancel until the wait ends.
/// https://github.com/near/NEPs/blob/master/neps/nep-0171.md (the release is an nft transfer)
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Line {
    pub heirs: Vec<AccountId>,
    pub guardians: Vec<AccountId>,
    pub threshold: u32,
    pub last_check_in_ns: u64,
    pub period_ns: u64,
    pub wait_ns: u64,
    pub pending_ns: u64,
    pub approvals: Vec<AccountId>,
    pub released: bool,
}

/// Shortest check-in or cancel window: 60 seconds. Longest: 366 days.
const MIN_WINDOW_NS: u64 = 60 * 1_000_000_000;
const MAX_WINDOW_NS: u64 = 366 * 24 * 60 * 60 * 1_000_000_000;

#[derive(BorshStorageKey)]
#[near]
enum Key { Owner, Meta, Enum, Approval, ContractMeta, Purse, Line }

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    tokens: NonFungibleToken,
    metadata: LazyOption<NFTContractMetadata>,
    purses: LookupMap<TokenId, Purse>,
    /// Inheritance line per deed. Absent until the holder calls house_set_line.
    lines: LookupMap<TokenId, Line>,
    /// The deployer: may only close the contract, and only while no purse holds NEAR.
    owner: AccountId,
    /// Sum of every purse balance (user money); close() refuses while it is above 0.
    held: u128,
}

/// Storage the minter pays for: the token, its metadata and the purse (about 1 KB; 0.02 NEAR covers it).
const MINT_STORAGE: NearToken = NearToken::from_millinear(20);
const MAX_CAP: u128 = 10u128.pow(24) * 5; // 5 NEAR per payment at most

#[near]
impl Contract {
    #[init]
    /// `owner`: who may close the contract (all its NEAR goes there); defaults to the caller.
    pub fn new(owner: Option<AccountId>) -> Self {
        let metadata = NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "Nearcarta House deeds v2".to_string(),
            symbol: "DEED".to_string(),
            icon: None, base_uri: None, reference: None, reference_hash: None,
        };
        Self {
            tokens: NonFungibleToken::new(Key::Owner, env::current_account_id(), Some(Key::Meta), Some(Key::Enum), Some(Key::Approval)),
            metadata: LazyOption::new(Key::ContractMeta, Some(&metadata)),
            purses: LookupMap::new(Key::Purse),
            lines: LookupMap::new(Key::Line),
            owner: owner.unwrap_or_else(env::predecessor_account_id),
            held: 0,
        }
    }

    /// Mint the caller's own deed (one per account). `cap` is the most one payment from the purse may be
    /// (yocto, at most 5 NEAR). Everything attached above 0.02 NEAR storage goes into the house purse.
    #[payable]
    pub fn mint_deed(&mut self, house: Option<AccountId>, cap: Option<U128>) -> Token {
        let who = env::predecessor_account_id();
        let dep = env::attached_deposit().as_yoctonear();
        require!(dep >= MINT_STORAGE.as_yoctonear(), "attach at least 0.02 NEAR (storage); the rest fills the house purse");
        require!(self.tokens.owner_by_id.get(&who.to_string()).is_none(), "this account already has a deed");
        let cap = cap.map(|c| c.0).unwrap_or(10u128.pow(23));
        require!(cap > 0 && cap <= MAX_CAP, "cap must be above 0 and at most 5 NEAR");
        let title = format!("House of {who}");
        let description = Some(match &house { Some(h) => format!("Charter: {h}. Holder of this deed controls the house purse."), None => "Holder of this deed controls the house purse.".to_string() });
        let meta = TokenMetadata {
            title: Some(title), description, media: None, media_hash: None, copies: Some(1),
            issued_at: Some(env::block_timestamp_ms().to_string()), expires_at: None, starts_at: None,
            updated_at: None, extra: None, reference: None, reference_hash: None,
        };
        let id = who.to_string();
        self.held += dep - MINT_STORAGE.as_yoctonear();
        self.purses.insert(&id, &Purse { balance: U128(dep - MINT_STORAGE.as_yoctonear()), cap: U128(cap), paid: U128(0), pays: 0, refused_note: None });
        self.tokens.internal_mint(id, who, Some(meta))
    }

    /// Anyone may add NEAR to a deed's purse.
    #[payable]
    pub fn house_fund(&mut self, token_id: TokenId) -> U128 {
        let mut p = self.purses.get(&token_id).unwrap_or_else(|| env::panic_str("no such deed"));
        let dep = env::attached_deposit().as_yoctonear();
        require!(dep > 0, "attach NEAR to fund the house");
        p.balance = U128(p.balance.0 + dep);
        self.held += dep;
        self.purses.insert(&token_id, &p);
        log!("EVENT_JSON:{{\"standard\":\"nearcarta_deed\",\"version\":\"1.0.0\",\"event\":\"house_fund\",\"data\":[{{\"token_id\":\"{}\",\"from\":\"{}\",\"amount\":\"{}\"}}]}}", token_id, env::predecessor_account_id(), dep);
        p.balance
    }

    /// Pay from the house purse. Only the deed's CURRENT owner, with exactly 1 yocto (full wallet approval),
    /// and never above the deed's cap or the purse balance.
    #[payable]
    pub fn house_pay(&mut self, token_id: TokenId, receiver_id: AccountId, amount: U128) -> Promise {
        assert_one_yocto();
        let owner = self.tokens.owner_by_id.get(&token_id).unwrap_or_else(|| env::panic_str("no such deed"));
        require!(env::predecessor_account_id() == owner, "only the deed holder may spend from this house");
        let mut p = self.purses.get(&token_id).unwrap();
        require!(amount.0 > 0, "amount must be above 0");
        require!(amount.0 <= p.cap.0, "over the deed's cap per payment");
        require!(amount.0 <= p.balance.0, "the house purse is too small");
        p.balance = U128(p.balance.0 - amount.0);
        self.held -= amount.0;
        self.purses.insert(&token_id, &p);
        Promise::new(receiver_id.clone()).transfer(NearToken::from_yoctonear(amount.0)).then(
            Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(5)).on_house_pay(token_id, receiver_id, amount))
    }

    #[private]
    pub fn on_house_pay(&mut self, token_id: TokenId, receiver_id: AccountId, amount: U128) -> bool {
        let mut p = self.purses.get(&token_id).unwrap();
        let ok = matches!(env::promise_result_checked(0, 0), Ok(_));
        if ok {
            p.paid = U128(p.paid.0 + amount.0); p.pays += 1;
            log!("EVENT_JSON:{{\"standard\":\"nearcarta_deed\",\"version\":\"1.0.0\",\"event\":\"house_pay\",\"data\":[{{\"token_id\":\"{}\",\"to\":\"{}\",\"amount\":\"{}\"}}]}}", token_id, receiver_id, amount.0);
        } else {
            p.balance = U128(p.balance.0 + amount.0); // the transfer bounced: the purse gets it back
            self.held += amount.0;
        }
        self.purses.insert(&token_id, &p);
        ok
    }

    /// Lower the cap at once (only the holder, 1 yocto). Raising it is not possible: a new holder gets the rule as sold.
    #[payable]
    pub fn house_lower_cap(&mut self, token_id: TokenId, cap: U128) {
        assert_one_yocto();
        let owner = self.tokens.owner_by_id.get(&token_id).unwrap_or_else(|| env::panic_str("no such deed"));
        require!(env::predecessor_account_id() == owner, "only the deed holder may change the rule");
        let mut p = self.purses.get(&token_id).unwrap();
        require!(cap.0 > 0 && cap.0 <= p.cap.0, "the cap can only go down");
        p.cap = cap; self.purses.insert(&token_id, &p);
    }

    /// NEAR held for deed holders across all purses (user money).
    pub fn house_held(&self) -> U128 { U128(self.held) }

    /// Teardown: the deployer (1 yocto, full-access key) deletes this account and takes back the storage
    /// stake, but only once every purse is empty, so no holder's NEAR can ever be taken.
    #[payable]
    pub fn close(&mut self) -> Promise {
        assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner, "only the deployer may close");
        require!(self.held == 0, "purses still hold NEAR: holders must spend it first");
        Promise::new(env::current_account_id()).delete_account(self.owner.clone())
    }

    pub fn house_purse(&self, token_id: TokenId) -> Option<Purse> { self.purses.get(&token_id) }

    /// The holder names heirs and guardians. One yocto, so a session key cannot call it.
    /// https://docs.near.org/protocol/accounts-contracts/access-keys
    #[payable]
    pub fn house_set_line(&mut self, token_id: TokenId, heirs: Vec<AccountId>, guardians: Vec<AccountId>, threshold: u32, period_ns: U64, wait_ns: U64) {
        assert_one_yocto();
        let owner = self.owner_of(&token_id);
        require!(env::predecessor_account_id() == owner, "only the deed holder");
        require!((1..=4).contains(&heirs.len()), "name one heir");
        require!((1..=4).contains(&guardians.len()), "name a guardian");
        require!(threshold >= 1 && (threshold as usize) <= guardians.len(), "threshold");
        require!(period_ns.0 >= MIN_WINDOW_NS && period_ns.0 <= MAX_WINDOW_NS, "window");
        require!(wait_ns.0 >= MIN_WINDOW_NS && wait_ns.0 <= MAX_WINDOW_NS, "window");
        require!(distinct(&heirs) && distinct(&guardians), "repeated name");
        require!(!heirs.contains(&owner) && !guardians.contains(&owner), "the owner is not an heir or a guardian");
        self.lines.insert(&token_id, &Line {
            heirs, guardians, threshold,
            last_check_in_ns: env::block_timestamp(),
            period_ns: period_ns.0, wait_ns: wait_ns.0,
            pending_ns: 0, approvals: Vec::new(), released: false,
        });
    }

    /// The holder is here. Clears a pending release.
    #[payable]
    pub fn house_check_in(&mut self, token_id: TokenId) {
        assert_one_yocto();
        let owner = self.owner_of(&token_id);
        require!(env::predecessor_account_id() == owner, "only the deed holder");
        let mut line = self.line_of(&token_id);
        require!(!line.released, "already released");
        line.last_check_in_ns = env::block_timestamp();
        line.pending_ns = 0;
        line.approvals.clear();
        self.lines.insert(&token_id, &line);
        log!("EVENT_JSON:{{\"standard\":\"nearcarta_deed\",\"version\":\"1.0.0\",\"event\":\"house_check_in\",\"data\":[{{\"token_id\":\"{}\"}}]}}", token_id);
    }

    /// The holder stops a release that has not finished. The check-in clock stays where it was.
    #[payable]
    pub fn house_cancel_release(&mut self, token_id: TokenId) {
        assert_one_yocto();
        let owner = self.owner_of(&token_id);
        require!(env::predecessor_account_id() == owner, "only the deed holder");
        let mut line = self.line_of(&token_id);
        require!(line.pending_ns > 0, "no release is waiting");
        line.pending_ns = 0;
        line.approvals.clear();
        self.lines.insert(&token_id, &line);
    }

    /// A named guardian, after the check-in window. Threshold starts the wait.
    #[payable]
    pub fn house_guardian_approve(&mut self, token_id: TokenId) {
        assert_one_yocto();
        let who = env::predecessor_account_id();
        let mut line = self.line_of(&token_id);
        require!(!line.released, "already released");
        require!(line.guardians.contains(&who), "not a guardian");
        let now = env::block_timestamp();
        require!(now > line.last_check_in_ns.saturating_add(line.period_ns), "still inside the check-in window");
        if !line.approvals.contains(&who) { line.approvals.push(who); }
        if line.approvals.len() as u32 >= line.threshold && line.pending_ns == 0 { line.pending_ns = now; }
        self.lines.insert(&token_id, &line);
    }

    /// After the wait, the deed moves to the first heir. The purse stays on the token.
    #[payable]
    pub fn house_release(&mut self, token_id: TokenId) {
        assert_one_yocto();
        let mut line = self.line_of(&token_id);
        require!(!line.released, "already released");
        require!(line.pending_ns > 0, "no release is waiting");
        require!(line.approvals.len() as u32 >= line.threshold, "not enough guardians");
        let now = env::block_timestamp();
        require!(now >= line.pending_ns.saturating_add(line.wait_ns), "the waiting period has not ended");
        let owner = self.owner_of(&token_id);
        let heir = line.heirs[0].clone();
        require!(heir != owner, "the heir already holds the deed");
        self.tokens.internal_transfer(&owner, &heir, &token_id, None, Some("inheritance release".into()));
        line.released = true;
        line.pending_ns = 0;
        self.lines.insert(&token_id, &line);
        log!("EVENT_JSON:{{\"standard\":\"nearcarta_deed\",\"version\":\"1.0.0\",\"event\":\"house_release\",\"data\":[{{\"token_id\":\"{}\",\"to\":\"{}\"}}]}}", token_id, heir);
    }

    pub fn house_line(&self, token_id: TokenId) -> Option<Line> { self.lines.get(&token_id) }

    fn owner_of(&self, token_id: &TokenId) -> AccountId {
        self.tokens.owner_by_id.get(token_id).unwrap_or_else(|| env::panic_str("no such deed"))
    }

    fn line_of(&self, token_id: &TokenId) -> Line {
        self.lines.get(token_id).unwrap_or_else(|| env::panic_str("no inheritance line"))
    }
}

fn distinct(ids: &[AccountId]) -> bool {
    let mut seen = std::collections::BTreeSet::new();
    ids.iter().all(|id| seen.insert(id))
}

#[near]
impl NonFungibleTokenCore for Contract {
    #[payable]
    fn nft_transfer(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>) {
        self.tokens.nft_transfer(receiver_id, token_id, approval_id, memo)
    }
    #[payable]
    fn nft_transfer_call(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>, msg: String) -> PromiseOrValue<bool> {
        self.tokens.nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }
    fn nft_token(&self, token_id: TokenId) -> Option<Token> { self.tokens.nft_token(token_id) }
}

#[near]
impl NonFungibleTokenResolver for Contract {
    #[private]
    fn nft_resolve_transfer(&mut self, previous_owner_id: AccountId, receiver_id: AccountId, token_id: TokenId, approved_account_ids: Option<HashMap<AccountId, u64>>) -> bool {
        self.tokens.nft_resolve_transfer(previous_owner_id, receiver_id, token_id, approved_account_ids)
    }
}

#[near]
impl NonFungibleTokenApproval for Contract {
    #[payable]
    fn nft_approve(&mut self, token_id: TokenId, account_id: AccountId, msg: Option<String>) -> Option<Promise> {
        self.tokens.nft_approve(token_id, account_id, msg)
    }
    #[payable]
    fn nft_revoke(&mut self, token_id: TokenId, account_id: AccountId) { self.tokens.nft_revoke(token_id, account_id) }
    #[payable]
    fn nft_revoke_all(&mut self, token_id: TokenId) { self.tokens.nft_revoke_all(token_id) }
    fn nft_is_approved(&self, token_id: TokenId, approved_account_id: AccountId, approval_id: Option<u64>) -> bool {
        self.tokens.nft_is_approved(token_id, approved_account_id, approval_id)
    }
}

#[near]
impl NonFungibleTokenEnumeration for Contract {
    fn nft_total_supply(&self) -> U128 { self.tokens.nft_total_supply() }
    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> { self.tokens.nft_tokens(from_index, limit) }
    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 { self.tokens.nft_supply_for_owner(account_id) }
    fn nft_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens.nft_tokens_for_owner(account_id, from_index, limit)
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for Contract {
    fn nft_metadata(&self) -> NFTContractMetadata { self.metadata.get().unwrap() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn ctx(who: usize, deposit: u128) {
        testing_env!(VMContextBuilder::new().current_account_id("deeds.near".parse().unwrap())
            .predecessor_account_id(accounts(who)).attached_deposit(NearToken::from_yoctonear(deposit)).build());
    }

    #[test]
    fn mint_own_deed_sets_owner_and_metadata() {
        ctx(0, 0); let mut c = Contract::new(None);
        ctx(1, 2 * 10u128.pow(22));
        let t = c.mint_deed(Some("r11house-31474.near".parse().unwrap()), None);
        assert_eq!(t.token_id, accounts(1).to_string());
        assert_eq!(t.owner_id, accounts(1));
        let m = t.metadata.unwrap();
        assert_eq!(m.title.unwrap(), format!("House of {}", accounts(1)));
        assert!(m.description.unwrap().starts_with("Charter: r11house-31474.near"));
        assert_eq!(c.nft_total_supply().0, 1);
        assert_eq!(c.nft_metadata().spec, NFT_METADATA_SPEC);
    }

    #[test]
    #[should_panic(expected = "this account already has a deed")]
    fn second_deed_for_same_account_is_refused() {
        ctx(0, 0); let mut c = Contract::new(None);
        ctx(1, 2 * 10u128.pow(22)); c.mint_deed(None, None);
        ctx(1, 2 * 10u128.pow(22)); c.mint_deed(None, None);
    }

    fn yocto(who: usize, deposit: u128) { ctx(who, deposit) }

    #[test]
    fn holder_pays_under_cap_and_purse_moves_with_the_deed() {
        ctx(0, 0); let mut c = Contract::new(None);
        let id = accounts(1).to_string();
        ctx(1, 10u128.pow(24)); c.mint_deed(None, Some(U128(10u128.pow(23))));
        assert_eq!(c.house_purse(id.clone()).unwrap().balance.0, 10u128.pow(24) - 2 * 10u128.pow(22));
        yocto(1, 1); let _ = c.house_pay(id.clone(), accounts(4), U128(5 * 10u128.pow(22)));
        assert_eq!(c.house_purse(id.clone()).unwrap().balance.0, 10u128.pow(24) - 2 * 10u128.pow(22) - 5 * 10u128.pow(22));
        yocto(1, 1); c.nft_transfer(accounts(2), id.clone(), None, None);
        yocto(2, 1); let _ = c.house_pay(id.clone(), accounts(4), U128(10u128.pow(22)));
    }

    #[test]
    #[should_panic(expected = "only the deed holder")]
    fn old_owner_refused_after_transfer() {
        ctx(0, 0); let mut c = Contract::new(None);
        let id = accounts(1).to_string();
        ctx(1, 10u128.pow(24)); c.mint_deed(None, None);
        yocto(1, 1); c.nft_transfer(accounts(2), id.clone(), None, None);
        yocto(1, 1); let _ = c.house_pay(id, accounts(4), U128(10u128.pow(22)));
    }

    #[test]
    #[should_panic(expected = "over the deed's cap")]
    fn over_cap_refused() {
        ctx(0, 0); let mut c = Contract::new(None);
        ctx(1, 10u128.pow(24)); c.mint_deed(None, Some(U128(10u128.pow(22))));
        yocto(1, 1); let _ = c.house_pay(accounts(1).to_string(), accounts(4), U128(2 * 10u128.pow(22)));
    }

    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn pay_without_one_yocto_refused() {
        ctx(0, 0); let mut c = Contract::new(None);
        ctx(1, 10u128.pow(24)); c.mint_deed(None, None);
        ctx(1, 0); let _ = c.house_pay(accounts(1).to_string(), accounts(4), U128(10u128.pow(22)));
    }

    #[test]
    fn anyone_funds_and_cap_only_goes_down() {
        ctx(0, 0); let mut c = Contract::new(None);
        let id = accounts(1).to_string();
        ctx(1, 2 * 10u128.pow(22)); c.mint_deed(None, None);
        ctx(3, 10u128.pow(23)); assert_eq!(c.house_fund(id.clone()).0, 10u128.pow(23));
        yocto(1, 1); c.house_lower_cap(id.clone(), U128(10u128.pow(22)));
        assert_eq!(c.house_purse(id).unwrap().cap.0, 10u128.pow(22));
    }

    #[test]
    #[should_panic(expected = "attach at least 0.02 NEAR")]
    fn mint_without_deposit_is_refused() {
        ctx(0, 0); let mut c = Contract::new(None);
        ctx(1, 0); c.mint_deed(None, None);
    }

    #[test]
    fn deed_transfers_by_owner_only_with_one_yocto() {
        ctx(0, 0); let mut c = Contract::new(None);
        ctx(1, 2 * 10u128.pow(22)); c.mint_deed(None, None);
        ctx(1, 1); c.nft_transfer(accounts(2), accounts(1).to_string(), None, None);
        assert_eq!(c.nft_token(accounts(1).to_string()).unwrap().owner_id, accounts(2));
        assert_eq!(c.nft_supply_for_owner(accounts(2)).0, 1);
    }

    #[test]
    #[should_panic]
    fn stranger_cannot_transfer_a_deed() {
        ctx(0, 0); let mut c = Contract::new(None);
        ctx(1, 2 * 10u128.pow(22)); c.mint_deed(None, None);
        ctx(3, 1); c.nft_transfer(accounts(3), accounts(1).to_string(), None, None);
    }
    // The deed is sold while a payout is in flight (house_pay sent the transfer; on_house_pay has not run yet).
    fn callback(ok: bool) {
        testing_env!(VMContextBuilder::new().current_account_id("deeds.near".parse().unwrap())
            .predecessor_account_id("deeds.near".parse().unwrap()).build(),
            near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(),
            vec![if ok { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed }]);
    }
    const PAY: u128 = 5 * 10u128.pow(22);

    #[test]
    fn deed_sold_mid_payout_settles_once_and_the_new_holder_keeps_the_purse() {
        ctx(0, 0); let mut c = Contract::new(None);
        let id = accounts(1).to_string();
        ctx(1, 10u128.pow(24)); c.mint_deed(None, Some(U128(10u128.pow(23))));
        let start = c.house_purse(id.clone()).unwrap().balance.0;
        yocto(1, 1); let _ = c.house_pay(id.clone(), accounts(4), U128(PAY));
        yocto(1, 1); c.nft_transfer(accounts(2), id.clone(), None, None); // sold before the callback lands
        callback(true); assert!(c.on_house_pay(id.clone(), accounts(4), U128(PAY)));
        let p = c.house_purse(id.clone()).unwrap();
        assert_eq!(p.balance.0, start - PAY); assert_eq!(p.paid.0, PAY); assert_eq!(p.pays, 1);
        assert_eq!(c.nft_token(id.clone()).unwrap().owner_id, accounts(2));
        // the buyer spends the rest of the purse under the same cap
        yocto(2, 1); let _ = c.house_pay(id.clone(), accounts(4), U128(PAY));
        assert_eq!(c.house_purse(id).unwrap().balance.0, start - 2 * PAY);
    }

    #[test]
    fn deed_sold_mid_payout_bounce_refunds_the_purse_not_the_seller() {
        ctx(0, 0); let mut c = Contract::new(None);
        let id = accounts(1).to_string();
        ctx(1, 10u128.pow(24)); c.mint_deed(None, Some(U128(10u128.pow(23))));
        let start = c.house_purse(id.clone()).unwrap().balance.0;
        yocto(1, 1); let _ = c.house_pay(id.clone(), accounts(4), U128(PAY));
        yocto(1, 1); c.nft_transfer(accounts(2), id.clone(), None, None);
        callback(false); assert!(!c.on_house_pay(id.clone(), accounts(4), U128(PAY)));
        let p = c.house_purse(id.clone()).unwrap();
        assert_eq!(p.balance.0, start); assert_eq!(p.paid.0, 0); assert_eq!(p.pays, 0); // back in the deed's purse, which the buyer now holds
    }

    #[test]
    #[should_panic(expected = "only the deed holder")]
    fn seller_cannot_pay_again_while_the_first_payout_is_in_flight() {
        ctx(0, 0); let mut c = Contract::new(None);
        let id = accounts(1).to_string();
        ctx(1, 10u128.pow(24)); c.mint_deed(None, Some(U128(10u128.pow(23))));
        yocto(1, 1); let _ = c.house_pay(id.clone(), accounts(4), U128(PAY));
        yocto(1, 1); c.nft_transfer(accounts(2), id.clone(), None, None);
        yocto(1, 1); let _ = c.house_pay(id, accounts(4), U128(PAY));
    }

    #[test]
    #[should_panic(expected = "purses still hold NEAR")]
    fn close_refused_while_a_purse_holds_user_near() {
        ctx(0, 0); let mut c = Contract::new(None);
        ctx(1, 3 * 10u128.pow(22)); c.mint_deed(None, None);
        assert_eq!(c.house_held().0, 10u128.pow(22));
        ctx(0, 1); let _ = c.close();
    }

    #[test]
    #[should_panic(expected = "only the deployer may close")]
    fn stranger_cannot_close() {
        ctx(0, 0); let mut c = Contract::new(None);
        ctx(2, 1); let _ = c.close();
    }

    #[test]
    fn deployer_closes_when_every_purse_is_empty() {
        ctx(0, 0); let mut c = Contract::new(None);
        ctx(1, 2 * 10u128.pow(22)); c.mint_deed(None, None);
        assert_eq!(c.house_held().0, 0);
        ctx(0, 1); let _ = c.close();
    }

    const SEC: u64 = 1_000_000_000;
    fn at(who: usize, deposit: u128, ts: u64) {
        testing_env!(VMContextBuilder::new().current_account_id("deeds.near".parse().unwrap())
            .predecessor_account_id(accounts(who)).attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(ts).build());
    }
    fn fresh() -> (Contract, String) {
        ctx(0, 0);
        let mut c = Contract::new(None);
        let id = accounts(1).to_string();
        at(1, 2 * 10u128.pow(22), SEC);
        c.mint_deed(None, None);
        at(1, 1, 2 * SEC);
        c.house_set_line(id.clone(), vec![accounts(4)], vec![accounts(3)], 1, U64(60 * SEC), U64(60 * SEC));
        (c, id)
    }

    #[test]
    #[should_panic(expected = "still inside the check-in window")]
    fn guardian_during_the_window_is_refused() {
        let (mut c, id) = fresh();
        at(3, 1, 30 * SEC);
        c.house_guardian_approve(id);
    }

    #[test]
    #[should_panic(expected = "not a guardian")]
    fn a_stranger_cannot_approve_a_release() {
        let (mut c, id) = fresh();
        at(5, 1, 70 * SEC);
        c.house_guardian_approve(id);
    }

    #[test]
    #[should_panic(expected = "the waiting period has not ended")]
    fn release_during_the_wait_is_refused() {
        let (mut c, id) = fresh();
        at(3, 1, 70 * SEC);
        c.house_guardian_approve(id.clone());
        at(2, 1, 80 * SEC);
        c.house_release(id);
    }

    #[test]
    #[should_panic(expected = "no release is waiting")]
    fn a_cancelled_release_cannot_be_executed() {
        let (mut c, id) = fresh();
        at(3, 1, 70 * SEC);
        c.house_guardian_approve(id.clone());
        at(1, 1, 80 * SEC);
        c.house_cancel_release(id.clone());
        at(2, 1, 200 * SEC);
        c.house_release(id);
    }

    #[test]
    #[should_panic(expected = "still inside the check-in window")]
    fn check_in_restarts_the_window() {
        let (mut c, id) = fresh();
        at(3, 1, 70 * SEC);
        c.house_guardian_approve(id.clone());
        at(1, 1, 80 * SEC);
        c.house_check_in(id.clone());
        at(3, 1, 100 * SEC);
        c.house_guardian_approve(id);
    }

    #[test]
    fn one_guardian_does_not_start_the_wait_when_two_are_required() {
        ctx(0, 0); let mut c = Contract::new(None);
        let id = accounts(1).to_string();
        at(1, 2 * 10u128.pow(22), SEC);
        c.mint_deed(None, None);
        at(1, 1, 2 * SEC);
        c.house_set_line(id.clone(), vec![accounts(4)], vec![accounts(3), accounts(5)], 2, U64(60 * SEC), U64(60 * SEC));
        at(3, 1, 70 * SEC);
        c.house_guardian_approve(id.clone());
        assert_eq!(c.house_line(id).unwrap().pending_ns, 0);
    }

    #[test]
    fn release_after_the_wait_moves_the_deed() {
        let (mut c, id) = fresh();
        at(3, 1, 70 * SEC);
        c.house_guardian_approve(id.clone());
        let started = c.house_line(id.clone()).unwrap().pending_ns;
        at(2, 1, started + 60 * SEC);
        c.house_release(id.clone());
        assert_eq!(c.nft_token(id.clone()).unwrap().owner_id, accounts(4));
        assert!(c.house_line(id).unwrap().released);
    }

    #[test]
    #[should_panic(expected = "only the deed holder")]
    fn the_previous_holder_cannot_pay_after_release() {
        let (mut c, id) = fresh();
        at(3, 1, 70 * SEC);
        c.house_guardian_approve(id.clone());
        let started = c.house_line(id.clone()).unwrap().pending_ns;
        at(2, 1, started + 60 * SEC);
        c.house_release(id.clone());
        at(1, 1, started + 61 * SEC);
        let _ = c.house_pay(id, accounts(4), U128(10u128.pow(21)));
    }

    #[test]
    fn close_still_returns_when_the_purse_is_empty_even_with_a_line() {
        let (mut c, _) = fresh();
        assert_eq!(c.house_held().0, 0);
        at(0, 1, 10 * SEC);
        let _ = c.close();
    }
}
