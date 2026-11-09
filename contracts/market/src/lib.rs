//! Market Day on arena.nearcarta.near.
//!
//! Goods, items and investor shares are NEP-245 tokens in this one contract.
//! Shops are the city's nine locations, each run by a keeper account. A shop's
//! shelf is the keeper's NEP-245 balance here; its till is NEAR this contract
//! holds for it. Every price comes from `pricing.rs`.
//!
//! Who may call what:
//! - `gather`, `sell`, `craft`, `fill_order`, `claim`: the player directly
//!   (a function-call key on this contract; gas from the relayer). They never
//!   move NEAR out of the player.
//! - `buy`, `invest`, `post_order`, keeper `restock`: through the player's or
//!   keeper's row on the board (`propose_call_as`), so the charter caps the NEAR.
//!   Through the board, `row_owner` only names who RECEIVES, never whose goods
//!   or NEAR are taken, so a forged `row_owner` can only give a gift.
//! - Setup, caps and the kill switch: the owner.
//! There is no public re-init. `migrate` is private and reads state by version.
pub mod mt;
pub mod pricing;
pub mod shops;

use near_sdk::json_types::{U128, U64};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise};

pub const STATE_VERSION: u32 = 1;
pub const DAY_NS: u64 = 86_400_000_000_000;
pub const HOUR_NS: u64 = 3_600_000_000_000;
pub const MILLI: u128 = 1_000_000_000_000_000_000_000;

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Caps {
    /// Units a player may gather per UTC day.
    pub gathers_per_day: u32,
    /// NEAR a player may receive from sales and wages per UTC day.
    pub player_payout_per_day: U128,
    /// NEAR all shops together may pay out per UTC day: the most the game can leak.
    pub city_payout_per_day: U128,
    /// Storage deposit a player needs before the first write.
    pub storage_min: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Default)]
pub struct PlayerDay {
    pub day: u32,
    pub gathers: u32,
    pub paid: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Default)]
pub struct Citizen {
    /// Storage deposit still available, yoctoNEAR.
    pub storage: U128,
    /// Orders filled, ever. Level = the number of digits of this, plus one.
    pub reputation: u32,
    /// Gathers made with a tool since it was last worn down.
    pub tool_uses: u32,
}

#[near(contract_state, contract_metadata(
    version = "1.0.0",
    link = "https://github.com/nearcarta/nearcarta/tree/main/contracts/market",
    standard(standard = "nep245", version = "1.0.0"),
    standard(standard = "nep330", version = "1.2.0")
))]
#[derive(PanicOnDefault)]
pub struct Contract {
    pub version: u32,
    pub owner: AccountId,
    pub board: AccountId,
    pub paused: bool,
    pub caps: Caps,
    pub city_day: u32,
    pub city_paid: u128,
    pub next_order: u64,
    pub tokens: IterableMap<String, mt::TokenMeta>,
    pub balances: LookupMap<(AccountId, String), u128>,
    pub supply: LookupMap<String, u128>,
    pub owned: LookupMap<AccountId, Vec<String>>,
    pub shops: IterableMap<String, shops::Shop>,
    pub demand: LookupMap<(String, String), shops::Demand>,
    pub nodes: LookupMap<String, String>,
    pub last_gather: LookupMap<(AccountId, String), u64>,
    pub share_debt: LookupMap<(AccountId, String), u128>,
    pub orders: IterableMap<u64, shops::Order>,
    pub citizens: LookupMap<AccountId, Citizen>,
    pub days: LookupMap<AccountId, PlayerDay>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, board: AccountId, caps: Caps) -> Self {
        require!(owner != board, "ERR_BOARD");
        Self {
            version: STATE_VERSION,
            owner,
            board,
            paused: false,
            caps,
            city_day: 0,
            city_paid: 0,
            next_order: 1,
            tokens: IterableMap::new(b"t"),
            balances: LookupMap::new(b"b"),
            supply: LookupMap::new(b"s"),
            owned: LookupMap::new(b"w"),
            shops: IterableMap::new(b"k"),
            demand: LookupMap::new(b"d"),
            nodes: LookupMap::new(b"n"),
            last_gather: LookupMap::new(b"l"),
            share_debt: LookupMap::new(b"h"),
            orders: IterableMap::new(b"o"),
            citizens: LookupMap::new(b"c"),
            days: LookupMap::new(b"y"),
        }
    }

    // ---------- owner ----------

    /// The kill switch: every player and keeper method refuses while paused.
    pub fn set_paused(&mut self, paused: bool) {
        self.only_owner();
        self.paused = paused;
        shops::Ev::new().n("paused", paused as u64).market("paused");
    }

    pub fn set_caps(&mut self, caps: Caps) {
        self.only_owner();
        self.caps = caps;
    }

    /// Owner only, 1 yocto. The input is the raw wasm; `migrate` runs in the same batch.
    #[payable]
    pub fn upgrade(&mut self) -> Promise {
        near_sdk::assert_one_yocto();
        self.only_owner();
        let code = env::input().unwrap_or_default();
        require!(!code.is_empty(), "ERR_NO_CODE");
        Promise::new(env::current_account_id())
            .deploy_contract(code)
            .function_call("migrate".to_string(), Vec::new(), NearToken::from_yoctonear(0), Gas::from_tgas(50))
    }

    /// Reads the stored state by its version. A later layout adds a `legacy::Vn`
    /// struct and converts here. Private: only this account (the upgrade batch).
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        require!(env::predecessor_account_id() == env::current_account_id(), "ERR_PRIVATE");
        let raw = env::storage_read(b"STATE").expect("ERR_NO_STATE");
        require!(raw.len() >= 4, "ERR_STATE");
        let version = u32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]]);
        match version {
            STATE_VERSION => near_sdk::borsh::from_slice::<Contract>(&raw).expect("ERR_STATE"),
            _ => env::panic_str("ERR_VERSION"),
        }
    }

    // ---------- storage (NEP-145 style) ----------

    /// Adds a storage deposit for `account_id` (default: the caller). The relayer
    /// sponsors a new citizen with this once.
    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>) -> U128 {
        let who = account_id.unwrap_or_else(env::predecessor_account_id);
        let add = env::attached_deposit().as_yoctonear();
        require!(add > 0, "ERR_DEPOSIT");
        let mut c = self.citizens.get(&who).cloned().unwrap_or_default();
        c.storage = U128(c.storage.0 + add);
        let left = c.storage;
        self.citizens.insert(who, c);
        left
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> U128 {
        self.citizens.get(&account_id).map(|c| c.storage).unwrap_or(U128(0))
    }

    // ---------- views ----------

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            version: self.version,
            owner: self.owner.clone(),
            board: self.board.clone(),
            paused: self.paused,
            caps: self.caps.clone(),
            city_day: self.city_day,
            city_paid_today: U128(if self.city_day == today() { self.city_paid } else { 0 }),
        }
    }

    pub fn get_citizen(&self, account_id: AccountId) -> CitizenView {
        let c = self.citizens.get(&account_id).cloned().unwrap_or_default();
        let d = self.days.get(&account_id).cloned().unwrap_or_default();
        let fresh = d.day == today();
        CitizenView {
            storage: c.storage,
            reputation: c.reputation,
            level: level(c.reputation),
            gathers_today: if fresh { d.gathers } else { 0 },
            paid_today: if fresh { d.paid } else { U128(0) },
        }
    }
}

#[near(serializers = [json])]
pub struct ConfigView {
    pub version: u32,
    pub owner: AccountId,
    pub board: AccountId,
    pub paused: bool,
    pub caps: Caps,
    pub city_day: u32,
    pub city_paid_today: U128,
}

#[near(serializers = [json])]
pub struct CitizenView {
    pub storage: U128,
    pub reputation: u32,
    pub level: u32,
    pub gathers_today: u32,
    pub paid_today: U128,
}

pub fn today() -> u32 {
    (env::block_timestamp() / DAY_NS) as u32
}

pub fn level(reputation: u32) -> u32 {
    let mut l = 1;
    let mut r = reputation;
    while r >= 3 {
        l += 1;
        r /= 3;
    }
    l
}

impl Contract {
    pub(crate) fn only_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "ERR_OWNER");
    }

    pub(crate) fn live(&self) {
        require!(!self.paused, "ERR_PAUSED");
    }

    /// A direct call: the caller is the actor. Used for every method that takes
    /// goods or NEAR from the caller.
    pub(crate) fn me(&self) -> AccountId {
        self.live();
        let who = env::predecessor_account_id();
        require!(who != self.board, "ERR_DIRECT_ONLY");
        who
    }

    /// A board call: the row named by the board RECEIVES what the deposit buys.
    pub(crate) fn via_board(&self, row_owner: AccountId) -> AccountId {
        self.live();
        require!(env::predecessor_account_id() == self.board, "ERR_BOARD_ONLY");
        require!(row_owner != self.board && row_owner != env::current_account_id(), "ERR_ROW");
        row_owner
    }

    /// Charges the storage a write path grew to `who`'s deposit, and credits back
    /// what it freed. Call with the usage read before the writes.
    /// Writes every cached collection so `storage_usage` sees this call's bytes.
    pub(crate) fn flush_all(&mut self) {
        self.tokens.flush();
        self.balances.flush();
        self.supply.flush();
        self.owned.flush();
        self.shops.flush();
        self.demand.flush();
        self.nodes.flush();
        self.last_gather.flush();
        self.share_debt.flush();
        self.orders.flush();
        self.citizens.flush();
        self.days.flush();
    }

    /// Flushes pending writes and returns the bytes used, the start mark for a charge.
    pub(crate) fn mark(&mut self) -> u64 {
        self.flush_all();
        env::storage_usage()
    }

    pub(crate) fn settle_storage(&mut self, who: &AccountId, before: u64) {
        self.flush_all();
        let after = env::storage_usage();
        let byte = env::storage_byte_cost().as_yoctonear();
        let mut c = self.citizens.get(who).cloned().unwrap_or_default();
        if after > before {
            let cost = (after - before) as u128 * byte;
            require!(c.storage.0 >= cost, "ERR_STORAGE: deposit storage first");
            c.storage = U128(c.storage.0 - cost);
        } else {
            c.storage = U128(c.storage.0 + (before - after) as u128 * byte);
        }
        self.citizens.insert(who.clone(), c);
    }

    /// Counts NEAR a player receives today against both daily caps.
    pub(crate) fn count_payout(&mut self, who: &AccountId, amount: u128) {
        let day = today();
        let mut d = self.days.get(who).cloned().unwrap_or_default();
        if d.day != day {
            d = PlayerDay { day, gathers: 0, paid: U128(0) };
        }
        require!(d.paid.0 + amount <= self.caps.player_payout_per_day.0, "ERR_PLAYER_DAILY_CAP");
        if self.city_day != day {
            self.city_day = day;
            self.city_paid = 0;
        }
        require!(self.city_paid + amount <= self.caps.city_payout_per_day.0, "ERR_CITY_DAILY_CAP");
        self.city_paid += amount;
        d.paid = U128(d.paid.0 + amount);
        self.days.insert(who.clone(), d);
    }

    pub(crate) fn count_gather(&mut self, who: &AccountId) {
        let day = today();
        let mut d = self.days.get(who).cloned().unwrap_or_default();
        if d.day != day {
            d = PlayerDay { day, gathers: 0, paid: U128(0) };
        }
        require!(d.gathers < self.caps.gathers_per_day, "ERR_GATHER_DAILY_CAP");
        d.gathers += 1;
        self.days.insert(who.clone(), d);
    }
}

#[allow(dead_code)]
fn _types(_: U64) {}

#[cfg(test)]
mod tests;
