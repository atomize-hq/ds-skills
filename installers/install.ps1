# ds-skills installer (Windows). Generated at release time with its identity
# baked in — the matched twin of install.sh, same prefix scheme, same
# verification, same failure modes (SPEC.md §10.6).
#
#   Invoke-WebRequest https://github.com/<repo>/releases/download/<tag>/install.ps1 -OutFile install.ps1
#   # CI: verify install.ps1 against the reviewed record, then run it.
#   powershell -ExecutionPolicy Bypass -File install.ps1
#
# Environment:
#   DS_SKILLS_PREFIX    install root (default: %LOCALAPPDATA%\ds-skills)
#   DS_SKILLS_BASE_URL  mirror to download from. Selection only: the payload
#                       digests below are baked and enforced either way.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ---------- baked release identity — generated, do not edit ----------
$Release       = '__DS_RELEASE__'
$Repository    = '__DS_REPOSITORY__'
$SourceCommit  = '__DS_SOURCE_COMMIT__'
$DefaultBaseUrl = '__DS_BASE_URL__'
# "<os>_<arch>  <asset>  <sha256>", one per supported platform.
$AssetLines    = @'
__DS_ASSETS__
'@
$SumsAsset     = '__DS_SUMS_ASSET__'
$NodeMinimum   = '__DS_NODE_MINIMUM__'
# ---------- end baked ----------

function Die([string]$Message) {
  [Console]::Error.WriteLine("ds-skills install failed: $Message")
  exit 1
}

# A bootstrap that does not know what it is must not guess: empty, or still the
# ungenerated template.
foreach ($pair in @(
    @{ Name = 'Release'; Value = $Release },
    @{ Name = 'Repository'; Value = $Repository },
    @{ Name = 'DefaultBaseUrl'; Value = $DefaultBaseUrl },
    @{ Name = 'AssetLines'; Value = $AssetLines })) {
  $value = "$($pair.Value)".Trim()
  if ([string]::IsNullOrEmpty($value)) {
    Die "baked $($pair.Name) is empty; this bootstrap was never generated"
  }
  if ($value -match '^__DS_.*__$') {
    Die "baked $($pair.Name) is still a placeholder; this is the template, not a release asset"
  }
}

$assets = @{}
foreach ($line in ($AssetLines -split "`n")) {
  $fields = $line.Trim() -split '\s+'
  if ($fields.Count -eq 3) { $assets[$fields[0]] = @{ Asset = $fields[1]; Sha256 = $fields[2] } }
}
$supported = ($assets.Keys | Sort-Object) -join ' '

# ---------- platform ----------
if (-not [System.Environment]::Is64BitOperatingSystem) {
  Die "unsupported architecture: 32-bit Windows. Supported: $supported"
}
$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
  'AMD64' { 'x86_64' }
  'x86'   { 'x86_64' }
  default { $null }
}
if (-not $arch) { Die "unsupported architecture: $($env:PROCESSOR_ARCHITECTURE). Supported: $supported" }
$platform = "windows_$arch"
if (-not $assets.ContainsKey($platform)) { Die "no asset for $platform. Supported: $supported" }
$asset = $assets[$platform].Asset
$expected = $assets[$platform].Sha256

# ---------- runtime prerequisite ----------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Die "node >= $NodeMinimum is required and was not found on PATH. ds-skills is a Node program and does not bundle a runtime."
}
$nodeMajor = 0
try { $nodeMajor = [int](& node -p 'process.versions.node.split(".")[0]') } catch { $nodeMajor = 0 }
if ($nodeMajor -lt [int]$NodeMinimum) {
  Die "node >= $NodeMinimum is required; found $(& node -v 2>$null)."
}

# ---------- download ----------
$baseUrl = if ($env:DS_SKILLS_BASE_URL) { $env:DS_SKILLS_BASE_URL } else { $DefaultBaseUrl }
$prefix  = if ($env:DS_SKILLS_PREFIX) { $env:DS_SKILLS_PREFIX } else { Join-Path $env:LOCALAPPDATA 'ds-skills' }
$dest    = Join-Path $prefix $Release

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("ds-skills-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
  $archive = Join-Path $work $asset
  try { Invoke-WebRequest -Uri "$baseUrl/$asset" -OutFile $archive -UseBasicParsing }
  catch { Die "could not download $baseUrl/$asset" }

  # The baked digest is the anchor; SHA256SUMS is a consistency check on top.
  $actual = (Get-FileHash -Algorithm SHA256 -Path $archive).Hash.ToLowerInvariant()
  if ($actual -ne $expected.ToLowerInvariant()) {
    Die "$asset does not match the digest baked into this installer.`n  expected $expected`n  actual   $actual`nNothing was installed. This bootstrap only installs $Release."
  }

  # Missing integrity metadata fails; it does not warn and skip (§10.2).
  $sums = Join-Path $work $SumsAsset
  try { Invoke-WebRequest -Uri "$baseUrl/$SumsAsset" -OutFile $sums -UseBasicParsing }
  catch { Die "$SumsAsset is missing from the release. A tool that gates CI cannot treat missing integrity as a warning." }
  $listed = $null
  foreach ($line in (Get-Content $sums)) {
    $fields = $line.Trim() -split '\s+'
    if ($fields.Count -ge 2 -and ($fields[1] -eq $asset -or $fields[1] -eq "*$asset")) { $listed = $fields[0] }
  }
  if (-not $listed) { Die "$SumsAsset does not list $asset" }
  if ($listed.ToLowerInvariant() -ne $expected.ToLowerInvariant()) {
    Die "$SumsAsset disagrees with this installer about $asset.`n  installer $expected`n  SHA256SUMS $listed"
  }

  # ---------- unpack, then install atomically ----------
  $staged = Join-Path $work 'staged'
  New-Item -ItemType Directory -Path $staged -Force | Out-Null
  try { Expand-Archive -Path $archive -DestinationPath $staged -Force }
  catch { Die "could not unpack $asset" }
  $root = Join-Path $staged "ds-skills-$Release"
  if (-not (Test-Path -LiteralPath $root)) { Die "$asset does not contain ds-skills-$Release" }
  if (-not (Test-Path -LiteralPath (Join-Path $root 'bin\ds-skills.cmd'))) {
    Die "$asset contains no executable at bin\ds-skills.cmd"
  }

  New-Item -ItemType Directory -Path $prefix -Force | Out-Null
  $previous = $null
  if (Test-Path -LiteralPath $dest) {
    $previous = "$dest.previous.$PID"
    Move-Item -LiteralPath $dest -Destination $previous
  }
  try {
    # The rename is the completion marker: a partially copied directory can
    # never be mistaken for a finished install.
    Move-Item -LiteralPath $root -Destination $dest
  } catch {
    if ($previous) { Move-Item -LiteralPath $previous -Destination $dest }
    Die "could not install into $dest"
  }
  if ($previous) { Remove-Item -LiteralPath $previous -Recurse -Force }

  Write-Output "ds-skills $Release installed"
  Write-Output "  asset       $asset ($platform)"
  Write-Output "  executable  $dest\bin\ds-skills.cmd"
  Write-Output "  source      $Repository@$SourceCommit"
  Write-Output "  resolve it from this exact path; an ambient ds-skills on PATH is not this one"
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
