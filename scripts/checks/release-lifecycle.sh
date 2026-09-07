#!/usr/bin/env bash
# §10.6's lifecycle behaviours, and the failure modes T14 names: an install that
# fails without damaging the existing one, paths with spaces, platform
# selection, and the runtime prerequisite.
set -euo pipefail

root="$1"; work="$2"; release="$3"
staged="$work/release"
base="http://127.0.0.1:$(cat "$work/port")"
export DS_SKILLS_BASE_URL="$base"
install() { DS_SKILLS_PREFIX="$1" bash "${2:-$staged/install.sh}"; }

# ---- idempotent reinstall ----
prefix="$work/prefix"
before="$(shasum -a 256 "$prefix/$release/lib/release.json" | cut -d' ' -f1)"
install "$prefix" >/dev/null
test "$(shasum -a 256 "$prefix/$release/lib/release.json" | cut -d' ' -f1)" = "$before" ||
  { echo "reinstalling changed the install" >&2; exit 1; }
"$prefix/$release/bin/ds-skills" --help >/dev/null ||
  { echo "the executable stopped working after a reinstall" >&2; exit 1; }

# ---- a failed install does not damage the existing one ----
# The mirror is gone, so the download fails after the install already exists.
canary="$prefix/$release/lib/canary.txt"
echo "still here" > "$canary"
set +e
DS_SKILLS_BASE_URL="http://127.0.0.1:1" install "$prefix" >/dev/null 2>&1
code=$?
set -e
test "$code" -ne 0 || { echo "an install with no reachable mirror reported success" >&2; exit 1; }
test -f "$canary" || { echo "a failed install destroyed the existing one" >&2; exit 1; }
"$prefix/$release/bin/ds-skills" --help >/dev/null ||
  { echo "the existing install stopped working after a failed one" >&2; exit 1; }
rm "$canary"

# ---- paths containing spaces ----
spaced="$work/a prefix with spaces"
install "$spaced" >/dev/null
"$spaced/$release/bin/ds-skills" --help >/dev/null ||
  { echo "the launcher does not survive a path with spaces" >&2; exit 1; }
( cd "$work" && "$spaced/$release/bin/ds-skills" --version >/dev/null ) ||
  { echo "the launcher does not work from an unrelated working directory" >&2; exit 1; }

# ---- concurrent versions coexist; there is no global current pointer ----
other="v0.4.1"
node "$root/scripts/release/stage.mjs" --release "$other" --out "$work/release-$other" >/dev/null
otherPortFile="$work/other.port"
node "$root/scripts/checks/serve-release.mjs" "$work/release-$other" "$otherPortFile" >/dev/null 2>&1 &
echo $! >> "$work/servers.pids"
for _ in $(seq 1 100); do [ -s "$otherPortFile" ] && break; sleep 0.05; done
otherBase="http://127.0.0.1:$(cat "$otherPortFile")"

# There is no --version flag: the asset IS the version (§10.1). So this release's
# bootstrap cannot be talked into installing another one, even pointed at a
# mirror that serves only the other. Found by writing the test the wrong way.
set +e
out="$(DS_SKILLS_BASE_URL="$otherBase" DS_SKILLS_PREFIX="$work/p-crossed" \
  bash "$staged/install.sh" 2>&1)"
code=$?
set -e
test "$code" -ne 0 ||
  { echo "the $release bootstrap installed something else" >&2; exit 1; }
grep -q "ds-skills-$release-" <<<"$out" ||
  { echo "the $release bootstrap asked for an asset that was not its own: $out" >&2; exit 1; }

# Installing another version means running that version's bootstrap.
DS_SKILLS_BASE_URL="$otherBase" install "$prefix" "$work/release-$other/install.sh" >/dev/null
for version in "$release" "$other"; do
  test -x "$prefix/$version/bin/ds-skills" ||
    { echo "$version did not survive installing the other" >&2; exit 1; }
  node -e '
    const r=require(`${process.argv[1]}/lib/release.json`);
    if (r.release !== process.argv[2]) { console.error(`${process.argv[1]} says ${r.release}`); process.exit(1); }
  ' "$prefix/$version" "$version"
done
# No pointer anywhere that one project's install could redirect another's.
test ! -e "$prefix/current" || { echo "a global current pointer exists" >&2; exit 1; }
test -z "$(find "$prefix" -maxdepth 1 -type l 2>/dev/null)" ||
  { echo "a symlink in the prefix root can override a project's selection" >&2; exit 1; }

# ---- uninstall removes only the selected install ----
rm -rf "${prefix:?}/$other"
test -x "$prefix/$release/bin/ds-skills" ||
  { echo "removing one version broke the other" >&2; exit 1; }

# ---- platform selection, and the runtime prerequisite ----
# A fake uname/node earlier on PATH, so the refusal paths are exercised rather
# than reasoned about.
shim="$work/shim"; mkdir -p "$shim"
printf '#!/bin/sh\ncase "$1" in -m) echo mips64 ;; *) echo Linux ;; esac\n' > "$shim/uname"
chmod +x "$shim/uname"
set +e
out="$(PATH="$shim:$PATH" DS_SKILLS_PREFIX="$work/p-arch" bash "$staged/install.sh" 2>&1)"
code=$?
set -e
test "$code" -ne 0 || { echo "an unsupported architecture installed anyway" >&2; exit 1; }
grep -q 'unsupported architecture: mips64' <<<"$out" ||
  { echo "the refusal did not name the architecture: $out" >&2; exit 1; }
grep -q 'linux_x86_64' <<<"$out" ||
  { echo "the refusal did not list the supported platforms: $out" >&2; exit 1; }

printf '#!/bin/sh\necho FreeBSD\n' > "$shim/uname"; chmod +x "$shim/uname"
set +e
out="$(PATH="$shim:$PATH" DS_SKILLS_PREFIX="$work/p-os" bash "$staged/install.sh" 2>&1)"
code=$?
set -e
test "$code" -ne 0 || { echo "an unsupported OS installed anyway" >&2; exit 1; }
grep -q 'unsupported operating system: FreeBSD' <<<"$out" ||
  { echo "the refusal did not name the OS: $out" >&2; exit 1; }

rm "$shim/uname"
printf '#!/bin/sh\nif [ "$1" = "-p" ]; then echo 18; else echo v18.0.0; fi\n' > "$shim/node"
chmod +x "$shim/node"
set +e
out="$(PATH="$shim:$PATH" DS_SKILLS_PREFIX="$work/p-node" bash "$staged/install.sh" 2>&1)"
code=$?
set -e
test "$code" -ne 0 || { echo "an unsupported Node installed anyway" >&2; exit 1; }
grep -qE 'node >= 22 is required' <<<"$out" ||
  { echo "the refusal did not state the Node minimum: $out" >&2; exit 1; }

echo "  lifecycle: reinstall, damage-free failure, spaces, coexistence, selection, runtime"
