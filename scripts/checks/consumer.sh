#!/usr/bin/env bash
# The decisive scenario (§7.3): a clean, data-only consumer outside both
# checkouts — no product dependencies, no repository credentials, no ambient
# builder — running the installed release against its own data. Every command,
# valid and invalid inputs.
#
#   consumer.sh <cli> <dir> <label>
set -euo pipefail

cli="$1"; dir="$2"; label="$3"
cd "$dir"

fails() { # <expected-code> <description> <command...>
  local want="$1" what="$2"; shift 2
  set +e
  out="$("$@" 2>"$dir/.err")"; code=$?
  set -e
  test "$code" -eq "$want" ||
    { echo "$label: $what expected exit $want, got $code"; cat "$dir/.err" >&2; exit 1; }
  if [ "$want" -eq 2 ] && [ -n "$out" ]; then
    echo "$label: $what could not evaluate but wrote to stdout: $out" >&2; exit 1
  fi
}

# ---- the executable answers from anywhere, with no consumer repo around ----
"$cli" --version >/dev/null
"$cli" --help >/dev/null
fails 2 "an unknown command" "$cli" wat

# ---- no command in the release is a placeholder ----
# Asserted over the registry rather than one command: the earlier form named a
# single command and kept passing after that command was implemented, because a
# missing required flag also exits 2 with empty stdout.
"$cli" --help | sed -n 's/^  \([a-z][a-z ]*[a-z]\)  .*/\1/p' | while read -r name; do
  set +e
  # shellcheck disable=SC2086
  "$cli" $name >/dev/null 2>"$dir/.err"
  set -e
  if grep -q 'CLI_COMMAND_NOT_IMPLEMENTED' "$dir/.err"; then
    echo "$label: the release ships \`$name\` as a placeholder" >&2; exit 1
  fi
done

# ---- figma plugin build ----
"$cli" figma plugin build --config config.json --out plugin-out >/dev/null
for file in manifest.json code.js ui.html; do
  test -s "plugin-out/$file" || { echo "$label: plugin build produced no $file" >&2; exit 1; }
done
node --check plugin-out/code.js ||
  { echo "$label: the assembled plugin bundle does not parse" >&2; exit 1; }
grep -q "$(node -p 'require("./config.json").collectionName')" plugin-out/code.js ||
  { echo "$label: the consumer's config did not reach the bundle" >&2; exit 1; }
fails 2 "a build with no config" "$cli" figma plugin build --config absent.json --out x

# ---- figma baseline: capture, re-check, and byte stability ----
"$cli" figma baseline --config config.json --artifact artifact.json --out refs \
  --plugin-out plugin-out >/dev/null
"$cli" figma baseline --check --config config.json --artifact artifact.json --out refs \
  --plugin-out plugin-out >/dev/null
before="$(cat refs/token-rail.baseline.json)"
"$cli" figma baseline --config config.json --artifact artifact.json --out refs \
  --plugin-out plugin-out >/dev/null
test "$before" = "$(cat refs/token-rail.baseline.json)" ||
  { echo "$label: re-capturing an unchanged baseline rewrote it" >&2; exit 1; }

# ---- figma verify, both ways ----
"$cli" figma verify --config config.json --expect refs/token-rail.baseline.json \
  --artifact artifact.json >/dev/null
node -e '
  const fs=require("node:fs");
  const b=JSON.parse(fs.readFileSync("refs/token-rail.baseline.json","utf8"));
  b.variables=b.variables.slice(0,1);
  fs.writeFileSync("refs/truncated.json", JSON.stringify(b,null,2));
'
fails 1 "verify against a baseline it does not match" "$cli" figma verify \
  --config config.json --expect refs/truncated.json --artifact artifact.json

# ---- figma drift, all three outcomes ----
"$cli" figma drift --config config.json --artifact artifact.json \
  --observed observed.json >/dev/null
fails 1 "drift against a changed collection" "$cli" figma drift \
  --config config.json --artifact artifact.json --observed observed-drifted.json
fails 2 "drift with no observation" "$cli" figma drift \
  --config config.json --artifact artifact.json
grep -q 'plugin session' "$dir/.err" ||
  { echo "$label: drift did not say where observed state comes from" >&2; exit 1; }

# ---- figma serve, actually served and actually stopped ----
"$cli" figma serve --config config.json --artifact artifact.json --port 0 \
  >/dev/null 2>serve.log &
servePid=$!
for _ in $(seq 1 100); do grep -q RAIL_SERVE_READY serve.log && break; sleep 0.05; done
url="$(sed -n 's/^\[RAIL_SERVE_READY\] \(http[^ ]*\)$/\1/p' serve.log | head -n1)"
test -n "$url" || { echo "$label: serve never reported a URL"; cat serve.log >&2; exit 1; }
test "$(curl -s -o /dev/null -w '%{http_code}' "$url")" = "200" ||
  { echo "$label: serve did not serve the artifact at $url" >&2; exit 1; }
test "$(curl -s -o /dev/null -w '%{http_code}' "${url%/*}/other.json")" = "404" ||
  { echo "$label: serve handed out a file it was not asked to serve" >&2; exit 1; }
kill "$servePid"
wait "$servePid" 2>/dev/null || true
# Without -w: curl prints 000 on a refused connection, so a `-w` form would
# capture "000dead" and never equal "dead".
test "$(curl -s -o /dev/null --max-time 2 "$url" && echo alive || echo dead)" = "dead" ||
  { echo "$label: serve kept listening after it was stopped" >&2; exit 1; }

# ---- the record commands, and the 0/1/2 contract ----
out="$("$cli" ledger validate --ledger sync-ledger.json --profile profile.json --json)"
node -e '
  const r=JSON.parse(process.argv[1]);
  if (r.resultVersion !== "1") throw new Error("resultVersion is not 1");
  if (r.ok !== true) throw new Error(`expected a conformant result: ${JSON.stringify(r.diagnostics)}`);
  if (Object.keys(r.evidence).length !== 9) throw new Error("evidence is not the nine keys");
' "$out"
"$cli" ledger parity --ledger sync-ledger.json --profile profile.json >/dev/null
"$cli" proof validate --proof publish-proof.json --profile profile.json >/dev/null

fails 1 "a ledger whose bound proof was edited" "$cli" ledger validate \
  --ledger broken/sync-ledger.json --profile profile.json
grep -q 'DIGEST_MISMATCH' "$dir/.err" ||
  { echo "$label: an edited proof was not reported as a digest mismatch"; cat "$dir/.err" >&2; exit 1; }
fails 2 "a ledger that is not there" "$cli" ledger validate \
  --ledger absent.json --profile profile.json
fails 2 "a ledger with no profile" "$cli" ledger validate --ledger sync-ledger.json
fails 2 "--json where it is not supported" "$cli" figma verify --json \
  --config config.json --expect refs/token-rail.baseline.json --artifact artifact.json

# ---- validate, against a schema the release ships ----
"$cli" validate sync-ledger sync-ledger.json --profile profile.json >/dev/null
fails 1 "validate against a schema the instance does not satisfy" \
  "$cli" validate sync-ledger config.json --profile profile.json

# ---- skills: discovery, and the release they came from ----
"$cli" skills >/dev/null
test -d "$("$cli" skills | sed -n 's/.*skills: //p' | head -n1)" ||
  { echo "$label: skills reported a directory that does not exist" >&2; exit 1; }
# §10.6: the CLI and its materialized skills share one release identity. In a
# release asset they are stamped from one object, so disagreement here means the
# asset was assembled from two builds.
identity="$("$cli" skills | sed -n 's/.*RAIL_SKILL_RELEASE\] //p')"
test "$(cut -d' ' -f1 <<<"$identity" | cut -d= -f2)" = \
     "$(cut -d' ' -f2 <<<"$identity" | cut -d= -f2)" ||
  { echo "$label: the CLI and its skills came from different releases: $identity" >&2; exit 1; }
grep -q "cli=$(basename "$(dirname "$(dirname "$cli")")")" <<<"$identity" ||
  { echo "$label: the install reports a release other than the directory it is in: $identity" >&2; exit 1; }

echo "  $label: every command exercised with valid and invalid inputs"
