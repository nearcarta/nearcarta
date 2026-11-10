//! Player stalls in the Arena square, the in-market purse, and the keepers' council.
//!
//! Purse: a player may keep what a sale or an order pays inside the market (`keep: true`), then spend it
//! with direct zero-deposit calls (relayable, no wallet) or `withdraw` it to their wallet.
//! Stalls: a player rents one of the square's stalls from their purse and sells goods from their bag at
//! their own price. The rent goes to the Arena square's till.
//! Council: the keepers vote; at quorum a market rule changes on chain. No code change, no owner call.
use crate::shops::{decision_id, Ev};
use crate::{Contract, ContractExt, DAY_NS, MILLI};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde::Serialize;
use near_sdk::{env, near, require, AccountId, NearToken, Promise};

pub const STALLS: u32 = 4;
pub const ARENA: &str = "arena";

#[near(serializers = [borsh])]
#[derive(Clone, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Rules {
    /// A shop is open while its till is at least floor * floor_bps / 10000.
    pub floor_bps: u32,
    /// Rent for one stall for `stall_days`, from the renter's purse.
    pub stall_rent: U128,
    pub stall_days: u32,
}

#[near(serializers = [borsh])]
#[derive(Clone, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Stall {
    pub id: u32,
    pub holder: AccountId,
    pub until: U64,
    pub good: String,
    pub qty: u32,
    pub price: U128,
    pub sales: u32,
}

#[near(serializers = [borsh])]
#[derive(Clone, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Square {
    pub rules: Rules,
    pub council: Council,
    pub stalls: Vec<Stall>,
    pub purse: U128,
}

#[near(serializers = [borsh])]
#[derive(Clone, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Proposal {
    pub id: U64,
    pub rule: String,
    pub value: U128,
    pub by: AccountId,
    pub yes: Vec<AccountId>,
    pub no: Vec<AccountId>,
    pub decision: String,
}

#[near(serializers = [borsh])]
#[derive(Clone, Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Council {
    pub members: Vec<AccountId>,
    pub quorum: u32,
    pub next: u64,
    pub open: Option<Proposal>,
}

fn pay(to: &AccountId, amount: u128) {
    if amount > 0 { Promise::new(to.clone()).transfer(NearToken::from_yoctonear(amount)).detach(); }
}

#[near]
impl Contract {
    /// Spends the purse: `withdraw` pays it to the wallet, `invest` buys shares in `shop`
    /// (one per milliNEAR, as `invest` does with a deposit).
    pub fn purse(&mut self, action: String, amount: U128, shop: Option<String>) -> U128 {
        let me = self.me();
        if action == "withdraw" {
            self.take_purse(&me, amount.0);
            pay(&me, amount.0);
            Ev::new().s("player", me.as_str()).u("amount", amount.0).market("withdraw");
            return amount;
        }
        require!(action == "invest", "ERR_ACTION");
        let units = amount.0 / crate::shops::SHARE_UNIT;
        require!(units > 0, "ERR_INVEST_MIN");
        self.take_purse(&me, units * crate::shops::SHARE_UNIT);
        let before = self.mark();
        let u = self.add_shares(&me, &shop.unwrap_or_else(|| env::panic_str("ERR_SHOP")), units, None);
        self.settle_storage(&me, before);
        u
    }

    /// One stall in the Arena square.
    /// `rent`: a free (or expired) stall for `stall_days`, paid from the purse into the Arena till.
    /// `list`: the holder puts `qty` of `good` from their bag on it at unit `price`.
    /// `buy`: anyone else buys `qty`, from their purse into the holder's, at most `price` in total.
    pub fn stall(&mut self, stall: u32, action: String, good: Option<String>, qty: Option<u32>, price: Option<U128>) -> U128 {
        let me = self.me();
        require!((1..=STALLS).contains(&stall), "ERR_STALL");
        let now = env::block_timestamp();
        let before = self.mark();
        let cur = self.stalls.get(&stall).cloned();
        let qty = qty.unwrap_or(0);
        let out = match action.as_str() {
            "rent" => {
                if let Some(s) = &cur { require!(s.until.0 < now || s.holder == me, "ERR_STALL_TAKEN"); }
                let rent = self.rules.stall_rent.0;
                self.take_purse(&me, rent);
                if let Some(mut a) = self.shops.get(ARENA).cloned() { a.till = U128(a.till.0 + rent); self.shops.insert(ARENA.to_string(), a); }
                let until = now + self.rules.stall_days as u64 * DAY_NS;
                self.stalls.insert(stall, Stall { id: stall, holder: me.clone(), until: U64(until), good: String::new(), qty: 0, price: U128(0), sales: 0 });
                Ev::new().s("player", me.as_str()).n("stall", stall as u64).u("rent", rent).n("until", until).market("stall_rented");
                rent
            }
            "list" => {
                let mut s = cur.unwrap_or_else(|| env::panic_str("ERR_STALL"));
                require!(s.holder == me && s.until.0 >= now, "ERR_NOT_HOLDER");
                let good = good.unwrap_or_default();
                let price = price.map(|p| p.0).unwrap_or(0);
                require!(self.tokens.get(&good).map(|m| m.kind != "share").unwrap_or(false), "ERR_GOOD");
                require!(qty <= 50 && price > 0 && price <= 10 * MILLI, "ERR_LISTING");
                require!(self.bal(&me, &good) >= qty as u128, "ERR_BAG");
                Ev::new().s("player", me.as_str()).n("stall", stall as u64).s("good", &good).n("qty", qty as u64).u("price", price).market("stall_listed");
                s.good = good; s.qty = qty; s.price = U128(price);
                self.stalls.insert(stall, s);
                price
            }
            "buy" => {
                let mut s = cur.unwrap_or_else(|| env::panic_str("ERR_STALL"));
                require!(s.until.0 >= now, "ERR_STALL_CLOSED");
                require!(s.holder != me, "ERR_OWN_STALL");
                require!(qty >= 1 && qty <= s.qty, "ERR_QTY");
                let total = s.price.0 * qty as u128;
                require!(total <= price.map(|p| p.0).unwrap_or(0), "ERR_PRICE_MOVED");
                self.take_purse(&me, total);
                let holder = s.holder.clone();
                let good = s.good.clone();
                self.move_one(&holder, &me, &good, qty as u128, "stall");
                self.credit_purse(&holder, total);
                s.qty -= qty; s.sales += qty;
                self.stalls.insert(stall, s);
                Ev::new().s("player", me.as_str()).s("holder", holder.as_str()).n("stall", stall as u64).s("good", &good).n("qty", qty as u64).u("total", total).market("stall_sale");
                total
            }
            _ => env::panic_str("ERR_ACTION"),
        };
        self.settle_storage(&me, before);
        U128(out)
    }

    /// Owner only, while nothing is on the table: who sits on the council and how many make a decision.
    pub fn set_council(&mut self, members: Vec<AccountId>, quorum: u32) {
        self.only_owner();
        require!(self.council.open.is_none(), "ERR_OPEN_PROPOSAL");
        require!(!members.is_empty() && members.len() <= 16 && quorum >= 1 && quorum as usize <= members.len(), "ERR_COUNCIL");
        self.council.members = members;
        self.council.quorum = quorum;
    }

    /// A member votes. With `rule` and `value` it puts a rule change on the table (and votes yes);
    /// without, it votes `yes` on the open one. At quorum the rule changes. `decision` names the
    /// signed NEAR AI answer behind the vote.
    pub fn council(&mut self, yes: bool, rule: Option<String>, value: Option<U128>, decision: Option<String>) -> U64 {
        let me = self.me();
        require!(self.council.members.contains(&me), "ERR_NOT_MEMBER");
        let d = decision_id(&decision);
        let id = if let Some(rule) = rule {
            require!(self.council.open.is_none(), "ERR_OPEN_PROPOSAL");
            let value = value.unwrap_or(U128(0));
            check_rule(&rule, value.0);
            let id = self.council.next; self.council.next += 1;
            self.council.open = Some(Proposal { id: U64(id), rule: rule.clone(), value, by: me.clone(), yes: vec![me.clone()], no: vec![], decision: d.clone() });
            Ev::new().n("proposal", id).s("rule", &rule).u("value", value.0).s("by", me.as_str()).s("decision", &d).market("council_proposed");
            id
        } else {
            let mut p = self.council.open.clone().unwrap_or_else(|| env::panic_str("ERR_NO_PROPOSAL"));
            require!(!p.yes.contains(&me) && !p.no.contains(&me), "ERR_VOTED");
            if yes { p.yes.push(me.clone()) } else { p.no.push(me.clone()) }
            let id = p.id.0;
            self.council.open = Some(p);
            Ev::new().n("proposal", id).s("member", me.as_str()).n("yes", yes as u64).s("decision", &d).market("council_vote");
            id
        };
        self.settle_proposal();
        U64(id)
    }

    /// The square in one read: rules, council, stalls, and one player's purse.
    pub fn square(&self, account_id: Option<AccountId>) -> Square {
        Square {
            rules: self.rules.clone(),
            council: self.council.clone(),
            stalls: self.stalls.values().cloned().collect(),
            purse: U128(account_id.and_then(|a| self.purses.get(&a).copied()).unwrap_or(0)),
        }
    }
}

fn check_rule(rule: &str, v: u128) {
    match rule {
        "floor_bps" => require!((5_000..=10_000).contains(&v), "ERR_RULE_VALUE"),
        "stall_rent" => require!(v >= MILLI / 10 && v <= 10 * MILLI, "ERR_RULE_VALUE"),
        "stall_days" => require!((1..=30).contains(&v), "ERR_RULE_VALUE"),
        _ => env::panic_str("ERR_RULE"),
    }
}

impl Contract {
    fn settle_proposal(&mut self) {
        let Some(p) = self.council.open.clone() else { return };
        let n = self.council.members.len() as u32;
        if p.yes.len() as u32 >= self.council.quorum {
            match p.rule.as_str() {
                "floor_bps" => self.rules.floor_bps = p.value.0 as u32,
                "stall_rent" => self.rules.stall_rent = p.value,
                _ => self.rules.stall_days = p.value.0 as u32,
            }
            self.council.open = None;
            Ev::new().n("proposal", p.id.0).s("rule", &p.rule).u("value", p.value.0).n("yes", p.yes.len() as u64).market("rule_changed");
        } else if p.no.len() as u32 > n - self.council.quorum {
            self.council.open = None;
            Ev::new().n("proposal", p.id.0).s("rule", &p.rule).market("proposal_rejected");
        }
    }

    pub(crate) fn credit_purse(&mut self, who: &AccountId, amount: u128) {
        let p = self.purses.get(who).copied().unwrap_or(0);
        self.purses.insert(who.clone(), p + amount);
    }

    pub(crate) fn take_purse(&mut self, who: &AccountId, amount: u128) {
        let p = self.purses.get(who).copied().unwrap_or(0);
        require!(p >= amount, "ERR_PURSE");
        self.purses.insert(who.clone(), p - amount);
    }

    /// The floor the council's rule makes effective for this shop.
    pub(crate) fn floor_of(&self, floor: u128) -> u128 { floor * self.rules.floor_bps as u128 / 10_000 }
}
