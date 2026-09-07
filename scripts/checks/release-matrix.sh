#!/usr/bin/env bash
# T5's mechanism proof, run at last against real assets: every OS/arch pair in
# SPEC.md §10.5 selects its own asset, verifies it, and installs a working
# executable — and the PowerShell twin does the same for Windows.
#
# The four Unix pairs are exercised with a shimmed `uname`, which is honest here
# precisely because the payload is platform-independent: what varies is
# selection and verification, and those are what this proves. An asset that a
# platform cannot select is an asset nobody can install.
set -euo pipefail

root="$1"; work="$2"; release="$3"
staged="$work/release"
base="http://127.0.0.1:$(cat "$work/port")"
shim="$work/matrix-shim"; mkdir -p "$shim"

for pair in "Darwin arm64 macos_arm64" "Darwin x86_64 macos_x86_64" \
            "Linux x86_64 linux_x86_64" "Linux aarch64 linux_aarch64"; do
  set -- $pair
  printf '#!/bin/sh\ncase "$1" in -m) echo %s ;; *) echo %s ;; esac\n' "$2" "$1" > "$shim/uname"
  chmod +x "$shim/uname"
  prefix="$work/matrix/$3"

  log="$work/matrix-$3.log"
  PATH="$shim:$PATH" DS_SKILLS_BASE_URL="$base" DS_SKILLS_PREFIX="$prefix" \
    bash "$staged/install.sh" > "$log" 2>&1 ||
    { cat "$log" >&2; echo "$3: install failed" >&2; exit 1; }

  # It selected ITS OWN asset, not merely some asset that verified. With a
  # platform-independent payload every asset would verify, so "it installed" is
  # true for every wrong answer too.
  grep -q "asset       ds-skills-$release-$3.tar.gz ($3)" "$log" ||
    { cat "$log" >&2; echo "$3: selected the wrong asset" >&2; exit 1; }
  test -x "$prefix/$release/bin/ds-skills" ||
    { echo "$3: no executable installed" >&2; exit 1; }
  # The launcher runs the host's own node, so the installed CLI answers here
  # whichever platform the asset was selected for.
  "$prefix/$release/bin/ds-skills" --help >/dev/null ||
    { echo "$3: the installed executable does not run" >&2; exit 1; }
done
rm -f "$shim/uname"

# ---- windows_x86_64, through the production PowerShell installer ----
if command -v pwsh >/dev/null 2>&1; then
  prefix="$work/matrix/windows_x86_64"
  log="$work/matrix-windows_x86_64.log"
  DS_SKILLS_BASE_URL="$base" DS_SKILLS_PREFIX="$prefix" PROCESSOR_ARCHITECTURE=AMD64 \
    pwsh -NoProfile -ExecutionPolicy Bypass -File "$staged/install.ps1" > "$log" 2>&1 ||
    { cat "$log" >&2; echo "windows: install.ps1 failed" >&2; exit 1; }
  grep -q "ds-skills $release installed" "$log" ||
    { cat "$log" >&2; echo "windows: no success line" >&2; exit 1; }
  grep -q "asset       ds-skills-$release-windows_x86_64.zip" "$log" ||
    { cat "$log" >&2; echo "windows: selected the wrong asset" >&2; exit 1; }
  test -f "$prefix/$release/bin/ds-skills.cmd" ||
    { echo "windows: no launcher installed" >&2; exit 1; }
  # The .cmd cannot run here, but what it invokes can — so the payload is
  # proven complete rather than merely present.
  node "$prefix/$release/lib/bin/ds-skills.mjs" --help >/dev/null ||
    { echo "windows: the installed payload does not run" >&2; exit 1; }

  # And it rejects a tampered payload for the same reason the bash twin does.
  set +e
  out="$(DS_SKILLS_BASE_URL="http://127.0.0.1:$(cat "$work/tampered.port")" \
    DS_SKILLS_PREFIX="$work/matrix/windows-tampered" PROCESSOR_ARCHITECTURE=AMD64 \
    pwsh -NoProfile -ExecutionPolicy Bypass -File "$staged/install.ps1" 2>&1)"
  code=$?
  set -e
  test "$code" -ne 0 || { echo "install.ps1 accepted a modified payload" >&2; exit 1; }
  grep -q 'baked into this installer' <<<"$out" ||
    { echo "install.ps1 rejected for the wrong reason: $out" >&2; exit 1; }

  # An unsupported architecture fails with the list, in the twin too.
  set +e
  out="$(DS_SKILLS_PREFIX="$work/matrix/windows-arm" PROCESSOR_ARCHITECTURE=ARM64 \
    pwsh -NoProfile -ExecutionPolicy Bypass -File "$staged/install.ps1" 2>&1)"
  code=$?
  set -e
  test "$code" -ne 0 || { echo "install.ps1 installed on an unsupported architecture" >&2; exit 1; }
  grep -q 'unsupported architecture' <<<"$out" ||
    { echo "install.ps1 did not name the architecture: $out" >&2; exit 1; }

  echo "  matrix: 5 of 5 platforms select, verify and install — bash and PowerShell"
else
  # No escape hatch. Claiming the Windows installer works because the bash one
  # does is exactly the overclaim SPEC.md §7.5 forbids, and the two are a
  # matched pair rather than one implementation with a translation.
  echo "pwsh is required to exercise install.ps1: 4 of 5 platforms is not the matrix" >&2
  exit 1
fi
