//! Teardown code for a charter (oath). The charter owner installs it through the charter's own timelocked
//! `queue_upgrade` + `upgrade`, then calls `reap()`. It reads the owner from the charter state that is still in
//! storage (the first borsh field, an AccountId) and deletes the account to that owner, so every yocto,
//! storage stake included, goes back to the owner. Only the owner can call it, with 1 yocto (full-access key).
use near_sdk::{env, require, AccountId, Promise};

fn stored_owner() -> AccountId {
    let s = env::storage_read(b"STATE").expect("ERR_NO_STATE");
    require!(s.len() >= 4, "ERR_STATE");
    let n = u32::from_le_bytes([s[0], s[1], s[2], s[3]]) as usize;
    require!(s.len() >= 4 + n, "ERR_STATE");
    String::from_utf8(s[4..4 + n].to_vec()).ok().and_then(|x| x.parse().ok()).expect("ERR_OWNER")
}

#[unsafe(no_mangle)]
pub extern "C" fn owner() {
    let o = stored_owner();
    env::value_return(format!("\"{o}\"").as_bytes());
}

#[unsafe(no_mangle)]
pub extern "C" fn reap() {
    require!(env::attached_deposit().as_yoctonear() == 1, "ERR_ONE_YOCTO");
    let o = stored_owner();
    require!(env::predecessor_account_id() == o, "ERR_NOT_OWNER");
    env::log_str(&format!("reap: deleting {} to {}", env::current_account_id(), o));
    let _ = Promise::new(env::current_account_id()).delete_account(o);
}
