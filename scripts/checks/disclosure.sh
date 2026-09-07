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

# The two ai-elements skills stay with the consumer: a token-rail CLI has no
# business shipping a third-party component library's docs, and a moved skill
# still pointing at them drags the coupling along behind it.
if grep -rqiE 'ai-elements|ai_elements|\bplate\b' "$tree/skills"; then
  echo "$label: installed skills reference ai-elements or plate" >&2; exit 1
fi
test ! -e "$tree/skills/ai-elements"
test ! -e "$tree/skills/ai-elements-plate-builder"

# Skills sit one level deeper here than under a consumer's .agents/skills/, so a
# relative asset path that was right there is silently wrong in the package.
if grep -rqE '\]\(\.\./(schemas|templates)/' "$tree/skills" ||
   grep -rqE '`\.\./(schemas|templates)' "$tree/skills"; then
  echo "$label: installed skills use consumer-relative asset paths" >&2; exit 1
fi

echo "  $label: discloses no consumer identity"
