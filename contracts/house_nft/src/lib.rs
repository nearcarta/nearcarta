//! House deed: a NEP-171 NFT (with NEP-177 metadata, NEP-178 approvals, NEP-181 enumeration) for Your House.
//! Any account may mint exactly one deed for itself with `mint_deed`; token_id = the minter's account id.
//! The minter pays the storage from the attached deposit; the rest is refunded. There is no owner,
//! no admin mint, no upgrade method and no way to change a minted deed's metadata. The account is
//! deployed in one batch with no access key, so nobody can change the code afterwards.
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, NonFungibleTokenEnumeration, Token, TokenId};
use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
use near_contract_standards::non_fungible_token::core::{NonFungibleTokenCore, NonFungibleTokenResolver};
use near_sdk::collections::LazyOption;
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise, PromiseOrValue};
use std::collections::HashMap;

#[derive(BorshStorageKey)]
#[near]
enum Key { Owner, Meta, Enum, Approval, ContractMeta }

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    tokens: NonFungibleToken,
    metadata: LazyOption<NFTContractMetadata>,
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        let metadata = NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "Nearcarta House deeds".to_string(),
            symbol: "DEED".to_string(),
            icon: None, base_uri: None, reference: None, reference_hash: None,
        };
        Self {
            tokens: NonFungibleToken::new(Key::Owner, env::current_account_id(), Some(Key::Meta), Some(Key::Enum), Some(Key::Approval)),
            metadata: LazyOption::new(Key::ContractMeta, Some(&metadata)),
        }
    }

    /// Mint the caller's own deed (one per account). `house` optionally names the caller's charter account.
    #[payable]
    pub fn mint_deed(&mut self, house: Option<AccountId>) -> Token {
        let who = env::predecessor_account_id();
        require!(env::attached_deposit() > NearToken::from_yoctonear(0), "attach a deposit for storage (0.01 NEAR is enough)");
        require!(self.tokens.owner_by_id.get(&who.to_string()).is_none(), "this account already has a deed");
        let title = format!("House of {who}");
        let description = house.as_ref().map(|h| format!("Charter: {h}"));
        let meta = TokenMetadata {
            title: Some(title), description, media: None, media_hash: None, copies: Some(1),
            issued_at: Some(env::block_timestamp_ms().to_string()), expires_at: None, starts_at: None,
            updated_at: None, extra: None, reference: None, reference_hash: None,
        };
        self.tokens.internal_mint(who.to_string(), who, Some(meta))
    }
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
        testing_env!(VMContextBuilder::new().current_account_id("deeds.testnet".parse().unwrap())
            .predecessor_account_id(accounts(who)).attached_deposit(NearToken::from_yoctonear(deposit)).build());
    }

    #[test]
    fn mint_own_deed_sets_owner_and_metadata() {
        ctx(0, 0); let mut c = Contract::new();
        ctx(1, 10u128.pow(22));
        let t = c.mint_deed(Some("r11house-31474.testnet".parse().unwrap()));
        assert_eq!(t.token_id, accounts(1).to_string());
        assert_eq!(t.owner_id, accounts(1));
        let m = t.metadata.unwrap();
        assert_eq!(m.title.unwrap(), format!("House of {}", accounts(1)));
        assert_eq!(m.description.unwrap(), "Charter: r11house-31474.testnet");
        assert_eq!(c.nft_total_supply().0, 1);
        assert_eq!(c.nft_metadata().spec, NFT_METADATA_SPEC);
    }

    #[test]
    #[should_panic(expected = "this account already has a deed")]
    fn second_deed_for_same_account_is_refused() {
        ctx(0, 0); let mut c = Contract::new();
        ctx(1, 10u128.pow(22)); c.mint_deed(None);
        ctx(1, 10u128.pow(22)); c.mint_deed(None);
    }

    #[test]
    #[should_panic(expected = "attach a deposit")]
    fn mint_without_deposit_is_refused() {
        ctx(0, 0); let mut c = Contract::new();
        ctx(1, 0); c.mint_deed(None);
    }

    #[test]
    fn deed_transfers_by_owner_only_with_one_yocto() {
        ctx(0, 0); let mut c = Contract::new();
        ctx(1, 10u128.pow(22)); c.mint_deed(None);
        ctx(1, 1); c.nft_transfer(accounts(2), accounts(1).to_string(), None, None);
        assert_eq!(c.nft_token(accounts(1).to_string()).unwrap().owner_id, accounts(2));
        assert_eq!(c.nft_supply_for_owner(accounts(2)).0, 1);
    }

    #[test]
    #[should_panic]
    fn stranger_cannot_transfer_a_deed() {
        ctx(0, 0); let mut c = Contract::new();
        ctx(1, 10u128.pow(22)); c.mint_deed(None);
        ctx(3, 1); c.nft_transfer(accounts(3), accounts(1).to_string(), None, None);
    }
}
