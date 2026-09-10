#!/usr/bin/env bash
# The decisive scenario (§7.3): a clean, data-only consumer outside both
# checkouts — no product dependencies, no repository credentials, no ambient
# builder — running the installed release against its own data. Configured command
# contracts use valid and invalid inputs; the enclosing pack gate also exercises
# release acquisition and project setup/check.
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
# Explicit project root must work from outside that project; equal relative
# strings are not sufficient when the caller and consumer are different roots.
(cd / && "$cli" figma verify --root "$dir" --config config.json --expect refs/token-rail.baseline.json --artifact artifact.json >/dev/null)
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
# A correction is only real if it is in the bytes that ship. The ledger agrees
# with itself whatever the proof says, so the rail block — the one a status
# caller is contracted to read ALONE — must not answer `satisfied` for a binding
# that does not hold. This consumer's ledger is required/E-promotion-complete,
# so it is a ledger that WOULD report satisfied; asserting it against a deferred
# one would pass with or without the fix.
fails 1 "a broken binding asked for its rail projection" "$cli" ledger validate \
  --ledger broken/sync-ledger.json --profile profile.json --json
node -e '
  const r = JSON.parse(process.argv[1]);
  if (r.ok !== false) throw new Error("a broken binding reported ok");
  if (r.rail.outcome !== "unsatisfied")
    throw new Error(`the rail block reports ${r.rail.outcome} for an unverified publication`);
  if (!r.rail.reasonCodes.includes("ct8b-publication-unverified"))
    throw new Error(`rail reasonCodes did not name it: ${JSON.stringify(r.rail.reasonCodes)}`);
  if (r.promotable !== false) throw new Error("a broken binding reported promotable");
' "$out"

# The sibling command makes the same affirmative claim from one record. This
# consumer's parity is `required`, so it affirms E-promotion-complete — the rung
# the binding's sufficiency check rests on the bound publication.
fails 1 "required parity over an unverified publication" "$cli" ledger parity \
  --ledger broken/sync-ledger.json --profile profile.json
grep -q 'DIGEST_MISMATCH' "$dir/.err" ||
  { echo "$label: parity did not report the unverified publication"; cat "$dir/.err" >&2; exit 1; }

fails 2 "a ledger that is not there" "$cli" ledger validate \
  --ledger absent.json --profile profile.json
fails 2 "a ledger with no profile" "$cli" ledger validate --ledger sync-ledger.json
fails 2 "--json where it is not supported" "$cli" figma verify --json \
  --config config.json --expect refs/token-rail.baseline.json --artifact artifact.json

# ---- validate, against a schema the release ships ----
"$cli" validate sync-ledger sync-ledger.json --profile profile.json >/dev/null
fails 1 "validate against a schema the instance does not satisfy" \
  "$cli" validate sync-ledger config.json --profile profile.json

# ---- portable recipe source validation, independent of publication status ----
recipes="$(node -p 'require("./recipe-test-input.json").recipes')"
"$cli" recipes validate --recipes "$recipes" --tokens artifact.json --json > recipe-result.json
node -e '
  const r=require("./recipe-result.json"), expected=require("./recipe-test-input.json");
  if(!r.ok || r.components.length!==1 || r.components[0].componentId!==expected.componentId)
    throw new Error("installed recipe validation did not evaluate the configured source");
'
node -e '
  const fs=require("node:fs"), input=require("./recipe-test-input.json");
  const recipe=JSON.parse(fs.readFileSync(`${input.recipes}/${input.componentId}.recipe.json`, "utf8"));
  recipe.slots[Object.keys(recipe.slots)[0]].color="{brand.missing}";
  fs.mkdirSync("invalid-recipes");
  fs.writeFileSync(`invalid-recipes/${input.componentId}.recipe.json`,JSON.stringify(recipe));
'
fails 1 "recipe with an unknown token" "$cli" recipes validate --recipes invalid-recipes --tokens artifact.json
grep -q 'token-inventory' "$dir/.err" ||
  { echo "$label: invalid recipe did not reach token existence validation" >&2; exit 1; }
fails 2 "missing recipe source directory" "$cli" recipes validate --recipes absent --tokens artifact.json

# ---- canonical token validation, not just a prebuilt artifact inventory ----
(cd / && "$cli" tokens validate --root "$dir" --config project.json --json > "$dir/token-result.json")
node -e '
  const r=require("./token-result.json");
  if(!r.ok || r.themes.length!==2 || r.themes.some(t=>t.tokenCount!==4 || t.recipeCount!==1))
    throw new Error("installed token validation did not evaluate both configured themes");
'
source_file="$(node -p 'require("./project.json").tokens.sourceDir + "/brand.tokens.json"')"
cp "$source_file" "$dir/source-backup.json"
node -e '
  const fs=require("node:fs"), file=process.argv[1];
  const data=JSON.parse(fs.readFileSync(file,"utf8"));data.base.$value="{brand.missing}";
  fs.writeFileSync(file,JSON.stringify(data));
' "$source_file"
fails 1 "canonical token reference is missing" "$cli" tokens validate --config project.json
grep -q 'TOKEN_REFERENCE' "$dir/.err" ||
  { echo "$label: canonical source failure did not reach reference validation" >&2; exit 1; }
cp "$dir/source-backup.json" "$source_file"
fails 2 "token project configuration is absent" "$cli" tokens validate --config absent.json

# ---- complete installed compiler, no dependencies or ambient config ----
(cd / && "$cli" tokens artifacts check --root "$dir" --config project.json --json > "$dir/artifact-result.json")
node -e '
 const r=require("./artifact-result.json");
 if(!r.ok || r.artifacts.length!==4 || r.artifacts.some(a=>a.state!=="current")) throw new Error("installed compiler differs from authored artifact bytes");
'
css_file="$(node -p 'require("./project.json").tokens.build.outputs.runtimeCss')"
cp "$css_file" "$dir/css-backup.txt"
printf '\n/* manual edit */\n' >> "$css_file"
fails 1 "runtime output drift" "$cli" tokens artifacts check --config project.json
grep -q 'GENERATED_ARTIFACT_STALE' "$dir/.err" || { echo "$label: drift not detected" >&2; exit 1; }
grep -q 'manual edit' "$css_file" || { echo "$label: check repaired output" >&2; exit 1; }
(cd / && "$cli" tokens build --root "$dir" --config project.json --json > "$dir/build-result.json")
cmp "$dir/css-backup.txt" "$css_file" || { echo "$label: installed build did not reproduce runtime bytes" >&2; exit 1; }
node -e '
 const r=require("./build-result.json");
 if(!r.ok || r.artifacts.find(a=>a.id==="runtimeCss").status!=="written") throw new Error("build did not report regenerated runtime output");
'
"$cli" tokens build --config project.json --json > build-again.json
node -e 'if(!require("./build-again.json").artifacts.every(a=>a.status==="unchanged")) throw new Error("repeat build rewrote unchanged output")'
node -e '
 const fs=require("node:fs"), data=require("./project.json");
 data.tokens.build.outputs.figma="bad-write-project.json";fs.writeFileSync("bad-write-project.json",JSON.stringify(data));
'
cp bad-write-project.json bad-write-project-backup.json
fails 2 "build output overlaps config input" "$cli" tokens build --config bad-write-project.json
cmp bad-write-project.json bad-write-project-backup.json || { echo "$label: build changed protected config" >&2; exit 1; }
fails 2 "artifact check cannot evaluate absent config" "$cli" tokens artifacts check --config missing.json

bash "$(dirname "${BASH_SOURCE[0]}")/runtime-consumer.sh" "$cli" "$dir"
bash "$(dirname "${BASH_SOURCE[0]}")/governance-consumer.sh" "$cli" "$dir"

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

echo "  $label: configured command contracts exercised with valid and invalid inputs"
