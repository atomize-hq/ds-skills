#!/usr/bin/env bash
# Rehearse the consumer cutover against the staged candidate, in a disposable
# clone, BEFORE anything is published.
#
#   cutover-rehearsal.sh <consumer-checkout> <cli> <profile-relative-path>
#
# T17 does the real cutover. This exists so the cutover does not discover a
# missing command semantic after the release is immutable and cannot be
# amended. Nothing here touches the consumer: it clones, and the clone is
# deleted. Deliberately NOT part of `pnpm check` — a portable package's own
# gate must not require a particular consumer to exist.
set -euo pipefail

source_repo="$(cd "$1" && pwd)"; cli="$2"; profile="${3:-.agents/skills/profiles/collider.json}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

clone="$work/checkout"
git clone --quiet --local --no-hardlinks --depth 1 "file://$source_repo" "$clone" 2>/dev/null ||
  git clone --quiet --local --no-hardlinks "$source_repo" "$clone"
cd "$clone"
test -f "$profile" || { echo "no profile at $profile in the checkout" >&2; exit 1; }

config="figma/token-sync.config.json"
artifact="design-tokens/dist/figma/tokens.json"
ledger="src/figma/sync-ledger.json"
proof="src/figma/publish-proof.json"
findings=0
note() { printf '  ! %s\n' "$1"; findings=$((findings + 1)); }
ok() { printf '  ✓ %s\n' "$1"; }

run() { # <label> <command...>
  local label="$1"; shift
  set +e
  out="$("$@" 2>&1)"; code=$?
  set -e
  printf '%s\n' "$out" >> "$work/rehearsal.log"
  if [ "$code" -eq 0 ]; then ok "$label"; else note "$label — exit $code: $(head -n2 <<<"$out" | tr '\n' ' ')"; fi
}

echo "cutover rehearsal against $(git -C "$clone" rev-parse --short HEAD)"

# ---- the record validators ----
run "ledger validate" "$cli" ledger validate --ledger "$ledger" --profile "$profile"
run "ledger parity" "$cli" ledger parity --ledger "$ledger" --profile "$profile"
run "proof validate" "$cli" proof validate --proof "$proof" --profile "$profile"

# The CI job that consumes the rail projection reads --json, so the shape it
# needs is checked here rather than after the release is immutable.
set +e
json="$("$cli" ledger validate --ledger "$ledger" --profile "$profile" --json 2>/dev/null)"
set -e
if [ -n "$json" ]; then
  node -e '
    const r = JSON.parse(process.argv[1]);
    for (const key of ["resultVersion","ok","state","rail","evidence","diagnostics"]) {
      if (!(key in r)) throw new Error(`--json is missing ${key}`);
    }
    for (const key of ["freshness","outcome","reasonCodes","sourceVersionOrRevision"]) {
      if (!(key in r.rail)) throw new Error(`--json rail projection is missing ${key}`);
    }
  ' "$json" && ok "--json carries the status-rail projection the promotion job reads" ||
    note "--json does not carry what the promotion job reads"
else
  note "--json produced nothing; the promotion job would have no rail to read"
fi

# ---- the artifact validator ----
run "validate sync-ledger (by name)" "$cli" validate sync-ledger "$ledger" --profile "$profile"

# ---- S3: the full mapping still matches the pre-migration baseline ----
run "figma verify against the committed baseline" \
  "$cli" figma verify --config "$config" --expect figma/token-rail.baseline.json --artifact "$artifact"

# ---- S4: the manifest is byte-identical to the pre-migration capture ----
# Built where the consumer builds it, not into a scratch directory: the manifest
# baseline records its own source path, so building elsewhere reports drift that
# is really just a different location.
pluginOut="$(node -e 'process.stdout.write(require("path").dirname(require(process.argv[1]).source))' ./figma/plugin-manifest.baseline.json)"
"$cli" figma plugin build --config "$config" --out "$pluginOut" >/dev/null 2>&1 || true
if [ -f "$pluginOut/manifest.json" ]; then
  expected="$(node -e 'process.stdout.write(require(process.argv[1]).sha256)' ./figma/plugin-manifest.baseline.json)"
  actual="$(shasum -a 256 "$pluginOut/manifest.json" | cut -d' ' -f1)"
  if [ "$expected" = "$actual" ]; then
    ok "figma plugin build reproduces the baseline manifest byte for byte"
  else
    note "the manifest differs from figma/plugin-manifest.baseline.json"
  fi
else
  note "figma plugin build produced no manifest"
fi

# ---- baselines: --check must pass against the committed references ----
run "figma baseline --check against the committed references" \
  "$cli" figma baseline --check --config "$config" --artifact "$artifact" --out figma \
  --plugin-out "$pluginOut"

# ---- serve: the endpoint the plugin is built to fetch ----
"$cli" figma serve --config "$config" --artifact "$artifact" --port 0 \
  --drift-out "$work/drift.json" >/dev/null 2>"$work/serve.log" &
servePid=$!
for _ in $(seq 1 100); do grep -q RAIL_SERVE_READY "$work/serve.log" && break; sleep 0.05; done
url="$(sed -n 's/^\[RAIL_SERVE_READY\] \(http[^ ]*\)$/\1/p' "$work/serve.log" | head -n1)"
if [ -n "$url" ] && [ "$(curl -s -o /dev/null -w '%{http_code}' "$url")" = "200" ]; then
  ok "figma serve answers at the URL the plugin is built with ($url)"
else
  note "figma serve did not answer at the URL the plugin is built with"
fi
kill "$servePid" 2>/dev/null || true
wait "$servePid" 2>/dev/null || true

# ---- the consumer's own tree is untouched ----
test -z "$(git -C "$source_repo" status --porcelain)" ||
  { echo "the rehearsal modified the consumer's working tree" >&2; exit 1; }

printf '\n%s findings to settle before T17.\n' "$findings"
test "$findings" -eq 0
