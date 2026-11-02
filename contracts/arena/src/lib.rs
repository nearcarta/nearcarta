//! Vault Arena — R6 prototype (testnet only).
//! One contract = Guardian NFTs (NEP-171/177/178/181) + oath per Guardian + NEP-245 items + attempts log.
//! The agent may only PROPOSE through `agent_act`; the contract decides. A refusal is a successful
//! transaction that emits a `decision` event and scores the Guardian — refusals are the gameplay.
use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
use near_contract_standards::non_fungible_token::core::{NonFungibleTokenCore, NonFungibleTokenResolver};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::collections::{LazyOption, LookupMap};
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseOrValue,
};
use std::collections::HashMap;

#[derive(BorshStorageKey)]
#[near]
enum SK { Nft, Meta, TokMeta, Enum, Appr, Guard, Bal, Sup, Att, Open, Seen }

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Oath {
    pub per_action_cap: U128,
    pub budget: U128,
    pub allow: Vec<AccountId>,
    pub handoff_allow: Vec<AccountId>,
    pub bounty_hash_hex: Option<String>,
    pub bounty_amount: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Guardian {
    pub agent: AccountId,
    pub oath: Oath,
    pub oath_version: u32,
    pub frozen: bool,
    pub pot: U128,
    pub spent: U128,
    pub reserved: U128,
    pub in_flight: u32,
    pub refusals: u64,
    pub allows: u64,
    pub holder_epoch: u32,
}

#[near(serializers = [json, borsh])]
pub enum Act {
    Pay { to: AccountId, amount: U128 },
    GiveItem { to: AccountId, item: String, amount: U128 },
    Handoff { to: AccountId },
    ClaimBounty { to: AccountId, preimage: String },
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Attempt {
    pub player: AccountId,
    pub token_id: TokenId,
    pub prompt_hash_hex: String,
    pub block: u64,
    pub verdict: Option<String>,
    pub revealed: bool,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Season { pub commit_hex: Option<String>, pub seed_hex: Option<String> }

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    tokens: NonFungibleToken,
    metadata: LazyOption<NFTContractMetadata>,
    guardians: LookupMap<TokenId, Guardian>,
    bal: LookupMap<String, U128>,
    sup: LookupMap<String, U128>,
    attempts: LookupMap<u64, Attempt>,
    open: LookupMap<AccountId, u64>,
    seen: LookupMap<String, bool>,
    next_attempt: u64,
    season: Season,
}

fn h(b: &[u8]) -> String { hex::encode(env::sha256(b)) }
fn k(item: &str, who: &AccountId) -> String { format!("{}\u{0}{}", item, who) }
fn ev(standard: &str, version: &str, event: &str, data: serde_json::Value) {
    env::log_str(&format!("EVENT_JSON:{}", json!({"standard":standard,"version":version,"event":event,"data":[data]})));
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        let meta = NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(), name: "Vault Arena Guardians (testnet)".into(),
            symbol: "GUARD".into(), icon: None, base_uri: None, reference: None, reference_hash: None,
        };
        Self {
            owner: owner.clone(),
            tokens: NonFungibleToken::new(SK::Nft, owner, Some(SK::TokMeta), Some(SK::Enum), Some(SK::Appr)),
            metadata: LazyOption::new(SK::Meta, Some(&meta)),
            guardians: LookupMap::new(SK::Guard), bal: LookupMap::new(SK::Bal), sup: LookupMap::new(SK::Sup),
            attempts: LookupMap::new(SK::Att), open: LookupMap::new(SK::Open), seen: LookupMap::new(SK::Seen),
            next_attempt: 0, season: Season { commit_hex: None, seed_hex: None },
        }
    }

    // ---------- Guardian lifecycle ----------
    /// Dev mints a Guardian NFT to `receiver_id`; attached deposit pays NFT storage (excess refunded).
    #[payable]
    pub fn mint_guardian(&mut self, token_id: TokenId, receiver_id: AccountId, agent: AccountId, oath: Oath, title: String) -> Token {
        require!(env::predecessor_account_id() == self.owner, "ERR_OWNER_ONLY");
        require!(self.inv(&token_id).as_str().len() <= 64, "ERR_TOKEN_ID");
        let md = TokenMetadata { title: Some(title), description: Some("Transfer the NFT = transfer the oath.".into()),
            media: None, media_hash: None, copies: Some(1), issued_at: None, expires_at: None, starts_at: None,
            updated_at: None, extra: None, reference: None, reference_hash: None };
        let t = self.tokens.internal_mint(token_id.clone(), receiver_id, Some(md));
        self.guardians.insert(&token_id, &Guardian { agent, oath, oath_version: 1, frozen: false, pot: U128(0),
            spent: U128(0), reserved: U128(0), in_flight: 0, refusals: 0, allows: 0, holder_epoch: 0 });
        self.emit_oath(&token_id, "oath_set");
        t
    }

    /// Anyone may add NEAR to a Guardian's pot (dev-funded on testnet; no player money is ever taken).
    #[payable]
    pub fn fund(&mut self, token_id: TokenId) -> U128 {
        let mut g = self.g(&token_id);
        g.pot = U128(g.pot.0 + env::attached_deposit().as_yoctonear());
        self.guardians.insert(&token_id, &g);
        g.pot
    }

    /// Dev stocks NEP-245 items into the Guardian's inventory account `g-<id>.<contract>`.
    pub fn stock(&mut self, token_id: TokenId, item: String, amount: U128) {
        require!(env::predecessor_account_id() == self.owner, "ERR_OWNER_ONLY");
        self.g(&token_id);
        let inv = self.inv(&token_id);
        self.mt_mint(&inv, &item, amount.0, "stock");
    }

    fn holder(&self, token_id: &TokenId) -> AccountId {
        self.tokens.owner_by_id.get(token_id).unwrap_or_else(|| env::panic_str("ERR_NO_TOKEN"))
    }
    fn assert_holder(&self, token_id: &TokenId) {
        require!(env::predecessor_account_id() == self.holder(token_id), "ERR_NOT_HOLDER");
    }
    /// Only the CURRENT NFT holder may rewrite the oath. Blocked while a payout is in flight.
    pub fn set_oath(&mut self, token_id: TokenId, oath: Oath) {
        self.assert_holder(&token_id);
        let mut g = self.g(&token_id);
        require!(g.in_flight == 0, "ERR_INFLIGHT_PAYOUT");
        g.oath = oath; g.oath_version += 1;
        self.guardians.insert(&token_id, &g);
        self.emit_oath(&token_id, "oath_set");
    }
    pub fn set_frozen(&mut self, token_id: TokenId, frozen: bool) {
        self.assert_holder(&token_id);
        let mut g = self.g(&token_id); g.frozen = frozen; self.guardians.insert(&token_id, &g);
        self.emit_oath(&token_id, if frozen { "frozen" } else { "unfrozen" });
    }
    pub fn set_agent(&mut self, token_id: TokenId, agent: AccountId) {
        self.assert_holder(&token_id);
        let mut g = self.g(&token_id); g.agent = agent; self.guardians.insert(&token_id, &g);
        self.emit_oath(&token_id, "agent_set");
    }

    // ---------- Play ----------
    /// Player commits sha256(prompt) BEFORE the agent answers. One open attempt per player (anti-spam).
    pub fn attempt(&mut self, token_id: TokenId, prompt_hash_hex: String) -> u64 {
        let player = env::predecessor_account_id();
        self.g(&token_id);
        require!(prompt_hash_hex.len() == 64 && hex::decode(&prompt_hash_hex).is_ok(), "ERR_HASH");
        require!(self.open.get(&player).is_none(), "ERR_ATTEMPT_OPEN");
        let id = self.next_attempt; self.next_attempt += 1;
        self.attempts.insert(&id, &Attempt { player: player.clone(), token_id: token_id.clone(), prompt_hash_hex: prompt_hash_hex.clone(),
            block: env::block_height(), verdict: None, revealed: false });
        self.open.insert(&player, &id);
        ev("vaultarena", "0.1.0", "attempt", json!({"attempt_id": id, "player": player, "token_id": token_id, "prompt_hash": prompt_hash_hex}));
        id
    }

    /// Anyone may reveal the prompt later; the contract checks it against the commitment (attack corpus).
    pub fn reveal_prompt(&mut self, attempt_id: u64, prompt: String) {
        let mut a = self.attempts.get(&attempt_id).unwrap_or_else(|| env::panic_str("ERR_NO_ATTEMPT"));
        require!(h(prompt.as_bytes()) == a.prompt_hash_hex, "ERR_REVEAL_MISMATCH");
        a.revealed = true; self.attempts.insert(&attempt_id, &a);
        ev("vaultarena", "0.1.0", "reveal", json!({"attempt_id": attempt_id, "prompt": prompt}));
    }

    /// The agent PROPOSES one action for one attempt. The oath decides. Refusal does not panic:
    /// it is recorded on chain, scores the Guardian, and gives the player a NEP-245 `case:<clause>` badge
    /// the first time that player hits that clause.
    pub fn agent_act(&mut self, attempt_id: u64, act: Act) -> String {
        let mut a = self.attempts.get(&attempt_id).unwrap_or_else(|| env::panic_str("ERR_NO_ATTEMPT"));
        require!(a.verdict.is_none(), "ERR_ATTEMPT_USED");
        let tid = a.token_id.clone();
        let mut g = self.g(&tid);
        require!(env::predecessor_account_id() == g.agent, "ERR_NOT_AGENT");
        let verdict = self.judge(&tid, &g, &act);
        let (kind, detail) = describe(&act);
        let clause = match &verdict { Ok(()) => "ALLOW".to_string(), Err(c) => c.to_string() };
        if verdict.is_ok() {
            g.allows += 1;
            match act {
                Act::Pay { to, amount } => { self.reserve(&mut g, amount.0); self.pay(&tid, attempt_id, &to, amount.0, false); }
                Act::ClaimBounty { to, .. } => {
                    let amt = g.oath.bounty_amount.0; g.oath.bounty_hash_hex = None; g.oath_version += 1;
                    self.reserve(&mut g, amt); self.pay(&tid, attempt_id, &to, amt, true);
                    self.mt_mint(&to, &format!("trophy:{}", tid), 1, "bounty");
                }
                Act::GiveItem { to, item, amount } => { let inv = self.inv(&tid); self.mt_move(&inv, &to, &item, amount.0, Some("agent_give")); }
                Act::Handoff { to } => {
                    let agent = g.agent.clone();
                    self.guardians.insert(&tid, &g);
                    self.tokens.internal_transfer(&agent, &to, &tid, None, Some("agent handoff within oath".into()));
                    g = self.g(&tid); self.seal(&mut g);
                }
            }
        } else {
            g.refusals += 1;
            let key = format!("{}|{}", clause, a.player);
            if self.seen.get(&key).is_none() {
                self.seen.insert(&key, &true);
                let p = a.player.clone();
                self.mt_mint(&p, &format!("case:{}", clause), 1, "first_refusal");
            }
        }
        self.guardians.insert(&tid, &g);
        a.verdict = Some(clause.clone()); self.attempts.insert(&attempt_id, &a); self.open.remove(&a.player);
        ev("vaultarena", "0.1.0", "decision", json!({"attempt_id": attempt_id, "token_id": tid, "player": a.player,
            "prompt_hash": a.prompt_hash_hex, "action": kind, "detail": detail, "verdict": if clause == "ALLOW" {"allow"} else {"refuse"},
            "clause": clause, "oath_version": g.oath_version, "oath_hash": h(&near_sdk::borsh::to_vec(&g.oath).unwrap()),
            "holder_epoch": g.holder_epoch}));
        clause
    }

    #[private]
    pub fn on_paid(&mut self, token_id: TokenId, attempt_id: u64, amount: U128, bounty: bool) -> bool {
        let ok = env::promise_result_checked(0, 64).is_ok();
        let mut g = self.g(&token_id);
        g.in_flight -= 1; g.reserved = U128(g.reserved.0 - amount.0);
        if ok { g.spent = U128(g.spent.0 + amount.0); g.pot = U128(g.pot.0 - amount.0); }
        self.guardians.insert(&token_id, &g);
        ev("vaultarena", "0.1.0", "settled", json!({"attempt_id": attempt_id, "token_id": token_id, "amount": amount, "ok": ok, "bounty": bounty}));
        ok
    }

    // ---------- Season seed: commit-reveal (never env::random_seed for anything of value) ----------
    pub fn season_open(&mut self, commit_hex: String) {
        require!(env::predecessor_account_id() == self.owner, "ERR_OWNER_ONLY");
        require!(self.season.commit_hex.is_none() || self.season.seed_hex.is_some(), "ERR_SEASON_RUNNING");
        self.season = Season { commit_hex: Some(commit_hex.clone()), seed_hex: None };
        ev("vaultarena", "0.1.0", "season_open", json!({"commit": commit_hex, "block": env::block_height()}));
    }
    pub fn season_close(&mut self, seed_hex: String) {
        require!(env::predecessor_account_id() == self.owner, "ERR_OWNER_ONLY");
        let seed = hex::decode(&seed_hex).unwrap_or_else(|_| env::panic_str("ERR_HEX"));
        require!(Some(h(&seed)) == self.season.commit_hex, "ERR_SEED_MISMATCH");
        self.season.seed_hex = Some(seed_hex.clone());
        ev("vaultarena", "0.1.0", "season_close", json!({"seed": seed_hex}));
    }
    /// Public tiebreak = sha256(seed || account); anyone can recompute it off chain.
    pub fn tiebreak(&self, account_id: AccountId) -> Option<String> {
        self.season.seed_hex.as_ref().map(|s| { let mut b = hex::decode(s).unwrap(); b.extend_from_slice(account_id.as_bytes()); h(&b) })
    }

    // ---------- Views ----------
    pub fn get_guardian(&self, token_id: TokenId) -> Option<Guardian> { self.guardians.get(&token_id) }
    pub fn get_attempt(&self, attempt_id: u64) -> Option<Attempt> { self.attempts.get(&attempt_id) }
    pub fn get_season(&self) -> Season { self.season.clone() }
    pub fn inventory_account(&self, token_id: TokenId) -> AccountId { self.inv(&token_id) }

    // ---------- NEP-245 core: transfer, batch transfer, transfer_call + resolve, balances, supply, events ----------
    #[payable]
    pub fn mt_transfer(&mut self, receiver_id: AccountId, token_id: String, amount: U128, approval: Option<(AccountId, u64)>, memo: Option<String>) {
        assert_one_yocto();
        require!(approval.is_none(), "ERR_MT_APPROVALS_UNSUPPORTED");
        let s = env::predecessor_account_id();
        self.mt_move(&s, &receiver_id, &token_id, amount.0, memo.as_deref());
    }
    #[payable]
    pub fn mt_batch_transfer(&mut self, receiver_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>, approvals: Option<Vec<Option<(AccountId, u64)>>>, memo: Option<String>) {
        assert_one_yocto();
        require!(token_ids.len() == amounts.len(), "ERR_LEN_MISMATCH");
        require!(approvals.map(|v| v.iter().all(|a| a.is_none())).unwrap_or(true), "ERR_MT_APPROVALS_UNSUPPORTED");
        let s = env::predecessor_account_id();
        for (t, a) in token_ids.iter().zip(amounts.iter()) { self.mt_move(&s, &receiver_id, t, a.0, memo.as_deref()); }
    }
    pub fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128 { self.bal.get(&k(&token_id, &account_id)).unwrap_or(U128(0)) }
    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<String>) -> Vec<U128> {
        token_ids.iter().map(|t| self.mt_balance_of(account_id.clone(), t.clone())).collect()
    }
    pub fn mt_supply(&self, token_id: String) -> Option<U128> { self.sup.get(&token_id) }
    pub fn mt_batch_supply(&self, token_ids: Vec<String>) -> Vec<Option<U128>> { token_ids.iter().map(|t| self.sup.get(t)).collect() }
    pub fn mt_token(&self, token_ids: Vec<String>) -> Vec<Option<serde_json::Value>> {
        token_ids.iter().map(|t| self.sup.get(t).map(|_| json!({"token_id": t, "owner_id": null}))).collect()
    }
    /// NEP-245 transfer_call: move, then ask the receiver; unused amounts come back in mt_resolve_transfer.
    #[payable]
    pub fn mt_transfer_call(&mut self, receiver_id: AccountId, token_id: String, amount: U128, approval: Option<(AccountId, u64)>, memo: Option<String>, msg: String) -> PromiseOrValue<Vec<U128>> {
        assert_one_yocto();
        require!(approval.is_none(), "ERR_MT_APPROVALS_UNSUPPORTED");
        self.mt_call(receiver_id, vec![token_id], vec![amount], memo, msg)
    }
    #[payable]
    pub fn mt_batch_transfer_call(&mut self, receiver_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>, approvals: Option<Vec<Option<(AccountId, u64)>>>, memo: Option<String>, msg: String) -> PromiseOrValue<Vec<U128>> {
        assert_one_yocto();
        require!(token_ids.len() == amounts.len(), "ERR_LEN_MISMATCH");
        require!(approvals.map(|v| v.iter().all(|a| a.is_none())).unwrap_or(true), "ERR_MT_APPROVALS_UNSUPPORTED");
        self.mt_call(receiver_id, token_ids, amounts, memo, msg)
    }
    /// Returns the amounts the receiver kept. Refunds = min(asked back, what the receiver still holds).
    #[private]
    pub fn mt_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>, approvals: Option<Vec<Option<(AccountId, u64)>>>) -> Vec<U128> {
        let _ = approvals;
        let unused: Vec<U128> = match env::promise_result_checked(0, 1024) {
            Ok(v) => serde_json::from_slice::<Vec<U128>>(&v).ok().filter(|u| u.len() == amounts.len()).unwrap_or_else(|| amounts.clone()),
            Err(_) => amounts.clone(),
        };
        self.mt_settle(&sender_id, &receiver_id, &token_ids, &amounts, &unused)
    }
}

fn describe(a: &Act) -> (&'static str, serde_json::Value) {
    match a {
        Act::Pay { to, amount } => ("pay", json!({"to": to, "amount": amount})),
        Act::GiveItem { to, item, amount } => ("give_item", json!({"to": to, "item": item, "amount": amount})),
        Act::Handoff { to } => ("handoff", json!({"to": to})),
        Act::ClaimBounty { to, .. } => ("claim_bounty", json!({"to": to})),
    }
}

impl Contract {
    fn g(&self, t: &TokenId) -> Guardian { self.guardians.get(t).unwrap_or_else(|| env::panic_str("ERR_NO_GUARDIAN")) }
    fn inv(&self, t: &TokenId) -> AccountId {
        format!("g-{}.{}", t, env::current_account_id()).parse().unwrap_or_else(|_| env::panic_str("ERR_TOKEN_ID"))
    }
    /// The oath, as code. Order matters and is documented in GAME.md.
    fn judge(&self, tid: &TokenId, g: &Guardian, act: &Act) -> Result<(), &'static str> {
        if g.frozen { return Err("C0_FROZEN"); }
        let money = |amt: u128| -> Result<(), &'static str> {
            if g.spent.0 + g.reserved.0 + amt > g.oath.budget.0 { return Err("C2_BUDGET"); }
            if g.reserved.0 + amt > g.pot.0 { return Err("C4_POT"); }
            Ok(())
        };
        match act {
            Act::Pay { to, amount } => {
                if amount.0 > g.oath.per_action_cap.0 { return Err("C1_CAP"); }
                if !g.oath.allow.contains(to) { return Err("C3_ALLOWLIST"); }
                money(amount.0)
            }
            Act::ClaimBounty { preimage, .. } => {
                let hh = g.oath.bounty_hash_hex.as_ref().ok_or("C5_NO_BOUNTY")?;
                if &h(preimage.as_bytes()) != hh { return Err("C6_BAD_PROOF"); }
                money(g.oath.bounty_amount.0)
            }
            Act::GiveItem { to, item, amount } => {
                if !g.oath.allow.contains(to) { return Err("C3_ALLOWLIST"); }
                if self.bal.get(&k(item, &self.inv(tid))).unwrap_or(U128(0)).0 < amount.0 { return Err("C9_STOCK"); }
                Ok(())
            }
            Act::Handoff { to } => {
                if !g.oath.handoff_allow.contains(to) { return Err("C7_HANDOFF"); }
                if g.in_flight > 0 { return Err("C10_INFLIGHT"); }
                let approved = self.tokens.approvals_by_id.as_ref().and_then(|m| m.get(tid)).map(|m| m.contains_key(&g.agent)).unwrap_or(false);
                if !approved { return Err("C8_NO_APPROVAL"); }
                Ok(())
            }
        }
    }
    fn reserve(&self, g: &mut Guardian, amt: u128) { g.reserved = U128(g.reserved.0 + amt); g.in_flight += 1; }
    fn pay(&self, tid: &TokenId, attempt_id: u64, to: &AccountId, amt: u128, bounty: bool) {
        Promise::new(to.clone()).transfer(NearToken::from_yoctonear(amt)).then(
            Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(10))
                .on_paid(tid.clone(), attempt_id, U128(amt), bounty)).detach();
    }
    /// After ANY NFT transfer: new epoch, recipients cleared, Guardian frozen until the new holder unfreezes.
    /// Caps, budget, bounty and pot survive (they are what the buyer saw in oath_hash).
    fn seal(&self, g: &mut Guardian) {
        g.holder_epoch += 1; g.oath.allow.clear(); g.oath.handoff_allow.clear(); g.frozen = true; g.oath_version += 1;
    }
    fn guard_transfer(&self, sender: &AccountId, tid: &TokenId, receiver: &AccountId) {
        let g = self.g(tid);
        require!(g.in_flight == 0, "ERR_INFLIGHT_PAYOUT");
        if sender != &self.holder(tid) && sender == &g.agent {
            require!(!g.frozen, "ERR_OATH_C0_FROZEN");
            require!(g.oath.handoff_allow.contains(receiver), "ERR_OATH_C7_HANDOFF");
        }
    }
    fn after_transfer(&mut self, tid: &TokenId) { let mut g = self.g(tid); self.seal(&mut g); self.guardians.insert(tid, &g); self.emit_oath(tid, "sealed_on_transfer"); }
    fn emit_oath(&self, tid: &TokenId, what: &str) {
        let g = self.g(tid);
        ev("vaultarena", "0.1.0", what, json!({"token_id": tid, "holder": self.tokens.owner_by_id.get(tid), "agent": g.agent,
            "oath": g.oath, "oath_version": g.oath_version, "oath_hash": h(&near_sdk::borsh::to_vec(&g.oath).unwrap()),
            "frozen": g.frozen, "holder_epoch": g.holder_epoch}));
    }
    fn mt_mint(&mut self, to: &AccountId, item: &str, amt: u128, memo: &str) {
        let key = k(item, to);
        self.bal.insert(&key, &U128(self.bal.get(&key).unwrap_or(U128(0)).0 + amt));
        self.sup.insert(&item.to_string(), &U128(self.sup.get(&item.to_string()).unwrap_or(U128(0)).0 + amt));
        ev("nep245", "1.0.0", "mt_mint", json!({"owner_id": to, "token_ids": [item], "amounts": [U128(amt)], "memo": memo}));
    }
    fn mt_call(&mut self, receiver_id: AccountId, token_ids: Vec<String>, amounts: Vec<U128>, memo: Option<String>, msg: String) -> PromiseOrValue<Vec<U128>> {
        require!(!token_ids.is_empty(), "ERR_EMPTY");
        let s = env::predecessor_account_id();
        for (t, a) in token_ids.iter().zip(amounts.iter()) { self.mt_move(&s, &receiver_id, t, a.0, memo.as_deref()); }
        let prev: Vec<AccountId> = token_ids.iter().map(|_| s.clone()).collect();
        let on = Promise::new(receiver_id.clone()).function_call("mt_on_transfer".to_string(),
            serde_json::to_vec(&json!({"sender_id": s, "previous_owner_ids": prev, "token_ids": token_ids, "amounts": amounts, "msg": msg})).unwrap(),
            NearToken::from_yoctonear(0), Gas::from_tgas(35));
        on.then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(15))
            .mt_resolve_transfer(s, receiver_id, token_ids, amounts, None)).into()
    }
    pub(crate) fn mt_settle(&mut self, sender: &AccountId, receiver: &AccountId, token_ids: &[String], amounts: &[U128], unused: &[U128]) -> Vec<U128> {
        let mut kept = Vec::with_capacity(token_ids.len());
        for ((t, a), u) in token_ids.iter().zip(amounts).zip(unused) {
            let have = self.bal.get(&k(t, receiver)).unwrap_or(U128(0)).0;
            let back = u.0.min(a.0).min(have);
            if back > 0 { self.mt_move(receiver, sender, t, back, Some("refund")); }
            kept.push(U128(a.0 - back));
        }
        kept
    }
    fn mt_move(&mut self, from: &AccountId, to: &AccountId, item: &str, amt: u128, memo: Option<&str>) {
        require!(amt > 0, "ERR_ZERO_AMOUNT");
        require!(from != to, "ERR_SELF_TRANSFER");
        let fk = k(item, from); let fb = self.bal.get(&fk).unwrap_or(U128(0)).0;
        require!(fb >= amt, "ERR_MT_BALANCE");
        self.bal.insert(&fk, &U128(fb - amt));
        let tk = k(item, to); self.bal.insert(&tk, &U128(self.bal.get(&tk).unwrap_or(U128(0)).0 + amt));
        let mut d = json!({"old_owner_id": from, "new_owner_id": to, "token_ids": [item], "amounts": [U128(amt)]});
        if let Some(m) = memo { d["memo"] = json!(m); }
        ev("nep245", "1.0.0", "mt_transfer", d);
    }
}

// ---------- NEP-171 core with the oath guard ----------
#[near]
impl NonFungibleTokenCore for Contract {
    #[payable]
    fn nft_transfer(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>) {
        assert_one_yocto();
        let s = env::predecessor_account_id();
        self.guard_transfer(&s, &token_id, &receiver_id);
        self.tokens.internal_transfer(&s, &receiver_id, &token_id, approval_id, memo);
        self.after_transfer(&token_id);
    }
    #[payable]
    fn nft_transfer_call(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u64>, memo: Option<String>, msg: String) -> PromiseOrValue<bool> {
        let s = env::predecessor_account_id();
        self.guard_transfer(&s, &token_id, &receiver_id);
        self.after_transfer(&token_id);
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
    fn nft_approve(&mut self, token_id: TokenId, account_id: AccountId, msg: Option<String>) -> Option<Promise> { self.tokens.nft_approve(token_id, account_id, msg) }
    #[payable]
    fn nft_revoke(&mut self, token_id: TokenId, account_id: AccountId) { self.tokens.nft_revoke(token_id, account_id) }
    #[payable]
    fn nft_revoke_all(&mut self, token_id: TokenId) { self.tokens.nft_revoke_all(token_id) }
    fn nft_is_approved(&self, token_id: TokenId, approved_account_id: AccountId, approval_id: Option<u64>) -> bool { self.tokens.nft_is_approved(token_id, approved_account_id, approval_id) }
}
#[near]
impl NonFungibleTokenEnumeration for Contract {
    fn nft_total_supply(&self) -> U128 { self.tokens.nft_total_supply() }
    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> { self.tokens.nft_tokens(from_index, limit) }
    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 { self.tokens.nft_supply_for_owner(account_id) }
    fn nft_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> { self.tokens.nft_tokens_for_owner(account_id, from_index, limit) }
}
#[near]
impl NonFungibleTokenMetadataProvider for Contract {
    fn nft_metadata(&self) -> NFTContractMetadata { self.metadata.get().unwrap() }
}

#[cfg(test)]
mod tests;
