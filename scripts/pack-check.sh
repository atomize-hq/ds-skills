#!/usr/bin/env bash
# The installed-artifact gate.
#
# It tests the RELEASE PRODUCT, not a package tarball: the staged assets, the
# production bootstrap, the trust chain, §10.6's lifecycle, and two differently
# configured data-only consumers running every command from the installed
# prefix. A .tgz in a temp directory is not the artifact anyone installs, so the
# npm path is kept only for the things it alone covers.
#
# Everything runs outside both checkouts, with no product dependencies, no
# credentials and no ambient builder.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release="${DS_SKILLS_CANDIDATE:-v0.0.0-candidate}"
work="$(mktemp -d)"
: > "$work/servers.pids"
cleanup() {
  while read -r pid; do kill "$pid" 2>/dev/null || true; done < "$work/servers.pids"
  rm -rf "$work"
}
trap cleanup EXIT

# Built here, not assumed built. The staging script copies dist/ and the
# prebuilt bundle straight into the asset, so a stale tree would produce a
# release that passes every check below and ships last week's code.
pnpm --dir "$root" build >/dev/null

bash "$root/scripts/checks/release-install.sh" "$root" "$work" "$release"
bash "$root/scripts/checks/release-lifecycle.sh" "$root" "$work" "$release"

bash "$root/scripts/checks/release-matrix.sh" "$root" "$work" "$release"

cli="$work/prefix/$release/bin/ds-skills"
installed="$work/prefix/$release/lib"
test -x "$cli" || { echo "the release did not install an executable" >&2; exit 1; }

# The environment the decisive scenario requires, asserted rather than assumed.
test ! -e "$work/prefix/$release/node_modules" ||
  { echo "the installed release carries a dependency tree" >&2; exit 1; }
test -z "$(find "$work/prefix" -name esbuild -maxdepth 6 2>/dev/null)" ||
  { echo "the installed release carries a bundler" >&2; exit 1; }

# Two consumers, differing in every profiled dimension: namespace, artifact
# path, origin, plugin identity, theme names, collection, and the permitted
# publish modes. Copying one layout under another name proves nothing (§7.3).
for flavour in alpha beta; do
  node "$root/scripts/checks/make-consumer.mjs" "$work/consumer-$flavour" "$flavour" >/dev/null
  bash "$root/scripts/checks/consumer.sh" "$cli" "$work/consumer-$flavour" "consumer $flavour"
done

# The CLI resolved nothing from the development checkout or a consumer's tree:
# every path it opened is inside its own install prefix.
node "$root/scripts/checks/trace-reads.mjs" "$cli" "$work/consumer-alpha" "$work/prefix/$release"

bash "$root/scripts/checks/disclosure.sh" "$installed" "installed release"
bash "$root/scripts/checks/npm-tarball.sh" "$root" "$work"

echo "pack check ok — the release installs, verifies, and runs as two unrelated consumers"
