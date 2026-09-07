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

# An unimplemented command must exit non-zero and print nothing on stdout: a
# caller parsing stdout must not be able to read the silence as an empty result.
# `figma verify` is T13's, so it is still the honest subject here — `ledger
# validate` now exits 2 for a *different* reason (missing --profile), which
# would have kept this assertion green while testing nothing it claims to.
set +e
out="$("$cli" figma verify --config nope.json 2>/dev/null)"
code=$?
set -e
test "$code" -eq 2 || { echo "expected exit 2 from an unimplemented command, got $code" >&2; exit 1; }
test -z "$out" || { echo "unimplemented command wrote to stdout: $out" >&2; exit 1; }

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
