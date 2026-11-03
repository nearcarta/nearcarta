//! Attested check: asks OutLayer (a TEE worker) to run the published charter_check WASM on a
//! proposed payment, with the clause and today's usage read from the charter on chain.
//! It records the decision. It never moves funds and the charter never reads it: the charter's
//! own require! checks stay the final gate, so an OutLayer outage cannot allow anything.
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{json, Value};
use near_sdk::store::Vector;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};

const VIEW_GAS: Gas = Gas::from_tgas(10);
const BUILD_GAS: Gas = Gas::from_tgas(15);
const RESULT_GAS: Gas = Gas::from_tgas(15);
const MIN_DEPOSIT: NearToken = NearToken::from_millinear(10);
const MAX_OUTPUT: usize = 2048;

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Check {
    pub id: U64,
    pub charter: AccountId,
    pub clause_id: String,
    pub receiver: String,
    pub amount: U128,
    pub caller: AccountId,
    pub input: String,
    /// "allow", "deny" or "unavailable" (OutLayer failed: treated as a deny).
    pub decision: String,
    pub output: String,
    pub at_ns: U64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct AttestedCheck {
    owner: AccountId,
    outlayer: AccountId,
    wasm_url: String,
    wasm_hash: String,
    checks: Vector<Check>,
}

#[near]
impl AttestedCheck {
    #[init]
    pub fn new(owner: AccountId, outlayer: AccountId, wasm_url: String, wasm_hash: String) -> Self {
        require!(wasm_hash.len() == 64 && wasm_hash.bytes().all(|b| b.is_ascii_hexdigit()), "wasm_hash: 64 hex");
        require!(wasm_url.starts_with("https://"), "wasm_url: https");
        Self { owner, outlayer, wasm_url, wasm_hash, checks: Vector::new(b"c") }
    }

    /// Pins a new checker build. Owner only.
    pub fn set_wasm(&mut self, wasm_url: String, wasm_hash: String) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
        require!(wasm_hash.len() == 64 && wasm_hash.bytes().all(|b| b.is_ascii_hexdigit()), "wasm_hash: 64 hex");
        require!(wasm_url.starts_with("https://"), "wasm_url: https");
        self.wasm_url = wasm_url;
        self.wasm_hash = wasm_hash;
    }

    /// Anyone may ask. Attach >= 0.01 NEAR for OutLayer; the unused part is refunded to the caller.
    #[payable]
    pub fn check(&mut self, charter: AccountId, clause_id: String, receiver: String, amount: U128) -> Promise {
        let deposit = env::attached_deposit();
        require!(deposit >= MIN_DEPOSIT, "attach at least 0.01 NEAR");
        require!(clause_id.len() <= 64 && receiver.len() <= 64, "too long");
        let a = Promise::new(charter.clone()).function_call("get_clauses", b"{}".to_vec(), NearToken::from_yoctonear(0), VIEW_GAS);
        let b = Promise::new(charter.clone()).function_call(
            "get_usage", json!({ "clause_id": clause_id }).to_string().into_bytes(), NearToken::from_yoctonear(0), VIEW_GAS);
        a.and(b).then(
            Self::ext(env::current_account_id())
                .with_attached_deposit(deposit)
                .with_static_gas(BUILD_GAS)
                .with_unused_gas_weight(1)
                .on_views(charter, clause_id, receiver, amount, env::predecessor_account_id()),
        )
    }

    #[private]
    #[payable]
    pub fn on_views(
        &mut self, charter: AccountId, clause_id: String, receiver: String, amount: U128, caller: AccountId,
        #[callback_result] clauses: Result<Value, PromiseError>,
        #[callback_result] usage: Result<Value, PromiseError>,
    ) -> Promise {
        let deposit = env::attached_deposit();
        let clause = clauses.ok().and_then(|c| c.get(&clause_id).cloned());
        let (Some(clause), Ok(usage)) = (clause, usage) else {
            self.push(&charter, &clause_id, &receiver, amount, &caller, String::new(), "deny", "clause or usage not readable".into());
            return Promise::new(caller).transfer(deposit);
        };
        let big = |v: &Value| v.as_str().unwrap_or("0").to_string();
        let spent = big(&usage["spent"]).parse::<u128>().unwrap_or(u128::MAX)
            .saturating_add(big(&usage["reserved"]).parse::<u128>().unwrap_or(u128::MAX));
        let input = json!({
            "charter": charter,
            "clause": {
                "cap": big(&clause["per_action_cap"]),
                "daily_limit": big(&clause["daily_budget"]),
                "allowlist": clause["receivers"].clone(),
            },
            "spent_today": spent.to_string(),
            "action": { "receiver": receiver, "amount": amount.0.to_string() },
        })
        .to_string();
        let source = json!({ "WasmUrl": { "url": self.wasm_url, "hash": self.wasm_hash, "build_target": "wasm32-wasip1" } });
        let limits = json!({ "max_instructions": 1_000_000_000u64, "max_memory_mb": 64, "max_execution_seconds": 20 });
        let args = json!({
            "source": source, "resource_limits": limits, "input_data": input,
            "response_format": "Json", "payer_account_id": caller,
        });
        let gas = env::prepaid_gas().saturating_sub(env::used_gas()).saturating_sub(RESULT_GAS).saturating_sub(Gas::from_tgas(10));
        Promise::new(self.outlayer.clone())
            .function_call_weight("request_execution", args.to_string().into_bytes(), deposit, gas, near_sdk::GasWeight(1))
            .then(Self::ext(env::current_account_id()).with_static_gas(RESULT_GAS)
                .on_result(charter, clause_id, receiver, amount, caller, input))
    }

    #[private]
    pub fn on_result(
        &mut self, charter: AccountId, clause_id: String, receiver: String, amount: U128, caller: AccountId, input: String,
        #[callback_result] result: Result<Value, PromiseError>,
    ) -> Check {
        let (decision, output) = match result {
            Ok(v) => {
                let allow = v["success"] == json!(true) && v["output"]["allow"] == json!(true);
                let mut s = v.to_string();
                s.truncate(MAX_OUTPUT);
                (if allow { "allow" } else { "deny" }, s)
            }
            Err(_) => ("unavailable", String::new()),
        };
        self.push(&charter, &clause_id, &receiver, amount, &caller, input, decision, output)
    }

    pub fn get_config(&self) -> Value {
        json!({ "owner": self.owner, "outlayer": self.outlayer, "wasm_url": self.wasm_url, "wasm_hash": self.wasm_hash, "count": self.checks.len() })
    }
    pub fn get_check(&self, id: U64) -> Option<Check> { self.checks.get(id.0 as u32).cloned() }
    pub fn get_last(&self, n: u32) -> Vec<Check> {
        let len = self.checks.len();
        let n = n.min(20).min(len);
        (len - n..len).rev().filter_map(|i| self.checks.get(i).cloned()).collect()
    }
}

impl AttestedCheck {
    #[allow(clippy::too_many_arguments)]
    fn push(&mut self, charter: &AccountId, clause_id: &str, receiver: &str, amount: U128, caller: &AccountId,
            input: String, decision: &str, output: String) -> Check {
        let c = Check {
            id: U64(self.checks.len() as u64), charter: charter.clone(), clause_id: clause_id.into(), receiver: receiver.into(),
            amount, caller: caller.clone(), input, decision: decision.into(), output, at_ns: U64(env::block_timestamp()),
        };
        env::log_str(&format!("attested_check {} {} {}", c.id.0, c.decision, c.charter));
        self.checks.push(c.clone());
        self.checks.flush();
        c
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn setup() -> AttestedCheck {
        testing_env!(VMContextBuilder::new().predecessor_account_id(accounts(0)).current_account_id(accounts(1)).build());
        AttestedCheck::new(accounts(0), "outlayer.testnet".parse().unwrap(), "https://x/y.wasm".into(), "a".repeat(64))
    }
    #[test]
    fn failure_is_unavailable_not_allow() {
        let mut c = setup();
        let r = c.on_result(accounts(2), "tip".into(), "b".into(), U128(1), accounts(0), "{}".into(), Err(PromiseError::Failed));
        assert_eq!(r.decision, "unavailable");
    }
    #[test]
    fn allow_needs_success_and_allow() {
        let mut c = setup();
        let ok = json!({"success": true, "output": {"allow": true}});
        assert_eq!(c.on_result(accounts(2), "t".into(), "b".into(), U128(1), accounts(0), "{}".into(), Ok(ok)).decision, "allow");
        let bad = json!({"success": false, "output": {"allow": true}});
        assert_eq!(c.on_result(accounts(2), "t".into(), "b".into(), U128(1), accounts(0), "{}".into(), Ok(bad)).decision, "deny");
        let deny = json!({"success": true, "output": {"allow": false}});
        assert_eq!(c.on_result(accounts(2), "t".into(), "b".into(), U128(1), accounts(0), "{}".into(), Ok(deny)).decision, "deny");
        assert_eq!(c.get_last(5).len(), 3);
        assert_eq!(c.get_last(5)[0].id, U64(2));
    }
    #[test]
    #[should_panic(expected = "owner only")]
    fn set_wasm_owner_only() {
        let mut c = setup();
        testing_env!(VMContextBuilder::new().predecessor_account_id(accounts(3)).build());
        c.set_wasm("https://z".into(), "b".repeat(64));
    }
    #[test]
    #[should_panic(expected = "wasm_hash")]
    fn bad_hash() { testing_env!(VMContextBuilder::new().build()); AttestedCheck::new(accounts(0), accounts(1), "https://x".into(), "zz".into()); }
}
