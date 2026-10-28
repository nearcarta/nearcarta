#!/usr/bin/env bash
# One-command verify (no `make` needed). Each step prints PASS/FAIL/SKIP; exit != 0 on any FAIL. Testnet reads only, no keys.
# Usage: scripts/verify/verify.sh [--offline]   (--offline skips the testnet RPC recheck)
# Overrides: OATH_SRC (contract dir), PINNED_WASM (expected build), PIN_REV (commit it was built from), MUTANT_RE (fns to mutate), MUTANTS_OUT,
#            EXTRA_SCAN (another dir to secret-scan; its own .gitleaks.toml wins if present), RECHECK_DIR / RECHECK_CMD.
set -uo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
OATH="${OATH_SRC:-$ROOT/contracts/oath}"; PINNED="${PINNED_WASM:-$ROOT/contracts/artifacts/oath.r16.wasm}"
MRE="${MUTANT_RE:-propose|check|on_settle|on_escalation|verify_receipt|parse_receipt|recheck|on_ft_storage|prune|queue_or_apply|execute_change|is_widening|upgrade|on_agent_key|apply|clause_expiry|rotating|refusal_bucket|reputation_score|clause_checks}"
MOUT="${MUTANTS_OUT:-$(mktemp -d)}"; RECHECK_DIR="${RECHECK_DIR:-$HERE}"; RECHECK_CMD="${RECHECK_CMD:-python3 recheck_r16.py}"
LOG="$(mktemp)"; fail=0
step(){ local n="$1"; shift; if "$@" >"$LOG" 2>&1; then echo "PASS $n"; else echo "FAIL $n (see below)"; tail -20 "$LOG"; fail=1; fi; }
# 1 unit + sandbox + exploit tests (near-workspaces sandbox lives in the contract crate)
step "cargo test (unit+sandbox)" bash -c "cd '$OATH' && cargo test --release -q"
# 2 reproducible build (cargo near, docker) -> sha256 must equal the pinned artifact
command -v docker >/dev/null || echo "NOTE reproducible-wasm needs Docker; the build step fails without it"
# The reproducible build records its source commit, so it is rebuilt from a clean clone of PIN_REV (oath.r16.wasm = 5099a7c).
REV="${PIN_REV:-5099a7c}"; BDIR="$(mktemp -d)"
step "build $REV + sha256 == pinned" bash -c "git clone -q '$ROOT' '$BDIR/r' && cd '$BDIR/r' && git checkout -q '$REV' && cd \"\$(realpath --relative-to='$ROOT' '$OATH')\" && cargo near build reproducible-wasm >/dev/null 2>&1 && [ \"\$(sha256sum target/near/oath.wasm|cut -c1-64)\" = \"\$(sha256sum '$PINNED'|cut -c1-64)\" ]"
# 3 mutation testing: any surviving mutant in the policy fns is a FAIL (cargo-mutants exits 3 on timeouts, so missed.txt is checked too)
if command -v cargo-mutants >/dev/null; then step "cargo mutants (policy fns; 0 missed, timeouts=caught)" bash -c "cd '$OATH' && cargo mutants -f src/lib.rs --re '$MRE' --no-shuffle -j4 --timeout 60 -o '$MOUT' -- --lib; rc=\$?; m='$MOUT/mutants.out/missed.txt'; [ ! -s \$m ] || { echo MISSED:; cat \$m; false; } && { [ \$rc = 0 ] || [ \$rc = 3 ]; }"; else echo "SKIP cargo-mutants not installed (cargo install cargo-mutants)"; fi
# 4 secrets scan: the contract dir with this folder's config, the repo with the repo config, EXTRA_SCAN with its own config if it has one
if command -v gitleaks >/dev/null; then step "gitleaks (contract + repo + EXTRA_SCAN)" bash -c "gitleaks dir '$OATH' -c '$HERE/gitleaks.toml' --redact && cd '$ROOT' && gitleaks dir . -c .gitleaks.toml --redact && { [ -z \"\${EXTRA_SCAN:-}\" ] || { cd \"\$EXTRA_SCAN\" && c='$HERE/gitleaks.toml' && { [ ! -f .gitleaks.toml ] || c=.gitleaks.toml; } && echo \"EXTRA_SCAN config: \$c\" && gitleaks dir . -c \"\$c\" --redact; }; }"; else echo "SKIP gitleaks not installed"; fi
# 5 on-chain re-derivation of judges/proofs/r16-factory.json: code hashes, keys, every proof tx
[ "${1:-}" = "--offline" ] || step "recheck vs testnet RPC" bash -c "cd '$RECHECK_DIR' && $RECHECK_CMD"
rm -f "$LOG"; exit $fail
