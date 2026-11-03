use std::io::{self, Read, Write};

fn main() {
    let mut raw = String::new();
    let out = match io::stdin().read_to_string(&mut raw) {
        Err(e) => serde_json::json!({"success": false, "output": null, "error": e.to_string()}),
        Ok(_) => match charter_check::decide(raw.trim()) {
            // A bad input is a deny, never an allow.
            Ok(d) => serde_json::json!({"success": true, "output": d, "error": null}),
            Err(e) => serde_json::json!({"success": false, "output": {"allow": false}, "error": e}),
        },
    };
    print!("{out}");
    io::stdout().flush().ok();
}
