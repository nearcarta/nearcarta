//! Shops, orders, gathering, crafting and investment. Prices from `pricing.rs`.
use crate::mt::{valid_id, TokenMeta, SHARE};
use crate::pricing::{self, Quote};
use crate::{today, Contract, ContractExt, HOUR_NS, MILLI};
use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near, require, AccountId, NearToken, Promise};

pub const GATHER_NS: u64 = 30_000_000_000;
pub const MAX_QTY: u32 = 10;
pub const SHARE_UNIT: u128 = MILLI;
pub const ACC: u128 = 1_000_000;
/// Investors receive this part of every later sale, until 110% of their money is back.
pub const DIVIDEND_BPS: u128 = 2_000;
pub const REPAY_BPS: u128 = 11_000;
/// A tool wears out after this many gathers.
pub const TOOL_LIFE: u32 = 10;
pub const TOOL: &str = "item:tool";
pub const MAX_ORDERS: usize = 64;

/// (item, inputs). Crafting happens at the market square.
pub const RECIPES: &[(&str, &[(&str, u128)])] = &[
    ("item:tool", &[("good:iron", 2), ("good:timber", 1)]),
    ("item:tonic", &[("good:herb", 2), ("good:salt", 1)]),
];

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct GoodCfg {
    pub good: String,
    pub base: U128,
    pub target: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Shop {
    pub id: String,
    pub keeper: AccountId,
    pub till: U128,
    pub floor: U128,
    pub goods: Vec<GoodCfg>,
    pub shares: U128,
    pub acc: U128,
    pub invested: U128,
    /// Dividends still promised to investors (110% of what they put in, less what was paid).
    pub owed: U128,
    /// Dividends set aside and not yet claimed.
    pub held: U128,
    pub trades: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Default)]
pub struct Demand {
    pub hour: U64,
    pub buys: u32,
    pub sells: u32,
    pub prev_buys: u32,
    pub prev_sells: u32,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Order {
    pub id: U64,
    pub poster: AccountId,
    pub good: String,
    pub qty_left: u32,
    pub reward: U128,
    pub escrow: U128,
    pub note: String,
}

#[near(serializers = [json])]
pub struct GoodView {
    pub good: String,
    pub stock: U128,
    pub quote: Quote,
}

#[near(serializers = [json])]
pub struct ShopView {
    pub id: String,
    pub keeper: AccountId,
    pub open: bool,
    pub till: U128,
    pub floor: U128,
    pub shares: U128,
    pub invested: U128,
    pub owed: U128,
    pub trades: U64,
    pub goods: Vec<GoodView>,
}

#[near(serializers = [json])]
pub struct RecipeView {
    pub item: String,
    pub inputs: Vec<(String, U128)>,
}

/// A small JSON event writer. Strings are escaped. It avoids serde_json::Value,
/// which would add about 100 KB of wasm and 1 NEAR of storage stake.
pub struct Ev(String);

pub fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 2);
    for ch in s.chars() {
        match ch {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o
}

impl Ev {
    pub fn new() -> Self { Ev(String::new()) }
    fn sep(&mut self) { if !self.0.is_empty() { self.0.push(','); } }
    pub fn s(mut self, k: &str, v: &str) -> Self { self.sep(); self.0.push_str(&format!("\"{k}\":\"{}\"", esc(v))); self }
    pub fn u(mut self, k: &str, v: u128) -> Self { self.sep(); self.0.push_str(&format!("\"{k}\":\"{v}\"")); self }
    pub fn n(mut self, k: &str, v: u64) -> Self { self.sep(); self.0.push_str(&format!("\"{k}\":{v}")); self }
    pub fn raw(mut self, k: &str, json: &str) -> Self { self.sep(); self.0.push_str(&format!("\"{k}\":{json}")); self }
    pub fn one(self, token: &str, amount: u128) -> Self {
        self.raw("token_ids", &format!("[\"{}\"]", esc(token))).raw("amounts", &format!("[\"{amount}\"]"))
    }
    fn emit(self, standard: &str, event: &str) {
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"{standard}\",\"version\":\"1.0.0\",\"event\":\"{event}\",\"data\":[{{{}}}]}}",
            self.0
        ));
    }
    pub fn market(self, event: &str) { self.emit("nearcarta_market", event) }
    pub fn nep245(self, event: &str) { self.emit("nep245", event) }
}

impl Default for Ev {
    fn default() -> Self { Self::new() }
}

fn hour_now() -> u64 { env::block_timestamp() / HOUR_NS }

fn pay(to: &AccountId, amount: u128) {
    if amount > 0 {
        Promise::new(to.clone()).transfer(NearToken::from_yoctonear(amount)).detach();
    }
}

#[near]
impl Contract {
    // ---------- owner setup ----------

    /// Opens a shop at one of the city's locations, run by `keeper`. The attached NEAR seeds its till.
    #[payable]
    pub fn open_shop(&mut self, id: String, keeper: AccountId, floor: U128, goods: Vec<GoodCfg>) {
        self.only_owner();
        require!(!id.is_empty() && id.len() <= 16 && id.bytes().all(|b| b.is_ascii_lowercase()), "ERR_SHOP_ID");
        require!(self.shops.get(&id).is_none(), "ERR_SHOP_EXISTS");
        require!(!goods.is_empty() && goods.len() <= 6, "ERR_GOODS");
        for g in &goods {
            require!(self.tokens.get(&g.good).map(|m| m.kind != "share").unwrap_or(false), "ERR_GOOD_UNREGISTERED");
            require!(g.base.0 > 0 && g.target.0 > 0, "ERR_GOOD_CFG");
        }
        let share = format!("{SHARE}{id}");
        self.tokens.insert(share, TokenMeta {
            title: format!("Share of {id}"),
            description: "Investor share: 20% of later sales until 110% is repaid. Not transferable.".into(),
            kind: "share".into(),
            icon: None,
        });
        self.shops.insert(id.clone(), Shop {
            id: id.clone(), keeper, till: U128(env::attached_deposit().as_yoctonear()), floor, goods,
            shares: U128(0), acc: U128(0), invested: U128(0), owed: U128(0), held: U128(0), trades: U64(0),
        });
        Ev::new().s("shop", &id).market("shop_opened");
    }

    pub fn stock_shop(&mut self, shop: String, good: String, qty: U128) {
        self.only_owner();
        let s = self.shop(&shop);
        require!(s.goods.iter().any(|g| g.good == good), "ERR_GOOD");
        self.mint(&s.keeper, &good, qty.0, "stock");
    }

    pub fn set_node(&mut self, node: String, good: String) {
        self.only_owner();
        require!(valid_id(&node), "ERR_NODE");
        require!(self.tokens.get(&good).map(|m| m.kind == "good").unwrap_or(false), "ERR_GOOD");
        self.nodes.insert(node, good);
    }

    // ---------- the player, direct calls ----------

    /// One unit from a node (two with a tool), at most once per node every 30 seconds,
    /// within the daily gather cap. Every tenth tool use wears one tool out.
    pub fn gather(&mut self, node: String) -> U128 {
        let me = self.me();
        let before = self.mark();
        let good = self.nodes.get(&node).cloned().unwrap_or_else(|| env::panic_str("ERR_NODE"));
        let key = (me.clone(), node);
        let now = env::block_timestamp();
        if let Some(last) = self.last_gather.get(&key) {
            require!(now >= last + GATHER_NS, "ERR_TOO_SOON");
        }
        self.last_gather.insert(key, now);
        self.count_gather(&me);
        let mut units = 1;
        if self.bal(&me, TOOL) > 0 {
            units = 2;
            let mut c = self.citizens.get(&me).cloned().unwrap_or_default();
            c.tool_uses += 1;
            let worn = c.tool_uses >= TOOL_LIFE;
            if worn { c.tool_uses = 0; }
            self.citizens.insert(me.clone(), c);
            if worn { self.burn(&me, TOOL, 1, "worn"); }
        }
        self.mint(&me, &good, units, "gather");
        self.settle_storage(&me, before);
        U128(units)
    }

    /// Sells `qty` of `good` to an open shop, paid from its till, within the daily caps.
    /// `keep: true` leaves the NEAR in the player's purse here instead of paying it out.
    pub fn sell(&mut self, shop: String, good: String, qty: u32, min_total: U128, keep: Option<bool>) -> U128 {
        let me = self.me();
        let before = self.mark();
        let mut s = self.shop(&shop);
        require!(s.till.0 >= self.floor_of(s.floor.0), "ERR_SHOP_CLOSED");
        require!((1..=MAX_QTY).contains(&qty), "ERR_QTY");
        let cfg = cfg(&s, &good);
        let mut d = self.demand_now(&shop, &good);
        let mut stock = self.bal(&s.keeper, &good);
        let mut total = 0u128;
        for _ in 0..qty {
            total += pricing::quote(&market_of(&s, &cfg, stock, &d, self.floor_of(s.floor.0))).sell.0;
            stock += 1;
        }
        require!(total >= min_total.0, "ERR_PRICE_MOVED");
        require!(s.till.0 >= total, "ERR_TILL");
        self.count_payout(&me, total);
        self.move_one(&me, &s.keeper.clone(), &good, qty as u128, "sell");
        d.sells += qty;
        s.till = U128(s.till.0 - total);
        s.trades = U64(s.trades.0 + 1);
        let closed = s.till.0 < self.floor_of(s.floor.0);
        self.shops.insert(shop.clone(), s);
        self.demand.insert((shop.clone(), good.clone()), d);
        if keep == Some(true) { self.credit_purse(&me, total) }
        self.settle_storage(&me, before);
        if keep != Some(true) { pay(&me, total) }
        Ev::new().s("player", me.as_str()).s("shop", &shop).s("good", &good).n("qty", qty as u64).u("total", total).market("sell");
        if closed { Ev::new().s("shop", &shop).market("shop_closed"); }
        U128(total)
    }

    /// Burns the recipe's inputs and mints the item.
    pub fn craft(&mut self, item: String) {
        let me = self.me();
        let before = self.mark();
        let (_, inputs) = RECIPES.iter().find(|(o, _)| *o == item).unwrap_or_else(|| env::panic_str("ERR_RECIPE"));
        for (good, n) in inputs.iter() {
            self.burn(&me, good, *n, "craft");
        }
        self.mint(&me, &item, 1, "craft");
        self.settle_storage(&me, before);
        Ev::new().s("player", me.as_str()).s("item", &item).market("craft");
    }

    /// Delivers goods to an order: they are burned and the order's escrow pays wages.
    pub fn fill_order(&mut self, order_id: U64, qty: u32, keep: Option<bool>) -> U128 {
        let me = self.me();
        let before = self.mark();
        let mut o = self.orders.get(&order_id.0).cloned().unwrap_or_else(|| env::panic_str("ERR_ORDER"));
        require!(o.poster != me, "ERR_OWN_ORDER");
        require!(qty >= 1 && qty <= o.qty_left, "ERR_QTY");
        let wage = o.reward.0 * qty as u128;
        self.count_payout(&me, wage);
        self.burn(&me, &o.good.clone(), qty as u128, "order");
        o.qty_left -= qty;
        o.escrow = U128(o.escrow.0 - wage);
        if o.qty_left == 0 {
            self.orders.remove(&order_id.0);
        } else {
            self.orders.insert(order_id.0, o);
        }
        let mut c = self.citizens.get(&me).cloned().unwrap_or_default();
        c.reputation += 1;
        self.citizens.insert(me.clone(), c);
        if keep == Some(true) { self.credit_purse(&me, wage) }
        self.settle_storage(&me, before);
        if keep != Some(true) { pay(&me, wage) }
        Ev::new().s("player", me.as_str()).n("order", order_id.0).n("qty", qty as u64).u("wage", wage).market("order_filled");
        U128(wage)
    }

    /// The poster takes back what is left of an order's escrow.
    pub fn cancel_order(&mut self, order_id: U64) -> U128 {
        let me = self.me();
        let o = self.orders.get(&order_id.0).cloned().unwrap_or_else(|| env::panic_str("ERR_ORDER"));
        require!(o.poster == me, "ERR_NOT_POSTER");
        self.orders.remove(&order_id.0);
        pay(&me, o.escrow.0);
        Ev::new().n("order", order_id.0).u("refund", o.escrow.0).market("order_cancelled");
        o.escrow
    }

    pub fn claim(&mut self, shop: String) -> U128 {
        let me = self.me();
        U128(self.pay_dividends(&me, &shop))
    }

    /// The keeper takes NEAR out of its till, never below twice the floor plus what investors are owed.
    pub fn keeper_take(&mut self, shop: String, amount: U128) {
        let me = self.me();
        let mut s = self.shop(&shop);
        require!(s.keeper == me, "ERR_NOT_KEEPER");
        require!(amount.0 > 0 && s.till.0 >= amount.0 + 2 * self.floor_of(s.floor.0) + s.owed.0, "ERR_TILL");
        s.till = U128(s.till.0 - amount.0);
        self.shops.insert(shop.clone(), s);
        pay(&me, amount.0);
        Ev::new().s("shop", &shop).u("amount", amount.0).market("keeper_take");
    }

    // ---------- NEAR spends, through a board row ----------

    /// Buys for `row_owner`. A closed shop still sells, cheaper, to raise cash.
    #[payable]
    pub fn buy(&mut self, row_owner: AccountId, shop: String, good: String, qty: u32, max_total: U128) -> U128 {
        let to = self.via_board(row_owner);
        let before = self.mark();
        let paid = env::attached_deposit().as_yoctonear();
        let total = self.take_from_shop(&shop, &good, qty, &to);
        require!(total <= max_total.0 && paid >= total, "ERR_PRICE_MOVED");
        self.credit_sale(&shop, total);
        let left = self.storage_from(&to, paid - total, before);
        pay(&to, left);
        Ev::new().s("player", to.as_str()).s("shop", &shop).s("good", &good).n("qty", qty as u64).u("total", total).market("buy");
        U128(total)
    }

    /// Invests in a shop for `row_owner`: one share per milliNEAR, pending dividends paid first.
    /// The part of the deposit below a whole milliNEAR pays the storage; the rest comes back.
    #[payable]
    pub fn invest(&mut self, row_owner: AccountId, shop: String, decision: Option<String>) -> U128 {
        let to = self.via_board(row_owner);
        let before = self.mark();
        let paid = env::attached_deposit().as_yoctonear();
        let units = paid / SHARE_UNIT;
        require!(units > 0, "ERR_INVEST_MIN");
        let amount = units * SHARE_UNIT;
        self.add_shares(&to, &shop, units, decision);
        let left = self.storage_from(&to, paid - amount, before);
        pay(&to, left);
        U128(units)
    }

    /// The keeper of `shop` buys stock from another shop with NEAR from the keeper's row.
    #[payable]
    pub fn restock(&mut self, row_owner: AccountId, shop: String, from_shop: String, good: String, qty: u32, max_total: U128, decision: Option<String>) -> U128 {
        let keeper = self.via_board(row_owner);
        let before = self.mark();
        let s = self.shop(&shop);
        require!(s.keeper == keeper, "ERR_NOT_KEEPER");
        require!(shop != from_shop, "ERR_SAME_SHOP");
        require!(s.goods.iter().any(|g| g.good == good), "ERR_GOOD");
        let paid = env::attached_deposit().as_yoctonear();
        let total = self.take_from_shop(&from_shop, &good, qty, &keeper);
        require!(total <= max_total.0 && paid >= total, "ERR_PRICE_MOVED");
        self.credit_sale(&from_shop, total);
        let left = self.storage_from(&keeper, paid - total, before);
        pay(&keeper, left);
        Ev::new().s("shop", &shop).s("from", &from_shop).s("good", &good).n("qty", qty as u64).u("total", total).s("decision", &decision_id(&decision)).market("restock");
        U128(total)
    }

    /// Posts an order for goods on the Town Hall board, with `reward` per unit held in escrow.
    #[payable]
    pub fn post_order(&mut self, row_owner: AccountId, good: String, qty: u32, reward: U128, note: String) -> U64 {
        let poster = self.via_board(row_owner);
        let before = self.mark();
        require!(self.tokens.get(&good).map(|m| m.kind != "share").unwrap_or(false), "ERR_GOOD");
        require!((1..=50).contains(&qty) && reward.0 > 0 && note.len() <= 80, "ERR_ORDER");
        require!(self.orders.len() < MAX_ORDERS as u32, "ERR_BOARD_FULL");
        let escrow = reward.0 * qty as u128;
        let paid = env::attached_deposit().as_yoctonear();
        require!(paid >= escrow, "ERR_DEPOSIT");
        let id = self.next_order;
        self.next_order += 1;
        self.orders.insert(id, Order { id: U64(id), poster: poster.clone(), good: good.clone(), qty_left: qty, reward, escrow: U128(escrow), note });
        let left = self.storage_from(&poster, paid - escrow, before);
        pay(&poster, left);
        Ev::new().s("poster", poster.as_str()).n("order", id).s("good", &good).n("qty", qty as u64).u("reward", reward.0).market("order_posted");
        U64(id)
    }

    // ---------- views ----------

    pub fn quote(&self, shop: String, good: String) -> Quote {
        let s = self.shop(&shop);
        let c = cfg(&s, &good);
        pricing::quote(&market_of(&s, &c, self.bal(&s.keeper, &good), &self.demand_now(&shop, &good), self.floor_of(s.floor.0)))
    }

    pub fn market_board(&self) -> Vec<ShopView> {
        self.shops.values().map(|s| self.view(s)).collect()
    }

    pub fn dividends_of(&self, account_id: AccountId, shop: String) -> U128 {
        U128(self.pending(&account_id, &shop))
    }

    pub fn recipes(&self) -> Vec<RecipeView> {
        RECIPES.iter().map(|(o, i)| RecipeView { item: o.to_string(), inputs: i.iter().map(|(g, n)| (g.to_string(), U128(*n))).collect() }).collect()
    }

    pub fn orders(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Order> {
        self.orders.values().skip(from_index.unwrap_or(0) as usize).take(limit.unwrap_or(20).min(64) as usize).cloned().collect()
    }
}

fn cfg(s: &Shop, good: &str) -> GoodCfg {
    s.goods.iter().find(|g| g.good == good).cloned().unwrap_or_else(|| env::panic_str("ERR_GOOD"))
}

fn market_of(s: &Shop, c: &GoodCfg, stock: u128, d: &Demand, floor: u128) -> pricing::Market {
    pricing::Market {
        base: c.base,
        stock: U64(stock.min(u64::MAX as u128) as u64),
        target_stock: c.target,
        buys_last_hour: d.prev_buys,
        sells_last_hour: d.prev_sells,
        till: s.till,
        floor: U128(floor),
    }
}

impl Contract {
    /// Shares for `units` milliNEAR already received: pending dividends paid first, the till grows.
    pub(crate) fn add_shares(&mut self, to: &AccountId, shop: &str, units: u128, decision: Option<String>) -> U128 {
        let amount = units * SHARE_UNIT;
        self.pay_dividends(to, shop);
        let mut s = self.shop(shop);
        let was_closed = s.till.0 < self.floor_of(s.floor.0);
        s.till = U128(s.till.0 + amount);
        s.shares = U128(s.shares.0 + units);
        s.invested = U128(s.invested.0 + amount);
        s.owed = U128(s.owed.0 + amount * REPAY_BPS / 10_000);
        let reopened = was_closed && s.till.0 >= self.floor_of(s.floor.0);
        let acc = s.acc.0;
        self.shops.insert(shop.to_string(), s);
        let token = format!("{SHARE}{shop}");
        self.mint(to, &token, units, "invest");
        let held = self.bal(to, &token);
        self.share_debt.insert((to.clone(), shop.to_string()), held * acc / ACC);
        Ev::new().s("investor", to.as_str()).s("shop", shop).u("amount", amount).u("shares", units).s("decision", &decision_id(&decision)).market("invest");
        if reopened { Ev::new().s("shop", shop).market("shop_reopened"); }
        U128(units)
    }

    pub(crate) fn shop(&self, id: &str) -> Shop {
        self.shops.get(id).cloned().unwrap_or_else(|| env::panic_str("ERR_SHOP"))
    }

    /// The demand record rolled to this hour: last hour's counts drive the price.
    pub(crate) fn demand_now(&self, shop: &str, good: &str) -> Demand {
        let h = hour_now();
        match self.demand.get(&(shop.to_string(), good.to_string())) {
            Some(d) if d.hour.0 == h => d.clone(),
            Some(d) if d.hour.0 + 1 == h => Demand { hour: U64(h), buys: 0, sells: 0, prev_buys: d.buys, prev_sells: d.sells },
            _ => Demand { hour: U64(h), ..Default::default() },
        }
    }

    pub(crate) fn view(&self, s: &Shop) -> ShopView {
        let goods = s.goods.iter().map(|g| {
            let stock = self.bal(&s.keeper, &g.good);
            GoodView { good: g.good.clone(), stock: U128(stock), quote: pricing::quote(&market_of(s, g, stock, &self.demand_now(&s.id, &g.good), self.floor_of(s.floor.0))) }
        }).collect();
        ShopView {
            id: s.id.clone(), keeper: s.keeper.clone(), open: s.till.0 >= self.floor_of(s.floor.0), till: s.till, floor: U128(self.floor_of(s.floor.0)),
            shares: s.shares, invested: s.invested, owed: s.owed, trades: s.trades, goods,
        }
    }

    /// Moves `qty` from the shop's shelf to `to` at the shop's buy price, unit by unit.
    fn take_from_shop(&mut self, shop: &str, good: &str, qty: u32, to: &AccountId) -> u128 {
        let s = self.shop(shop);
        require!((1..=MAX_QTY).contains(&qty), "ERR_QTY");
        let c = cfg(&s, good);
        let mut d = self.demand_now(shop, good);
        let mut stock = self.bal(&s.keeper, good);
        require!(stock >= qty as u128, "ERR_OUT_OF_STOCK");
        let mut total = 0u128;
        for _ in 0..qty {
            total += pricing::quote(&market_of(&s, &c, stock, &d, self.floor_of(s.floor.0))).buy.0;
            stock -= 1;
        }
        d.buys += qty;
        self.demand.insert((shop.to_string(), good.to_string()), d);
        self.move_one(&s.keeper, to, good, qty as u128, "buy");
        total
    }

    /// The shop keeps the sale, less the investors' cut while they are owed.
    fn credit_sale(&mut self, shop: &str, total: u128) {
        let mut s = self.shop(shop);
        let mut cut = 0;
        if s.shares.0 > 0 && s.owed.0 > 0 {
            cut = (total * DIVIDEND_BPS / 10_000).min(s.owed.0);
            s.acc = U128(s.acc.0 + cut * ACC / s.shares.0);
            s.owed = U128(s.owed.0 - cut);
            s.held = U128(s.held.0 + cut);
        }
        s.till = U128(s.till.0 + total - cut);
        s.trades = U64(s.trades.0 + 1);
        self.shops.insert(shop.to_string(), s);
    }

    /// Board calls carry the payer's deposit: storage they add is paid from what is
    /// left of it first, then from the receiver's storage deposit.
    fn storage_from(&mut self, who: &AccountId, left: u128, before: u64) -> u128 {
        self.flush_all();
        let after = env::storage_usage();
        let cost = after.saturating_sub(before) as u128 * env::storage_byte_cost().as_yoctonear();
        if left >= cost {
            return left - cost;
        }
        let mut c = self.citizens.get(who).cloned().unwrap_or_default();
        require!(c.storage.0 >= cost - left, "ERR_STORAGE: attach a little more for storage");
        c.storage = U128(c.storage.0 - (cost - left));
        self.citizens.insert(who.clone(), c);
        0
    }

    fn pending(&self, who: &AccountId, shop: &str) -> u128 {
        let Some(s) = self.shops.get(shop) else { return 0 };
        let held = self.bal(who, &format!("{SHARE}{shop}"));
        let debt = self.share_debt.get(&(who.clone(), shop.to_string())).copied().unwrap_or(0);
        (held * s.acc.0 / ACC).saturating_sub(debt)
    }

    fn pay_dividends(&mut self, who: &AccountId, shop: &str) -> u128 {
        let mut s = self.shop(shop);
        let owed = self.pending(who, shop).min(s.held.0);
        let held = self.bal(who, &format!("{SHARE}{shop}"));
        if held > 0 || owed > 0 {
            self.share_debt.insert((who.clone(), shop.to_string()), held * s.acc.0 / ACC);
        }
        if owed > 0 {
            s.held = U128(s.held.0 - owed);
            self.shops.insert(shop.to_string(), s);
            pay(who, owed);
            Ev::new().s("investor", who.as_str()).s("shop", shop).u("amount", owed).market("dividend");
        }
        owed
    }
}

#[allow(dead_code)]
fn _unused(_: u32) -> u32 { today() }

/// A keeper's or the council's decision id: the hash of the signed NEAR AI answer that chose
/// this action, so the event on chain points at the decision that caused it. Empty when none.
pub fn decision_id(d: &Option<String>) -> String {
    let s = d.clone().unwrap_or_default();
    require!(s.len() <= 100 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_:.".contains(&b)), "ERR_DECISION");
    s
}
