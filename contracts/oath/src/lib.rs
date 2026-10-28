//! Oath (R11 hardened): a policy contract that lives on the agent's own account.
//! The agent holds only a function-call key limited to `propose`.
//! The contract checks typed clauses, builds the payload itself, reserves
//! budget before the outgoing promise, releases on failure, and emits one
//! NEP-297 event schema ("chronicle") for every decision and settlement.
//!
//! R11 changes vs R2 (see deep/R11_HARDENED.md):
//! - S6: receipts are parsed strictly (exact canonical JSON, verdict == "ALLOW",
//!   action_hash / receiver / amount / job_id must match; code_hash + account age
//!   are signed fields and checked against the clause).
//! - F4: an escalated action stores policy_version, freeze_epoch and asset; on
//!   approval it is denied if any changed, and the clause checks are re-run.
//! - Storage griefing: per-clause min_amount and max_actions_per_day, pruning of
//!   settled records (automatic ring + public `prune`), storage reserve check.
//! - memo is in action_hash; job ids need 16..=64 chars of [A-Za-z0-9_-];
//!   FT path checks `storage_balance_of(receiver)` before `ft_transfer`.
//! - Owner-key theft: policy-widening changes are queued behind `policy_delay_ns`;
//!   tightening and freeze are instant; when a DAO is set only the DAO can unfreeze.
//! - Setup window (opt-in at `new`, used by the charter factory): until the first
//!   agent key is added, the first rules, receipt signers and agent key apply at
//!   once even with a delay set, so a new charter is usable in one approval. There
//!   is no agent key yet, so nothing can be spent while it is open. DAO, delay and
//!   upgrade changes are never exempt. Adding the agent key (or `close_setup`) ends it.
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{
    env, near, require, AccountId, Allowance, CryptoHash, Gas, GasWeight, NearToken,
    PanicOnDefault, Promise, PromiseOrValue, PublicKey,
};
use std::collections::BTreeMap;

const NS_PER_DAY: u64 = 86_400_000_000_000;
const NS_PER_MIN: u64 = 60_000_000_000;
const GAS_SETTLE: Gas = Gas::from_tgas(10);
const GAS_FT: Gas = Gas::from_tgas(10);
const GAS_FT_STORAGE_VIEW: Gas = Gas::from_tgas(5);
const GAS_FT_STORAGE_CB: Gas = Gas::from_tgas(30);
const GAS_ESCALATION_CB: Gas = Gas::from_tgas(60);
const GAS_AGENT_KEY_CB: Gas = Gas::from_tgas(5);
/// R14: set/execute of SetAgentKey needs room for AddKey + on_agent_key (+ its DeleteKey).
const GAS_MIN_AGENT_KEY: Gas = Gas::from_tgas(25); // R15: +1 DeleteKey action in the AddKey batch
/// Minimum prepaid gas per path, checked before anything is logged, so a
/// starved call reverts cleanly instead of leaving a phantom `submitted` log.
const MIN_GAS_NATIVE: Gas = Gas::from_tgas(25);
const MIN_GAS_FT: Gas = Gas::from_tgas(60);
const MIN_GAS_ESCALATE: Gas = Gas::from_tgas(75);
/// Settled action records older than the newest KEEP_RECENT are pruned.
pub const KEEP_RECENT: u64 = 32;
/// R15 data lives under its own raw storage keys, so the root state layout is unchanged.
const K_ROTATING: &[u8] = b"r15:rot";
const K_REPUTATION: &[u8] = b"r15:rep";
fn k_expiry(clause_id: &str) -> Vec<u8> { [b"r15:exp:".as_slice(), clause_id.as_bytes()].concat() }
fn clause_expiry(clause_id: &str) -> Option<u64> {
    env::storage_read(&k_expiry(clause_id)).and_then(|v| v.try_into().ok()).map(u64::from_le_bytes)
}
fn rotating() -> bool { env::storage_has_key(K_ROTATING) }

/// Per-charter record of what the agent tried, counted on chain at every `propose`.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Reputation {
    pub proposals: u64,
    pub allowed: u64,
    pub escalated: u64,
    pub refused: u64,
    /// Refusal reason -> count (e.g. receiver_not_allowlisted, over_per_action_cap).
    pub refusals: BTreeMap<String, u64>,
}
fn reputation_read() -> Reputation {
    env::storage_read(K_REPUTATION).and_then(|v| near_sdk::borsh::from_slice(&v).ok()).unwrap_or_default()
}
/// Score 0..=100: the share of proposals that stayed inside the rules. None until 5 proposals.
pub fn reputation_score(r: &Reputation) -> Option<u64> {
    if r.proposals < 5 { return None; }
    Some((r.allowed + r.escalated) * 100 / r.proposals)
}
/// Storage headroom (bytes) one new action may need; used by the reserve check.
const ACTION_STORAGE_HEADROOM: u64 = 600;
const MAX_MEMO: usize = 64;
const MAX_FIELD: usize = 32;
pub const RECEIPT_V: &str = "oath-receipt-v2";
const RECEIPT_KEYS: [&str; 8] = ["action_hash", "age_days", "amount", "code_hash", "job_id", "receiver", "v", "verdict"];

fn default_min_amount() -> U128 { U128(1) }
fn default_max_actions() -> u32 { 50 }

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum Asset {
    Native,
    Ft { token: AccountId },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Clause {
    pub asset: Asset,
    /// Receiver allowlist. The contract only ever pays these accounts.
    pub receivers: Vec<AccountId>,
    pub per_action_cap: U128,
    pub daily_budget: U128,
    /// UTC minutes of day, [start, end). start == end means always open.
    pub window_start_min: u16,
    pub window_end_min: u16,
    /// Require a valid ed25519 receipt bound to this exact action.
    pub requires_receipt: bool,
    /// Above the cap (but <= escalation_max) the action waits for the owner
    /// via NEP-519 yield/resume instead of being denied outright.
    pub escalation_max: Option<U128>,
    /// Smallest amount one action may move (anti storage-griefing).
    #[serde(default = "default_min_amount")]
    pub min_amount: U128,
    /// Allowed + escalated actions per UTC day for this clause.
    #[serde(default = "default_max_actions")]
    pub max_actions_per_day: u32,
    /// Receipt must attest the receiver account is at least this old.
    #[serde(default)]
    pub min_receiver_age_days: u32,
    /// Receipt must attest exactly this code_hash for a pinned receiver.
    #[serde(default)]
    pub code_hash_pins: BTreeMap<AccountId, String>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct Usage {
    pub day: u64,
    pub spent: U128,
    pub reserved: U128,
    #[serde(default)]
    pub count: u32,
}

#[near(serializers = [json])]
pub struct Receipt {
    pub signer_key_id: String,
    pub model: String,
    pub request_body: String,
    pub response_body: String,
    pub signature: Base64VecU8,
    pub job_id: String,
}

#[near(serializers = [json])]
pub struct Proposal {
    pub shop: String,
    pub clause_id: String,
    pub receiver: AccountId,
    pub amount: U128,
    pub nonce: U64,
    pub policy_version: u32,
    pub expires_at: U64,
    pub memo: Option<String>,
    pub receipt: Option<Receipt>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct ActionRec {
    pub shop: String,
    pub clause_id: String,
    pub receiver: AccountId,
    pub amount: U128,
    pub day: u64,
    pub status: String,
    pub receipt_hash: Option<String>,
    pub yield_id: Option<Vec<u8>>,
    /// F4: snapshot taken at propose time, re-checked on approval.
    pub policy_version: u32,
    pub freeze_epoch: u32,
    pub asset: Asset,
    pub memo: Option<String>,
}

#[near(serializers = [json])]
pub struct Outcome {
    pub action_id: Option<U64>,
    pub decision: String,
    pub status: String,
    pub reason: String,
}

/// A policy-widening change waiting for `policy_delay_ns`.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub enum Change {
    SetClause { clause_id: String, clause: Clause },
    SetReceiptSigner { key_id: String, public_key: Base64VecU8 },
    SetAgentKey { public_key: PublicKey, allowance: U128 },
    SetDao { dao: Option<AccountId> },
    SetPolicyDelay { delay_ns: U64 },
    Upgrade { code_hash: String },
    /// R15: a later expiry or none (a widening change) waits for the policy delay.
    SetClauseExpiry { clause_id: String, expires_at: Option<U64> },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Pending {
    pub change: Change,
    pub eta: U64,
    pub by: AccountId,
}

/// The signed verdict body, parsed strictly.
#[derive(Debug, PartialEq)]
pub struct ReceiptBody {
    pub v: String,
    pub verdict: String,
    pub action_hash: String,
    pub receiver: String,
    pub amount: String,
    pub code_hash: String,
    pub age_days: u64,
    pub job_id: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Oath {
    owner: AccountId,
    dao: Option<AccountId>,
    agent_key: Option<PublicKey>,
    frozen: bool,
    freeze_epoch: u32,
    policy_version: u32,
    policy_hash: CryptoHash,
    clauses: BTreeMap<String, Clause>,
    receipt_signers: BTreeMap<String, Vec<u8>>,
    usage: LookupMap<String, Usage>,
    actions: LookupMap<u64, ActionRec>,
    used_jobs: LookupSet<CryptoHash>,
    next_nonce: u64,
    next_action: u64,
    prune_cursor: u64,
    policy_delay_ns: u64,
    storage_reserve: u128,
    pending: BTreeMap<u64, Pending>,
    next_change: u64,
    setup_open: bool,
    /// The agent key whose AddKey closed the setup window; a rollback of that key reopens it.
    setup_key: Option<PublicKey>,
}

fn reason(o: Option<U64>, decision: &str, status: &str, r: &str) -> Outcome {
    Outcome { action_id: o, decision: decision.into(), status: status.into(), reason: r.into() }
}

#[near]
impl Oath {
    #[init]
    pub fn new(owner: AccountId, dao: Option<AccountId>, policy_delay_ns: Option<U64>, storage_reserve: Option<U128>, setup_window: Option<bool>) -> Self {
        let mut s = Self {
            owner,
            dao,
            agent_key: None,
            frozen: false,
            freeze_epoch: 0,
            policy_version: 0,
            policy_hash: [0u8; 32],
            clauses: BTreeMap::new(),
            receipt_signers: BTreeMap::new(),
            usage: LookupMap::new(b"u"),
            actions: LookupMap::new(b"a"),
            used_jobs: LookupSet::new(b"j"),
            next_nonce: 0,
            next_action: 0,
            prune_cursor: 0,
            policy_delay_ns: policy_delay_ns.map(|d| d.0).unwrap_or(0),
            storage_reserve: storage_reserve.map(|r| r.0).unwrap_or(NearToken::from_millinear(100).as_yoctonear()),
            pending: BTreeMap::new(),
            next_change: 0,
            setup_open: setup_window.unwrap_or(false),
            setup_key: None,
        };
        s.bump_policy("init");
        s
    }

    // ---------------- governance (owner or DAO) ----------------
    fn assert_gov(&self) {
        let p = env::predecessor_account_id();
        require!(p == self.owner || Some(&p) == self.dao.as_ref(), "ERR_NOT_GOVERNOR");
    }

    fn assert_upgrader(&self) {
        let p = env::predecessor_account_id();
        match &self.dao {
            Some(d) => require!(&p == d, "ERR_DAO_ONLY_UPGRADE"),
            None => require!(p == self.owner, "ERR_NOT_OWNER"),
        }
    }

    fn bump_policy(&mut self, what: &str) {
        self.policy_version += 1;
        let bytes = near_sdk::borsh::to_vec(&(&self.clauses, &self.receipt_signers, &self.dao, &self.owner, &self.policy_delay_ns)).unwrap();
        self.policy_hash = env::sha256_array(&bytes);
        emit("policy", json!({
            "policy_version": self.policy_version,
            "policy_hash": hex::encode(self.policy_hash),
            "change": what,
            "by": env::predecessor_account_id(),
        }));
    }

    /// Widening changes wait `policy_delay_ns`; with delay 0 they apply now.
    fn queue_or_apply(&mut self, change: Change) -> PromiseOrValue<serde_json::Value> {
        let setup_exempt = self.setup_open
            && matches!(change, Change::SetClause { .. } | Change::SetClauseExpiry { .. } | Change::SetReceiptSigner { .. } | Change::SetAgentKey { .. });
        if self.policy_delay_ns == 0 || setup_exempt {
            return self.apply(change);
        }
        let id = self.next_change;
        self.next_change += 1;
        let eta = env::block_timestamp() + self.policy_delay_ns;
        let by = env::predecessor_account_id();
        emit("policy_queued", json!({"change_id": U64(id), "eta": U64(eta), "change": &change, "by": by}));
        self.pending.insert(id, Pending { change, eta: U64(eta), by });
        PromiseOrValue::Value(json!({"queued": U64(id), "eta": U64(eta)}))
    }

    fn apply(&mut self, change: Change) -> PromiseOrValue<serde_json::Value> {
        match change {
            Change::SetClause { clause_id, clause } => {
                self.clauses.insert(clause_id.clone(), clause);
                self.bump_policy(&format!("set_clause:{clause_id}"));
            }
            Change::SetReceiptSigner { key_id, public_key } => {
                self.receipt_signers.insert(key_id.clone(), public_key.0);
                self.bump_policy(&format!("set_receipt_signer:{key_id}"));
            }
            Change::SetDao { dao } => {
                self.dao = dao;
                self.bump_policy("set_dao");
            }
            Change::SetPolicyDelay { delay_ns } => {
                self.policy_delay_ns = delay_ns.0;
                self.bump_policy("set_policy_delay");
            }
            Change::SetClauseExpiry { clause_id, expires_at } => {
                match expires_at {
                    Some(t) => { env::storage_write(&k_expiry(&clause_id), &t.0.to_le_bytes()); }
                    None => { env::storage_remove(&k_expiry(&clause_id)); }
                }
                self.bump_policy(&format!("set_clause_expiry:{clause_id}"));
            }
            Change::Upgrade { code_hash } => {
                // Executing marks the hash as ready; `upgrade` consumes it.
                let id = self.next_change;
                self.next_change += 1;
                self.pending.insert(id, Pending { change: Change::Upgrade { code_hash: code_hash.clone() }, eta: U64(0), by: env::predecessor_account_id() });
                emit("policy", json!({"change": "upgrade_ready", "code_hash": code_hash, "change_id": U64(id)}));
            }
            Change::SetAgentKey { public_key, allowance } => {
                // R15: AddKey(new) and DeleteKey(old) run as ONE batch receipt. A batch is atomic,
                // so the old key is gone in the same receipt that adds the new one, and if AddKey
                // fails the delete is rolled back too: the account never has neither key.
                // State switches to the new key at once (direct path); until the callback runs a
                // `rotating` flag also refuses NEP-366 relayed proposes, which cannot name their key.
                // Checked before any state change or log: a call that cannot fund the callback reverts whole.
                require!(env::prepaid_gas() >= GAS_MIN_AGENT_KEY, "ERR_LOW_GAS");
                let me = env::current_account_id();
                let prev = self.agent_key.clone();
                self.agent_key = Some(public_key.clone());
                if self.setup_open {
                    self.setup_open = false;
                    self.setup_key = Some(public_key.clone());
                    emit("policy", json!({"change": "setup_closed", "by": env::predecessor_account_id()}));
                }
                emit("agent_key", json!({"op": "set", "public_key": public_key, "allowance": allowance}));
                let a = Allowance::limited(NearToken::from_yoctonear(allowance.0)).expect("ERR_ALLOWANCE_ZERO");
                let mut add = Promise::new(me.clone()).add_access_key_allowance(public_key.clone(), a, me.clone(), "propose".to_string());
                if let Some(old) = prev.clone().filter(|o| *o != public_key) { add = add.delete_key(old); }
                env::storage_write(K_ROTATING, &[1]);
                let cb = Promise::new(me).function_call_weight(
                    "on_agent_key",
                    json!({"prev": prev, "new": public_key}).to_string().into_bytes(),
                    NearToken::from_yoctonear(0),
                    GAS_AGENT_KEY_CB,
                    near_sdk::GasWeight(1),
                );
                return PromiseOrValue::Promise(add.then(cb));
            }
        }
        PromiseOrValue::Value(json!({"applied": true, "policy_version": self.policy_version}))
    }

    /// Tightening applies at once; widening is queued behind the delay.
    pub fn set_clause(&mut self, clause_id: String, clause: Clause) -> PromiseOrValue<serde_json::Value> {
        self.assert_gov();
        require!(clause.window_start_min < 1440 && clause.window_end_min <= 1440, "ERR_WINDOW");
        require!(valid_field(&clause_id), "ERR_CLAUSE_ID");
        require!(clause.min_amount.0 >= 1, "ERR_MIN_AMOUNT");
        // R14 lean build: no receipt verification and no NEP-519 escalation compiled in.
        #[cfg(feature = "lean")]
        require!(!clause.requires_receipt && clause.escalation_max.is_none(), "ERR_LEAN_BUILD");
        if is_widening(self.clauses.get(&clause_id), &clause) {
            self.queue_or_apply(Change::SetClause { clause_id, clause })
        } else {
            self.apply(Change::SetClause { clause_id, clause })
        }
    }

    /// Rule expiry for one clause: after `expires_at` (ns) every proposal under it is refused
    /// with `clause_expired`. An earlier expiry applies at once; a later one or none is a widening change.
    pub fn set_clause_expiry(&mut self, clause_id: String, expires_at: Option<U64>) -> PromiseOrValue<serde_json::Value> {
        self.assert_gov();
        require!(self.clauses.contains_key(&clause_id), "ERR_NO_CLAUSE");
        let narrowing = match (clause_expiry(&clause_id), expires_at) {
            (_, None) => false,
            (None, Some(_)) => true,
            (Some(old), Some(new)) => new.0 <= old,
        };
        let ch = Change::SetClauseExpiry { clause_id, expires_at };
        if narrowing { self.apply(ch) } else { self.queue_or_apply(ch) }
    }

    pub fn remove_clause(&mut self, clause_id: String) {
        self.assert_gov();
        env::storage_remove(&k_expiry(&clause_id));
        self.clauses.remove(&clause_id);
        self.bump_policy(&format!("remove_clause:{clause_id}"));
    }

    pub fn set_receipt_signer(&mut self, key_id: String, public_key: Base64VecU8) -> PromiseOrValue<serde_json::Value> {
        self.assert_gov();
        require!(public_key.0.len() == 32, "ERR_PK_LEN");
        self.queue_or_apply(Change::SetReceiptSigner { key_id, public_key })
    }

    pub fn remove_receipt_signer(&mut self, key_id: String) {
        self.assert_gov();
        self.receipt_signers.remove(&key_id);
        self.bump_policy(&format!("remove_receipt_signer:{key_id}"));
    }

    pub fn set_dao(&mut self, dao: Option<AccountId>) -> PromiseOrValue<serde_json::Value> {
        require!(env::predecessor_account_id() == self.owner, "ERR_NOT_OWNER");
        self.queue_or_apply(Change::SetDao { dao })
    }

    /// Raising the delay is instant; lowering it is itself delayed.
    pub fn set_policy_delay(&mut self, delay_ns: U64) -> PromiseOrValue<serde_json::Value> {
        self.assert_gov();
        if delay_ns.0 >= self.policy_delay_ns {
            self.apply(Change::SetPolicyDelay { delay_ns })
        } else {
            self.queue_or_apply(Change::SetPolicyDelay { delay_ns })
        }
    }

    /// Adds the agent key to THIS account as a function-call key that may only
    /// call `propose` on this contract. A new key is a widening change.
    pub fn set_agent_key(&mut self, public_key: PublicKey, allowance: U128) -> PromiseOrValue<serde_json::Value> {
        self.assert_gov();
        require!(allowance.0 > 0, "ERR_ALLOWANCE_ZERO");
        self.queue_or_apply(Change::SetAgentKey { public_key, allowance })
    }

    pub fn execute_change(&mut self, change_id: U64) -> PromiseOrValue<serde_json::Value> {
        self.assert_gov();
        let p = self.pending.get(&change_id.0).cloned().expect("ERR_NO_CHANGE");
        if let Change::Upgrade { .. } = p.change { require!(p.eta.0 != 0, "ERR_ALREADY_READY"); self.assert_upgrader(); }
        require!(env::block_timestamp() >= p.eta.0, "ERR_TIMELOCK_NOT_READY");
        self.pending.remove(&change_id.0);
        emit("policy_executed", json!({"change_id": change_id, "by": env::predecessor_account_id()}));
        self.apply(p.change)
    }

    /// Cancelling is tightening: either governor may cancel any pending change.
    pub fn cancel_change(&mut self, change_id: U64) {
        self.assert_gov();
        let p = self.pending.remove(&change_id.0).expect("ERR_NO_CHANGE");
        emit("policy_cancelled", json!({"change_id": change_id, "queued_by": p.by, "by": env::predecessor_account_id()}));
    }

    /// R14: result of the AddKey receipt from `set_agent_key`.
    /// Success: delete the previous key (if any and different). Failure (e.g.
    /// `AddKeyAlreadyExists`, whose existing permission we cannot see): roll
    /// `agent_key` back to `prev`, but only if no later change replaced it.
    #[private]
    pub fn on_agent_key(&mut self, prev: Option<PublicKey>, new: PublicKey) -> PromiseOrValue<bool> {
        let ok = env::promise_result_checked(0, 64).is_ok();
        let closed_setup = self.setup_key.as_ref() == Some(&new);
        if closed_setup { self.setup_key = None; }
        env::storage_remove(K_ROTATING);
        if ok {
            let me = env::current_account_id();
            // The old key was already deleted in the AddKey batch.
            let mut del: Option<Promise> = None;
            if self.agent_key.as_ref() != Some(&new) {
                // Revoked or replaced while AddKey was in flight: do not leave it on the account.
                emit("agent_key", json!({"op": "added_stale_removed", "public_key": new}));
                let d = Promise::new(me).delete_key(new);
                del = Some(match del { Some(p) => p.and(d), None => d });
            } else {
                emit("agent_key", json!({"op": "added", "public_key": new}));
            }
            return match del { Some(p) => PromiseOrValue::Promise(p), None => PromiseOrValue::Value(true) };
        }
        if closed_setup && self.agent_key.as_ref() == Some(&new) {
            // The key that ended setup never landed: the charter still has no working agent.
            self.setup_open = true;
            emit("policy", json!({"change": "setup_reopened"}));
        }
        if self.agent_key.as_ref() == Some(&new) {
            self.agent_key = prev.clone();
            emit("agent_key", json!({"op": "rollback", "failed_key": new, "restored": prev}));
        } else {
            emit("agent_key", json!({"op": "add_failed_stale", "failed_key": new}));
        }
        PromiseOrValue::Value(false)
    }

    /// Ends the setup window early (tightening, instant).
    pub fn close_setup(&mut self) {
        self.assert_gov();
        if self.setup_open {
            self.setup_open = false;
            emit("policy", json!({"change": "setup_closed", "by": env::predecessor_account_id()}));
        }
    }

    pub fn revoke_agent(&mut self) -> Promise {
        self.assert_gov();
        let pk = self.agent_key.take().expect("ERR_NO_AGENT");
        env::storage_remove(K_ROTATING);
        emit("agent_key", json!({"op": "revoke", "public_key": pk}));
        Promise::new(env::current_account_id()).delete_key(pk)
    }

    pub fn freeze(&mut self) {
        self.assert_gov();
        self.frozen = true;
        self.freeze_epoch += 1;
        emit("freeze", json!({"frozen": true, "freeze_epoch": self.freeze_epoch, "by": env::predecessor_account_id()}));
    }

    /// With a DAO set, only the DAO may unfreeze (a stolen owner key cannot undo a freeze).
    pub fn unfreeze(&mut self) {
        let p = env::predecessor_account_id();
        match &self.dao {
            Some(d) => require!(&p == d, "ERR_DAO_ONLY_UNFREEZE"),
            None => require!(p == self.owner, "ERR_NOT_OWNER"),
        }
        self.frozen = false;
        emit("freeze", json!({"frozen": false, "freeze_epoch": self.freeze_epoch, "by": p}));
    }

    /// Queue a code hash for upgrade (DAO if set, else owner).
    pub fn queue_upgrade(&mut self, code_hash: String) -> PromiseOrValue<serde_json::Value> {
        self.assert_upgrader();
        require!(code_hash.len() == 64 && code_hash.bytes().all(|b| b.is_ascii_hexdigit()), "ERR_CODE_HASH");
        self.queue_or_apply(Change::Upgrade { code_hash: code_hash.to_ascii_lowercase() })
    }

    /// Upgrade: raw wasm as input. Its sha256 must have passed the timelock
    /// (when policy_delay_ns > 0). DAO if set, else owner.
    pub fn upgrade(&mut self) -> Promise {
        self.assert_upgrader();
        let code = env::input().expect("ERR_NO_CODE");
        let h = hex::encode(env::sha256_array(&code));
        if self.policy_delay_ns > 0 {
            let ready = self.pending.iter()
                .find(|(_, p)| p.eta.0 == 0 && matches!(&p.change, Change::Upgrade { code_hash } if *code_hash == h))
                .map(|(k, _)| *k);
            let k = ready.expect("ERR_UPGRADE_NOT_TIMELOCKED");
            self.pending.remove(&k);
        }
        emit("upgrade", json!({"code_hash": h, "by": env::predecessor_account_id()}));
        Promise::new(env::current_account_id()).deploy_contract(code)
    }

    // ---------------- the agent path ----------------
    pub fn propose(&mut self, p: Proposal) -> PromiseOrValue<Outcome> {
        // Only the agent key, signing as this very account, reaches here.
        require!(env::predecessor_account_id() == env::current_account_id(), "ERR_NOT_AGENT");
        // Direct tx: the signer is this account, so the key must be the registered agent key.
        // NEP-366 relayed tx: the protocol already checked the DelegateAction against a key of
        // THIS account (and its FC scope), so predecessor == self is the binding guarantee.
        if env::signer_account_id() == env::current_account_id() {
            require!(Some(env::signer_account_pk()) == self.agent_key, "ERR_NOT_AGENT_KEY");
        } else {
            // Relayed: the inner key is not visible here, so no relayed propose while a rotation is in flight.
            require!(!rotating(), "ERR_KEY_ROTATING");
        }
        require!(p.nonce.0 == self.next_nonce, "ERR_NONCE");
        self.next_nonce += 1;
        let ah = action_hash(&p);
        match self.check(&p, &ah) {
            Err(r) => {
                self.chronicle(None, &p, "denied", "denied", &r, None, &ah);
                PromiseOrValue::Value(reason(None, "denied", "denied", &r))
            }
            Ok((clause, receipt_hash, escalate)) => {
                // Gas floor per path: revert BEFORE any log (no phantom events).
                let need = if escalate { MIN_GAS_ESCALATE } else { match clause.asset { Asset::Native => MIN_GAS_NATIVE, Asset::Ft { .. } => MIN_GAS_FT } };
                require!(env::prepaid_gas() >= need, "ERR_LOW_GAS");
                let id = self.next_action;
                self.next_action += 1;
                let day = today();
                let mut u = self.usage_today(&p.clause_id);
                u.reserved.0 += p.amount.0;
                u.count += 1;
                self.usage.insert(p.clause_id.clone(), u);
                let mut rec = ActionRec {
                    shop: p.shop.clone(),
                    clause_id: p.clause_id.clone(),
                    receiver: p.receiver.clone(),
                    amount: p.amount,
                    day,
                    status: "reserved".into(),
                    receipt_hash: receipt_hash.clone(),
                    yield_id: None,
                    policy_version: self.policy_version,
                    freeze_epoch: self.freeze_epoch,
                    asset: clause.asset.clone(),
                    memo: p.memo.clone(),
                };
                self.auto_prune(2);
                if !cfg!(feature = "lean") && escalate {
                    let args = json!({"action_id": U64(id)}).to_string();
                    env::promise_yield_create(
                        "on_escalation", args.as_bytes(), GAS_ESCALATION_CB, GasWeight(0), 0);
                    let yid = env::read_register(0).expect("ERR_YIELD_ID");
                    rec.status = "escalated".into();
                    rec.yield_id = Some(yid);
                    self.actions.insert(id, rec);
                    self.chronicle(Some(id), &p, "escalated", "escalated", "over_cap_waiting_owner", receipt_hash, &ah);
                    return PromiseOrValue::Value(reason(Some(U64(id)), "escalated", "escalated", "over_cap_waiting_owner"));
                }
                rec.status = "submitted".into();
                self.actions.insert(id, rec);
                self.chronicle(Some(id), &p, "allowed", "submitted", "ok", receipt_hash, &ah);
                PromiseOrValue::Promise(execute(&clause.asset, &p.receiver, p.amount.0, p.memo.clone(), id))
            }
        }
    }

    fn check(&mut self, p: &Proposal, ah: &str) -> Result<(Clause, Option<String>, bool), String> {
        if self.frozen { return Err("frozen".into()); }
        if p.policy_version != self.policy_version { return Err("stale_policy_version".into()); }
        if env::block_timestamp() > p.expires_at.0 { return Err("expired".into()); }
        if !valid_field(&p.shop) || !valid_field(&p.clause_id) { return Err("bad_field".into()); }
        if p.memo.as_ref().map(|m| m.len() > MAX_MEMO).unwrap_or(false) { return Err("memo_too_long".into()); }
        let c = self.clauses.get(&p.clause_id).cloned().ok_or("unknown_clause")?;
        if clause_expiry(&p.clause_id).map(|t| env::block_timestamp() >= t).unwrap_or(false) { return Err("clause_expired".into()); }
        let escalate = clause_checks(&c, &p.receiver, p.amount.0)?;
        let u = self.usage_today(&p.clause_id);
        if u.spent.0 + u.reserved.0 + p.amount.0 > c.daily_budget.0 { return Err("over_daily_budget".into()); }
        if u.count >= c.max_actions_per_day { return Err("over_daily_action_count".into()); }
        let native = if c.asset == Asset::Native { p.amount.0 } else { 0 };
        let need = (env::storage_usage() + ACTION_STORAGE_HEADROOM) as u128 * env::storage_byte_cost().as_yoctonear()
            + self.storage_reserve + native;
        if env::account_balance().as_yoctonear() < need { return Err("storage_reserve_low".into()); }
        #[cfg(feature = "lean")]
        {
            let _ = ah;
            if c.requires_receipt { return Err("receipt_required".into()); }
            if escalate { return Err("over_per_action_cap".into()); }
            Ok((c, None, false))
        }
        #[cfg(not(feature = "lean"))]
        {
            let mut rh = None;
            if c.requires_receipt {
                let r = p.receipt.as_ref().ok_or("receipt_required")?;
                rh = Some(self.verify_receipt(r, p, &c, ah)?);
            }
            Ok((c, rh, escalate))
        }
    }

    /// NEAR AI style envelope: signer signs `MODEL:sha256(request):sha256(response)`.
    /// The response must be EXACTLY the canonical verdict JSON (see `parse_receipt_body`).
    #[cfg(not(feature = "lean"))]
    fn verify_receipt(&mut self, r: &Receipt, p: &Proposal, c: &Clause, ah: &str) -> Result<String, String> {
        let pk = self.receipt_signers.get(&r.signer_key_id).ok_or("unknown_receipt_signer")?;
        if !valid_job_id(&r.job_id) { return Err("receipt_job_id_invalid".into()); }
        let jh = env::sha256_array(r.job_id.as_bytes());
        if self.used_jobs.contains(&jh) { return Err("receipt_replayed".into()); }
        let rq = hex::encode(env::sha256_array(r.request_body.as_bytes()));
        let rs = hex::encode(env::sha256_array(r.response_body.as_bytes()));
        let text = format!("{}:{}:{}", r.model, rq, rs);
        let sig: [u8; 64] = r.signature.0.clone().try_into().map_err(|_| "bad_sig_len")?;
        let pkb: [u8; 32] = pk.clone().try_into().map_err(|_| "bad_pk_len")?;
        if !env::ed25519_verify(&sig, text.as_bytes(), &pkb) { return Err("receipt_signature_invalid".into()); }
        if !r.request_body.contains(ah) { return Err("receipt_not_bound_to_action".into()); }
        let body = parse_receipt_body(&r.response_body)?;
        check_receipt_body(&body, ah, &p.receiver, p.amount.0, &r.job_id, c)?;
        self.used_jobs.insert(jh);
        Ok(hex::encode(env::sha256_array(text.as_bytes())))
    }

    /// Owner/DAO answers a yielded escalation (NEP-519).
    #[cfg(not(feature = "lean"))]
    pub fn resolve_escalation(&mut self, action_id: U64, approve: bool) -> bool {
        self.assert_gov();
        let rec = self.actions.get(&action_id.0).cloned().expect("ERR_NO_ACTION");
        require!(rec.status == "escalated", "ERR_NOT_ESCALATED");
        let y: CryptoHash = rec.yield_id.clone().unwrap().try_into().unwrap();
        env::promise_yield_resume(&y, json!({"approve": approve}).to_string().as_bytes())
    }

    #[cfg(not(feature = "lean"))]
    #[private]
    pub fn on_escalation(&mut self, action_id: U64) -> PromiseOrValue<Outcome> {
        let id = action_id.0;
        let mut rec = self.actions.get(&id).cloned().expect("ERR_NO_ACTION");
        let res = env::promise_result_checked(0, 256);
        let timed_out = res.is_err(); // yield timeout (~200 blocks) resolves as failure
        let approved = res.ok().and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
            .and_then(|v| v["approve"].as_bool()).unwrap_or(false);
        let verdict = self.recheck_escalation(&rec, approved, timed_out);
        if let Err(r) = verdict {
            self.release(&rec);
            rec.status = "denied".into();
            self.actions.insert(id, rec.clone());
            self.settle_event(id, &rec, "denied", &r);
            return PromiseOrValue::Value(reason(Some(action_id), "denied", "denied", &r));
        }
        rec.status = "submitted".into();
        self.actions.insert(id, rec.clone());
        self.settle_event(id, &rec, "approved", "owner_approved");
        PromiseOrValue::Promise(execute(&rec.asset, &rec.receiver, rec.amount.0, rec.memo.clone(), id))
    }

    /// F4: everything that could have changed while the action waited.
    #[cfg(not(feature = "lean"))]
    fn recheck_escalation(&self, rec: &ActionRec, approved: bool, timed_out: bool) -> Result<(), String> {
        if timed_out { return Err("escalation_timed_out".into()); }
        if !approved { return Err("owner_rejected".into()); }
        if self.frozen { return Err("frozen".into()); }
        if self.freeze_epoch != rec.freeze_epoch { return Err("freeze_epoch_changed".into()); }
        let c = self.clauses.get(&rec.clause_id).ok_or("unknown_clause")?;
        if c.asset != rec.asset { return Err("asset_changed".into()); }
        clause_checks(c, &rec.receiver, rec.amount.0)?;
        if self.policy_version != rec.policy_version { return Err("policy_changed".into()); }
        Ok(())
    }

    #[private]
    pub fn on_ft_storage(&mut self, action_id: U64) -> PromiseOrValue<Outcome> {
        let id = action_id.0;
        let mut rec = self.actions.get(&id).cloned().expect("ERR_NO_ACTION");
        if rec.status != "submitted" {
            return PromiseOrValue::Value(reason(Some(action_id), "allowed", &rec.status, "already_settled"));
        }
        let registered = env::promise_result_checked(0, 1024).ok()
            .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
            .map(|v| v.is_object())
            .unwrap_or(false);
        if !registered {
            self.release(&rec);
            rec.status = "failed_released".into();
            self.actions.insert(id, rec.clone());
            self.settle_event(id, &rec, "failed_released", "ft_receiver_not_registered");
            return PromiseOrValue::Value(reason(Some(action_id), "allowed", "failed_released", "ft_receiver_not_registered"));
        }
        let token = match &rec.asset { Asset::Ft { token } => token.clone(), Asset::Native => env::panic_str("ERR_NOT_FT") };
        PromiseOrValue::Promise(Promise::new(token).function_call(
            "ft_transfer",
            json!({"receiver_id": rec.receiver, "amount": rec.amount, "memo": rec.memo}).to_string().into_bytes(),
            NearToken::from_yoctonear(1),
            GAS_FT,
        ).then(settle_promise(id)))
    }

    #[private]
    pub fn on_settle(&mut self, action_id: U64) -> Outcome {
        let id = action_id.0;
        let mut rec = self.actions.get(&id).cloned().expect("ERR_NO_ACTION");
        if rec.status != "submitted" {
            return reason(Some(action_id), "allowed", &rec.status, "already_settled");
        }
        let ok = env::promise_result_checked(0, 1024).is_ok();
        let mut u = self.usage_today(&rec.clause_id);
        u.reserved.0 = u.reserved.0.saturating_sub(rec.amount.0);
        // A12: the reservation was carried across UTC midnight by usage_today (reserved is not reset),
        // so the settled amount is charged to the day the money actually moves.
        if ok { u.spent.0 += rec.amount.0; }
        self.usage.insert(rec.clause_id.clone(), u);
        rec.status = if ok { "confirmed".into() } else { "failed_released".into() };
        self.actions.insert(id, rec.clone());
        self.settle_event(id, &rec, &rec.status.clone(), if ok { "ok" } else { "execution_failed_budget_released" });
        reason(Some(action_id), "allowed", &rec.status, if ok { "ok" } else { "execution_failed_budget_released" })
    }

    /// Anyone may prune settled records older than the newest KEEP_RECENT.
    pub fn prune(&mut self, max: u32) -> u32 { self.auto_prune(max.min(100)) }

    // ---------------- helpers ----------------
    fn auto_prune(&mut self, max: u32) -> u32 {
        let mut n = 0;
        while n < max && self.prune_cursor + KEEP_RECENT < self.next_action {
            let c = self.prune_cursor;
            match self.actions.get(&c).map(|r| is_settled(&r.status)) {
                None => { self.prune_cursor += 1; }
                Some(true) => { self.actions.remove(&c); self.prune_cursor += 1; n += 1; }
                Some(false) => break,
            }
        }
        n
    }

    fn usage_today(&self, clause_id: &String) -> Usage {
        let d = today();
        let mut u = self.usage.get(clause_id).cloned().unwrap_or_default();
        if u.day != d { u.day = d; u.spent = U128(0); u.count = 0; }
        u
    }

    fn release(&mut self, rec: &ActionRec) {
        let mut u = self.usage_today(&rec.clause_id);
        u.reserved.0 = u.reserved.0.saturating_sub(rec.amount.0);
        self.usage.insert(rec.clause_id.clone(), u);
    }

    #[allow(clippy::too_many_arguments)]
    fn chronicle(&self, id: Option<u64>, p: &Proposal, decision: &str, status: &str, why: &str, receipt_hash: Option<String>, ah: &str) {
        let mut r = reputation_read();
        r.proposals += 1;
        match decision {
            "allowed" => r.allowed += 1,
            "escalated" => r.escalated += 1,
            _ => { r.refused += 1; *r.refusals.entry(why.chars().take(MAX_FIELD).collect()).or_default() += 1; }
        }
        env::storage_write(K_REPUTATION, &near_sdk::borsh::to_vec(&r).expect("ERR_REP"));
        emit("action", json!({
            "action_id": id.map(U64),
            "agent": env::current_account_id(),
            "shop": p.shop,
            "clause_id": p.clause_id,
            "policy_version": self.policy_version,
            "policy_hash": hex::encode(self.policy_hash),
            "freeze_epoch": self.freeze_epoch,
            "action_hash": ah,
            "receiver": p.receiver,
            "amount": p.amount,
            "nonce": p.nonce,
            "memo_hash": p.memo.as_ref().map(|m| hex::encode(env::sha256_array(m.as_bytes()))),
            "decision": decision,
            "status": status,
            "reason": why,
            "receipt_hash": receipt_hash,
        }));
    }

    fn settle_event(&self, id: u64, rec: &ActionRec, status: &str, why: &str) {
        emit("settle", json!({
            "action_id": U64(id),
            "agent": env::current_account_id(),
            "shop": rec.shop,
            "clause_id": rec.clause_id,
            "policy_version": self.policy_version,
            "action_policy_version": rec.policy_version,
            "freeze_epoch": self.freeze_epoch,
            "status": status,
            "reason": why,
            "receipt_hash": rec.receipt_hash,
        }));
    }

    // ---------------- views ----------------
    pub fn get_state(&self) -> serde_json::Value {
        json!({
            "owner": self.owner, "dao": self.dao, "agent_key": self.agent_key,
            "frozen": self.frozen, "freeze_epoch": self.freeze_epoch,
            "policy_version": self.policy_version, "policy_hash": hex::encode(self.policy_hash),
            "next_nonce": U64(self.next_nonce), "next_action": U64(self.next_action),
            "prune_cursor": U64(self.prune_cursor),
            "policy_delay_ns": U64(self.policy_delay_ns),
            "storage_reserve": U128(self.storage_reserve),
            "pending_changes": self.pending.len(),
            "setup_open": self.setup_open,
            "storage_usage": U64(env::storage_usage()),
        })
    }
    pub fn get_clauses(&self) -> &BTreeMap<String, Clause> { &self.clauses }
    pub fn get_clause_expiry(&self, clause_id: String) -> Option<U64> { clause_expiry(&clause_id).map(U64) }
    /// Every user-set rule for one clause in one read: cap, allowlist, asset, daily count, escalation, expiry, usage.
    pub fn get_rules(&self, clause_id: String) -> Option<serde_json::Value> {
        let c = self.clauses.get(&clause_id)?;
        Some(json!({"clause_id": clause_id, "clause": c, "expires_at": clause_expiry(&clause_id).map(U64),
            "usage": self.usage_today(&clause_id), "policy_version": self.policy_version}))
    }
    /// Agent reputation from this charter's own on-chain decisions.
    pub fn get_reputation(&self) -> serde_json::Value {
        let r = reputation_read();
        json!({"score": reputation_score(&r), "min_proposals_for_score": 5, "counts": r, "rotating_key": rotating()})
    }
    pub fn get_usage(&self, clause_id: String) -> Usage { self.usage_today(&clause_id) }
    pub fn get_action(&self, action_id: U64) -> Option<ActionRec> { self.actions.get(&action_id.0).cloned() }
    pub fn get_pending(&self) -> &BTreeMap<u64, Pending> { &self.pending }
}

fn is_settled(s: &str) -> bool { matches!(s, "confirmed" | "denied" | "failed_released") }

/// Allowlist, amount bounds, window and cap/escalation band. Shared by propose and approval.
pub fn clause_checks(c: &Clause, receiver: &AccountId, amount: u128) -> Result<bool, String> {
    if !c.receivers.contains(receiver) { return Err("receiver_not_allowlisted".into()); }
    if amount == 0 { return Err("zero_amount".into()); }
    if amount < c.min_amount.0 { return Err("below_min_amount".into()); }
    if !in_window(c.window_start_min, c.window_end_min) { return Err("outside_time_window".into()); }
    if amount > c.per_action_cap.0 {
        return match c.escalation_max { Some(m) if amount <= m.0 => Ok(true), _ => Err("over_per_action_cap".into()) };
    }
    Ok(false)
}

/// Anything that lets the agent do more than before counts as widening.
pub fn is_widening(old: Option<&Clause>, new: &Clause) -> bool {
    let Some(o) = old else { return true };
    if o.asset != new.asset { return true; }
    if new.receivers.iter().any(|r| !o.receivers.contains(r)) { return true; }
    if new.per_action_cap.0 > o.per_action_cap.0 || new.daily_budget.0 > o.daily_budget.0 { return true; }
    match (o.escalation_max, new.escalation_max) {
        (None, Some(_)) => return true,
        (Some(a), Some(b)) if b.0 > a.0 => return true,
        _ => {}
    }
    if (o.window_start_min, o.window_end_min) != (new.window_start_min, new.window_end_min) { return true; }
    if o.requires_receipt && !new.requires_receipt { return true; }
    if new.min_amount.0 < o.min_amount.0 { return true; }
    if new.max_actions_per_day > o.max_actions_per_day { return true; }
    if new.min_receiver_age_days < o.min_receiver_age_days { return true; }
    if o.code_hash_pins.iter().any(|(k, v)| new.code_hash_pins.get(k) != Some(v)) { return true; }
    false
}

/// Field used inside the `|`-joined action hash: non-empty, short, no separator.
pub fn valid_field(s: &str) -> bool {
    !s.is_empty() && s.len() <= MAX_FIELD && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

pub fn valid_job_id(s: &str) -> bool {
    (16..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Strict parse: the body must be EXACTLY `serde_json` compact output of an
/// object with the 8 keys in RECEIPT_KEYS order (sorted), string values except
/// `age_days` (non-negative integer). No extra keys, whitespace or duplicates.
pub fn parse_receipt_body(body: &str) -> Result<ReceiptBody, String> {
    let v: serde_json::Value = serde_json::from_str(body).map_err(|_| "receipt_malformed")?;
    let m = v.as_object().ok_or("receipt_malformed")?;
    let keys: Vec<&str> = m.keys().map(|k| k.as_str()).collect();
    if keys != RECEIPT_KEYS { return Err("receipt_malformed".into()); }
    if serde_json::to_string(&v).map_err(|_| "receipt_malformed")? != body { return Err("receipt_not_canonical".into()); }
    let s = |k: &str| m[k].as_str().map(|x| x.to_string()).ok_or_else(|| "receipt_malformed".to_string());
    Ok(ReceiptBody {
        v: s("v")?,
        verdict: s("verdict")?,
        action_hash: s("action_hash")?,
        receiver: s("receiver")?,
        amount: s("amount")?,
        code_hash: s("code_hash")?,
        age_days: m["age_days"].as_u64().ok_or("receipt_malformed")?,
        job_id: s("job_id")?,
    })
}

pub fn check_receipt_body(b: &ReceiptBody, ah: &str, receiver: &AccountId, amount: u128, job_id: &str, c: &Clause) -> Result<(), String> {
    if b.v != RECEIPT_V { return Err("receipt_malformed".into()); }
    if b.verdict != "ALLOW" { return Err("receipt_verdict_not_allow".into()); }
    if b.action_hash != ah { return Err("receipt_not_bound_to_action".into()); }
    if b.receiver != receiver.as_str() { return Err("receipt_receiver_mismatch".into()); }
    if b.amount != amount.to_string() { return Err("receipt_amount_mismatch".into()); }
    if b.job_id != job_id { return Err("receipt_job_mismatch".into()); }
    if b.code_hash.is_empty() || b.code_hash.len() > 64 { return Err("receipt_malformed".into()); }
    if let Some(pin) = c.code_hash_pins.get(receiver) {
        if &b.code_hash != pin { return Err("receipt_code_hash_mismatch".into()); }
    }
    if b.age_days < c.min_receiver_age_days as u64 { return Err("receipt_receiver_too_new".into()); }
    Ok(())
}

fn settle_promise(id: u64) -> Promise {
    Promise::new(env::current_account_id()).function_call(
        "on_settle",
        json!({"action_id": U64(id)}).to_string().into_bytes(),
        NearToken::from_yoctonear(0),
        GAS_SETTLE,
    )
}

fn execute(asset: &Asset, receiver: &AccountId, amount: u128, _memo: Option<String>, id: u64) -> Promise {
    match asset {
        Asset::Native => Promise::new(receiver.clone()).transfer(NearToken::from_yoctonear(amount)).then(settle_promise(id)),
        // M7: check the receiver is registered on the token before ft_transfer.
        Asset::Ft { token } => Promise::new(token.clone()).function_call(
            "storage_balance_of",
            json!({"account_id": receiver}).to_string().into_bytes(),
            NearToken::from_yoctonear(0),
            GAS_FT_STORAGE_VIEW,
        ).then(Promise::new(env::current_account_id()).function_call(
            "on_ft_storage",
            json!({"action_id": U64(id)}).to_string().into_bytes(),
            NearToken::from_yoctonear(0),
            GAS_FT_STORAGE_CB,
        )),
    }
}

fn today() -> u64 { env::block_timestamp() / NS_PER_DAY }

fn in_window(s: u16, e: u16) -> bool {
    if s == e { return true; }
    let m = ((env::block_timestamp() / NS_PER_MIN) % 1440) as u16;
    if s < e { m >= s && m < e } else { m >= s || m < e }
}

/// Canonical commitment to the typed action (what a receipt must reference).
/// v2 adds sha256(memo) ("none" when absent).
pub fn action_hash(p: &Proposal) -> String {
    let mh = p.memo.as_ref().map(|m| hex::encode(env::sha256_array(m.as_bytes()))).unwrap_or_else(|| "none".into());
    let s = format!("oath-v2|{}|{}|{}|{}|{}|{}|{}|{}|{}", env::current_account_id(), p.shop, p.clause_id,
        p.receiver, p.amount.0, p.nonce.0, p.policy_version, p.expires_at.0, mh);
    hex::encode(env::sha256_array(s.as_bytes()))
}

fn emit(event: &str, data: serde_json::Value) {
    env::log_str(&format!("EVENT_JSON:{}", json!({
        "standard": "oath", "version": "2.0.0", "event": event, "data": [data]
    })));
}

#[cfg(test)]
mod tests;
