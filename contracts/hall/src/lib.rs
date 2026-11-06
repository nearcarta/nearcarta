//! Town Hall jobs. One account, any visitor.
//!
//! `migrate` drops the old oath state. The deploy script refunds every open
//! bounty to the account that posted it before this method runs.
//! The board writes the top-level `row_owner`. This contract trusts that field
//! only when the predecessor is the board. A direct call must be the same account.
//! Workers, prices, and budgets come from the call. None are stored in the code.
use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

const OPEN: u8 = 0;
const QUOTED: u8 = 1;
const COUNTERED: u8 = 2;
const AWARDED: u8 = 3;
const HELD: u8 = 4;
const RELEASED: u8 = 5;
const REFUNDED: u8 = 6;
const MAX_PARTS: u32 = 8;
const DAY_NS: u64 = 86_400_000_000_000;

#[derive(Clone)]
#[near(serializers = [borsh])]
pub struct Part {
    pub budget: u128,
    pub quote: u128,
    pub worker: Option<AccountId>,
    pub counters: u8,
    pub counter: u128,
    pub awarded: u128,
    pub phase: u8,
}

#[derive(Clone)]
#[near(serializers = [borsh])]
pub struct Job {
    pub owner: AccountId,
    pub task: String,
    pub budget: u128,
    pub remaining: u128,
    pub paid: u128,
    pub refunded: u128,
    pub deadline: u64,
    pub workers: Vec<AccountId>,
    pub parts: Vec<Part>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Hall {
    owner: AccountId,
    board: AccountId,
    next_id: u64,
    jobs: IterableMap<u64, Job>,
    stakes: IterableMap<AccountId, u128>,
    keys: LookupMap<String, u64>,
}

impl Hall {
    fn empty(owner: AccountId, board: AccountId) -> Self {
        require!(owner != board, "ERR_INIT");
        Self {
            owner,
            board,
            next_id: 1,
            jobs: IterableMap::new(b"j"),
            stakes: IterableMap::new(b"s"),
            keys: LookupMap::new(b"k"),
        }
    }

    fn actor(&self, row_owner: &AccountId) -> AccountId {
        let pred = env::predecessor_account_id();
        require!(pred == self.board || pred == *row_owner, "ERR_ROW");
        row_owner.clone()
    }

    fn not_shop(&self, id: &AccountId) {
        require!(id != &self.board && id != &env::current_account_id(), "ERR_WORKER");
    }
}

fn conserved(job: &Job) {
    require!(job.paid + job.remaining + job.refunded == job.budget, "ERR_ESCROW");
}

fn locked(job: &Job) -> u128 {
    job.parts.iter().filter(|p| p.phase == AWARDED || p.phase == HELD).map(|p| p.awarded).sum()
}

fn job_key(id: U128) -> u64 {
    u64::try_from(id.0).unwrap_or_else(|_| env::panic_str("ERR_JOB"))
}

#[near]
impl Hall {
    #[init]
    pub fn new(owner: AccountId, board: AccountId) -> Self {
        let pred = env::predecessor_account_id();
        require!(pred == owner || pred == env::current_account_id(), "ERR_INIT");
        Self::empty(owner, board)
    }

    /// Clean state. The predecessor is this account (its full-access key) or the owner.
    /// Open bounties on the previous code are not visible here. Refund them first.
    #[init(ignore_state)]
    pub fn migrate(owner: AccountId, board: AccountId) -> Self {
        let pred = env::predecessor_account_id();
        require!(pred == env::current_account_id() || pred == owner, "ERR_MIGRATE");
        Self::empty(owner, board)
    }

    #[payable]
    pub fn post_job(&mut self, row_owner: AccountId, task: String, parts: u32, deadline: U128, workers: Vec<AccountId>, idempotency: Option<String>) -> u64 {
        let owner = self.actor(&row_owner);
        let budget = env::attached_deposit().as_yoctonear();
        require!(budget > 0, "ERR_AMOUNT");
        let task = task.split_whitespace().collect::<Vec<_>>().join(" ");
        require!(!task.is_empty() && task.len() <= 180, "ERR_TASK");
        require!((1..=MAX_PARTS).contains(&parts), "ERR_PARTS");
        require!(budget >= parts as u128, "ERR_AMOUNT");
        let now = env::block_timestamp();
        require!(deadline.0 <= u64::MAX as u128, "ERR_DEADLINE");
        let deadline = deadline.0 as u64;
        require!(deadline > now && deadline <= now.saturating_add(30 * DAY_NS), "ERR_DEADLINE");
        require!(workers.len() <= MAX_PARTS as usize, "ERR_WORKER");
        let mut seen = Vec::new();
        for w in &workers {
            self.not_shop(w);
            require!(!seen.contains(w), "ERR_WORKER");
            seen.push(w.clone());
        }
        if let Some(key) = idempotency.as_ref().filter(|k| !k.is_empty()) {
            require!(key.len() <= 128, "ERR_KEY");
            require!(self.keys.get(key).is_none(), "ERR_EXISTS");
        }
        let each = budget / parts as u128;
        let mut used = 0u128;
        let mut part_rows = Vec::with_capacity(parts as usize);
        for i in 0..parts {
            let slice = if i + 1 == parts { budget - used } else { each };
            used += slice;
            part_rows.push(Part {
                budget: slice, quote: 0, worker: None, counters: 0, counter: 0, awarded: 0, phase: OPEN,
            });
        }
        let id = self.next_id;
        self.next_id += 1;
        let job = Job {
            owner, task, budget, remaining: budget, paid: 0, refunded: 0, deadline, workers, parts: part_rows,
        };
        conserved(&job);
        self.jobs.insert(id, job);
        if let Some(key) = idempotency.filter(|k| !k.is_empty()) { self.keys.insert(key, id); }
        id
    }

    #[payable]
    pub fn register_agent(&mut self, row_owner: AccountId) {
        let who = self.actor(&row_owner);
        self.not_shop(&who);
        let add = env::attached_deposit().as_yoctonear();
        require!(add > 0, "ERR_STAKE");
        let next = self.stakes.get(&who).copied().unwrap_or(0).saturating_add(add);
        self.stakes.insert(who, next);
    }

    pub fn withdraw_stake(&mut self, row_owner: AccountId) -> Promise {
        let who = self.actor(&row_owner);
        let n = self.stakes.get(&who).copied().unwrap_or(0);
        require!(n > 0, "ERR_STAKE");
        self.stakes.insert(who.clone(), 0);
        Promise::new(who).transfer(NearToken::from_yoctonear(n))
    }

    pub fn bid(&mut self, row_owner: AccountId, job_id: U128, part: u32, price: U128) {
        let worker = self.actor(&row_owner);
        self.not_shop(&worker);
        let mut job = self.jobs.get(&job_key(job_id)).cloned().unwrap_or_else(|| env::panic_str("ERR_JOB"));
        if !job.workers.is_empty() { require!(job.workers.contains(&worker), "ERR_WORKER"); }
        let p = job.parts.get_mut(part as usize).unwrap_or_else(|| env::panic_str("ERR_PART"));
        require!(p.phase == OPEN || p.phase == QUOTED, "ERR_PHASE");
        require!(price.0 > 0 && price.0 <= p.budget, "ERR_AMOUNT");
        p.quote = price.0;
        p.worker = Some(worker);
        p.phase = QUOTED;
        conserved(&job);
        self.jobs.insert(job_key(job_id), job);
    }

    pub fn counter(&mut self, row_owner: AccountId, job_id: U128, part: u32, price: U128) {
        let owner = self.actor(&row_owner);
        let mut job = self.jobs.get(&job_key(job_id)).cloned().unwrap_or_else(|| env::panic_str("ERR_JOB"));
        require!(job.owner == owner, "ERR_ROW");
        let p = job.parts.get_mut(part as usize).unwrap_or_else(|| env::panic_str("ERR_PART"));
        require!(p.phase == QUOTED || p.counters > 0, "ERR_PHASE");
        require!(p.counters == 0, "ERR_COUNTER");
        require!(price.0 > 0 && price.0 <= p.budget, "ERR_AMOUNT");
        p.counters = 1;
        p.counter = price.0;
        p.phase = COUNTERED;
        conserved(&job);
        self.jobs.insert(job_key(job_id), job);
    }

    pub fn accept(&mut self, row_owner: AccountId, job_id: U128, part: u32) {
        let owner = self.actor(&row_owner);
        let mut job = self.jobs.get(&job_key(job_id)).cloned().unwrap_or_else(|| env::panic_str("ERR_JOB"));
        require!(job.owner == owner, "ERR_ROW");
        let p = job.parts.get_mut(part as usize).unwrap_or_else(|| env::panic_str("ERR_PART"));
        let price = if p.phase == QUOTED { p.quote } else if p.phase == COUNTERED { p.counter } else { env::panic_str("ERR_PHASE") };
        require!(price > 0 && price <= p.budget, "ERR_AMOUNT");
        require!(p.worker.is_some(), "ERR_WORKER");
        p.awarded = price;
        p.phase = AWARDED;
        conserved(&job);
        self.jobs.insert(job_key(job_id), job);
    }

    pub fn deliver(&mut self, row_owner: AccountId, job_id: U128, part: u32) {
        let worker = self.actor(&row_owner);
        let mut job = self.jobs.get(&job_key(job_id)).cloned().unwrap_or_else(|| env::panic_str("ERR_JOB"));
        let p = job.parts.get_mut(part as usize).unwrap_or_else(|| env::panic_str("ERR_PART"));
        require!(p.phase == AWARDED, "ERR_PHASE");
        require!(p.worker.as_ref() == Some(&worker), "ERR_WORKER");
        p.phase = HELD;
        conserved(&job);
        self.jobs.insert(job_key(job_id), job);
    }

    /// A pass pays the awarded price to the worker named on the part.
    /// A fail leaves the budget in escrow and does not touch registration stake.
    pub fn review(&mut self, row_owner: AccountId, job_id: U128, part: u32, pass: bool) -> Promise {
        let owner = self.actor(&row_owner);
        let mut job = self.jobs.get(&job_key(job_id)).cloned().unwrap_or_else(|| env::panic_str("ERR_JOB"));
        require!(job.owner == owner, "ERR_ROW");
        let paid = {
            let p = job.parts.get_mut(part as usize).unwrap_or_else(|| env::panic_str("ERR_PART"));
            require!(p.phase == HELD, "ERR_PHASE");
            if !pass {
                p.phase = REFUNDED;
                p.awarded = 0;
                None
            } else {
                let worker = p.worker.clone().unwrap_or_else(|| env::panic_str("ERR_WORKER"));
                let amount = p.awarded;
                p.phase = RELEASED;
                Some((worker, amount))
            }
        };
        if let Some((worker, amount)) = paid {
            require!(amount > 0 && job.remaining >= amount, "ERR_ESCROW");
            job.remaining -= amount;
            job.paid += amount;
            conserved(&job);
            self.jobs.insert(job_key(job_id), job);
            Promise::new(worker).transfer(NearToken::from_yoctonear(amount))
        } else {
            conserved(&job);
            self.jobs.insert(job_key(job_id), job);
            Promise::new(owner)
        }
    }

    pub fn refund(&mut self, row_owner: AccountId, job_id: U128) -> Promise {
        let owner = self.actor(&row_owner);
        let mut job = self.jobs.get(&job_key(job_id)).cloned().unwrap_or_else(|| env::panic_str("ERR_JOB"));
        require!(job.owner == owner, "ERR_ROW");
        let hold = locked(&job);
        require!(job.remaining >= hold, "ERR_ESCROW");
        let back = job.remaining - hold;
        require!(back > 0, "ERR_NOTHING");
        job.remaining = hold;
        job.refunded += back;
        conserved(&job);
        self.jobs.insert(job_key(job_id), job);
        Promise::new(owner).transfer(NearToken::from_yoctonear(back))
    }

    #[payable]
    pub fn close(&mut self) -> Promise {
        near_sdk::assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner, "ERR_NOT_OWNER");
        for (_, job) in self.jobs.iter() {
            require!(job.remaining == 0, "ERR_OPEN");
        }
        for (_, stake) in self.stakes.iter() {
            require!(*stake == 0, "ERR_STAKE");
        }
        Promise::new(env::current_account_id()).delete_account(self.owner.clone())
    }

    pub fn get_hall(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({
            "owner": self.owner,
            "board": self.board,
            "next_id": self.next_id.to_string(),
            "jobs": self.jobs.len(),
            "stakes": self.stakes.len(),
        })
    }

    pub fn get_job(&self, job_id: U128) -> Option<near_sdk::serde_json::Value> {
        self.jobs.get(&job_key(job_id)).map(|job| near_sdk::serde_json::json!({
            "owner": job.owner,
            "task": job.task,
            "budget": job.budget.to_string(),
            "remaining": job.remaining.to_string(),
            "paid": job.paid.to_string(),
            "refunded": job.refunded.to_string(),
            "deadline": job.deadline.to_string(),
            "workers": job.workers,
            "parts": job.parts.iter().map(|p| near_sdk::serde_json::json!({
                "budget": p.budget.to_string(),
                "quote": p.quote.to_string(),
                "worker": p.worker,
                "counters": p.counters,
                "counter": p.counter.to_string(),
                "awarded": p.awarded.to_string(),
                "phase": p.phase,
            })).collect::<Vec<_>>(),
        }))
    }

    pub fn get_stake(&self, account: AccountId) -> String {
        self.stakes.get(&account).copied().unwrap_or(0).to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn acc(s: &str) -> AccountId { s.parse().unwrap() }

    fn ctx(pred: &str, deposit: u128) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(acc("hall.test"))
            .predecessor_account_id(acc(pred))
            .signer_account_id(acc(pred))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .account_balance(NearToken::from_near(40))
            .block_timestamp(1_000_000_000_000_000)
            .prepaid_gas(near_sdk::Gas::from_tgas(300));
        testing_env!(b.build());
    }

    fn hall() -> Hall {
        ctx("owner.test", 0);
        Hall::new(acc("owner.test"), acc("board.test"))
    }

    fn deadline() -> U128 { U128(1_000_000_000_000_000 + DAY_NS as u128) }

    fn post(h: &mut Hall, pred: &str, row: &str, budget: u128, workers: &[&str]) -> u64 {
        ctx(pred, budget);
        h.post_job(acc(row), "readme pass".into(), 2, deadline(), workers.iter().map(|s| acc(s)).collect(), None)
    }

    #[test]
    fn a_visitor_posts_through_the_board_and_a_pass_pays_the_named_worker() {
        let mut h = hall();
        let id = post(&mut h, "board.test", "alice.test", 10, &["bob.test", "cara.test"]);
        ctx("board.test", 0);
        h.bid(acc("bob.test"), U128(id as u128), 0, U128(4));
        h.counter(acc("alice.test"), U128(id as u128), 0, U128(3));
        h.accept(acc("alice.test"), U128(id as u128), 0);
        h.deliver(acc("bob.test"), U128(id as u128), 0);
        let _ = h.review(acc("alice.test"), U128(id as u128), 0, true);
        let job = h.get_job(U128(id as u128)).unwrap();
        assert_eq!(job["paid"], "3");
        assert_eq!(job["remaining"], "7");
        assert_eq!(job["refunded"], "0");
        assert_eq!(job["parts"][0]["phase"], 5);
        assert_eq!(job["parts"][0]["worker"], "bob.test");
    }

    #[test]
    #[should_panic(expected = "ERR_COUNTER")]
    fn a_second_counter_is_refused() {
        let mut h = hall();
        let id = post(&mut h, "alice.test", "alice.test", 10, &["bob.test"]);
        ctx("bob.test", 0);
        h.bid(acc("bob.test"), U128(id as u128), 0, U128(4));
        ctx("alice.test", 0);
        h.counter(acc("alice.test"), U128(id as u128), 0, U128(3));
        h.counter(acc("alice.test"), U128(id as u128), 0, U128(2));
    }

    #[test]
    fn a_fail_refunds_nothing_from_stake() {
        let mut h = hall();
        ctx("board.test", 5);
        h.register_agent(acc("bob.test"));
        let id = post(&mut h, "board.test", "alice.test", 8, &[]);
        ctx("bob.test", 0);
        h.bid(acc("bob.test"), U128(id as u128), 0, U128(2));
        ctx("alice.test", 0);
        h.accept(acc("alice.test"), U128(id as u128), 0);
        ctx("bob.test", 0);
        h.deliver(acc("bob.test"), U128(id as u128), 0);
        ctx("alice.test", 0);
        let _ = h.review(acc("alice.test"), U128(id as u128), 0, false);
        assert_eq!(h.get_stake(acc("bob.test")), "5");
        let job = h.get_job(U128(id as u128)).unwrap();
        assert_eq!(job["paid"], "0");
        assert_eq!(job["remaining"], "8");
        let _ = h.refund(acc("alice.test"), U128(id as u128));
        let job = h.get_job(U128(id as u128)).unwrap();
        assert_eq!(job["refunded"], "8");
        assert_eq!(job["remaining"], "0");
        assert_eq!(h.get_stake(acc("bob.test")), "5");
    }

    #[test]
    #[should_panic(expected = "ERR_ROW")]
    fn a_stranger_cannot_use_another_row_owner() {
        let mut h = hall();
        ctx("mallory.test", 4);
        h.post_job(acc("alice.test"), "task".into(), 1, deadline(), vec![acc("bob.test")], None);
    }

    #[test]
    #[should_panic(expected = "ERR_WORKER")]
    fn the_shop_and_the_board_are_not_workers() {
        let mut h = hall();
        ctx("alice.test", 4);
        h.post_job(acc("alice.test"), "task".into(), 1, deadline(), vec![acc("board.test")], None);
    }

    #[test]
    fn another_visitor_uses_the_same_methods() {
        let mut h = hall();
        let id = post(&mut h, "board.test", "dora.test", 9, &["ed.test"]);
        let job = h.get_job(U128(id as u128)).unwrap();
        assert_eq!(job["owner"], "dora.test");
        assert_eq!(job["workers"][0], "ed.test");
        assert_eq!(h.get_hall()["jobs"], 1);
    }

    #[test]
    fn migrate_starts_empty_for_the_owner_only() {
        ctx("hall.test", 0);
        let h = Hall::migrate(acc("owner.test"), acc("board.test"));
        assert_eq!(h.get_hall()["jobs"], 0);
        assert_eq!(h.get_hall()["owner"], "owner.test");
        assert_eq!(h.get_hall()["board"], "board.test");
    }

    #[test]
    #[should_panic(expected = "ERR_MIGRATE")]
    fn a_stranger_cannot_migrate() {
        ctx("mallory.test", 0);
        let _ = Hall::migrate(acc("owner.test"), acc("board.test"));
    }
}
