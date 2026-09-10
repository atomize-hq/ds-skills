#!/usr/bin/env bash
# Installed execution of the fixed full pipeline, with real negative inputs.
set -euo pipefail
cli="$1"; dir="$2"
cd "$dir"
fails() {
  local wanted="$1"; shift
  local actual=0
  "$@" > .governance-out 2> .governance-err || actual=$?
  test "$actual" -eq "$wanted" || { cat .governance-err >&2; cat .governance-out >&2; echo "governance consumer: expected $wanted, got $actual" >&2; exit 1; }
  if test "$wanted" -eq 2; then test ! -s .governance-out; fi
}
(cd / && "$cli" tokens govern --root "$dir" --config project.json --json > "$dir/governance-result.json")
node -e 'const r=require("./governance-result.json"); if(!r.ok || r.steps.length!==9 || !r.capabilities.publication || r.steps.at(-1).id!=="proof validate") throw new Error("full installed governance was not evaluated")'
cp governance-baseline.json governance-baseline-original.json
node -e 'const fs=require("node:fs"), p="governance-baseline.json", r=JSON.parse(fs.readFileSync(p)); r.variables[0].valuesByTheme[Object.keys(r.variables[0].valuesByTheme)[0]].r=0; fs.writeFileSync(p,JSON.stringify(r))'
fails 1 "$cli" tokens govern --config project.json --json
node -e 'const fs=require("node:fs"), r=JSON.parse(fs.readFileSync(".governance-out")); if(r.failedStep!=="figma verify") throw new Error("baseline drift failed the wrong gate")'
cmp -s governance-baseline.json governance-baseline-original.json && { echo 'governance repaired a reviewed baseline' >&2; exit 1; }
cp governance-baseline-original.json governance-baseline.json
cp publish-proof.json governance-proof-original.json
printf '\n' >> publish-proof.json
fails 1 "$cli" tokens govern --config project.json --json
node -e 'const fs=require("node:fs"), r=JSON.parse(fs.readFileSync(".governance-out")); if(r.failedStep!=="ledger validate" || !r.steps.at(-1).result.diagnostics.some(d=>d.code.includes("DIGEST_MISMATCH"))) throw new Error("proof digest drift failed the wrong gate")'
cp governance-proof-original.json publish-proof.json
mv governance-baseline.json governance-baseline-moved.json
fails 2 "$cli" tokens govern --config project.json --json
mv governance-baseline-moved.json governance-baseline.json
"$cli" tokens govern --config project.json --json > governance-final.json
node -e 'if(!require("./governance-final.json").ok) throw new Error("restored consumer did not govern")'
echo '  installed governance: all nine steps, baseline/proof rejection and no false partial result'
