#!/usr/bin/env bash
# Install the packed tarball into a throwaway project and build the plugin from
# it — the path a real consumer takes. Catches files/ omissions and dependencies
# that were only ever satisfied by the development repo's own node_modules.
set -euo pipefail
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

pnpm pack --pack-destination "$work" >/dev/null
tarball="$(ls "$work"/*.tgz)"

mkdir -p "$work/consumer"
cd "$work/consumer"
echo '{"name":"consumer","private":true,"type":"module"}' > package.json
pnpm add "$tarball" esbuild --silent >/dev/null

cp "$OLDPWD/ds-skills.config.example.json" ./config.json
node node_modules/@atomize-hq/ds-skills/plugin/build.mjs \
  --config ./config.json --out ./plugin-out >/dev/null

test -f ./plugin-out/manifest.json
test -f ./plugin-out/code.js
test -f ./plugin-out/ui.html
node --input-type=module -e "import('@atomize-hq/ds-skills').then(m=>{if(typeof m.flattenTokenDocument!=='function'||typeof m.buildExpectedVariables!=='function')throw new Error('API missing from installed package')})"

# The executable, exercised as a consumer reaches it. `--help` and `--version`
# must answer from outside any consumer repository, so run them from a directory
# with no config, no ledger and no repository root.
cli="$work/consumer/node_modules/.bin/ds-skills"
test -x "$cli"
mkdir -p "$work/elsewhere"
( cd "$work/elsewhere" && "$cli" --version >/dev/null )
( cd "$work/elsewhere" && "$cli" --help >/dev/null )

# No placeholder commands. This assertion has been wrong twice: it ran
# `ledger validate`, then `figma verify`, and each time the command it named got
# implemented and the check stayed green for a different reason — a missing
# required flag also exits 2 with an empty stdout. So it now asserts the
# invariant instead of one command: every command refuses to run without its
# arguments, and none of them reports itself as unimplemented.
while read -r name; do
  set +e
  out="$("$cli" $name 2>/tmp/ds-skills-cmd.err)"
  code=$?
  set -e
  test "$code" -ne 0 || { echo "\`$name\` with no arguments exited 0" >&2; exit 1; }
  test -z "$out" || { echo "\`$name\` wrote to stdout with no arguments: $out" >&2; exit 1; }
  if grep -q 'CLI_COMMAND_NOT_IMPLEMENTED' /tmp/ds-skills-cmd.err; then
    echo "the release ships \`$name\` as a placeholder" >&2; exit 1
  fi
done <<'COMMANDS'
figma plugin build
figma verify
figma drift
figma serve
figma baseline
ledger validate
ledger parity
proof validate
COMMANDS

# The shipped assets, checked in the INSTALLED package rather than by reading
# the files field — a files entry naming a directory that does not ship still
# looks correct in package.json.
installed="$work/consumer/node_modules/@atomize-hq/ds-skills"
for dir in skills schemas templates profiles; do
  test -d "$installed/$dir" || { echo "$dir/ did not survive packing" >&2; exit 1; }
done
test -f "$installed/schemas/sync-ledger.schema.json"
test -f "$installed/profiles/example.json"
test -f "$installed/src/validate/artifact.mjs"

# The rail commands, run from the installed package against records it ships.
# Implemented is not the same claim as installed-and-working: a module that
# resolves in the development tree can be absent from the tarball.
ledgers="$installed/src/figma/__fixtures__/sync-ledger"
profile="$installed/src/figma/__fixtures__/profiles/consumer-a.json"
test -f "$profile" || { echo "the fixture profile did not survive packing" >&2; exit 1; }

# The figma commands, run from the installed package against files it ships.
artifact="$installed/src/__fixtures__/artifact.json"
test -f "$artifact" || { echo "the artifact fixture did not survive packing" >&2; exit 1; }

# Two entry points, one builder. `plugin/build.mjs` ran above; the CLI runs the
# same code, so a manifest that differs between them means one of them has its
# own copy of the substitution logic.
"$cli" figma plugin build --config ./config.json --out ./plugin-cli >/dev/null
cmp ./plugin-out/manifest.json ./plugin-cli/manifest.json || {
  echo "the CLI and plugin/build.mjs produced different manifests" >&2; exit 1; }
cmp ./plugin-out/ui.html ./plugin-cli/ui.html || {
  echo "the CLI and plugin/build.mjs produced different ui.html" >&2; exit 1; }

# Capture, re-check, and verify — the loop a consumer actually runs.
"$cli" figma baseline --config ./config.json --artifact "$artifact" --out ./refs >/dev/null
test -f ./refs/plugin-manifest.baseline.json
test -f ./refs/token-rail.baseline.json
"$cli" figma baseline --check --config ./config.json --artifact "$artifact" --out ./refs >/dev/null

# An unchanged reference is left alone byte for byte, so a consumer's formatter
# and a re-capture never fight over it.
before="$(cat ./refs/token-rail.baseline.json)"
"$cli" figma baseline --config ./config.json --artifact "$artifact" --out ./refs >/dev/null
test "$before" = "$(cat ./refs/token-rail.baseline.json)" || {
  echo "re-capturing an unchanged baseline rewrote it" >&2; exit 1; }

"$cli" figma verify --config ./config.json --expect ./refs/token-rail.baseline.json \
  --artifact "$artifact" >/dev/null

# Verification must fail against data it does not describe, or a green run means
# nothing. A one-variable baseline cannot match a twelve-variable artifact.
node -e '
  const fs = require("node:fs");
  const b = JSON.parse(fs.readFileSync("./refs/token-rail.baseline.json", "utf8"));
  b.variables = b.variables.slice(0, 1);
  fs.writeFileSync("./refs/truncated.json", JSON.stringify(b, null, 2));
'
set +e
"$cli" figma verify --config ./config.json --expect ./refs/truncated.json --artifact "$artifact" >/dev/null 2>&1
code=$?
set -e
test "$code" -eq 1 || { echo "figma verify passed against a baseline it does not match (exit $code)" >&2; exit 1; }

# `figma drift` never reads Figma itself, and says so rather than pretending it
# could. Without --observed it cannot evaluate, and prints nothing on stdout.
set +e
out="$("$cli" figma drift --config ./config.json --artifact "$artifact" 2>/tmp/ds-skills-drift.err)"
code=$?
set -e
test "$code" -eq 2 || { echo "expected exit 2 from figma drift with no observation, got $code" >&2; exit 1; }
test -z "$out" || { echo "figma drift wrote to stdout with no observation" >&2; exit 1; }
grep -q 'plugin session' /tmp/ds-skills-drift.err || {
  echo "figma drift did not say where observed state comes from" >&2; exit 1; }

# 0 — evaluated and conformant, with a parseable result on stdout.
out="$("$cli" ledger validate --ledger "$ledgers/valid.sync-ledger.json" --profile "$profile" --json)"
node -e '
  const r = JSON.parse(process.argv[1]);
  if (r.resultVersion !== "1") throw new Error("resultVersion is not 1");
  if (r.ok !== true) throw new Error("expected a conformant result");
  if (Object.keys(r.evidence).length !== 9) throw new Error("evidence is not the nine keys");
  if (r.rail.sourceVersionOrRevision.indexOf("ledgerVersion:3") !== 0) throw new Error("rail projection missing");
' "$out"

"$cli" ledger parity --ledger "$ledgers/valid-required.sync-ledger.json" --profile "$profile" >/dev/null
"$cli" proof validate --proof "$installed/src/figma/__fixtures__/publish-proof/valid-plugin-import-manual.publish-proof.json" --profile "$profile" >/dev/null

# 1 — evaluated and NOT conformant. The result must still be on stdout: that
# payload is the reason --json exists, and a caller that discards stdout on a
# non-zero exit throws away the diagnosis.
set +e
out="$("$cli" ledger validate --ledger "$ledgers/invalid-deferred-complete.sync-ledger.json" --profile "$profile" --json 2>/dev/null)"
code=$?
set -e
test "$code" -eq 1 || { echo "expected exit 1 for a nonconformant ledger, got $code" >&2; exit 1; }
node -e '
  const r = JSON.parse(process.argv[1]);
  if (r.ok !== false) throw new Error("expected ok:false");
  if (r.diagnostics.length === 0) throw new Error("a nonconformant result carried no diagnostics");
  if (r.diagnostics.some((d) => d.code.includes("["))) throw new Error("diagnostic codes carry human punctuation");
' "$out"

# 2 — could not evaluate. Nothing on stdout at all, so the absence of an answer
# can never be parsed as an empty one.
set +e
out="$("$cli" ledger validate --ledger "$ledgers/absent.json" --profile "$profile" --json 2>/dev/null)"
code=$?
set -e
test "$code" -eq 2 || { echo "expected exit 2 for a missing ledger, got $code" >&2; exit 1; }
test -z "$out" || { echo "could-not-evaluate wrote to stdout: $out" >&2; exit 1; }

# Nothing shipped may carry a consumer's namespace out into the world. This
# covers src/ as well as the data directories, because the fixtures under
# src/figma/__fixtures__ shipped a real Figma file key until T12.
# boundary.test.ts is excluded for the one reason a file may name a consumer:
# it is the test that forbids it, and it has to say the word to look for it.
# The Figma-key check below has no such exemption — a test may name a repo, but
# nothing may embed a real file key.
for dir in schemas skills templates profiles src; do
  named="$(grep -rli 'collider' "$installed/$dir" | grep -v '/boundary\.test\.ts$' || true)"
  if [ -n "$named" ]; then
    echo "installed $dir/ names a consumer: $named" >&2; exit 1
  fi
done
if grep -rqE 'figma://file/[A-Za-z0-9]{18,}' "$installed"; then
  echo "installed package embeds a real Figma file key" >&2; exit 1
fi

# The two ai-elements skills stay with the consumer: a design-system tooling
# package has no business shipping a third-party component library's docs, and a
# moved skill that still points at them drags the coupling along behind it.
if grep -rqiE 'ai-elements|ai_elements|\bplate\b' "$installed/skills"; then
  echo "installed skills reference ai-elements or plate" >&2; exit 1
fi
test ! -e "$installed/skills/ai-elements"
test ! -e "$installed/skills/ai-elements-plate-builder"

# Skills sit one level deeper here than under .agents/skills/, so a relative
# asset path that was right in the consumer is silently wrong in the package.
if grep -rqE '\]\(\.\./(schemas|templates)/' "$installed/skills" || \
   grep -rqE '`\.\./(schemas|templates)' "$installed/skills"; then
  echo "installed skills use consumer-relative asset paths" >&2; exit 1
fi

echo "pack check ok — installs, imports, builds the plugin, and runs the CLI as a consumer"
