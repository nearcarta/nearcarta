#!/usr/bin/env bash
# Runs every contract's tests. oath and charter_factory also run near-workspaces sandbox tests, whose
# dev-dependencies need a C toolchain, pkg-config and the OpenSSL headers (Debian/Ubuntu:
# `sudo apt-get install -y build-essential pkg-config libssl-dev`; macOS: `brew install openssl pkg-config`).
# Without them those two crates are skipped with a clear message and the script exits 2, so nobody mistakes
# a partial run for a full one. SKIP_SANDBOX=1 runs only the crates that need nothing extra (exit 0).
set -euo pipefail
cd "$(dirname "$0")/../contracts"
for c in arena toll townhall house_nft attested_check; do echo "== $c"; (cd "$c" && cargo test --lib -q); done
[ "${SKIP_SANDBOX:-}" = 1 ] && { echo "SKIP_SANDBOX=1: oath and charter_factory not run"; exit 0; }
if ! command -v pkg-config >/dev/null || ! pkg-config --exists openssl; then
  echo "oath and charter_factory NOT run: install pkg-config and the OpenSSL headers (see the top of scripts/test-contracts.sh)" >&2; exit 2; fi
# the factory sandbox test deploys target/near/charter_factory.wasm, so build it first
(cd charter_factory && cargo near build non-reproducible-wasm >/dev/null)
for c in oath charter_factory; do echo "== $c"; (cd "$c" && cargo test -q); done
