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
set +e
out="$("$cli" ledger validate --ledger nope.json 2>/dev/null)"
code=$?
set -e
test "$code" -eq 2 || { echo "expected exit 2 from an unimplemented command, got $code" >&2; exit 1; }
test -z "$out" || { echo "unimplemented command wrote to stdout: $out" >&2; exit 1; }

# The shipped assets, checked in the INSTALLED package rather than by reading
# the files field — a files entry naming a directory that does not ship still
# looks correct in package.json.
installed="$work/consumer/node_modules/@atomize-hq/ds-skills"
for dir in schemas templates profiles; do
  test -d "$installed/$dir" || { echo "$dir/ did not survive packing" >&2; exit 1; }
done
test -f "$installed/schemas/sync-ledger.schema.json"
test -f "$installed/profiles/example.json"
test -f "$installed/src/validate/artifact.mjs"

# The portable schemas must not carry a consumer's namespace out into the world.
if grep -rq 'collider' "$installed/schemas"; then
  echo "installed schemas name a consumer" >&2; exit 1
fi

echo "pack check ok — installs, imports, builds the plugin, and runs the CLI as a consumer"
