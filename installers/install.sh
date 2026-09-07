#!/usr/bin/env bash
# ds-skills installer. Generated at release time with its identity baked in.
#
# SPEC.md §10.1: the bootstrap is a release ASSET, not a repository file, so the
# URL you fetched and the version you get cannot disagree. There is no --version
# flag — the asset IS the version. Installing a different one means using that
# release's URL.
#
#   curl -fsSL https://github.com/<repo>/releases/download/<tag>/install.sh -o install.sh
#   # CI: verify install.sh against the reviewed record, then run it. Never pipe.
#   bash install.sh
#
# Environment:
#   DS_SKILLS_PREFIX    install root (default: ~/.local/share/ds-skills)
#   DS_SKILLS_BASE_URL  mirror to download from. Selection only: the payload
#                       digests below are baked and enforced either way, so a
#                       mirror cannot change what ends up installed.
set -euo pipefail

# ---------- baked release identity — generated, do not edit ----------
RELEASE="__DS_RELEASE__"
REPOSITORY="__DS_REPOSITORY__"
SOURCE_COMMIT="__DS_SOURCE_COMMIT__"
DEFAULT_BASE_URL="__DS_BASE_URL__"
# "<os>_<arch>  <asset>  <sha256>", one per supported platform.
ASSETS="__DS_ASSETS__"
SUMS_ASSET="__DS_SUMS_ASSET__"
NODE_MINIMUM="__DS_NODE_MINIMUM__"
# ---------- end baked ----------

die() { printf '%s\n' "ds-skills install failed: $*" >&2; exit 1; }

# A bootstrap that does not know what it is must not guess. This catches both
# an empty substitution and the ungenerated template being run directly.
for pair in "RELEASE:$RELEASE" "REPOSITORY:$REPOSITORY" \
            "DEFAULT_BASE_URL:$DEFAULT_BASE_URL" "ASSETS:$ASSETS"; do
  name="${pair%%:*}"; value="${pair#*:}"
  [ -n "$value" ] || die "baked $name is empty; this bootstrap was never generated"
  case "$value" in
    __DS_*__) die "baked $name is still a placeholder; this is the template, not a release asset" ;;
  esac
done

base_url="${DS_SKILLS_BASE_URL:-$DEFAULT_BASE_URL}"
prefix="${DS_SKILLS_PREFIX:-$HOME/.local/share/ds-skills}"
dest="$prefix/$RELEASE"

# ---------- platform ----------
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin) os="macos" ;;
  Linux) os="linux" ;;
  *) die "unsupported operating system: $os. Supported: $(printf '%s' "$ASSETS" | awk '{print $1}' | tr '\n' ' ')" ;;
esac
case "$os:$arch" in
  macos:arm64|macos:aarch64) arch="arm64" ;;
  macos:x86_64|macos:amd64) arch="x86_64" ;;
  linux:aarch64|linux:arm64) arch="aarch64" ;;
  linux:x86_64|linux:amd64) arch="x86_64" ;;
  *) die "unsupported architecture: $arch on $os. Supported: $(printf '%s' "$ASSETS" | awk '{print $1}' | tr '\n' ' ')" ;;
esac
platform="${os}_${arch}"

asset=""; expected=""
while read -r name file sha; do
  [ -n "$name" ] || continue
  if [ "$name" = "$platform" ]; then asset="$file"; expected="$sha"; fi
done <<EOF
$ASSETS
EOF
[ -n "$asset" ] || die "no asset for $platform. Supported: $(printf '%s' "$ASSETS" | awk '{print $1}' | tr '\n' ' ')"

# ---------- runtime prerequisite ----------
# The release ships no Node (§10.5). Say the exact requirement, not "install node".
command -v node >/dev/null 2>&1 ||
  die "node >= $NODE_MINIMUM is required and was not found on PATH. ds-skills is a Node program and does not bundle a runtime."
node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$node_major" -ge "$NODE_MINIMUM" ] 2>/dev/null ||
  die "node >= $NODE_MINIMUM is required; found $(node -v 2>/dev/null || echo none)."

# ---------- download ----------
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2" || return 1
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$1" -O "$2" || return 1
  else
    die "neither curl nor wget is available"
  fi
}

digest() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else die "no sha256 tool (sha256sum or shasum) is available"
  fi
}

archive="$work/$asset"
fetch "$base_url/$asset" "$archive" || die "could not download $base_url/$asset"

# The baked digest is the anchor. SHA256SUMS is published beside the archive, so
# whoever can replace one can replace the other; it is a consistency check
# layered on top, never the authority (§10.3).
actual="$(digest "$archive")"
[ "$actual" = "$expected" ] ||
  die "$asset does not match the digest baked into this installer.
  expected $expected
  actual   $actual
Nothing was installed. This bootstrap only installs $RELEASE."

# Missing integrity metadata fails; it does not warn and skip (§10.2).
sums="$work/$SUMS_ASSET"
fetch "$base_url/$SUMS_ASSET" "$sums" ||
  die "$SUMS_ASSET is missing from the release. A tool that gates CI cannot treat missing integrity as a warning."
listed="$(awk -v a="$asset" '$2 == a || $2 == "*" a {print $1}' "$sums" | head -n1)"
[ -n "$listed" ] || die "$SUMS_ASSET does not list $asset"
[ "$listed" = "$expected" ] ||
  die "$SUMS_ASSET disagrees with this installer about $asset.
  installer $expected
  SHA256SUMS $listed"

# ---------- unpack, then install atomically ----------
staged="$work/staged"
mkdir -p "$staged"
tar -xzf "$archive" -C "$staged" || die "could not unpack $asset"
root="$staged/ds-skills-$RELEASE"
[ -d "$root" ] || die "$asset does not contain ds-skills-$RELEASE"
[ -x "$root/bin/ds-skills" ] || die "$asset contains no executable at bin/ds-skills"

mkdir -p "$prefix"
previous=""
if [ -e "$dest" ]; then
  previous="$dest.previous.$$"
  mv "$dest" "$previous" || die "could not set aside the existing install at $dest"
fi
# The rename is the completion marker: a partially copied directory can never be
# mistaken for a finished install.
if ! mv "$root" "$dest"; then
  if [ -n "$previous" ]; then mv "$previous" "$dest"; fi
  die "could not install into $dest"
fi
if [ -n "$previous" ]; then rm -rf "$previous"; fi

printf '%s\n' \
  "ds-skills $RELEASE installed" \
  "  asset       $asset ($platform)" \
  "  executable  $dest/bin/ds-skills" \
  "  source      $REPOSITORY@$SOURCE_COMMIT" \
  "  resolve it from this exact path; an ambient ds-skills on PATH is not this one"
