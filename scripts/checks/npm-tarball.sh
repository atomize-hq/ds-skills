#!/usr/bin/env bash
# The npm tarball path. Superseded as the delivery contract by the release
# installer, and kept for the two things only it covers: that `files` actually
# ships what it claims, and that the package still works when consumed as a
# dependency rather than as an install prefix.
#
# It no longer installs esbuild. That is the point: SPEC.md §7.3 — `pnpm add
# "$tarball" esbuild` proved the plugin builds when a consumer ALREADY has a
# bundler, and never that a plain install can.
set -euo pipefail
root="$1"; work="$2"

pnpm --dir "$root" pack --pack-destination "$work" >/dev/null
tarball="$(ls "$work"/*.tgz)"

consumer="$work/npm-consumer"
mkdir -p "$consumer"
cd "$consumer"
echo '{"name":"consumer","private":true,"type":"module"}' > package.json
pnpm add "$tarball" --silent >/dev/null

installed="$consumer/node_modules/@atomize-hq/ds-skills"
# No bundler anywhere in the dependency tree, and none needed.
if [ -e "$consumer/node_modules/esbuild" ] || [ -e "$installed/node_modules/esbuild" ]; then
  echo "the package still drags a bundler in behind it" >&2; exit 1
fi

cp "$root/ds-skills.config.example.json" ./config.json
node "$installed/plugin/build.mjs" --config ./config.json --out ./plugin-out >/dev/null
test -s ./plugin-out/code.js

# Two entry points, one builder: `plugin/build.mjs` above and the CLI here. A
# manifest that differs between them means one has its own copy of the logic.
"$installed/bin/ds-skills.mjs" figma plugin build --config ./config.json --out ./plugin-cli >/dev/null
for file in manifest.json ui.html code.js; do
  cmp "./plugin-out/$file" "./plugin-cli/$file" ||
    { echo "the CLI and plugin/build.mjs produced different $file" >&2; exit 1; }
done

node --input-type=module -e "import('@atomize-hq/ds-skills').then(m=>{if(typeof m.flattenTokenDocument!=='function'||typeof m.buildExpectedVariables!=='function')throw new Error('API missing from installed package')})"

# Checked in the INSTALLED package rather than by reading `files`: an entry
# naming a directory that does not ship still looks correct in package.json.
for dir in skills schemas templates profiles dist/plugin-bundle; do
  test -d "$installed/$dir" || { echo "$dir/ did not survive packing" >&2; exit 1; }
done
for file in schemas/sync-ledger.schema.json profiles/example.json \
            src/validate/artifact.mjs release.json skills/RELEASE.json \
            dist/plugin-bundle/code.js; do
  test -f "$installed/$file" || { echo "$file did not survive packing" >&2; exit 1; }
done

bash "$root/scripts/checks/disclosure.sh" "$installed" "npm tarball"
echo "  npm tarball: files complete, one builder, no bundler pulled in"
