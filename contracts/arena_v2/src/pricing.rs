//! Market Day pricing. Every merchant price comes from this file.
//!
//! All factors are basis points (10_000 = 1.0) and every step rounds down,
//! so `shared/market/pricing.js` can repeat the same integer steps exactly.
//! The golden cases in `shared/market/pricing-cases.json` pin both.
//!
//!   scarcity = target_stock / stock                 clamped to [0.25, 4.0]
//!   demand   = 1 + (buys - sells) / 20  (last hour) clamped to [0.5, 2.0]
//!   mood     = 0.9 when the till is below its floor, else 1.0
//!   buy      = base * scarcity * demand * mood      (the player pays)
//!   sell     = buy * 0.8                            (the player receives)
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};

pub const ONE: u128 = 10_000;
pub const SCARCITY_MIN: u128 = 2_500;
pub const SCARCITY_MAX: u128 = 40_000;
pub const DEMAND_STEP: i64 = 500; // one net trade moves demand by 1/20
pub const DEMAND_MIN: i64 = 5_000;
pub const DEMAND_MAX: i64 = 20_000;
pub const MOOD_SHORT: u128 = 9_000;
pub const SELL_SHARE: u128 = 8_000;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(crate = "near_sdk::serde")]
pub struct Market {
    pub base: U128,
    pub stock: u64,
    pub target_stock: u64,
    pub buys_last_hour: u32,
    pub sells_last_hour: u32,
    pub till: U128,
    pub floor: U128,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(crate = "near_sdk::serde")]
pub struct Reason {
    pub rule: String,
    pub factor_bps: u32,
    pub why: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(crate = "near_sdk::serde")]
pub struct Quote {
    pub buy: U128,
    pub sell: U128,
    pub reasons: Vec<Reason>,
}

pub fn scarcity_bps(stock: u64, target: u64) -> u128 {
    let s = (target as u128) * ONE / (stock.max(1) as u128);
    s.clamp(SCARCITY_MIN, SCARCITY_MAX)
}

pub fn demand_bps(buys: u32, sells: u32) -> u128 {
    let d = ONE as i64 + (buys as i64 - sells as i64) * DEMAND_STEP;
    d.clamp(DEMAND_MIN, DEMAND_MAX) as u128
}

pub fn mood_bps(till: u128, floor: u128) -> u128 {
    if till < floor { MOOD_SHORT } else { ONE }
}

pub fn quote(m: &Market) -> Quote {
    let s = scarcity_bps(m.stock, m.target_stock);
    let d = demand_bps(m.buys_last_hour, m.sells_last_hour);
    let o = mood_bps(m.till.0, m.floor.0);
    let buy = m.base.0 * s / ONE * d / ONE * o / ONE;
    let sell = buy * SELL_SHARE / ONE;
    let reasons = vec![
        Reason { rule: "scarcity".into(), factor_bps: s as u32,
            why: format!("{} in stock, target {}", m.stock, m.target_stock) },
        Reason { rule: "demand".into(), factor_bps: d as u32,
            why: format!("{} bought, {} sold in the last hour", m.buys_last_hour, m.sells_last_hour) },
        Reason { rule: "mood".into(), factor_bps: o as u32,
            why: if o < ONE { "till below floor, selling cheaper to raise cash".into() } else { "till above floor".into() } },
    ];
    Quote { buy: U128(buy), sell: U128(sell), reasons }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    #[serde(crate = "near_sdk::serde")]
    struct Case { name: String, market: Market, buy: U128, sell: U128, factors: Vec<u32> }

    fn m(stock: u64, buys: u32, sells: u32) -> Market {
        Market { base: U128(1_000_000), stock, target_stock: 20, buys_last_hour: buys,
            sells_last_hour: sells, till: U128(10), floor: U128(1) }
    }

    #[test]
    fn js_and_rust_pricing_agree_on_every_golden_case() {
        let cases: Vec<Case> = near_sdk::serde_json::from_str(include_str!("../../../shared/market/pricing-cases.json")).unwrap();
        assert!(cases.len() >= 8);
        for c in cases {
            let q = quote(&c.market);
            assert_eq!(q.buy, c.buy, "{}", c.name);
            assert_eq!(q.sell, c.sell, "{}", c.name);
            let f: Vec<u32> = q.reasons.iter().map(|r| r.factor_bps).collect();
            assert_eq!(f, c.factors, "{}", c.name);
        }
    }

    #[test]
    fn flooding_a_shop_with_iron_lowers_the_iron_price() {
        let before = quote(&m(20, 0, 0)).buy.0;
        let after = quote(&m(60, 0, 10)).buy.0;
        assert!(after < before / 4, "{after} vs {before}");
    }

    #[test]
    fn an_empty_shelf_and_a_rush_cap_at_eight_times_base() {
        assert_eq!(quote(&m(0, 1_000, 0)).buy.0, 8_000_000);
    }

    #[test]
    fn a_short_till_sells_cheaper_and_says_why() {
        let mut short = m(20, 0, 0);
        short.till = U128(0);
        let q = quote(&short);
        assert_eq!(q.buy.0, 900_000);
        assert_eq!(q.reasons[2].why, "till below floor, selling cheaper to raise cash");
    }

    #[test]
    fn the_player_always_receives_less_than_they_would_pay() {
        for stock in [0, 1, 5, 20, 80, 1_000] {
            let q = quote(&m(stock, 3, 1));
            assert!(q.sell.0 < q.buy.0 || q.buy.0 == 0);
        }
    }
}
