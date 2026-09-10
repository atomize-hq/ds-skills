#!/usr/bin/env bash
# A trusted installed CLI verifies/acquires a DIFFERENT target install as data.
# No target executable is ever run to establish its integrity.
set -euo pipefail
cli="$1"; work="$2"; release="$3"
record="$work/release/ds-skills.release.json"
target="$work/resolution-prefix"
mirror="http://127.0.0.1:$(cat "$work/good.port")"
run() { "$cli" release "$1" --record "$record" --prefix "$target" --json "${@:2}"; }
fails() {
  local wanted="$1"; shift
  local code=0
  "$@" > "$work/resolution-out" 2> "$work/resolution-err" || code=$?
  test "$code" -eq "$wanted" || { cat "$work/resolution-err" >&2; echo "release resolution: expected $wanted, got $code" >&2; exit 1; }
  if test "$wanted" -eq 2; then test ! -s "$work/resolution-out"; fi
}
fails 2 run verify
run install --mirror "$mirror" > "$work/resolution-installed.json"
node -e 'const r=require(process.argv[1]); if(!r.ok || !r.acquired) throw new Error("explicit install did not verify")' "$work/resolution-installed.json"
run install > "$work/resolution-unchanged.json"
node -e 'const r=require(process.argv[1]); if(!r.ok || r.acquired) throw new Error("healthy install was reacquired")' "$work/resolution-unchanged.json"
mkdir -p "$target/unrelated-release"
printf 'keep\n' > "$target/unrelated-release/user-file"
# Replace the target launcher while retaining every old version label.
printf '#!/bin/sh\necho EXECUTED > "%s"\nexit 0\n' "$work/untrusted-executed" > "$target/$release/bin/ds-skills"
fails 1 run verify
grep -q RELEASE_CONTENT_DIGEST "$work/resolution-out"
test ! -e "$work/untrusted-executed"
# Rewriting its local manifest cannot hide tampering from the reviewed pin.
node --input-type=module - "$target/$release" <<'JS'
import fs from 'node:fs'; import crypto from 'node:crypto';
const home=process.argv[2], file=home+'/payload-manifest.json';
const manifest=JSON.parse(fs.readFileSync(file));
manifest.files['bin/ds-skills'].sha256=crypto.createHash('sha256').update(fs.readFileSync(home+'/bin/ds-skills')).digest('hex');
fs.writeFileSync(file,JSON.stringify(manifest));
JS
fails 1 run verify
grep -q RELEASE_MANIFEST_DIGEST "$work/resolution-out"
# A bad transport payload cannot repair/replace this target.
fails 2 run install --mirror "http://127.0.0.1:$(cat "$work/tampered.port")"
grep -q 'baked into this installer' "$work/resolution-err"
test ! -e "$work/untrusted-executed"
run install --mirror "$mirror" > "$work/resolution-repaired.json"
node -e 'const r=require(process.argv[1]); if(!r.ok || !r.acquired) throw new Error("damaged install was not repaired")' "$work/resolution-repaired.json"
run verify > "$work/resolution-verified.json"
test "$(cat "$target/unrelated-release/user-file")" = keep
test ! -e "$work/untrusted-executed"
echo '  product release resolution: cold install, sealed bytes, tamper rejection, safe repair, no target execution'
