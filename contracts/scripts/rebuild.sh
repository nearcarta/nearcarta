#!/bin/bash
# rebuild.sh <account> [out-dir]: rebuild one live contract from source and print its sha256.
# The recipe comes from contracts/deployed.json:
#   nep330  the rev in the contract's own contract_source_metadata, built in the image pinned
#           in that rev's Cargo.toml, with the same docker call `cargo near build reproducible-wasm` makes
#   box     the manifest rev, with rustc 1.86.0, cargo-near 0.22.0, binaryen version_108 wasm-opt and
#           CARGO_HOME=/home/box/.cargo (the registry path is inside the panic strings)
set -euo pipefail
ACC=$1; OUT=${2:-/tmp/rebuilt}; ROOT=$(git rev-parse --show-toplevel); mkdir -p "$OUT"
read -r BUILD CRATE REV < <(node -e '
  const m=require(process.argv[1]); const c=m.contracts.find(x=>x.account===process.argv[2]);
  if(!c) { console.error("not in deployed.json"); process.exit(2); }
  console.log(c.build, c.crate, c.rev||"-")' "$ROOT/contracts/deployed.json" "$ACC")
W=$(mktemp -d /tmp/rebuild-XXXX)
if [ "$BUILD" = nep330 ]; then
  REV=$(node --input-type=module -e '
    import { sourceMetadata } from "'"$ROOT"'/contracts/scripts/check-onchain.mjs";
    const m = await sourceMetadata(process.argv[1]);
    const s = m?.build_info?.source_code_snapshot || ""; const r = s.split("rev=")[1];
    if (!r) { console.error("no build_info on chain"); process.exit(3); } console.log(r);' "$ACC")
  CP=$(git -C "$ROOT" show "$REV:$CRATE/Cargo.toml" >/dev/null && echo "$CRATE")
  IMG=$(git -C "$ROOT" show "$REV:$CP/Cargo.toml" | sed -n 's/^image = "\(.*\)"/\1/p')
  DIG=$(git -C "$ROOT" show "$REV:$CP/Cargo.toml" | sed -n 's/^image_digest = "\(.*\)"/\1/p')
  CMD=$(git -C "$ROOT" show "$REV:$CP/Cargo.toml" | sed -n 's/^container_build_command = \[\(.*\)\]/\1/p' | tr -d '",')
  git -C "$ROOT" archive "$REV" | tar x -C "$W"; chmod -R a+rwX "$W"
  docker run -u 1000:1000 --network host --rm -v "$W":/home/near/code --workdir "/home/near/code/$CP" \
    --env NEP330_BUILD_INFO_BUILD_ENVIRONMENT="$IMG@$DIG" \
    --env NEP330_BUILD_INFO_SOURCE_CODE_SNAPSHOT="git+https://github.com/nearcarta/nearcarta?rev=$REV" \
    --env NEP330_BUILD_INFO_CONTRACT_PATH="$CP" \
    --env NEP330_LINK="https://github.com/nearcarta/nearcarta/tree/$REV" \
    --env RUST_LOG=info "$IMG@$DIG" /bin/bash -c "$CMD && chmod -R a+rX target/near"
  cp "$(ls "$W/$CP"/target/near/*.wasm | head -1)" "$OUT/$ACC.wasm"
elif [ "$BUILD" = box ]; then
  WASM_OPT=${WASM_OPT:-wasm-opt}
  "$WASM_OPT" --version | grep -q "version 108" || { echo "need binaryen version_108 wasm-opt (WASM_OPT=...)"; exit 4; }
  [ "${CARGO_HOME:-$HOME/.cargo}" = /home/box/.cargo ] || [ "$HOME" = /home/box ] || { echo "box builds need CARGO_HOME=/home/box/.cargo"; exit 5; }
  git -C "$ROOT" archive "$REV" | tar x -C "$W"
  (cd "$W/$CRATE" && cargo +1.86.0 near build non-reproducible-wasm --locked --no-abi)
  "$WASM_OPT" --enable-sign-ext --enable-mutable-globals --enable-bulk-memory -Oz --strip-debug --strip-producers \
    "$(ls "$W/$CRATE"/target/near/*.wasm | head -1)" -o "$OUT/$ACC.wasm"
else
  echo "$ACC has no reproducible build: $(node -e 'const m=require(process.argv[1]);console.log(m.contracts.find(x=>x.account===process.argv[2]).reason)' "$ROOT/contracts/deployed.json" "$ACC")"
  exit 0
fi
echo "$ACC $BUILD rev=$REV sha256=$(sha256sum "$OUT/$ACC.wasm" | cut -d' ' -f1) bytes=$(stat -c %s "$OUT/$ACC.wasm")"
