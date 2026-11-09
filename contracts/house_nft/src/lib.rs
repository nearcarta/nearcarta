//! House deed v2: a NEP-171 NFT (NEP-177 metadata, NEP-178 approvals, NEP-181 enumeration) that IS the house.
//! Each deed carries a purse of NEAR held by this contract and one spending rule (a cap per payment).
//! Whoever holds the deed controls the purse: `house_pay` is allowed only for the current owner, needs 1 yocto
//! (a full wallet approval, never a function-call key) and stays under the deed's cap. Transfer the deed and the
//! purse and the rule move with it; the old owner is refused from then on. Anyone may `house_fund` a deed.
//! Any account may mint one deed (token_id = minter account id). The deployer may upgrade, then migrate.
//! The recorded shop has no access key. A successor account is created outside this contract.
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
    pub last_check_in_ns: U64,
    pub period_ns: U64,
    pub wait_ns: U64,
    pub pending_ns: U64,
    pub approvals: Vec<AccountId>,
    pub released: bool,
}

/// Shortest check-in or cancel window: 60 seconds. Longest: 366 days.
const MIN_WINDOW_NS: u64 = 60 * 1_000_000_000;
const MAX_WINDOW_NS: u64 = 366 * 24 * 60 * 60 * 1_000_000_000;

#[derive(BorshStorageKey)]
#[near]
enum Key { Owner, Meta, Enum, Approval, ContractMeta, Purse, Line, Epoch, Vault, Prepared, Seen }

/// A foreign vault bound to the deed, not to the current holder.
/// The path stays put when the deed moves, so an heir reaches the same address.
/// Toll owns the signer. This record does not sign or broadcast.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Vault {
    pub chain: String,
    pub path: String,
    pub asset: String,
    pub max_value: U128,
    pub max_gas: u64,
    pub receivers: Vec<String>,
    pub funded: bool,
}

/// A send the contract checked and did not broadcast.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct PreparedSend {
    pub action_id: String,
    pub chain: String,
    pub to: String,
    pub asset: String,
    pub value: U128,
    pub gas_limit: u64,
    pub epoch: u64,
    pub live: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    tokens: NonFungibleToken,
    metadata: LazyOption<NFTContractMetadata>,
    purses: LookupMap<TokenId, Purse>,
    /// Inheritance line per deed. Absent until the holder calls house_set_line.
    lines: LookupMap<TokenId, Line>,
    /// Bumps when the deed moves. An in-flight pay from the previous epoch is refunded.
    epochs: LookupMap<TokenId, u64>,
    /// One foreign vault per deed. The path is the deed id, not the current holder.
    vaults: LookupMap<TokenId, Vault>,
    /// Last checked send. `live` stays false until a Toll signer exists.
    prepared: LookupMap<TokenId, PreparedSend>,
    /// Action ids already applied, so a repeated click does not pay twice.
    seen: LookupMap<String, u8>,
    /// The deployer: may only close or upgrade the contract, and only while no purse holds NEAR.
    owner: AccountId,
    /// Board that may act for a row. The row owner is an argument, never the predecessor.
    board: AccountId,
    /// Sum of every purse balance (user money); close() refuses while it is above 0.
    held: u128,
    /// Vaults the holder has marked as holding foreign value. Close refuses while this is above 0.
    foreign_open: u32,
    version: u32,
}

/// Storage the minter pays for: the token, its metadata and the purse (about 1 KB; 0.02 NEAR covers it).
const MINT_STORAGE: NearToken = NearToken::from_millinear(20);

/// Every write that adds bytes must leave the purses payable. Purse NEAR (`held`) sits in the same
/// balance the storage stake comes from, so a holder who could add bytes for free (a payment's
/// `seen` id, a long vault payee) could stake other holders' purses away until a payout failed.
fn check_float(held: u128) {
    let stake = env::storage_usage() as u128 * env::storage_byte_cost().as_yoctonear();
    require!(env::account_balance().as_yoctonear() >= stake.saturating_add(held), "ERR_FLOAT");
}
const MAX_CAP: u128 = 10u128.pow(24) * 5; // 5 NEAR per payment at most

#[near]
impl Contract {
    #[init]
    /// `owner`: who may close the contract (all its NEAR goes there); defaults to the caller.
    pub fn new(owner: Option<AccountId>) -> Self {
        let metadata = NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "Nearcarta House deeds v3".to_string(),
            symbol: "DEED".to_string(),
            icon: None, base_uri: None, reference: None, reference_hash: None,
        };
        Self {
            tokens: NonFungibleToken::new(Key::Owner, env::current_account_id(), Some(Key::Meta), Some(Key::Enum), Some(Key::Approval)),
            metadata: LazyOption::new(Key::ContractMeta, Some(&metadata)),
            purses: LookupMap::new(Key::Purse),
            lines: LookupMap::new(Key::Line),
            epochs: LookupMap::new(Key::Epoch),
            vaults: LookupMap::new(Key::Vault),
            prepared: LookupMap::new(Key::Prepared),
            seen: LookupMap::new(Key::Seen),
            owner: owner.unwrap_or_else(env::predecessor_account_id),
            board: "board.nearcarta.near".parse().unwrap(),
            held: 0,
            foreign_open: 0,
            version: 3,
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
        check_float(self.held);
        let epoch = self.epochs.get(&token_id).unwrap_or(0);
        Promise::new(receiver_id.clone()).transfer(NearToken::from_yoctonear(amount.0)).then(
            Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(5)).on_house_pay(token_id, receiver_id, amount, epoch))
    }

    #[private]
    pub fn on_house_pay(&mut self, token_id: TokenId, receiver_id: AccountId, amount: U128, epoch: u64) -> bool {
        let mut p = self.purses.get(&token_id).unwrap();
        // The epoch only labels the event. A transfer that landed is paid, even if the deed moved
        // while it was in flight: crediting it back here would hand the purse NEAR it no longer has.
        let moved = self.epochs.get(&token_id).unwrap_or(0) != epoch;
        let ok = matches!(env::promise_result_checked(0, 0), Ok(_));
        if moved { log!("house_pay landed after the deed moved (epoch {})", epoch); }
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
        require!(self.foreign_open == 0, "a foreign vault still holds value");
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
            last_check_in_ns: U64(env::block_timestamp()),
            period_ns, wait_ns,
            pending_ns: U64(0), approvals: Vec::new(), released: false,
        });
        check_float(self.held);
    }

    /// The holder is here. Clears a pending release.
    #[payable]
    pub fn house_check_in(&mut self, token_id: TokenId) {
        assert_one_yocto();
        let owner = self.owner_of(&token_id);
        require!(env::predecessor_account_id() == owner, "only the deed holder");
        let mut line = self.line_of(&token_id);
        require!(!line.released, "already released");
        line.last_check_in_ns = U64(env::block_timestamp());
        line.pending_ns = U64(0);
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
        require!(line.pending_ns.0 > 0, "no release is waiting");
        line.pending_ns = U64(0);
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
        require!(now > line.last_check_in_ns.0.saturating_add(line.period_ns.0), "still inside the check-in window");
        if !line.approvals.contains(&who) { line.approvals.push(who); }
        if line.approvals.len() as u32 >= line.threshold && line.pending_ns.0 == 0 { line.pending_ns = U64(now); }
        self.lines.insert(&token_id, &line);
        check_float(self.held);
    }

    /// After the wait, the deed moves to the first heir. The purse stays on the token.
    #[payable]
    pub fn house_release(&mut self, token_id: TokenId) {
        assert_one_yocto();
        let mut line = self.line_of(&token_id);
        require!(!line.released, "already released");
        require!(line.pending_ns.0 > 0, "no release is waiting");
        require!(line.approvals.len() as u32 >= line.threshold, "not enough guardians");
        let now = env::block_timestamp();
        require!(now >= line.pending_ns.0.saturating_add(line.wait_ns.0), "the waiting period has not ended");
        let owner = self.owner_of(&token_id);
        let heir = line.heirs[0].clone();
        require!(heir != owner, "the heir already holds the deed");
        self.tokens.internal_transfer(&owner, &heir, &token_id, None, Some("inheritance release".into()));
        let epoch = self.epochs.get(&token_id).unwrap_or(0).saturating_add(1);
        self.epochs.insert(&token_id, &epoch);
        line.released = true;
        line.pending_ns = U64(0);
        self.lines.insert(&token_id, &line);
        log!("EVENT_JSON:{{\"standard\":\"nearcarta_deed\",\"version\":\"1.0.0\",\"event\":\"house_release\",\"data\":[{{\"token_id\":\"{}\",\"to\":\"{}\"}}]}}", token_id, heir);
    }

    pub fn house_line(&self, token_id: TokenId) -> Option<Line> { self.lines.get(&token_id) }

    pub fn house_epoch(&self, token_id: TokenId) -> u64 { self.epochs.get(&token_id).unwrap_or(0) }

    pub fn house_vault(&self, token_id: TokenId) -> Option<Vault> { self.vaults.get(&token_id) }

    pub fn house_prepared(&self, token_id: TokenId) -> Option<PreparedSend> { self.prepared.get(&token_id) }

    /// The board acts for `row_owner`. The predecessor is the board, never the holder.
    /// https://docs.near.org/chain-abstraction/chain-signatures/tutorials/controlling-near-accounts/1-setup
    #[payable]
    pub fn house_session_mint(&mut self, row_owner: AccountId, cap: Option<U128>) -> Token {
        self.require_board();
        self.mint_for(row_owner, None, cap)
    }

    /// `row_owner` is the top-level argument the board writes. A nested `row_owner` is not a field here.
    #[payable]
    pub fn house_session_check_in(&mut self, row_owner: AccountId, token_id: TokenId) {
        self.require_board();
        self.require_holder(&token_id, &row_owner);
        self.credit_attached(&token_id);
        self.check_in_holder(&token_id);
    }

    /// A session may set a line, or tighten one. Changing heirs or loosening the wait needs the holder's own key.
    #[payable]
    pub fn house_session_set_line(&mut self, row_owner: AccountId, token_id: TokenId, heirs: Vec<AccountId>, guardians: Vec<AccountId>, threshold: u32, period_ns: U64, wait_ns: U64) {
        self.require_board();
        self.require_holder(&token_id, &row_owner);
        self.credit_attached(&token_id);
        if let Some(prev) = self.lines.get(&token_id) {
            require!(prev.heirs == heirs && prev.guardians == guardians, "owner intent required");
            require!(threshold >= prev.threshold, "owner intent required");
            require!(period_ns.0 <= prev.period_ns.0 && wait_ns.0 <= prev.wait_ns.0, "owner intent required");
        }
        self.write_line(&token_id, &row_owner, heirs, guardians, threshold, period_ns, wait_ns);
    }

    /// Purse payment for the row owner. Repeating `action_id` does not pay again.
    #[payable]
    pub fn house_session_pay(&mut self, row_owner: AccountId, token_id: TokenId, receiver_id: AccountId, amount: U128, action_id: String) -> Promise {
        self.require_board();
        self.require_holder(&token_id, &row_owner);
        self.credit_attached(&token_id);
        self.pay_from_purse(token_id, receiver_id, amount, action_id)
    }

    /// Check a foreign send. This does not call the signer and does not broadcast.
    /// Bitcoin with a value is refused: signing-only until a real spend exists.
    #[payable]
    pub fn house_session_prepare_send(&mut self, row_owner: AccountId, token_id: TokenId, chain: String, to: String, asset: String, value: U128, gas_limit: u64, action_id: String) -> PreparedSend {
        self.require_board();
        self.require_holder(&token_id, &row_owner);
        self.credit_attached(&token_id);
        self.prepare_send(&token_id, chain, to, asset, value.0, gas_limit, action_id)
    }

    /// The holder's own key. One yocto, so a session cannot call it. This is the owner-intent path.
    #[payable]
    pub fn house_set_vault(&mut self, token_id: TokenId, chain: String, asset: String, max_value: U128, max_gas: u64, receivers: Vec<String>) {
        assert_one_yocto();
        let owner = self.owner_of(&token_id);
        require!(env::predecessor_account_id() == owner, "only the deed holder");
        require!(receivers.len() >= 1 && receivers.len() <= 4, "name a payee");
        require!(receivers.iter().all(|r| !r.is_empty() && r.len() <= 100), "payee");
        require!(!asset.is_empty() && asset.len() <= 16, "asset");
        require!(max_value.0 > 0, "cap must be above 0");
        let path = format!("{token_id}-{chain}-1");
        let chain_l = chain.to_lowercase();
        require!(chain_l == "base" || chain_l == "btc", "chain");
        if chain_l == "btc" { require!(asset.to_uppercase() == "BTC", "bitcoin asset"); }
        self.vaults.insert(&token_id, &Vault {
            chain: chain_l, path, asset: asset.to_uppercase(), max_value, max_gas, receivers, funded: false,
        });
        check_float(self.held);
    }

    /// The holder says this vault holds value. Close stays shut until the deployer records an evacuation.
    #[payable]
    pub fn house_mark_funded(&mut self, token_id: TokenId) {
        assert_one_yocto();
        let owner = self.owner_of(&token_id);
        require!(env::predecessor_account_id() == owner, "only the deed holder");
        let mut vault = self.vaults.get(&token_id).unwrap_or_else(|| env::panic_str("no vault"));
        if !vault.funded {
            vault.funded = true;
            self.foreign_open = self.foreign_open.saturating_add(1);
            self.vaults.insert(&token_id, &vault);
        }
    }

    /// Deployer only, after the foreign coins have left the path.
    #[payable]
    pub fn house_declare_evacuated(&mut self, token_id: TokenId) {
        assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner, "only the deployer may clear a vault");
        let mut vault = self.vaults.get(&token_id).unwrap_or_else(|| env::panic_str("no vault"));
        if vault.funded {
            vault.funded = false;
            self.foreign_open = self.foreign_open.saturating_sub(1);
            self.vaults.insert(&token_id, &vault);
        }
    }

    /// Return the purse to the current holder. Not a payment to a stranger, and not a way to skip a funded vault.
    #[payable]
    pub fn house_withdraw(&mut self, token_id: TokenId) -> Promise {
        assert_one_yocto();
        let owner = self.owner_of(&token_id);
        require!(env::predecessor_account_id() == owner, "only the deed holder");
        let mut p = self.purses.get(&token_id).unwrap();
        let amount = p.balance.0;
        require!(amount > 0, "the purse is empty");
        p.balance = U128(0);
        self.held -= amount;
        self.purses.insert(&token_id, &p);
        Promise::new(owner).transfer(NearToken::from_yoctonear(amount))
    }

    /// The deployer replaces the code. State stays for `migrate`.
    /// https://docs.near.org/smart-contracts/release/upgrade#migrating-the-state
    #[payable]
    pub fn upgrade(&mut self) -> Promise {
        assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner, "only the deployer may upgrade");
        let code = env::input().unwrap_or_else(|| env::panic_str("empty code"));
        Promise::new(env::current_account_id()).deploy_contract(code).then(
            Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(5)).migrate())
    }

    #[private]
    pub fn migrate(&mut self) {
        self.version = 3;
    }

    /// Read the live v2 state, send each purse to its current deed holder, then keep the deeds.
    /// The new maps start empty. Call this in the same transaction as the code deploy.
    #[init(ignore_state)]
    pub fn migrate_from_v2() -> Self {
        require!(env::predecessor_account_id() == env::current_account_id(), "only the contract may migrate");
        let mut old: OldHouse = env::state_read().unwrap_or_else(|| env::panic_str("old house state"));
        let supply = old.tokens.nft_total_supply().0;
        let tokens = if supply == 0 { Vec::new() } else { old.tokens.nft_tokens(Some(U128(0)), Some(supply as u64)) };
        for t in &tokens {
            let Some(mut p) = old.purses.get(&t.token_id) else { continue; };
            if p.balance.0 == 0 { continue; }
            let _ = Promise::new(t.owner_id.clone()).transfer(NearToken::from_yoctonear(p.balance.0));
            p.balance = U128(0);
            old.purses.insert(&t.token_id, &p);
        }
        Self {
            tokens: old.tokens,
            metadata: old.metadata,
            purses: old.purses,
            lines: LookupMap::new(Key::Line),
            epochs: LookupMap::new(Key::Epoch),
            vaults: LookupMap::new(Key::Vault),
            prepared: LookupMap::new(Key::Prepared),
            seen: LookupMap::new(Key::Seen),
            owner: old.owner,
            board: "board.nearcarta.near".parse().unwrap(),
            held: 0,
            foreign_open: 0,
            version: 3,
        }
    }

    pub fn house_version(&self) -> u32 { self.version }

    /// NEAR attached by the board lands on this contract. Count it on the deed, so it is not loose storage.
    fn credit_attached(&mut self, token_id: &TokenId) {
        let dep = env::attached_deposit().as_yoctonear();
        if dep == 0 { return; }
        let mut p = self.purses.get(token_id).unwrap_or_else(|| env::panic_str("no such deed"));
        p.balance = U128(p.balance.0.checked_add(dep).expect("purse"));
        self.held = self.held.checked_add(dep).expect("held");
        self.purses.insert(token_id, &p);
    }

    fn require_board(&self) {
        require!(env::predecessor_account_id() == self.board, "only the board may act for a row");
    }

    fn require_holder(&self, token_id: &TokenId, actor: &AccountId) {
        require!(actor == &self.owner_of(token_id), "only the deed holder");
    }

    fn check_in_holder(&mut self, token_id: &TokenId) {
        let mut line = self.line_of(token_id);
        require!(!line.released, "already released");
        line.last_check_in_ns = U64(env::block_timestamp());
        line.pending_ns = U64(0);
        line.approvals.clear();
        self.lines.insert(token_id, &line);
    }

    fn write_line(&mut self, token_id: &TokenId, owner: &AccountId, heirs: Vec<AccountId>, guardians: Vec<AccountId>, threshold: u32, period_ns: U64, wait_ns: U64) {
        require!((1..=4).contains(&heirs.len()), "name one heir");
        require!((1..=4).contains(&guardians.len()), "name a guardian");
        require!(threshold >= 1 && (threshold as usize) <= guardians.len(), "threshold");
        require!(period_ns.0 >= MIN_WINDOW_NS && period_ns.0 <= MAX_WINDOW_NS, "window");
        require!(wait_ns.0 >= MIN_WINDOW_NS && wait_ns.0 <= MAX_WINDOW_NS, "window");
        require!(distinct(&heirs) && distinct(&guardians), "repeated name");
        require!(!heirs.contains(owner) && !guardians.contains(owner), "the owner is not an heir or a guardian");
        self.lines.insert(token_id, &Line {
            heirs, guardians, threshold,
            last_check_in_ns: U64(env::block_timestamp()),
            period_ns, wait_ns,
            pending_ns: U64(0), approvals: Vec::new(), released: false,
        });
        check_float(self.held);
    }

    fn pay_from_purse(&mut self, token_id: TokenId, receiver_id: AccountId, amount: U128, action_id: String) -> Promise {
        require!(!action_id.is_empty() && action_id.len() <= 80, "action");
        if self.seen.get(&action_id).is_some() {
            env::panic_str("already done");
        }
        self.seen.insert(&action_id, &1);
        let owner = self.owner_of(&token_id);
        require!(env::predecessor_account_id() == self.board || env::predecessor_account_id() == owner, "only the deed holder");
        let mut p = self.purses.get(&token_id).unwrap();
        require!(amount.0 > 0, "amount must be above 0");
        require!(amount.0 <= p.cap.0, "over the deed's cap per payment");
        require!(amount.0 <= p.balance.0, "the house purse is too small");
        p.balance = U128(p.balance.0 - amount.0);
        self.held -= amount.0;
        self.purses.insert(&token_id, &p);
        check_float(self.held);
        let epoch = self.epochs.get(&token_id).unwrap_or(0);
        Promise::new(receiver_id.clone()).transfer(NearToken::from_yoctonear(amount.0)).then(
            Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(5)).on_house_pay(token_id, receiver_id, amount, epoch))
    }

    fn prepare_send(&mut self, token_id: &TokenId, chain: String, to: String, asset: String, value: u128, gas_limit: u64, action_id: String) -> PreparedSend {
        require!(!action_id.is_empty() && action_id.len() <= 80, "action");
        if let Some(prev) = self.prepared.get(token_id) {
            if prev.action_id == action_id { return prev; }
        }
        let vault = self.vaults.get(token_id).unwrap_or_else(|| env::panic_str("no vault"));
        let chain_l = chain.to_lowercase();
        require!(chain_l == vault.chain, "chain");
        let asset_u = asset.to_uppercase();
        require!(asset_u == vault.asset, "asset");
        if chain_l == "btc" && value > 0 { env::panic_str("bitcoin is signing only"); }
        require!(value > 0 || chain_l == "btc", "amount must be above 0");
        require!(value <= vault.max_value.0, "over the vault cap");
        require!(gas_limit <= vault.max_gas, "gas");
        require!(vault.receivers.iter().any(|r| r.eq_ignore_ascii_case(&to)), "payee");
        let prepared = PreparedSend {
            action_id, chain: chain_l, to, asset: asset_u, value: U128(value), gas_limit,
            epoch: self.epochs.get(token_id).unwrap_or(0),
            live: false,
        };
        self.prepared.insert(token_id, &prepared);
        check_float(self.held);
        prepared
    }

    fn mint_for(&mut self, who: AccountId, house: Option<AccountId>, cap: Option<U128>) -> Token {
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
        let token = self.tokens.internal_mint(who.to_string(), who.clone(), Some(meta));
        let purse = dep - MINT_STORAGE.as_yoctonear();
        self.held += purse;
        self.purses.insert(&who.to_string(), &Purse { balance: U128(purse), cap: U128(cap), paid: U128(0), pays: 0, refused_note: None });
        self.epochs.insert(&who.to_string(), &0);
        token
    }

    /// A deed that changes hands drops the seller's inheritance line and checked send, and bumps the
    /// epoch. Otherwise the seller's guardians could release the sold deed to the seller's heir.
    fn on_sale(&mut self, token_id: &TokenId) {
        self.lines.remove(token_id);
        self.prepared.remove(token_id);
        let epoch = self.epochs.get(token_id).unwrap_or(0).saturating_add(1);
        self.epochs.insert(token_id, &epoch);
    }

    fn owner_of(&self, token_id: &TokenId) -> AccountId {
        self.tokens.owner_by_id.get(token_id).unwrap_or_else(|| env::panic_str("no such deed"))
    }

    fn line_of(&self, token_id: &TokenId) -> Line {
        self.lines.get(token_id).unwrap_or_else(|| env::panic_str("no inheritance line"))
    }
}

/// The account as it is on mainnet today: deed, purse, owner, held. No inheritance maps.
#[near(serializers = [borsh])]
struct OldHouse {
    tokens: NonFungibleToken,
    metadata: LazyOption<NFTContractMetadata>,
    purses: LookupMap<TokenId, Purse>,
    owner: AccountId,
    held: u128,
}

fn distinct(ids: &[AccountId]) -> bool {
    let mut seen = std::collections::BTreeSet::new();
    ids.iter().all(|id| seen.insert(id))
}

#[near]
impl NonFungibleTokenCore for Contract {
    #[payable]
    fn nft_transfer(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>) {
        self.tokens.nft_transfer(receiver_id, token_id.clone(), approval_id, memo);
        self.on_sale(&token_id);
    }
    #[payable]
    fn nft_transfer_call(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>, msg: String) -> PromiseOrValue<bool> {
        self.on_sale(&token_id);
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

    /// Each paid `action_id` stays in `seen`, and nothing pays for those bytes. Once only the
    /// purses are left over the storage stake, the next payment is refused instead of staking
    /// another holder's purse away.
    #[test]
    fn free_writes_cannot_stake_away_the_purses() {
        ctx(0, 0); let mut c = Contract::new(None);
        ctx(1, 2 * 10u128.pow(22) + 10u128.pow(23));
        c.mint_deed(None, None);
        let price = env::storage_byte_cost().as_yoctonear();
        let mut b = VMContextBuilder::new();
        b.current_account_id("deeds.near".parse().unwrap()).predecessor_account_id("board.nearcarta.near".parse().unwrap());
        testing_env!(b.build());
        let usage = env::storage_usage() as u128;
        b.account_balance(NearToken::from_yoctonear(usage * price + c.house_held().0 + 1000 * price));
        testing_env!(b.build());
        let mut paid = 0;
        let refused = loop {
            let id = format!("{paid:0>80}");
            let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let _ = c.house_session_pay(accounts(1), accounts(1).to_string(), accounts(2), U128(1), id);
            }));
            if r.is_err() { break true; }
            paid += 1;
            if paid > 50 { break false; }
        };
        assert!(refused, "the float check stops the stream of payments");
        assert!(paid < 12, "within the spare bytes ({paid} went through)");
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
        callback(true); assert!(c.on_house_pay(id.clone(), accounts(4), U128(PAY), 0));
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
        callback(false); assert!(!c.on_house_pay(id.clone(), accounts(4), U128(PAY), 0));
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
        assert_eq!(c.house_line(id).unwrap().pending_ns.0, 0);
    }

    #[test]
    fn release_after_the_wait_moves_the_deed() {
        let (mut c, id) = fresh();
        at(3, 1, 70 * SEC);
        c.house_guardian_approve(id.clone());
        let started = c.house_line(id.clone()).unwrap().pending_ns.0;
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
        let started = c.house_line(id.clone()).unwrap().pending_ns.0;
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

    fn board_at(deposit: u128, ts: u64) {
        testing_env!(VMContextBuilder::new().current_account_id("deeds.near".parse().unwrap())
            .predecessor_account_id("board.nearcarta.near".parse().unwrap())
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(ts).build());
    }

    #[test]
    fn two_visitors_mint_through_the_board_not_as_its_predecessor() {
        ctx(0, 0); let mut c = Contract::new(None);
        board_at(2 * 10u128.pow(22), SEC);
        let a = c.house_session_mint(accounts(1), None);
        board_at(2 * 10u128.pow(22), 2 * SEC);
        let b = c.house_session_mint(accounts(2), None);
        assert_eq!(a.owner_id, accounts(1));
        assert_eq!(b.owner_id, accounts(2));
        assert_ne!(a.token_id, b.token_id);
    }

    #[test]
    #[should_panic(expected = "only the deed holder")]
    fn a_session_for_someone_else_cannot_check_in() {
        let (mut c, id) = fresh();
        board_at(0, 90 * SEC);
        c.house_session_check_in(accounts(2), id);
    }

    #[test]
    #[should_panic(expected = "still inside the check-in window")]
    fn a_session_check_in_restarts_the_window_for_the_row_owner() {
        let (mut c, id) = fresh();
        board_at(0, 90 * SEC);
        c.house_session_check_in(accounts(1), id.clone());
        at(3, 1, 100 * SEC);
        c.house_guardian_approve(id);
    }

    #[test]
    #[should_panic(expected = "owner intent required")]
    fn a_session_cannot_change_heirs() {
        let (mut c, id) = fresh();
        board_at(0, 30 * SEC);
        c.house_session_set_line(accounts(1), id, vec![accounts(5)], vec![accounts(3)], 1, U64(60 * SEC), U64(60 * SEC));
    }

    #[test]
    #[should_panic(expected = "over the vault cap")]
    fn a_foreign_send_over_the_cap_is_refused() {
        let (mut c, id) = fresh();
        at(1, 1, 3 * SEC);
        c.house_set_vault(id.clone(), "base".into(), "ETH".into(), U128(5), 100_000, vec!["0xabc".into()]);
        board_at(0, 4 * SEC);
        let _ = c.house_session_prepare_send(accounts(1), id, "base".into(), "0xabc".into(), "ETH".into(), U128(6), 21_000, "a1".into());
    }

    #[test]
    #[should_panic(expected = "bitcoin is signing only")]
    fn bitcoin_value_is_not_a_spend() {
        let (mut c, id) = fresh();
        at(1, 1, 3 * SEC);
        c.house_set_vault(id.clone(), "btc".into(), "BTC".into(), U128(5), 0, vec!["bc1qexample".into()]);
        board_at(0, 4 * SEC);
        let _ = c.house_session_prepare_send(accounts(1), id, "btc".into(), "bc1qexample".into(), "BTC".into(), U128(1), 0, "btc1".into());
    }

    #[test]
    fn a_bitcoin_signature_request_is_not_a_live_spend() {
        let (mut c, id) = fresh();
        at(1, 1, 3 * SEC);
        c.house_set_vault(id.clone(), "btc".into(), "BTC".into(), U128(5), 0, vec!["bc1qexample".into()]);
        board_at(0, 4 * SEC);
        let prepared = c.house_session_prepare_send(accounts(1), id.clone(), "btc".into(), "bc1qexample".into(), "BTC".into(), U128(0), 0, "btc0".into());
        assert!(!prepared.live);
        assert_eq!(prepared.value.0, 0);
        assert_eq!(c.house_prepared(id).unwrap().action_id, "btc0");
    }

    #[test]
    #[should_panic(expected = "only the deed holder")]
    fn the_previous_holder_session_cannot_send_after_release() {
        let (mut c, id) = fresh();
        at(3, 1, 70 * SEC);
        c.house_guardian_approve(id.clone());
        let started = c.house_line(id.clone()).unwrap().pending_ns.0;
        at(2, 1, started + 60 * SEC);
        c.house_release(id.clone());
        assert_eq!(c.house_epoch(id.clone()), 1);
        board_at(0, started + 61 * SEC);
        let _ = c.house_session_pay(accounts(1), id, accounts(4), U128(1), "old".into());
    }

    #[test]
    fn a_pay_that_landed_after_the_deed_moved_is_not_credited_back() {
        // The NEAR already left. Crediting the purse again would let the next holder
        // withdraw NEAR that belongs to other purses.
        ctx(0, 0); let mut c = Contract::new(None);
        let id = accounts(1).to_string();
        at(1, 3 * 10u128.pow(22), SEC);
        c.mint_deed(None, None);
        let before = c.house_purse(id.clone()).unwrap().balance.0;
        at(1, 1, 2 * SEC);
        let _ = c.house_pay(id.clone(), accounts(4), U128(10u128.pow(21)));
        c.epochs.insert(&id, &1);
        callback(true);
        assert!(c.on_house_pay(id.clone(), accounts(4), U128(10u128.pow(21)), 0));
        assert_eq!(c.house_purse(id.clone()).unwrap().balance.0, before - 10u128.pow(21));
        assert_eq!(c.house_held().0, before - 10u128.pow(21));
    }

    #[test]
    fn a_pay_that_bounced_returns_to_the_purse_whatever_the_epoch() {
        ctx(0, 0); let mut c = Contract::new(None);
        let id = accounts(1).to_string();
        at(1, 3 * 10u128.pow(22), SEC);
        c.mint_deed(None, None);
        let before = c.house_purse(id.clone()).unwrap().balance.0;
        at(1, 1, 2 * SEC);
        let _ = c.house_pay(id.clone(), accounts(4), U128(10u128.pow(21)));
        c.epochs.insert(&id, &1);
        callback(false);
        assert!(!c.on_house_pay(id.clone(), accounts(4), U128(10u128.pow(21)), 0));
        assert_eq!(c.house_purse(id).unwrap().balance.0, before);
        assert_eq!(c.house_held().0, before);
    }

    #[test]
    #[should_panic(expected = "no inheritance line")]
    fn a_sold_deed_drops_the_sellers_line_so_the_sellers_guardians_cannot_release_it() {
        let (mut c, id) = fresh();
        at(1, 1, 3 * SEC);
        c.nft_transfer(accounts(2), id.clone(), None, None);
        assert!(c.house_line(id.clone()).is_none());
        assert_eq!(c.house_epoch(id.clone()), 1);
        // the seller's guardian waits out the window and tries anyway
        at(3, 1, 200 * SEC);
        c.house_guardian_approve(id);
    }

    #[test]
    fn line_times_and_vault_amounts_are_strings_in_json() {
        let (mut c, id) = fresh();
        at(1, 1, 3 * SEC);
        c.house_set_vault(id.clone(), "base".into(), "ETH".into(), U128(5), 100_000, vec!["0xabc".into()]);
        let v = near_sdk::serde_json::to_value(c.house_vault(id).unwrap()).unwrap();
        assert!(v["max_value"].is_string());
    }

    #[test]
    #[should_panic(expected = "a foreign vault still holds value")]
    fn close_refuses_a_funded_foreign_vault() {
        let (mut c, id) = fresh();
        at(1, 1, 3 * SEC);
        c.house_set_vault(id.clone(), "base".into(), "ETH".into(), U128(5), 100_000, vec!["0xabc".into()]);
        at(1, 1, 4 * SEC);
        c.house_mark_funded(id);
        at(0, 1, 5 * SEC);
        let _ = c.close();
    }

    #[test]
    fn a_board_deposit_on_check_in_stays_on_the_purse() {
        let (mut c, id) = fresh();
        let before = c.house_purse(id.clone()).unwrap().balance.0;
        board_at(7, 3 * SEC);
        c.house_session_check_in(accounts(1), id.clone());
        assert_eq!(c.house_purse(id).unwrap().balance.0, before + 7);
        assert_eq!(c.house_held().0, before + 7);
        assert_eq!(c.house_version(), 3);
    }

    #[test]
    #[should_panic(expected = "old house state")]
    fn migrate_from_v2_refuses_a_missing_v2_state() {
        ctx(0, 0);
        let _ = Contract::new(None);
        testing_env!(VMContextBuilder::new().current_account_id("deeds.near".parse().unwrap())
            .predecessor_account_id("deeds.near".parse().unwrap()).build());
        let _ = Contract::migrate_from_v2();
    }

    #[test]
    fn migrate_keeps_the_line_and_a_stranger_cannot_upgrade() {
        let (mut c, id) = fresh();
        let line = c.house_line(id.clone()).unwrap();
        testing_env!(VMContextBuilder::new().current_account_id("deeds.near".parse().unwrap())
            .predecessor_account_id("deeds.near".parse().unwrap()).build());
        c.migrate();
        assert_eq!(c.house_line(id).unwrap().heirs, line.heirs);
    }

    #[test]
    #[should_panic(expected = "only the deployer may upgrade")]
    fn a_stranger_cannot_upgrade() {
        let (mut c, _) = fresh();
        at(2, 1, 3 * SEC);
        let _ = c.upgrade();
    }

    #[test]
    #[should_panic(expected = "already done")]
    fn the_same_purse_action_does_not_pay_twice() {
        ctx(0, 0); let mut c = Contract::new(None);
        let id = accounts(1).to_string();
        at(1, 3 * 10u128.pow(22), SEC);
        c.mint_deed(None, Some(U128(10u128.pow(23))));
        board_at(0, 2 * SEC);
        let _ = c.house_session_pay(accounts(1), id.clone(), accounts(4), U128(10u128.pow(21)), "once".into());
        board_at(0, 3 * SEC);
        let _ = c.house_session_pay(accounts(1), id, accounts(4), U128(10u128.pow(21)), "once".into());
    }
    // ---- Transfer is the whole point of this track: the wallet must move with the deed ----
    //
    // The NFT track asks, in its own words: "Explain how control passes on transfer and what
    // stops the old owner from keeping access." Before these tests there was no transfer test
    // at all, so that claim was unproven.

    fn transfer(c: &mut Contract, from: usize, to: &str, token_id: &str) {
        // nft_transfer is `#[payable]` and needs 1 yocto, and the predecessor must be the owner.
        ctx(from, 1);
        c.nft_transfer(to.parse().unwrap(), token_id.to_string(), None, None);
    }

    #[test]
    fn the_deed_moves_with_its_purse_and_the_old_holder_loses_control() {
        ctx(0, 0); let mut c = Contract::new(None);
        ctx(1, 20u128 * 10u128.pow(22));
        let t = c.mint_deed(None, Some(U128(10u128.pow(22))));
        let token = t.token_id.clone();
        // Someone funds the purse, so there is real money to move with the deed.
        ctx(2, 5u128 * 10u128.pow(22));
        c.house_fund(token.clone());
        let before = c.house_purse(token.clone()).unwrap();
        assert!(before.balance.0 > t.metadata.as_ref().map(|_| 0).unwrap_or(0));

        // Transfer to account 3.
        transfer(&mut c, 1, accounts(3).as_str(), &token);

        let after = c.nft_token(token.clone()).unwrap();
        assert_eq!(after.owner_id, accounts(3), "the deed is now account 3's");
        let purse = c.house_purse(token.clone()).unwrap();
        assert_eq!(purse.balance, before.balance, "the purse balance travels with the deed");
        assert_eq!(purse.cap, before.cap, "so does its cap");

        // The old holder cannot spend any more.
        ctx(1, 1);
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.house_pay(token.clone(), "thief.near".parse().unwrap(), U128(1));
        })).unwrap_err();
        let msg = err.downcast_ref::<String>().cloned().unwrap_or_default();
        assert!(msg.contains("only the deed holder"), "old holder refused: {msg}");

        // Nor can they change the inheritance line, nor check in as the holder.
        ctx(1, 1);
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.house_set_line(token.clone(), vec!["a.near".parse().unwrap()], vec!["b.near".parse().unwrap()], 1, U64(60_000_000_000), U64(60_000_000_000));
        })).unwrap_err();
        let msg = err.downcast_ref::<String>().cloned().unwrap_or_default();
        assert!(msg.contains("only the deed holder"), "old holder cannot name heirs: {msg}");
    }

    #[test]
    fn the_new_holder_can_spend_the_purse_immediately() {
        ctx(0, 0); let mut c = Contract::new(None);
        ctx(1, 20u128 * 10u128.pow(22));
        let token = c.mint_deed(None, Some(U128(10u128.pow(22)))).token_id;
        transfer(&mut c, 1, accounts(4).as_str(), &token);
        // The new holder is the only one who may spend, and the purse kept its balance.
        let p = c.house_purse(token.clone()).unwrap();
        assert!(p.balance.0 > 0, "the purse still holds what was funded",);
        ctx(4, 1);
        let _ = c.house_pay(token.clone(), "shop.near".parse().unwrap(), U128(1));
        let after = c.house_purse(token.clone()).unwrap();
        assert_eq!(after.balance.0, p.balance.0 - 1, "the new holder spent from the same purse");
        // `pays` is credited by `on_house_pay`, the callback after the transfer lands, so it is
        // still 0 here. Asserting it in the same call was my mistake, not the contract's.
    }

    #[test]
    fn a_stranger_cannot_take_the_deed() {
        ctx(0, 0); let mut c = Contract::new(None);
        ctx(1, 20u128 * 10u128.pow(22));
        let token = c.mint_deed(None, None).token_id;
        // accounts(2) is not the owner and holds no approval.
        ctx(2, 1);
        let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.nft_transfer(accounts(9), token.clone(), None, None);
        })).unwrap_err();
        let msg = err.downcast_ref::<String>().cloned().unwrap_or_default();
        assert!(!msg.is_empty(), "a transfer by a stranger is refused: {msg}");
        assert_eq!(c.nft_token(token).unwrap().owner_id, accounts(1), "the deed did not move");
    }

}
