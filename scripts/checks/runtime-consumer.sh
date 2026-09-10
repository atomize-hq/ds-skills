#!/usr/bin/env bash
# Both commands are evaluated by the installed executable, not source imports.
set -euo pipefail
cli="$1"; dir="$2"
cd "$dir"
fails() {
  local wanted="$1"; shift
  local actual=0
  "$@" > .runtime-out 2> .runtime-err || actual=$?
  test "$actual" -eq "$wanted" || { cat .runtime-err >&2; echo "runtime consumer: expected $wanted, got $actual" >&2; exit 1; }
  if test "$wanted" -eq 2; then test ! -s .runtime-out; fi
}
(cd / && "$cli" tokens runtime check --root "$dir" --config project.json --json > "$dir/runtime-check.json")
node -e 'const r=require("./runtime-check.json"); if(!r.ok || r.obligations.length!==3) throw new Error("runtime obligations were not evaluated")'
css="$(node -p 'require("./project.json").tokens.build.outputs.runtimeCss')"
cp "$css" runtime-original.css
node -e 'const fs=require("node:fs"), p=process.argv[1]; fs.writeFileSync(p,fs.readFileSync(p,"utf8").replaceAll("--brand-base:","--removed-base:"))' "$css"
fails 1 "$cli" tokens runtime check --config project.json --json
grep -q RUNTIME_CSS_COMPATIBILITY_MISSING .runtime-out
cp runtime-original.css "$css"
cp global.css global-original.css
printf '/* ' > global.css; cat global-original.css >> global.css; printf ' */\n' >> global.css
fails 1 "$cli" tokens runtime check --config project.json --json
grep -q RUNTIME_CSS_IMPORT_MISSING .runtime-out
cp global-original.css global.css
mv runtime-surface.json runtime-surface-backup.json
fails 2 "$cli" tokens runtime check --config project.json
mv runtime-surface-backup.json runtime-surface.json
fails 2 "$cli" tokens guard --config project.json

git init --quiet
# Prevent ambient signing/hooks from running in this test repository.
git -c core.hooksPath=/dev/null add .
git -c core.hooksPath=/dev/null -c commit.gpgsign=false -c user.name=Fixture -c user.email=fixture@example.invalid commit --quiet -m fixture
(cd / && "$cli" tokens guard --root "$dir" --config project.json --json > "$dir/runtime-guard.json")
node -e 'if(!require("./runtime-guard.json").ok) throw new Error("clean guard failed")'
printf '\n/* edited output */\n' >> "$css"
fails 1 "$cli" tokens guard --config project.json --json
grep -q RUNTIME_CSS_MANUAL_EDIT .runtime-out
# Dirty generator selection retains the old policy; freshness is a separate gate.
printf '\n' >> product-pin.json
"$cli" tokens guard --config project.json --json > guard-pin.json
node -e 'const r=require("./guard-pin.json"); if(!r.ok || !r.state.generatorDirty) throw new Error("pin change not considered")'
cp runtime-original.css "$css"
git checkout -- product-pin.json
"$cli" tokens runtime check --config project.json >/dev/null
"$cli" tokens guard --config project.json >/dev/null
echo '  installed runtime compatibility/import checks and Git guard: positive and negative proof'
