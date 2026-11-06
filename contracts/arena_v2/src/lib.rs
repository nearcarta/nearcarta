//! Arena v2. Player-owned guardian pets. This crate is not deployed.
//!
//! The live account `arena.nearcarta.near` is still the v1 contract. v1 keys one
//! open attempt by the predecessor. Board `propose_call` sets that predecessor
//! to the board, so the whole city would share one attempt. v2 accepts a call
//! only when the predecessor is the board, and the visitor is the top-level
//! `row_owner` argument. A nested account id is not authority.
//!
//! TEE signature verification is not implemented. The published NEAR AI
//! verification write-up does not pin an ecrecover scheme we have tested with
//! a signed fixture. The contract binds the oath, the pot, and the envelope.
//! It does not pretend a model signature was checked.
use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise,
};

const STATE_VERSION: u32 = 2;
const TIMEOUT_NS: u64 = 60_000_000_000;
const BADGE_PREFIX: &str = "case:";

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Oath {
    pub per_action_cap: U128,
    pub allow: Vec<AccountId>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Guardian {
    pub id: u64,
    pub creator: AccountId,
    pub title: String,
    pub persona: String,
    pub oath: Oath,
    pub oath_hash: String,
    pub persona_hash: String,
    pub pot: U128,
    pub fee: U128,
    pub split_bps: u16,
    pub demand: u32,
    pub alive: bool,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Attempt {
    pub id: u64,
    pub player: AccountId,
    pub guardian_id: u64,
    pub prompt_hash: String,
    pub oath_hash: String,
    pub persona_hash: String,
    pub fee: U128,
    pub nonce: u64,
    pub opened_at: u64,
    pub deadline: u64,
    pub state: String,
    pub verdict: Option<String>,
    pub badge: bool,
    pub inference: U128,
    pub subsidy: bool,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Envelope {
    pub attempt_id: u64,
    pub player: AccountId,
    pub prompt_hash: String,
    pub oath_hash: String,
    pub persona_hash: String,
    pub response_hash: String,
    pub nonce: u64,
    pub pay_to: Option<AccountId>,
    pub pay_amount: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct JsonToken {
    pub token_id: String,
    pub owner_id: AccountId,
    pub metadata: TokenMeta,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct TokenMeta {
    pub title: String,
    pub description: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct MtToken {
    pub token_id: String,
    pub owner_id: Option<AccountId>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    pub version: u32,
    pub board: AccountId,
    pub owner: AccountId,
    pub next_guardian: u64,
    pub next_attempt: u64,
    pub inference_budget: u128,
    pub inference_cost: u128,
    pub subsidy: bool,
    pub upgrade_nonce: u64,
    pub guardians: IterableMap<u64, Guardian>,
    pub attempts: IterableMap<u64, Attempt>,
    pub open_by_player: LookupMap<AccountId, u64>,
    pub earnings: IterableMap<AccountId, u128>,
    pub mt_balance: LookupMap<(AccountId, String), u128>,
    pub mt_supply: LookupMap<String, u128>,
    pub nft_owner: LookupMap<String, AccountId>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(board: AccountId, owner: AccountId, inference_budget: U128, inference_cost: U128) -> Self {
        require!(board != owner, "ERR_BOARD");
        Self {
            version: STATE_VERSION,
            board,
            owner,
            next_guardian: 1,
            next_attempt: 1,
            inference_budget: inference_budget.0,
            inference_cost: inference_cost.0,
            subsidy: false,
            upgrade_nonce: 0,
            guardians: IterableMap::new(b"g"),
            attempts: IterableMap::new(b"a"),
            open_by_player: LookupMap::new(b"o"),
            earnings: IterableMap::new(b"e"),
            mt_balance: LookupMap::new(b"b"),
            mt_supply: LookupMap::new(b"s"),
            nft_owner: LookupMap::new(b"n"),
        }
    }

    /// Owner only. The published verifier algorithm is not treated as checked.
    pub fn set_inference(&mut self, budget: U128, cost: U128, subsidy: bool) {
        self.only_owner();
        self.inference_budget = budget.0;
        self.inference_cost = cost.0;
        self.subsidy = subsidy;
    }

    pub fn mint(
        &mut self,
        row_owner: AccountId,
        title: String,
        persona: String,
        per_action_cap: U128,
        allow: Vec<AccountId>,
        fee: U128,
        split_bps: u16,
    ) -> u64 {
        let creator = self.row(row_owner);
        require!(!title.is_empty() && title.len() <= 48, "ERR_TITLE");
        require!(!persona.is_empty() && persona.len() <= 280, "ERR_PERSONA");
        require!(split_bps <= 10_000, "ERR_SPLIT");
        require!(fee.0 > 0, "ERR_FEE");
        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit > fee.0, "ERR_POT");
        let oath = Oath { per_action_cap, allow };
        let oath_hash = hash_json(&oath);
        let persona_hash = hash_bytes(persona.as_bytes());
        let id = self.next_guardian;
        self.next_guardian += 1;
        let g = Guardian {
            id,
            creator: creator.clone(),
            title: title.clone(),
            persona,
            oath,
            oath_hash,
            persona_hash,
            pot: U128(deposit - fee.0),
            fee,
            split_bps,
            demand: 0,
            alive: true,
        };
        self.nft_owner.insert(id.to_string(), creator.clone());
        self.guardians.insert(id, g);
        id
    }

    pub fn feed(&mut self, row_owner: AccountId, guardian_id: u64) {
        let _feeder = self.row(row_owner);
        let mut g = self.guardian(guardian_id);
        require!(g.alive, "ERR_DEAD");
        let add = env::attached_deposit().as_yoctonear();
        require!(add > 0, "ERR_FEED");
        g.pot = U128(g.pot.0 + add);
        self.guardians.insert(guardian_id, g);
    }

    /// Opens one attempt for this row owner. An empty inference budget panics
    /// before the fee is stored, so the attached deposit is refunded by the
    /// failed receipt and the pot is unchanged.
    pub fn open_attempt(&mut self, row_owner: AccountId, guardian_id: u64, prompt: String) -> u64 {
        let player = self.row(row_owner);
        require!(self.inference_budget > 0, "ERR_SLEEP");
        require!(self.open_by_player.get(&player).is_none(), "ERR_OPEN");
        require!(!prompt.is_empty() && prompt.len() <= 500, "ERR_PROMPT");
        let g = self.guardian(guardian_id);
        require!(g.alive, "ERR_DEAD");
        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit == g.fee.0, "ERR_FEE");
        let id = self.next_attempt;
        self.next_attempt += 1;
        let now = env::block_timestamp();
        let attempt = Attempt {
            id,
            player: player.clone(),
            guardian_id,
            prompt_hash: hash_bytes(prompt.as_bytes()),
            oath_hash: g.oath_hash,
            persona_hash: g.persona_hash,
            fee: g.fee,
            nonce: id,
            opened_at: now,
            deadline: now + TIMEOUT_NS,
            state: "open".to_string(),
            verdict: None,
            badge: false,
            inference: U128(0),
            subsidy: self.subsidy,
        };
        self.attempts.insert(id, attempt);
        self.open_by_player.insert(player, id);
        id
    }

    /// Permissionless. The envelope must match the snapshotted attempt.
    /// The oath, not the model's pay fields, decides whether the pot pays.
    pub fn resolve(&mut self, envelope: Envelope, response: String) -> String {
        require!(hash_bytes(response.as_bytes()) == envelope.response_hash, "ERR_RESPONSE");
        let mut attempt = self.attempt(envelope.attempt_id);
        require!(attempt.state == "open", "ERR_STATE");
        require!(env::block_timestamp() <= attempt.deadline, "ERR_LATE");
        self.bind(&attempt, &envelope);
        let mut g = self.guardian(attempt.guardian_id);
        let cost = self.take_inference();
        attempt.inference = U128(cost);
        attempt.subsidy = self.subsidy && cost == 0;
        let allowed = self.oath_allows(&g, envelope.pay_to.as_ref(), envelope.pay_amount.0);
        let verdict = if allowed {
            let prize = envelope.pay_amount.0;
            require!(g.pot.0 >= prize, "ERR_POT");
            g.pot = U128(g.pot.0 - prize);
            if prize > 0 {
                Promise::new(attempt.player.clone()).transfer(NearToken::from_yoctonear(prize));
            }
            self.pay_creator_fee(&g, attempt.fee.0);
            "paid".to_string()
        } else {
            self.mint_badge(&attempt.player, attempt.id);
            attempt.badge = true;
            self.pay_creator_fee(&g, attempt.fee.0);
            "refused".to_string()
        };
        g.demand += 1;
        self.guardians.insert(g.id, g);
        attempt.state = "resolved".to_string();
        attempt.verdict = Some(verdict.clone());
        self.open_by_player.remove(&attempt.player);
        self.attempts.insert(attempt.id, attempt);
        verdict
    }

    pub fn refund_timeout(&mut self, attempt_id: u64) {
        let mut attempt = self.attempt(attempt_id);
        require!(attempt.state == "open", "ERR_STATE");
        require!(env::block_timestamp() > attempt.deadline, "ERR_EARLY");
        Promise::new(attempt.player.clone()).transfer(NearToken::from_yoctonear(attempt.fee.0));
        attempt.state = "refunded".to_string();
        attempt.verdict = Some("refunded".to_string());
        self.open_by_player.remove(&attempt.player);
        self.attempts.insert(attempt_id, attempt);
    }

    pub fn withdraw(&mut self, row_owner: AccountId, amount: U128) {
        let creator = self.row(row_owner);
        let have = self.earnings.get(&creator).copied().unwrap_or(0);
        require!(amount.0 > 0 && amount.0 <= have, "ERR_EARNINGS");
        self.earnings.insert(creator.clone(), have - amount.0);
        Promise::new(creator).transfer(NearToken::from_yoctonear(amount.0));
    }

    /// Owner only. Refuses while an attempt is open or any pot or earnings remain.
    #[payable]
    pub fn close(&mut self) -> Promise {
        assert_one_yocto();
        self.only_owner();
        for (_, attempt) in self.attempts.iter() {
            require!(attempt.state != "open", "ERR_LIABILITY");
        }
        for (_, g) in self.guardians.iter() {
            require!(g.pot.0 == 0, "ERR_LIABILITY");
        }
        for (_, earned) in self.earnings.iter() {
            require!(*earned == 0, "ERR_LIABILITY");
        }
        Promise::new(self.owner.clone()).delete_account(self.owner.clone())
    }

    #[payable]
    pub fn upgrade(&mut self) -> Promise {
        assert_one_yocto();
        self.only_owner();
        self.upgrade_nonce += 1;
        let code = env::input().unwrap_or_default();
        Promise::new(env::current_account_id()).deploy_contract(code)
    }

    pub fn migrate(&mut self) {
        self.only_owner();
        require!(self.version <= STATE_VERSION, "ERR_VERSION");
        self.version = STATE_VERSION;
    }

    /// First call after a code deploy onto an account that still has the old
    /// arena state. The old bytes are not read. Pots have to be refunded first.
    #[init(ignore_state)]
    pub fn clean(board: AccountId, owner: AccountId) -> Self {
        Self::new(board, owner, U128(0), U128(0))
    }

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128 {
        U128(self.mt_balance.get(&(account_id, token_id)).copied().unwrap_or(0))
    }

    pub fn mt_supply(&self, token_id: String) -> Option<U128> {
        self.mt_supply.get(&token_id).copied().map(U128)
    }

    pub fn mt_token(&self, token_ids: Vec<String>) -> Vec<Option<MtToken>> {
        token_ids
            .into_iter()
            .map(|token_id| {
                let supply = self.mt_supply.get(&token_id).copied().unwrap_or(0);
                if supply == 0 {
                    None
                } else {
                    Some(MtToken { token_id, owner_id: None })
                }
            })
            .collect()
    }

    #[payable]
    pub fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        memo: Option<String>,
    ) {
        let _ = memo;
        assert_one_yocto();
        let from = env::predecessor_account_id();
        require!(amount.0 > 0, "ERR_AMOUNT");
        let key = (from.clone(), token_id.clone());
        let have = self.mt_balance.get(&key).copied().unwrap_or(0);
        require!(have >= amount.0, "ERR_BALANCE");
        self.mt_balance.insert(key, have - amount.0);
        let dest = (receiver_id, token_id);
        let there = self.mt_balance.get(&dest).copied().unwrap_or(0);
        self.mt_balance.insert(dest, there + amount.0);
    }

    pub fn nft_token(&self, token_id: String) -> Option<JsonToken> {
        let owner_id = self.nft_owner.get(&token_id)?.clone();
        let id: u64 = token_id.parse().ok()?;
        let g = self.guardians.get(&id)?;
        Some(JsonToken {
            token_id,
            owner_id,
            metadata: TokenMeta { title: g.title.clone(), description: g.persona.clone() },
        })
    }

    pub fn get_guardian(&self, guardian_id: u64) -> Option<Guardian> {
        self.guardians.get(&guardian_id).cloned()
    }

    pub fn get_attempt(&self, attempt_id: u64) -> Option<Attempt> {
        self.attempts.get(&attempt_id).cloned()
    }

    pub fn get_earnings(&self, account_id: AccountId) -> U128 {
        U128(self.earnings.get(&account_id).copied().unwrap_or(0))
    }

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            version: self.version,
            board: self.board.clone(),
            owner: self.owner.clone(),
            inference_budget: U128(self.inference_budget),
            inference_cost: U128(self.inference_cost),
            subsidy: self.subsidy,
            upgrade_nonce: self.upgrade_nonce,
            verifier: "unverified",
        }
    }
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ConfigView {
    pub version: u32,
    pub board: AccountId,
    pub owner: AccountId,
    pub inference_budget: U128,
    pub inference_cost: U128,
    pub subsidy: bool,
    pub upgrade_nonce: u64,
    pub verifier: &'static str,
}

impl Contract {
    fn only_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "ERR_OWNER");
    }

    fn row(&self, row_owner: AccountId) -> AccountId {
        require!(env::predecessor_account_id() == self.board, "ERR_BOARD");
        require!(row_owner != self.board, "ERR_ROW");
        require!(!row_owner.as_str().is_empty(), "ERR_ROW");
        row_owner
    }

    fn guardian(&self, id: u64) -> Guardian {
        self.guardians.get(&id).expect("ERR_GUARDIAN").clone()
    }

    fn attempt(&self, id: u64) -> Attempt {
        self.attempts.get(&id).expect("ERR_ATTEMPT").clone()
    }

    fn bind(&self, attempt: &Attempt, envelope: &Envelope) {
        require!(envelope.player == attempt.player, "ERR_ENVELOPE");
        require!(envelope.prompt_hash == attempt.prompt_hash, "ERR_ENVELOPE");
        require!(envelope.oath_hash == attempt.oath_hash, "ERR_ENVELOPE");
        require!(envelope.persona_hash == attempt.persona_hash, "ERR_ENVELOPE");
        require!(envelope.nonce == attempt.nonce, "ERR_ENVELOPE");
    }

    fn oath_allows(&self, g: &Guardian, pay_to: Option<&AccountId>, amount: u128) -> bool {
        if amount == 0 {
            return true;
        }
        if amount > g.oath.per_action_cap.0 {
            return false;
        }
        match pay_to {
            Some(to) => g.oath.allow.iter().any(|a| a == to),
            None => false,
        }
    }

    fn take_inference(&mut self) -> u128 {
        if self.subsidy {
            return 0;
        }
        let cost = self.inference_cost;
        if cost == 0 {
            return 0;
        }
        require!(self.inference_budget >= cost, "ERR_BUDGET");
        self.inference_budget -= cost;
        cost
    }

    fn pay_creator_fee(&mut self, g: &Guardian, fee: u128) {
        let share = fee * u128::from(g.split_bps) / 10_000;
        if share > 0 {
            let have = self.earnings.get(&g.creator).copied().unwrap_or(0);
            self.earnings.insert(g.creator.clone(), have + share);
        }
    }

    fn mint_badge(&mut self, player: &AccountId, attempt_id: u64) {
        let token_id = format!("{BADGE_PREFIX}{attempt_id}");
        require!(self.mt_supply.get(&token_id).copied().unwrap_or(0) == 0, "ERR_BADGE");
        self.mt_supply.insert(token_id.clone(), 1);
        self.mt_balance.insert((player.clone(), token_id), 1);
    }
}

fn hash_bytes(bytes: &[u8]) -> String {
    hex_encode(&env::sha256(bytes))
}

fn hash_json<T: Serialize>(value: &T) -> String {
    let bytes = serde_json::to_vec(value).expect("ERR_JSON");
    hash_bytes(&bytes)
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0xf) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn id(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn board() -> AccountId {
        id("board.test")
    }
    fn owner() -> AccountId {
        id("owner.test")
    }
    fn alice() -> AccountId {
        id("alice.test")
    }
    fn bob() -> AccountId {
        id("bob.test")
    }
    fn prize() -> AccountId {
        id("prize.test")
    }

    fn ctx(pred: AccountId, deposit: u128, ts: u64) {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(pred)
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(ts)
            .prepaid_gas(Gas::from_tgas(300));
        testing_env!(b.build());
    }

    fn boot() -> Contract {
        ctx(owner(), 0, 1);
        Contract::new(board(), owner(), U128(1_000), U128(10))
    }

    fn mint_one(c: &mut Contract, who: AccountId, cap: u128) -> u64 {
        ctx(board(), 50, 1);
        c.mint(
            who,
            "Lamp".into(),
            "keeps the oath".into(),
            U128(cap),
            vec![prize()],
            U128(5),
            2_000,
        )
    }

    fn env_for(c: &Contract, attempt: u64, player: AccountId, prompt: &str, pay: u128) -> (Envelope, String) {
        let a = c.get_attempt(attempt).unwrap();
        let response = format!("reply-{attempt}");
        let envelope = Envelope {
            attempt_id: attempt,
            player,
            prompt_hash: hash_bytes(prompt.as_bytes()),
            oath_hash: a.oath_hash,
            persona_hash: a.persona_hash,
            response_hash: hash_bytes(response.as_bytes()),
            nonce: a.nonce,
            pay_to: Some(prize()),
            pay_amount: U128(pay),
        };
        (envelope, response)
    }

    #[test]
    fn two_rows_open_independent_attempts() {
        let mut c = boot();
        let g = mint_one(&mut c, alice(), 8);
        ctx(board(), 5, 10);
        let a1 = c.open_attempt(alice(), g, "hello from alice".into());
        ctx(board(), 5, 11);
        let a2 = c.open_attempt(bob(), g, "hello from bob".into());
        assert_ne!(a1, a2);
        assert_eq!(c.get_attempt(a1).unwrap().player, alice());
        assert_eq!(c.get_attempt(a2).unwrap().player, bob());
    }

    #[test]
    #[should_panic(expected = "ERR_BOARD")]
    fn a_player_predecessor_is_not_the_row() {
        let mut c = boot();
        let g = mint_one(&mut c, alice(), 8);
        ctx(alice(), 5, 10);
        c.open_attempt(alice(), g, "direct call".into());
    }

    #[test]
    #[should_panic(expected = "ERR_OPEN")]
    fn one_open_attempt_per_row_owner() {
        let mut c = boot();
        let g = mint_one(&mut c, alice(), 8);
        ctx(board(), 5, 10);
        c.open_attempt(alice(), g, "one".into());
        ctx(board(), 5, 11);
        c.open_attempt(alice(), g, "two".into());
    }

    #[test]
    fn in_oath_pays_and_over_oath_refuses_with_one_badge() {
        let mut c = boot();
        let g = mint_one(&mut c, alice(), 8);
        ctx(board(), 5, 10);
        let ok = c.open_attempt(bob(), g, "inside".into());
        let (env, response) = env_for(&c, ok, bob(), "inside", 4);
        let verdict = c.resolve(env, response);
        assert_eq!(verdict, "paid");
        assert_eq!(c.get_guardian(g).unwrap().pot.0, 41);
        assert_eq!(c.get_earnings(alice()).0, 1);

        ctx(board(), 5, 12);
        let bad = c.open_attempt(alice(), g, "outside".into());
        let (mut env, response) = env_for(&c, bad, alice(), "outside", 50);
        env.pay_amount = U128(50);
        let verdict = c.resolve(env, response);
        assert_eq!(verdict, "refused");
        let token = format!("case:{bad}");
        assert_eq!(c.mt_balance_of(alice(), token.clone()).0, 1);
        assert_eq!(c.mt_supply(token).unwrap().0, 1);
        assert!(c.get_attempt(bad).unwrap().badge);
        assert_eq!(c.get_guardian(g).unwrap().pot.0, 41);
    }

    #[test]
    #[should_panic(expected = "ERR_STATE")]
    fn a_second_resolve_does_not_mint_another_badge() {
        let mut c = boot();
        let g = mint_one(&mut c, alice(), 1);
        ctx(board(), 5, 10);
        let bad = c.open_attempt(bob(), g, "again".into());
        let (env, response) = env_for(&c, bad, bob(), "again", 9);
        assert_eq!(c.resolve(env.clone(), response.clone()), "refused");
        c.resolve(env, response);
    }

    #[test]
    #[should_panic(expected = "ERR_ENVELOPE")]
    fn a_swapped_nonce_rejects() {
        let mut c = boot();
        let g = mint_one(&mut c, alice(), 8);
        ctx(board(), 5, 10);
        let id = c.open_attempt(bob(), g, "bound".into());
        let (mut env, response) = env_for(&c, id, bob(), "bound", 1);
        env.nonce = 99;
        c.resolve(env, response);
    }

    #[test]
    #[should_panic(expected = "ERR_ENVELOPE")]
    fn a_swapped_oath_rejects() {
        let mut c = boot();
        let g = mint_one(&mut c, alice(), 8);
        ctx(board(), 5, 10);
        let id = c.open_attempt(bob(), g, "bound".into());
        let (mut env, response) = env_for(&c, id, bob(), "bound", 1);
        env.oath_hash = "00".into();
        c.resolve(env, response);
    }

    #[test]
    #[should_panic(expected = "ERR_RESPONSE")]
    fn a_swapped_response_rejects() {
        let mut c = boot();
        let g = mint_one(&mut c, alice(), 8);
        ctx(board(), 5, 10);
        let id = c.open_attempt(bob(), g, "bound".into());
        let (env, _) = env_for(&c, id, bob(), "bound", 1);
        c.resolve(env, "other words".into());
    }

    #[test]
    #[should_panic(expected = "ERR_ENVELOPE")]
    fn a_swapped_player_rejects() {
        let mut c = boot();
        let g = mint_one(&mut c, alice(), 8);
        ctx(board(), 5, 10);
        let id = c.open_attempt(bob(), g, "bound".into());
        let (mut env, response) = env_for(&c, id, bob(), "bound", 1);
        env.player = alice();
        c.resolve(env, response);
    }

    #[test]
    #[should_panic(expected = "ERR_SLEEP")]
    fn an_empty_budget_does_not_take_the_fee() {
        let mut c = boot();
        let g = mint_one(&mut c, alice(), 8);
        ctx(owner(), 0, 2);
        c.set_inference(U128(0), U128(10), false);
        let pot = c.get_guardian(g).unwrap().pot.0;
        ctx(board(), 5, 10);
        let _ = c.open_attempt(bob(), g, "asleep".into());
        let _ = pot;
    }

    #[test]
    fn timeout_refunds_the_entry_fee_and_releases_the_row() {
        let mut c = boot();
        let g = mint_one(&mut c, alice(), 8);
        ctx(board(), 5, 10);
        let id = c.open_attempt(bob(), g, "wait".into());
        ctx(board(), 0, 10 + TIMEOUT_NS + 1);
        c.refund_timeout(id);
        assert_eq!(c.get_attempt(id).unwrap().state, "refunded");
        ctx(board(), 5, 10 + TIMEOUT_NS + 2);
        let next = c.open_attempt(bob(), g, "again".into());
        assert_ne!(next, id);
    }

    #[test]
    #[should_panic(expected = "ERR_LIABILITY")]
    fn close_refuses_while_a_pot_remains() {
        let mut c = boot();
        mint_one(&mut c, alice(), 8);
        ctx(owner(), 1, 3);
        c.close();
    }

    #[test]
    fn close_after_the_pot_and_earnings_are_cleared() {
        let mut c = boot();
        let g = mint_one(&mut c, alice(), 100);
        ctx(board(), 5, 10);
        let id = c.open_attempt(bob(), g, "inside".into());
        let (env, response) = env_for(&c, id, bob(), "inside", 45);
        assert_eq!(c.resolve(env, response), "paid");
        let earned = c.get_earnings(alice()).0;
        assert!(earned > 0);
        ctx(board(), 0, 20);
        c.withdraw(alice(), U128(earned));
        assert_eq!(c.get_earnings(alice()).0, 0);
        assert_eq!(c.get_guardian(g).unwrap().pot.0, 0);
        ctx(owner(), 1, 21);
        c.close();
    }

    #[test]
    fn clean_starts_from_an_empty_state() {
        let c = Contract::clean(board(), owner());
        assert_eq!(c.get_config().version, 2);
        assert_eq!(c.get_config().verifier, "unverified");
        assert!(c.get_guardian(1).is_none());
    }

    #[test]
    fn migrate_and_upgrade_are_owner_only() {
        let mut c = boot();
        ctx(owner(), 0, 2);
        c.migrate();
        assert_eq!(c.get_config().version, 2);
        assert_eq!(c.get_config().verifier, "unverified");
        ctx(owner(), 1, 3);
        c.upgrade();
        assert_eq!(c.get_config().upgrade_nonce, 1);
    }

    #[test]
    #[should_panic(expected = "ERR_OWNER")]
    fn a_visitor_cannot_upgrade() {
        let mut c = boot();
        ctx(board(), 1, 3);
        c.upgrade();
    }

    #[test]
    fn a_badge_moves_with_one_yocto() {
        let mut c = boot();
        let g = mint_one(&mut c, alice(), 1);
        ctx(board(), 5, 10);
        let bad = c.open_attempt(bob(), g, "no".into());
        let (env, response) = env_for(&c, bad, bob(), "no", 9);
        c.resolve(env, response);
        let token = format!("case:{bad}");
        ctx(bob(), 1, 11);
        c.mt_transfer(alice(), token.clone(), U128(1), None);
        assert_eq!(c.mt_balance_of(bob(), token.clone()).0, 0);
        assert_eq!(c.mt_balance_of(alice(), token).0, 1);
        let nft = c.nft_token(g.to_string()).unwrap();
        assert_eq!(nft.owner_id, alice());
        assert_eq!(nft.metadata.title, "Lamp");
    }

    #[test]
    fn subsidy_discloses_zero_inference_cost() {
        let mut c = boot();
        ctx(owner(), 0, 2);
        c.set_inference(U128(1_000), U128(10), true);
        let g = mint_one(&mut c, alice(), 8);
        ctx(board(), 5, 10);
        let id = c.open_attempt(bob(), g, "inside".into());
        let (env, response) = env_for(&c, id, bob(), "inside", 1);
        c.resolve(env, response);
        let row = c.get_attempt(id).unwrap();
        assert!(row.subsidy);
        assert_eq!(row.inference.0, 0);
        assert_eq!(c.get_config().inference_budget.0, 1_000);
    }
}
