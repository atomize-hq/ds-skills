#!/usr/bin/env bash
# Nothing shipped may carry a consumer's identity out into a public repository.
#
# Separate from the boundary check on purpose: that one reads MODULES, on the
# reasoning that a fixture naming a consumer is sample data. True for coupling,
# false for disclosure — the fixtures carried a real Figma file key and a real
# repository name until T12 found them here.
set -euo pipefail
tree="$1"; label="$2"

for dir in schemas skills templates profiles src; do
  test -d "$tree/$dir" || continue
  # boundary.test.ts is the one file that may say the word: it is the test that
  # forbids it, and it has to name what it looks for.
  named="$(grep -rli 'collider' "$tree/$dir" | grep -v '/boundary\.test\.ts$' || true)"
  if [ -n "$named" ]; then
    echo "$label: $dir/ names a consumer: $named" >&2; exit 1
  fi
done

# No exemption here. A test may name a repository; nothing may embed a real key.
if grep -rqE 'figma://file/[A-Za-z0-9]{18,}' "$tree"; then
  echo "$label: embeds a real Figma file key" >&2; exit 1
fi

# Library names may occur in reviewed examples; they are not forbidden product
# capabilities. Operational retired-system guidance, local runtime paths and
# consumer command assumptions remain forbidden in reusable instructions/assets.
if grep -rqiE 'code[ _-]?connect|pilot|CT-11B|figma:connect:' "$tree/skills" "$tree/templates" "$tree/schemas"; then
  echo "$label: reusable instructions retain retired-system guidance" >&2; exit 1
fi
if grep -rqE '/Users/|/home/|src/components/|src-tauri/|design-tokens/src/|pnpm validate:|just check' "$tree/skills"; then
  echo "$label: reusable skills embed consumer path/command assumptions" >&2; exit 1
fi

# Skills sit one level deeper here than under a consumer's .agents/skills/, so a
# relative asset path that was right there is silently wrong in the package.
if grep -rqE '\]\(\.\./(schemas|templates)/' "$tree/skills" ||
   grep -rqE '`\.\./(schemas|templates)' "$tree/skills"; then
  echo "$label: installed skills use consumer-relative asset paths" >&2; exit 1
fi

echo "  $label: discloses no consumer identity"
