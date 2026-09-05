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
pnpm add "$tarball" --silent >/dev/null

cp "$OLDPWD/figma-token-rail.config.example.json" ./config.json
node node_modules/@atomize-hq/figma-token-rail/plugin/build.mjs \
  --config ./config.json --out ./plugin-out >/dev/null

test -f ./plugin-out/manifest.json
test -f ./plugin-out/code.js
test -f ./plugin-out/ui.html
node --input-type=module -e "import('@atomize-hq/figma-token-rail').then(m=>{if(typeof m.syncVariablesViaRest!=='function')throw new Error('API missing from installed package')})"
echo "pack check ok — installs, imports, and builds the plugin as a consumer"
