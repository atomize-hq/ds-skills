#!/usr/bin/env bash
# The release product: staged assets, the production bootstrap, and the trust
# chain end to end. Everything here runs against the exact bytes T15 publishes —
# §7.5: exercising a different build from the one distributed proves something
# about neither.
set -euo pipefail

root="$1"; work="$2"; release="$3"
staged="$work/release"

node "$root/scripts/release/stage.mjs" --release "$release" --out "$staged" >/dev/null

# Reproducible by construction, or "the tested bytes" and "the published bytes"
# are two different claims.
node "$root/scripts/release/stage.mjs" --release "$release" --out "$work/again" >/dev/null
for asset in "$staged"/*; do
  cmp -s "$asset" "$work/again/$(basename "$asset")" ||
    { echo "staging is not reproducible: $(basename "$asset") differs between runs" >&2; exit 1; }
done

record="$staged/ds-skills.release.json"
digest() { shasum -a 256 "$1" | cut -d' ' -f1; }
field() { node -e 'const r=require(process.argv[1]);process.stdout.write(String(process.argv[2].split(".").reduce((o,k)=>o[k],r)))' "$record" "$1"; }

serve() { # <dir> <name> -> echoes the port
  local dir="$1" name="$2" portFile="$work/$2.port"
  rm -f "$portFile"
  # Streams detached: a background job holding the command-substitution pipe
  # open would make every `$(serve ...)` wait for the server to exit.
  node "$root/scripts/checks/serve-release.mjs" "$dir" "$portFile" >/dev/null 2>&1 &
  echo $! >> "$work/servers.pids"
  for _ in $(seq 1 100); do [ -s "$portFile" ] && break; sleep 0.05; done
  [ -s "$portFile" ] || { echo "the $name mirror never started" >&2; exit 1; }
  cat "$portFile"
}
# The mirrors outlive this script: the honest one is still serving when the
# lifecycle and consumer checks run. pack-check.sh owns their lifetime, and
# records every pid in one file so nothing is left listening.

# ---- link 1: the reviewed record pins the bootstrap's own digest ----
# A consumer verifies this BEFORE executing it, and it is held unchanged for
# every negative test below — that is what makes it an anchor and not a copy.
test "$(digest "$staged/install.sh")" = "$(field bootstrap.sha256)" ||
  { echo "the record does not describe the bootstrap it was generated with" >&2; exit 1; }
test "$(digest "$staged/install.ps1")" = "$(field bootstrapPowershell.sha256)" ||
  { echo "the record does not describe install.ps1" >&2; exit 1; }

# A modified bootstrap is rejected against the record, before it ever runs.
cp "$staged/install.sh" "$work/evil.sh"
printf '\n# appended\n' >> "$work/evil.sh"
test "$(digest "$work/evil.sh")" != "$(field bootstrap.sha256)" ||
  { echo "an appended byte did not change the bootstrap's digest" >&2; exit 1; }

# ---- links 2 and 3: the bootstrap enforces payload integrity itself ----
# The decisive negative: a modified payload WITH a matching modified SHA256SUMS.
# A merely corrupted archive proves only that the weaker check works, because
# SHA256SUMS ships beside the archive — whoever can replace one replaces both.
cp -R "$staged" "$work/tampered"
node -e '
  const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
  const dir=process.argv[1];
  const lines=[];
  for (const name of fs.readdirSync(dir)) {
    if (!/^ds-skills-.*\.(tar\.gz|zip)$/.test(name)) continue;
    fs.appendFileSync(path.join(dir,name), "tampered");
    const sha=crypto.createHash("sha256").update(fs.readFileSync(path.join(dir,name))).digest("hex");
    lines.push(`${sha}  ${name}`);
  }
  // The checksum list is rewritten to agree with the tampered payload, exactly
  // as an attacker who controls the release would rewrite it.
  fs.writeFileSync(path.join(dir,"SHA256SUMS"), `${lines.join("\n")}\n`);
' "$work/tampered"

prefix="$work/prefix"
set +e
out="$(DS_SKILLS_BASE_URL="http://127.0.0.1:$(serve "$work/tampered" tampered)" \
  DS_SKILLS_PREFIX="$prefix" bash "$staged/install.sh" 2>&1)"
code=$?
set -e
test "$code" -ne 0 ||
  { echo "the installer accepted a modified payload whose SHA256SUMS agreed with it" >&2; exit 1; }
grep -q 'baked into this installer' <<<"$out" ||
  { echo "rejection did not name the baked digest as the authority: $out" >&2; exit 1; }
test ! -e "$prefix/$release" || { echo "a rejected payload still left an install behind" >&2; exit 1; }
# Rejection happened BEFORE untrusted execution: nothing was unpacked at all.
test -z "$(find "$prefix" -name 'ds-skills*' 2>/dev/null)" ||
  { echo "the installer unpacked a payload it went on to reject" >&2; exit 1; }

# ---- missing integrity metadata fails; it does not warn and skip (§10.2) ----
cp -R "$staged" "$work/no-sums"
rm "$work/no-sums/SHA256SUMS"
set +e
out="$(DS_SKILLS_BASE_URL="http://127.0.0.1:$(serve "$work/no-sums" nosums)" \
  DS_SKILLS_PREFIX="$work/prefix-nosums" bash "$staged/install.sh" 2>&1)"
code=$?
set -e
test "$code" -ne 0 || { echo "a release with no SHA256SUMS installed anyway" >&2; exit 1; }
grep -q 'cannot treat missing integrity as a warning' <<<"$out" ||
  { echo "missing SHA256SUMS was not the reported reason: $out" >&2; exit 1; }

# ---- a bootstrap that does not know what it is must not guess (§10.1) ----
set +e
out="$(DS_SKILLS_PREFIX="$work/prefix-template" bash "$root/installers/install.sh" 2>&1)"
code=$?
set -e
test "$code" -ne 0 || { echo "the ungenerated installer template ran" >&2; exit 1; }
grep -q 'template, not a release asset' <<<"$out" ||
  { echo "the template did not say it was a template: $out" >&2; exit 1; }

# ---- the honest install, from the untampered mirror ----
port="$(serve "$staged" good)"
echo "$port" > "$work/port"
DS_SKILLS_BASE_URL="http://127.0.0.1:$port" DS_SKILLS_PREFIX="$prefix" \
  bash "$staged/install.sh" > "$work/install.log"
grep -q "ds-skills $release installed" "$work/install.log" ||
  { echo "the installer did not report success"; cat "$work/install.log" >&2; exit 1; }
test -x "$prefix/$release/bin/ds-skills" ||
  { echo "no executable at $prefix/$release/bin/ds-skills" >&2; exit 1; }

echo "  trust chain: record → bootstrap → baked digests → payload, each link tested"
