//! Pay-clause check for a Lamplighter charter. Pure: same input, same decision.
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Debug)]
pub struct Clause {
    /// Max yoctoNEAR per payment.
    pub cap: String,
    /// Max yoctoNEAR per UTC day.
    pub daily_limit: String,
    pub allowlist: Vec<String>,
}

#[derive(Deserialize, Debug)]
pub struct Action {
    pub receiver: String,
    pub amount: String,
}

#[derive(Deserialize, Debug)]
pub struct Input {
    pub charter: String,
    pub clause: Clause,
    /// yoctoNEAR already spent today under this clause.
    pub spent_today: String,
    pub action: Action,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Decision {
    pub charter: String,
    pub allow: bool,
    pub reasons: Vec<String>,
    pub input_sha256: String,
    pub checker: &'static str,
}

fn num(s: &str, name: &str) -> Result<u128, String> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("{name} is not a whole yocto amount"));
    }
    s.parse::<u128>().map_err(|_| format!("{name} is too large"))
}

pub fn decide(raw: &str) -> Result<Decision, String> {
    use sha2::{Digest, Sha256};
    let input: Input = serde_json::from_str(raw).map_err(|e| format!("bad input: {e}"))?;
    let hash: String = Sha256::digest(raw.as_bytes()).iter().map(|b| format!("{b:02x}")).collect();
    let cap = num(&input.clause.cap, "cap")?;
    let daily = num(&input.clause.daily_limit, "daily_limit")?;
    let spent = num(&input.spent_today, "spent_today")?;
    let amount = num(&input.action.amount, "amount")?;
    let mut reasons = Vec::new();
    if amount == 0 {
        reasons.push("amount is zero".to_string());
    }
    if amount > cap {
        reasons.push("over the per-payment cap".to_string());
    }
    match spent.checked_add(amount) {
        Some(t) if t <= daily => {}
        _ => reasons.push("over the daily limit".to_string()),
    }
    // Exact, byte-for-byte match: no case folding, so look-alike names never pass.
    if !input.clause.allowlist.iter().any(|a| a == &input.action.receiver) {
        reasons.push("receiver not on the allowlist".to_string());
    }
    Ok(Decision {
        charter: input.charter,
        allow: reasons.is_empty(),
        reasons,
        input_sha256: hash,
        checker: "nearcarta/charter_check v1",
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn inp(recv: &str, amt: &str, spent: &str) -> String {
        format!(r#"{{"charter":"c.near","clause":{{"cap":"100","daily_limit":"150","allowlist":["bob.near"]}},"spent_today":"{spent}","action":{{"receiver":"{recv}","amount":"{amt}"}}}}"#)
    }
    #[test]
    fn allows_inside_clause() { assert!(decide(&inp("bob.near", "100", "50")).unwrap().allow); }
    #[test]
    fn denies_over_cap() { let d = decide(&inp("bob.near", "101", "0")).unwrap(); assert!(!d.allow); assert_eq!(d.reasons, vec!["over the per-payment cap"]); }
    #[test]
    fn denies_over_daily() { let d = decide(&inp("bob.near", "60", "100")).unwrap(); assert_eq!(d.reasons, vec!["over the daily limit"]); }
    #[test]
    fn denies_lookalike() { assert!(!decide(&inp("b\u{043e}b.near", "1", "0")).unwrap().allow); }
    #[test]
    fn denies_case() { assert!(!decide(&inp("Bob.near", "1", "0")).unwrap().allow); }
    #[test]
    fn denies_zero() { assert!(!decide(&inp("bob.near", "0", "0")).unwrap().allow); }
    #[test]
    fn overflow_denies() { assert!(!decide(&inp("bob.near", "1", "340282366920938463463374607431768211455")).unwrap().allow); }
    #[test]
    fn rejects_bad_numbers() { assert!(decide(&inp("bob.near", "-1", "0")).is_err()); assert!(decide(&inp("bob.near", "1e3", "0")).is_err()); assert!(decide("{}").is_err()); }
    #[test]
    fn hash_is_of_raw_input() { let s = inp("bob.near", "1", "0"); assert_eq!(decide(&s).unwrap().input_sha256.len(), 64); }
}
