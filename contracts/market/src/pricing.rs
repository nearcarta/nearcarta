//! Market Day pricing. Every merchant price comes from this file.
//!
//! All factors are basis points (10_000 = 1.0) and every step rounds down, so
//! `shared/market/pricing.js` repeats the same integer steps exactly. The golden
//! cases in `shared/market/pricing-cases.json` pin both.
//!
//! For one shop and one good, with `s` units on its shelf:
//!
//!   scarcity(s) = target / s                       clamped to [0.25, 4.0]
//!   demand      = 1 + (buys - sells) / 20           from the LAST COMPLETED hour,
//!                                                   clamped to [0.5, 2.0]
//!   mood        = 0.9 when the till is below its floor (a closed shop sells
//!                 cheaper to raise cash), else 1.0
//!
//!   buy  (the player pays for the next unit, shelf s -> s-1)
//!        = base * scarcity(s) * max(1, demand) * mood
//!   sell (the shop pays for one more unit, shelf s -> s+1)
//!        = base * scarcity(s+1) * min(1, demand) * mood * 0.8
//!
//! Why a round trip always loses: buying the unit at shelf s costs at least
//! base * scarcity(s) * mood. Selling it back moves the shelf from s-1 to s, so
//! it pays at most 0.8 * base * scarcity(s) * mood. Demand is fixed inside an
//! hour, cannot raise a sell price above 1.0 and cannot lower a buy price below
//! 1.0. A closed shop's lower mood applies to both sides. So any sequence of
//! buys and sells that ends with the shelf where it started pays the shop at
//! least 20% of what it bought. The property tests here and in pricing.test
//! check that over random sequences.
use near_sdk::json_types::{U128, U64};
use near_sdk::near;

pub const ONE: u128 = 10_000;
pub const SCARCITY_MIN: u128 = 2_500;
pub const SCARCITY_MAX: u128 = 40_000;
pub const DEMAND_STEP: i64 = 500;
pub const DEMAND_MIN: i64 = 5_000;
pub const DEMAND_MAX: i64 = 20_000;
pub const MOOD_SHORT: u128 = 9_000;
pub const SELL_SHARE: u128 = 8_000;

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Market {
    pub base: U128,
    pub stock: U64,
    pub target_stock: U64,
    pub buys_last_hour: u32,
    pub sells_last_hour: u32,
    pub till: U128,
    pub floor: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Reason {
    pub rule: String,
    pub factor_bps: u32,
    pub why: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
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

fn apply(base: u128, factors: &[u128]) -> u128 {
    factors.iter().fold(base, |v, f| v * f / ONE)
}

pub fn quote(m: &Market) -> Quote {
    let stock = m.stock.0;
    let target = m.target_stock.0;
    let s_buy = scarcity_bps(stock, target);
    let s_sell = scarcity_bps(stock.saturating_add(1), target);
    let d = demand_bps(m.buys_last_hour, m.sells_last_hour);
    let o = mood_bps(m.till.0, m.floor.0);
    let buy = apply(m.base.0, &[s_buy, d.max(ONE), o]);
    let sell = apply(m.base.0, &[s_sell, d.min(ONE), o, SELL_SHARE]);
    let reasons = vec![
        Reason { rule: "scarcity".into(), factor_bps: s_buy as u32,
            why: format!("{stock} on the shelf, the shop wants {target}") },
        Reason { rule: "demand".into(), factor_bps: d as u32,
            why: format!("last hour: {} bought, {} sold", m.buys_last_hour, m.sells_last_hour) },
        Reason { rule: "mood".into(), factor_bps: o as u32,
            why: if o < ONE { "closed: selling cheaper to raise cash".into() } else { "open".into() } },
        Reason { rule: "margin".into(), factor_bps: SELL_SHARE as u32,
            why: "the shop pays 80% of the next unit's price, with no demand bonus".into() },
    ];
    Quote { buy: U128(buy), sell: U128(sell), reasons }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[near(serializers = [json])]
    struct Case { name: String, market: Market, buy: U128, sell: U128, factors: Vec<u32> }

    fn m(stock: u64, buys: u32, sells: u32) -> Market {
        Market { base: U128(1_000_000), stock: U64(stock), target_stock: U64(20), buys_last_hour: buys,
            sells_last_hour: sells, till: U128(10), floor: U128(1) }
    }

    #[test]
    fn js_and_rust_pricing_agree_on_every_golden_case() {
        let cases: Vec<Case> = near_sdk::serde_json::from_str(include_str!("../../../shared/market/pricing-cases.json")).unwrap();
        assert!(cases.len() >= 10);
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
        assert!(after * 3 <= before, "{after} vs {before}");
    }

    #[test]
    fn a_closed_shop_sells_cheaper_and_says_why() {
        let mut short = m(20, 0, 0);
        short.till = U128(0);
        let q = quote(&short);
        assert_eq!(q.buy.0, 900_000);
        assert_eq!(q.reasons[2].why, "closed: selling cheaper to raise cash");
    }

    /// A tiny deterministic generator, so the property test needs no extra crate.
    struct Lcg(u64);
    impl Lcg {
        fn next(&mut self) -> u64 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            self.0 >> 33
        }
    }

    /// Any single actor's buys and sells that end with the shelf where it began
    /// leave the actor with less NEAR, whatever the demand and mood of each hour.
    #[test]
    fn a_round_trip_never_gains_over_random_sequences() {
        let mut r = Lcg(7);
        for trial in 0..4_000 {
            let target = 1 + r.next() % 60;
            let start = r.next() % 80;
            let base = 1_000 + (r.next() % 5_000_000) as u128;
            let mut stock = start;
            let mut paid: i128 = 0;
            let mut hour = (r.next() % 30) as u32;
            let mut sells = (r.next() % 30) as u32;
            let mut till_low = r.next() % 2 == 0;
            let steps = 1 + r.next() % 30;
            let mut moves = Vec::new();
            for _ in 0..steps {
                if stock > 0 && r.next() % 2 == 0 { moves.push(true); stock -= 1; } else { moves.push(false); stock += 1; }
            }
            // Close the loop so the shelf ends where it started.
            while stock > start { moves.push(true); stock -= 1; }
            while stock < start { moves.push(false); stock += 1; }
            let mut s = start;
            for buy in moves {
                if r.next() % 5 == 0 { hour = (r.next() % 30) as u32; sells = (r.next() % 30) as u32; till_low = !till_low; }
                let q = quote(&Market { base: U128(base), stock: U64(s), target_stock: U64(target),
                    buys_last_hour: hour, sells_last_hour: sells,
                    till: U128(if till_low { 0 } else { 10 }), floor: U128(1) });
                if buy { paid += q.buy.0 as i128; s -= 1; } else { paid -= q.sell.0 as i128; s += 1; }
            }
            assert!(paid >= 0, "trial {trial}: the actor gained {} yocto", -paid);
        }
    }

    #[test]
    fn buying_one_and_selling_it_back_loses_at_least_a_fifth() {
        for stock in 1..80u64 {
            for (b, s) in [(0, 0), (40, 0), (0, 40), (7, 3)] {
                let buy = quote(&m(stock, b, s)).buy.0;
                let back = quote(&m(stock - 1, b, s)).sell.0;
                assert!(back * 10 <= buy * 8 + 10, "stock {stock}: buy {buy} back {back}");
            }
        }
    }
}
