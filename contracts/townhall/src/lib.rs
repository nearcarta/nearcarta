//! Town Hall oath (R7 testnet spike). The DAO owns the rule; the agent acts inside it.
use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::serde_json::json;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise};

#[derive(Clone, Debug)]
#[near(serializers = [json, borsh])]
pub struct Policy {
    /// max yoctoNEAR per single reward
    pub per_reward_cap: U128,
    /// max yoctoNEAR the agent may pay in total under this version
    pub total_cap: U128,
    /// accounts the agent must never pay
    pub deny: Vec<AccountId>,
    /// confirmed rewards needed before the agent may PROPOSE a role
    pub role_threshold: u32,
    /// role name the agent may propose
    pub role: String,
    /// bond the contract attaches when the agent files a role proposal (agent key cannot attach deposits)
    pub proposal_bond: U128,
}

#[derive(Clone, Debug)]
#[near(serializers = [json, borsh])]
pub struct Bounty {
    pub amount: U128,
    pub claimed_by: Option<AccountId>,
    pub policy_version: u32,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TownHall {
    dao: AccountId,
    agent: AccountId,
    version: u32,
    policy: Policy,
    spent: u128,
    frozen: bool,
    bounties: IterableMap<String, Bounty>, // hex sha256(preimage) -> bounty
    rewards: LookupMap<AccountId, u32>,
    proposed: LookupMap<AccountId, bool>,
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard":"chronicle","version":"0.1.0","event":event,"data":[data]})
    ));
}

#[near]
impl TownHall {
    #[init]
    pub fn new(dao: AccountId, agent: AccountId, policy: Policy) -> Self {
        let s = Self {
            dao,
            agent,
            version: 1,
            policy,
            spent: 0,
            frozen: false,
            bounties: IterableMap::new(b"b"),
            rewards: LookupMap::new(b"r"),
            proposed: LookupMap::new(b"p"),
        };
        emit("policy_set", json!({"version":1,"by":env::predecessor_account_id()}));
        s
    }

    fn only_dao(&self) {
        require!(env::predecessor_account_id() == self.dao, "ERR_NOT_DAO");
    }
    fn only_agent(&self) {
        require!(env::predecessor_account_id() == self.agent, "ERR_NOT_AGENT");
        require!(!self.frozen, "ERR_FROZEN");
    }

    /// Only callable by the DAO (i.e. through a passed FunctionCall proposal).
    pub fn set_policy(&mut self, policy: Policy) -> u32 {
        self.only_dao();
        self.policy = policy;
        self.version += 1;
        self.spent = 0;
        emit("policy_set", json!({"version":self.version,"by":self.dao}));
        self.version
    }

    pub fn post_bounty(&mut self, hash_hex: String, amount: U128) {
        self.only_dao();
        require!(hash_hex.len() == 64, "ERR_HASH");
        require!(self.bounties.get(&hash_hex).is_none(), "ERR_EXISTS");
        self.bounties.insert(
            hash_hex.clone(),
            Bounty { amount, claimed_by: None, policy_version: self.version },
        );
        emit("bounty_posted", json!({"hash":hash_hex,"amount":amount,"version":self.version}));
    }

    pub fn freeze(&mut self) {
        self.only_dao();
        self.frozen = true;
        emit("frozen", json!({"version":self.version}));
    }

    /// The agent pays a reward when it presents the preimage of a posted bounty hash.
    /// No per-claim vote: the DAO voted the rule (caps + deny list) once.
    pub fn agent_reward(&mut self, receiver: AccountId, preimage: Base64VecU8) -> Promise {
        self.only_agent();
        let h = hex::encode(env::sha256(&preimage.0));
        let mut b = self.bounties.get(&h).cloned().unwrap_or_else(|| env::panic_str("ERR_NO_EVIDENCE"));
        require!(b.claimed_by.is_none(), "ERR_ALREADY_CLAIMED");
        require!(!self.policy.deny.contains(&receiver), "ERR_OATH_DENY");
        let amt = b.amount.0;
        require!(amt <= self.policy.per_reward_cap.0, "ERR_OATH_PER_REWARD_CAP");
        require!(self.spent + amt <= self.policy.total_cap.0, "ERR_OATH_TOTAL_CAP");
        self.spent += amt;
        b.claimed_by = Some(receiver.clone());
        self.bounties.insert(h.clone(), b);
        let n = self.rewards.get(&receiver).copied().unwrap_or(0) + 1;
        self.rewards.insert(receiver.clone(), n);
        emit(
            "reward_paid",
            json!({"to":receiver,"amount":U128(amt),"evidence":h,"policy_version":self.version,"rewards":n}),
        );
        Promise::new(receiver).transfer(NearToken::from_yoctonear(amt))
    }

    /// Reputation ladder: after N rewards the agent may only PROPOSE a role; members still vote.
    pub fn agent_propose_role(&mut self, member: AccountId) -> Promise {
        self.only_agent();
        let n = self.rewards.get(&member).copied().unwrap_or(0);
        require!(n >= self.policy.role_threshold, "ERR_NOT_ENOUGH_REPUTATION");
        require!(self.proposed.get(&member).is_none(), "ERR_ALREADY_PROPOSED");
        self.proposed.insert(member.clone(), true);
        let bond = NearToken::from_yoctonear(self.policy.proposal_bond.0);
        emit("role_proposed", json!({"member":member,"role":self.policy.role,"rewards":n,"policy_version":self.version}));
        Promise::new(self.dao.clone()).function_call(
            "add_proposal".to_string(),
            json!({"proposal":{
                "description": format!("Town Hall agent: {} earned {} rewards (policy v{})", member, n, self.version),
                "kind": {"AddMemberToRole": {"member_id": member, "role": self.policy.role}}
            }})
            .to_string()
            .into_bytes(),
            bond,
            Gas::from_tgas(30),
        )
    }

    pub fn get_state(&self) -> near_sdk::serde_json::Value {
        json!({"dao":self.dao,"agent":self.agent,"version":self.version,"policy":self.policy,
               "spent":U128(self.spent),"frozen":self.frozen})
    }
    pub fn get_bounties(&self) -> Vec<(String, Bounty)> {
        self.bounties.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }
    pub fn get_rewards(&self, account: AccountId) -> u32 {
        self.rewards.get(&account).copied().unwrap_or(0)
    }
}
