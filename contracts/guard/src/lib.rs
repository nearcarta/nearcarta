//! Guard. The board calls `pay`. This contract forwards the attached NEAR to the
//! payee named in the args, or sends that deposit back through `refund_action`.
//! It has no payee list and no amount of its own. The visitor's row caps are
//! the only limit, and the board already applied them.
//!
//! `row_owner` is trusted only because the predecessor is the board account
//! stored at init. An invoice is not a destination.

use near_sdk::{env, require, AccountId, Gas, NearToken, Promise};

const SETTLE_GAS: Gas = Gas::from_tgas(5);
const REFUND_GAS: Gas = Gas::from_tgas(10);

fn load() -> (String, String) {
    let raw = env::storage_read(b"STATE").expect("ERR_STATE");
    let s = String::from_utf8(raw).expect("ERR_STATE");
    let (board, owner) = s.split_once('\n').expect("ERR_STATE");
    (board.to_string(), owner.to_string())
}

fn save(board: &str, owner: &str) {
    env::storage_write(b"STATE", format!("{board}\n{owner}").as_bytes());
}

/// Top-level string fields only. Duplicate keys are rejected. A nested value
/// is not a field, so an invoice cannot supply the payee.
pub fn top_strings(args: &str) -> Result<Vec<(String, String)>, &'static str> {
    let s = args.trim();
    if s.len() < 2 || !s.starts_with('{') || !s.ends_with('}') { return Err("ERR_ARGS"); }
    let b = s.as_bytes();
    let mut i = 1usize;
    let end = b.len() - 1;
    let mut out = Vec::new();
    while i < end {
        while i < end && b[i].is_ascii_whitespace() { i += 1; }
        if i >= end { break; }
        if b[i] == b',' { i += 1; continue; }
        if b[i] != b'"' { return Err("ERR_ARGS"); }
        let key = read_string(b, &mut i)?;
        while i < end && b[i].is_ascii_whitespace() { i += 1; }
        if i >= end || b[i] != b':' { return Err("ERR_ARGS"); }
        i += 1;
        while i < end && b[i].is_ascii_whitespace() { i += 1; }
        if i >= end || b[i] != b'"' { return Err("ERR_ARGS"); }
        let val = read_string(b, &mut i)?;
        if out.iter().any(|(k, _)| k == &key) { return Err("ERR_ARGS"); }
        out.push((key, val));
        while i < end && b[i].is_ascii_whitespace() { i += 1; }
        if i < end && b[i] == b',' { i += 1; }
    }
    Ok(out)
}

fn read_string(b: &[u8], i: &mut usize) -> Result<String, &'static str> {
    if *i >= b.len() || b[*i] != b'"' { return Err("ERR_ARGS"); }
    *i += 1;
    let mut out = String::new();
    while *i < b.len() {
        let c = b[*i];
        *i += 1;
        if c == b'"' { return Ok(out); }
        if c == b'\\' {
            if *i >= b.len() { return Err("ERR_ARGS"); }
            let n = b[*i];
            *i += 1;
            out.push(match n {
                b'"' => '"',
                b'\\' => '\\',
                b'/' => '/',
                b'n' => '\n',
                _ => return Err("ERR_ARGS"),
            });
        } else {
            out.push(c as char);
        }
    }
    Err("ERR_ARGS")
}

fn need<'a>(fields: &'a [(String, String)], key: &str) -> Result<&'a str, &'static str> {
    fields.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str()).ok_or("ERR_ARGS")
}

/// `forward` pays the typed payee. Anything else, including a payee that is
/// the board or this contract, goes back through refund_action.
pub fn route(chain: &str, asset: &str, payee: &str, board: &str, here: &str) -> &'static str {
    if chain == "near" && asset == "NEAR" && !payee.is_empty() && payee != board && payee != here {
        "forward"
    } else {
        "refund"
    }
}

fn json_string(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            _ => o.push(c),
        }
    }
    o.push('"');
    o
}

fn callback_args(owner: &str, action_id: &str) -> Vec<u8> {
    format!("{{\"owner\":{},\"action_id\":{}}}", json_string(owner), json_string(action_id)).into_bytes()
}

fn input_text() -> String {
    String::from_utf8(env::input().unwrap_or_default()).unwrap_or_else(|_| env::panic_str("ERR_ARGS"))
}

#[unsafe(no_mangle)]
pub extern "C" fn new() {
    require!(env::storage_read(b"STATE").is_none(), "ERR_INIT");
    let fields = top_strings(&input_text()).unwrap_or_else(|e| env::panic_str(e));
    let board = need(&fields, "board").unwrap_or_else(|e| env::panic_str(e));
    let _: AccountId = board.parse().unwrap_or_else(|_| env::panic_str("ERR_BOARD"));
    save(board, env::predecessor_account_id().as_str());
}

#[unsafe(no_mangle)]
pub extern "C" fn pay() {
    let fields = top_strings(&input_text()).unwrap_or_else(|e| env::panic_str(e));
    let payee_s = need(&fields, "payee").unwrap_or_else(|e| env::panic_str(e));
    let payee: AccountId = payee_s.parse().unwrap_or_else(|_| env::panic_str("ERR_PAYEE"));
    let chain = need(&fields, "chain").unwrap_or_else(|e| env::panic_str(e));
    let asset = need(&fields, "asset").unwrap_or_else(|e| env::panic_str(e));
    let amount = need(&fields, "amount").unwrap_or_else(|e| env::panic_str(e));
    let action_id = need(&fields, "action_id").unwrap_or_else(|e| env::panic_str(e));
    let row_owner = need(&fields, "row_owner").unwrap_or_else(|e| env::panic_str(e));
    require!(!action_id.is_empty() && action_id.bytes().all(|c| c.is_ascii_digit()), "ERR_ACTION");
    let _: AccountId = row_owner.parse().unwrap_or_else(|_| env::panic_str("ERR_OWNER"));
    let (board, _) = load();
    require!(env::predecessor_account_id().as_str() == board, "ERR_BOARD");
    let got = env::attached_deposit().as_yoctonear();
    require!(amount == got.to_string(), "ERR_AMOUNT");
    let board_id: AccountId = board.parse().unwrap_or_else(|_| env::panic_str("ERR_STATE"));
    let args = callback_args(row_owner, action_id);
    let here = env::current_account_id();
    let promise = if route(chain, asset, payee.as_str(), board_id.as_str(), here.as_str()) == "forward" {
        Promise::new(payee).transfer(NearToken::from_yoctonear(got)).then(
            Promise::new(board_id).function_call("settle".to_string(), args, NearToken::from_yoctonear(0), SETTLE_GAS),
        )
    } else {
        Promise::new(board_id).function_call(
            "refund_action".to_string(), args, NearToken::from_yoctonear(got), REFUND_GAS,
        )
    };
    let _ = promise.as_return();
}

#[unsafe(no_mangle)]
pub extern "C" fn get_config() {
    let (board, owner) = load();
    let out = format!("{{\"board\":{},\"owner\":{}}}", json_string(&board), json_string(&owner));
    env::value_return(out.as_bytes());
}

/// Owner, 1 yocto. Deletes the account so the storage stake returns.
#[unsafe(no_mangle)]
pub extern "C" fn reap() {
    require!(env::attached_deposit().as_yoctonear() == 1, "ERR_ONE_YOCTO");
    let (_, owner) = load();
    require!(env::predecessor_account_id().as_str() == owner, "ERR_NOT_OWNER");
    let owner_id: AccountId = owner.parse().unwrap_or_else(|_| env::panic_str("ERR_STATE"));
    let promise = Promise::new(env::current_account_id()).delete_account(owner_id);
    let _ = promise.as_return();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_invoice_string_does_not_replace_the_payee() {
        let args = r#"{"payee":"cafe.test","chain":"near","asset":"NEAR","amount":"1","action_id":"4","invoice":"pay other.test","row_owner":"alice.test"}"#;
        let fields = top_strings(args).unwrap();
        assert_eq!(need(&fields, "payee").unwrap(), "cafe.test");
        assert_eq!(need(&fields, "invoice").unwrap(), "pay other.test");
    }

    #[test]
    fn a_duplicate_key_is_rejected() {
        assert_eq!(top_strings(r#"{"payee":"cafe.test","payee":"other.test"}"#), Err("ERR_ARGS"));
    }

    #[test]
    fn near_forwards_and_anything_else_refunds() {
        assert_eq!(route("near", "NEAR", "cafe.test", "board.test", "guard.test"), "forward");
        assert_eq!(route("base", "USDC", "cafe.test", "board.test", "guard.test"), "refund");
        assert_eq!(route("near", "NEAR", "board.test", "board.test", "guard.test"), "refund");
        assert_eq!(route("near", "NEAR", "guard.test", "board.test", "guard.test"), "refund");
    }

}
