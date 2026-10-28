#!/usr/bin/env bash
# Fresh testnet redeploy plan for 1 Nov 2026 (see MIGRATE_NOV1.md).
# Default is a DRY RUN: it checks every reproducible artifact (sha256 + NEAR code hash) and the
# script each step uses, then prints the plan. It sends no transaction and reads no key.
#   bash scripts/fresh-deploy.sh            # dry run (default)
#   bash scripts/fresh-deploy.sh --run      # runs the T1 steps; refused before 2026-11-01 UTC
set -euo pipefail
cd "$(dirname "$0")/.."
MODE=${1:-dry}
b58() { python3 - "$1" <<'PY'
import sys
a='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
n=int(sys.argv[1],16); s=''
while n: n,r=divmod(n,58); s=a[r]+s
print(s)
PY
}
# step | artifact | script (run from backend/) | env it needs (names only)
STEPS=(
  "arena|contracts/artifacts/arena.wasm|scripts/arena-fresh.js|funder key file"
  "toll|contracts/artifacts/toll.wasm|scripts/toll-deploy.js|owner key file"
  "oath R16|contracts/artifacts/oath.r16.wasm|scripts/oath-r16.js|owner key file"
  "house charter|contracts/artifacts/oath.r11.wasm|scripts/house-deploy.js|OWNER_KEY_FILE HOUSE_KEY_FILE AGENT_OUT"
  "house deed|contracts/artifacts/house_nft.wasm|scripts/house-nft-fresh.js|FUNDER_FILE OUT HOUSE"
  "mist bank payout|-|scripts/mistbank-record.js|MIST_PAYEE_WALLET (a payee whose UFVK was never public)"
)
fail=0
echo "mode: $MODE"
for s in "${STEPS[@]}"; do
  IFS='|' read -r name art script envs <<<"$s"
  line="[$name] script backend/$script"
  [ -f "backend/$script" ] || { line+=" MISSING"; fail=1; }
  if [ "$art" != "-" ]; then
    if [ -f "$art" ]; then
      h=$(sha256sum "$art" | cut -d' ' -f1); line+=" | $art sha256 ${h:0:12}… code_hash $(b58 "$h")"
    else line+=" | $art MISSING"; fail=1; fi
  fi
  echo "$line | needs: $envs"
done
echo "[charter factory + town hall] owned by the charter-factory worker; not run here (see MIGRATE_NOV1.md)"
echo "[after] cd backend && node scripts/verify-proofs.js && node scripts/txs-table.js && node scripts/readme-numbers.js"
[ $fail = 0 ] || { echo "plan check FAILED"; exit 1; }
if [ "$MODE" != "--run" ]; then echo "dry run OK: nothing sent"; exit 0; fi
[ "$(date -u +%Y%m%d)" -ge 20261101 ] || { echo "refused: --run is for 1 Nov 2026 UTC or later"; exit 2; }
echo "--run: execute each step by hand from backend/ with its env set, in the order above, then the [after] line."
echo "This script deliberately does not chain them: each step writes new account names that the next step reads."
