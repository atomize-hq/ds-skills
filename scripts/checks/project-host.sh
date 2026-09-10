#!/usr/bin/env bash
# Exercise the generated launcher from an installed release, not product source.
set -euo pipefail
cli="$1"; work="$2"; release="$3"; root="$4"
project="$work/launcher project"; prefix="$work/launcher-prefix"
mkdir -p "$project"
cp "$work/release/ds-skills.release.json" "$project/ds-skills.release.json"
export DS_SKILLS_PREFIX="$prefix"
export DS_SKILLS_BASE_URL="http://127.0.0.1:$(cat "$work/good.port")"

fails() {
  local want="$1"; shift
  local code=0
  "$@" > "$work/host-out" 2> "$work/host-err" || code=$?
  test "$code" -eq "$want" || { cat "$work/host-err" >&2; echo "project host expected $want, got $code" >&2; exit 1; }
  if test "$want" -eq 2; then test ! -s "$work/host-out"; fi
}

# Initial provisioning uses the trusted installed product explicitly. A cloned
# project thereafter carries only this generated launcher and reviewed pin.
"$cli" release install --record "$project/ds-skills.release.json" --prefix "$prefix" >/dev/null
"$cli" project setup --root "$project" --prefix "$prefix" --json > "$work/host-setup.json"
node -e 'if(!require(process.argv[1]).ok)throw Error("setup failed")' "$work/host-setup.json"
launcher="$project/.ds-skills/project.mjs"
cmp "$launcher" "$prefix/$release/lib/dist/project-host/launcher.mjs"
node "$launcher" --check > /dev/null
node "$root/scripts/checks/project-discovery.mjs" "$project" "$prefix/$release"

# Fresh clone: no receipt or installation. Ordinary gates cannot auto-install.
clone="$work/launcher fresh clone"
mkdir -p "$clone/.ds-skills"
cp "$launcher" "$clone/.ds-skills/project.mjs"
cp "$project/ds-skills.release.json" "$clone/ds-skills.release.json"
export DS_SKILLS_PREFIX="$work/launcher-cold-prefix"
fails 2 node "$clone/.ds-skills/project.mjs" --version
test ! -e "$DS_SKILLS_PREFIX/$release"
node "$clone/.ds-skills/project.mjs" --install >/dev/null
node "$clone/.ds-skills/project.mjs" --check >/dev/null
test -s "$clone/.ds-skills/installation.json"
test ! -e "$clone/node_modules"

# The bound machine helper runs installed code with the right result identity.
node --input-type=module - "$clone" <<'JS'
import fs from 'node:fs'; import {pathToFileURL} from 'node:url';
const root=process.argv[2];
const m=await import(pathToFileURL(root+'/.ds-skills/project.mjs'));
const r=m.readPinnedResult(['project','check','--root',root], 'project check');
if(!r.evaluated || r.status!==0 || !r.result.ok || r.result.root!==fs.realpathSync(root)) throw Error('bad bound result');
JS

# A tampered target never runs; explicit install repairs it from sealed assets.
target="$DS_SKILLS_PREFIX/$release/lib/bin/ds-skills.mjs"
printf '\nthrow new Error("tampered executable ran");\n' >> "$target"
fails 2 node "$clone/.ds-skills/project.mjs" --version
grep -q 'failed verification' "$work/host-err"
node "$clone/.ds-skills/project.mjs" --install >/dev/null
node "$clone/.ds-skills/project.mjs" --check >/dev/null

# Genuine unrelated content in discovery remains untouched by launcher setup.
mkdir -p "$clone/.agents/skills/user-skill"
printf 'keep\n' > "$clone/.agents/skills/user-skill/SKILL.md"
node "$clone/.ds-skills/project.mjs" --install >/dev/null
test "$(cat "$clone/.agents/skills/user-skill/SKILL.md")" = keep

# An edited owned launcher is never silently replaced, even on explicit setup.
printf '\n// user edit\n' >> "$clone/.ds-skills/project.mjs"
fails 2 "$cli" project setup --root "$clone" --prefix "$DS_SKILLS_PREFIX" --json
grep -q 'unowned or edited' "$work/host-err"

# Real figma serve: output must reach a parent while the child is still serving.
export DS_SKILLS_PREFIX="$prefix"
node "$root/scripts/checks/make-consumer.mjs" "$project" alpha >/dev/null
node "$root/scripts/checks/project-host-stream.mjs" "$launcher" "$project"
echo '  project host: copied bundle, cold acquisition, rooted invocation, sealed repair, ownership refusal, live server output'
