#!/usr/bin/env bash
# Full R16 verify: verify.sh, then the oath sandbox + exploit suites against the deployed bytes (oath.r16.oz.wasm),
# the factory unit + sandbox tests, and factory mutants. Earlier network reads only. Usage: scripts/verify/run_r16.sh [--offline]
set -uo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
OATH="$ROOT/contracts/oath"; FAC="$ROOT/contracts/charter_factory"; ART="$ROOT/contracts/artifacts"
OUT="${MUTANTS_OUT:-$(mktemp -d)}"; mkdir -p "$OUT/oath" "$OUT/factory"; LOG="$(mktemp)"
MUTANTS_OUT="$OUT/oath" bash "$HERE/verify.sh" "$@"; v=$?; echo "verify.sh exit=$v"
x=0; f="$OATH/target/near/oath.wasm"
[ -f "$f" ] || (cd "$OATH" && cargo near build reproducible-wasm) >/dev/null 2>&1
bak="$(mktemp)"; cp "$f" "$bak" && cp "$ART/oath.r16.oz.wasm" "$f"
if (cd "$OATH" && cargo test --release -q --tests) >"$LOG" 2>&1; then echo "PASS oath sandbox+exploits against oath.r16.oz.wasm"; else echo "FAIL oath tests on -Oz"; tail -20 "$LOG"; x=1; fi
grep -E "^test result" "$LOG"; cp "$bak" "$f"
if (cd "$FAC" && cargo test --release -q) >"$LOG" 2>&1; then echo "PASS factory unit + sandbox (R16 -Oz global code)"; else echo "FAIL factory tests"; tail -20 "$LOG"; x=1; fi
grep -E "^test result" "$LOG"
if command -v cargo-mutants >/dev/null; then
  (cd "$FAC" && cargo mutants -f src/lib.rs --no-shuffle -j4 --timeout 120 -o "$OUT/factory" -- --lib) >"$LOG" 2>&1; rc=$?; tail -1 "$LOG"
  if [ ! -s "$OUT/factory/mutants.out/missed.txt" ] && { [ $rc = 0 ] || [ $rc = 3 ]; }; then echo "PASS factory cargo mutants (0 missed)"; else echo "FAIL factory mutants"; cat "$OUT/factory/mutants.out/missed.txt"; x=1; fi
else echo "SKIP cargo-mutants not installed"; fi
rm -f "$LOG" "$bak"; echo "extra exit=$x"; [ $v = 0 ] && [ $x = 0 ]
