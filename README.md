# @atomize-hq/ds-skills

Publish a [DTCG](https://tr.designtokens.org/) token artifact into Figma variables, and check a
Figma file for drift against it.

**The repo is canonical.** Nothing here ever writes Figma's state back into token sources. A
value someone changed inside Figma surfaces as a reviewable finding, not a silent commit.

## What you get

- **A Figma plugin** with two actions — _Sync Variables_ (write) and _Check Drift_ (read-only).
- **A pure comparison core** you can call from CI or a script: `buildExpectedVariables`,
  `compareFigmaVariables`, `formatDriftReport`. No Figma API dependency, so it unit-tests without
  a browser or a token.
- **Upsert preserves matching name/type `VariableID`s**. Renames, deletions and type
  changes do not preserve identity; read the pre-sync safety warning below.

## Install

Release selection is pin-driven. This source tree carries the intended `0.5.4`
package version, but a source version is not evidence that a tag or asset has been
published. `v0.5.3` at
[`9e9e8e83369736de2f90a75b498d5fd12f600731`](https://github.com/atomize-hq/ds-skills/tree/9e9e8e83369736de2f90a75b498d5fd12f600731)
is historical release information, not an instruction to select that release.
Select only the release named by a human-reviewed `ds-skills.release.json`; never
substitute `latest`, a branch, or an unpublished tag.

Provisioning and execution are separate operations. Provisioning may reach the
network to install one exact reviewed release. Execution resolves no registry,
`latest`, or `PATH` entry: use the executable under the selected prefix.

### First-time bootstrap (Unix)

Set `DS_SKILLS_REVIEWED_RELEASE` only after a human has selected the intended
public release and source authority. The first command acquires its record; that
download is **not** trust by itself. Before running any bootstrap, inspect the
printed repository, release, source commit, and bootstrap digest against the
human-reviewed release/source record. Stop on any mismatch.

```sh
: "${DS_SKILLS_REVIEWED_RELEASE:?set the human-reviewed release tag, for example vX.Y.Z}"
release_base_url="${DS_SKILLS_RELEASE_BASE_URL:-https://github.com/atomize-hq/ds-skills/releases/download/$DS_SKILLS_REVIEWED_RELEASE}"
curl -fsSL "$release_base_url/ds-skills.release.json" -o ds-skills.release.json
node -e 'const r=require("./ds-skills.release.json"); console.log({repository:r.repository, release:r.release, sourceCommit:r.sourceCommit, bootstrapSha256:r.bootstrap?.sha256})'
# HUMAN GATE: compare the printed values with the approved public release/source record before continuing.
release="$(node -p 'require("./ds-skills.release.json").release')"
test "$release" = "$DS_SKILLS_REVIEWED_RELEASE" || { echo "reviewed release and record disagree" >&2; exit 1; }
repository="$(node -p 'require("./ds-skills.release.json").repository')"
test "$repository" = "atomize-hq/ds-skills" || { echo "unexpected release repository" >&2; exit 1; }
curl -fsSL "$release_base_url/install.sh" -o "/tmp/ds-skills-$release-install.sh"
expected="$(node -p 'require("./ds-skills.release.json").bootstrap.sha256')"
actual="$(shasum -a 256 "/tmp/ds-skills-$release-install.sh" | awk '{print $1}')"
test "$actual" = "$expected" || { echo "bootstrap digest mismatch" >&2; exit 1; }
export DS_SKILLS_PREFIX="$PWD/.tools/ds-skills"
export DS_SKILLS_BASE_URL="$release_base_url"
bash "/tmp/ds-skills-$release-install.sh"
export DS_SKILLS="$DS_SKILLS_PREFIX/$release/bin/ds-skills"
"$DS_SKILLS" release verify --record "$PWD/ds-skills.release.json" --prefix "$DS_SKILLS_PREFIX" --json
```

Requires Node 22+ plus `curl` (or a separately trusted transport) and
`shasum`/`sha256sum`. Never pipe a downloaded bootstrap into a shell. The manual
digest check verifies the bootstrap **before** it executes; the bootstrap then
verifies its baked payload digests and `SHA256SUMS`. `DS_SKILLS_RELEASE_BASE_URL`
is optional mirror transport for this documented journey, not a new trust anchor.

### First-time bootstrap (Windows PowerShell)

Use the same selected tag and human review gate. This is the repository's
PowerShell installer path and its host matrix is package-tested; it is **not** a
claim of a native Windows run from this source checkout.

```powershell
if (-not $env:DS_SKILLS_REVIEWED_RELEASE) { throw 'set the human-reviewed release tag first' }
$releaseBaseUrl = if ($env:DS_SKILLS_RELEASE_BASE_URL) { $env:DS_SKILLS_RELEASE_BASE_URL } else { "https://github.com/atomize-hq/ds-skills/releases/download/$env:DS_SKILLS_REVIEWED_RELEASE" }
Invoke-WebRequest "$releaseBaseUrl/ds-skills.release.json" -OutFile .\ds-skills.release.json
$pin = Get-Content .\ds-skills.release.json -Raw | ConvertFrom-Json
$pin | Select-Object repository, release, sourceCommit, @{Name='bootstrapSha256'; Expression = { $_.bootstrapPowershell.sha256 } }
# HUMAN GATE: compare these values with the approved public release/source record before continuing.
if ($pin.release -ne $env:DS_SKILLS_REVIEWED_RELEASE -or $pin.repository -ne 'atomize-hq/ds-skills') { throw 'reviewed release and record disagree' }
$bootstrap = Join-Path $env:TEMP "ds-skills-$($pin.release)-install.ps1"
Invoke-WebRequest "$releaseBaseUrl/install.ps1" -OutFile $bootstrap
$expected = $pin.bootstrapPowershell.sha256
$actual = (Get-FileHash -Algorithm SHA256 -Path $bootstrap).Hash.ToLowerInvariant()
if ($actual -ne $expected.ToLowerInvariant()) { throw 'bootstrap digest mismatch' }
$env:DS_SKILLS_PREFIX = Join-Path $PWD '.tools\ds-skills'
$env:DS_SKILLS_BASE_URL = $releaseBaseUrl
& PowerShell -ExecutionPolicy Bypass -File $bootstrap
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$DS_SKILLS = Join-Path $env:DS_SKILLS_PREFIX "$($pin.release)\bin\ds-skills.cmd"
& $DS_SKILLS release verify --record (Join-Path $PWD 'ds-skills.release.json') --prefix $env:DS_SKILLS_PREFIX --json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

Requires Node 22+, PowerShell, and `Invoke-WebRequest`. `install.ps1` selects the
Windows asset and installs `bin\ds-skills.cmd`; it is not a Bash action and does
not claim Windows arm64 support. `-ExecutionPolicy Bypass` applies only to this
explicit local file after its digest is checked; follow your organization policy.

The executable is `<prefix>/<release>/bin/ds-skills` on Unix and
`<prefix>\<release>\bin\ds-skills.cmd` on Windows. Versions coexist and there is
no global `current` pointer. The reviewed record and bootstrap's baked payload
digest decide installed bytes.

### Core setup, custom curation, and repair

From the exact verified executable, set up and check core discovery assets:

```sh
"$DS_SKILLS" project setup --root "$PWD" --prefix "$DS_SKILLS_PREFIX"
node .ds-skills/project.mjs --check
```

On Windows, keep the selected prefix in the environment and check each native
command result; the generated launcher is a Node command, not a `.cmd` alias:

```powershell
& $DS_SKILLS project setup --root $PWD --prefix $env:DS_SKILLS_PREFIX
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& node .ds-skills/project.mjs --check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

Core setup writes only package-owned launcher, skill, schema, and template outputs.
It does **not** author a consumer project configuration or install project-specific
curated skills. Create the project configuration described by the
[library evidence guide](src/libraries/README.md), then follow the
[curation authoring/review contract](skills/curate-component-libraries/references/contract.md)
to capture/review/pin selected evidence, author guidance, build/diff a candidate,
and separately review/pin its exact bundle. The examples name that consumer-owned
project configuration `ds-skills.project.json`; choose its inputs for your own
project, without Collider aliases or libraries. After acceptance, run:

```sh
node .ds-skills/project.mjs curation check --config ds-skills.project.json
node .ds-skills/project.mjs curation install --config ds-skills.project.json
node .ds-skills/project.mjs curation installed check --config ds-skills.project.json
```

```powershell
& node .ds-skills/project.mjs curation check --config ds-skills.project.json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& node .ds-skills/project.mjs curation install --config ds-skills.project.json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& node .ds-skills/project.mjs curation installed check --config ds-skills.project.json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

For every release upgrade, first review the new pin, bootstrap its exact executable,
and rerun `project setup`, `curation install`, and `curation installed check`: the
curation receipt binds the product pin even when curated bytes are unchanged.
Semantic re-curation/review is conditional on changed curation inputs or accepted
bundle content, not on this required receipt refresh. Setup refuses edited or
unowned managed outputs rather than overwriting them. Inspect and either restore
approved bytes or relocate user content before retrying; do not delete discovery
roots to force an upgrade. `project check` and `curation installed check` remain
separate gates.

### Release history

Version 0.5.0 introduced the generated project launcher, v2 release verification,
Storybook structural policy checks, and product-owned setup action. Those are
historical capabilities, not a license to use old release assets. The
[setup action guide](https://github.com/atomize-hq/ds-skills/blob/v0.5.4/.github/actions/setup-ds-skills/README.md)
is linked at this release tag for archive readers; normal operation follows the reviewed pin.

## Configure

This is the **token-plugin configuration**, named `ds-skills.config.json` in these
examples. It is distinct from the root `projectVersion` configuration used by
tokens, Storybook, library evidence, and curation commands (`ds-skills.project.json`
above). Core setup installs discovery assets, not these consumer-owned inputs.

Token-plugin example:

```json
{
  "collectionName": "Design Tokens",
  "artifactUrl": "http://localhost:4173/tokens.json",
  "tokenSourcePath": "tokens/",
  "extensionsNamespace": "com.example.tokens",
  "fallbackThemeId": "light",
  "plugin": { "name": "Design Token Sync", "id": "design-token-sync-dev" }
}
```

| Field                       | Meaning                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `collectionName`            | The Figma variable collection this rail owns. Created on first sync.                             |
| `artifactUrl`               | Where the plugin fetches your published artifact from.                                           |
| `tokenSourcePath`           | Where you author token sources. The plugin names it as the only place to fix drift.              |
| `extensionsNamespace`       | `$extensions` key carrying `{ themeId }` for the default theme. `null` if you don't declare one. |
| `fallbackThemeId`           | Theme id assumed when the artifact declares none.                                                |
| `plugin.name` / `plugin.id` | Figma manifest fields. The id must be unique in your Figma account.                              |

## Build the plugin

```sh
node .ds-skills/project.mjs figma plugin build --config ds-skills.config.json --out figma/plugin
```

The bundle is prebuilt inside the release, so this step is substitution and file writes — no
bundler, and nothing to install alongside.

Then import the generated `manifest.json` through Figma's **development-plugin** flow and launch
it there. Nothing repo-specific is baked into this package — the config is injected at build time.

The operating sequence is: (1) build the configured plugin; (2) in a second terminal start the
configured artifact server; (3) in the panel choose **Fetch** for that server's Artifact URL, or
choose **Artifact File** for the file fallback; (4) after the pre-sync warning and appropriate
consumer authorization, choose **Sync Variables**; (5) choose **Check Drift**; and (6) read the
in-panel result, with report recording as a separate best-effort output.

```sh
node .ds-skills/project.mjs figma serve --config ds-skills.config.json \
  --artifact dist/tokens.json --drift-out artifacts/figma-drift.json
```

The command's `--config` and `--artifact` values must be the same consumer values used for the
plugin build. `--drift-out` authorizes only the local server to write that report; without it the
server intentionally refuses report POSTs. Fetch/File and the in-panel **Check Drift** result
remain useful if recording fails. This is a development artifact server, not a published-plugin
deployment or Figma mutation authorization.

> **Before Sync Variables:** use a complete, authoritative artifact and a collection exclusively
> owned by this rail. The plugin selects the **first** local collection whose name matches the
> configured collection name. Sync removes variables absent from the artifact; a rename loses
> identity, and a type change removes then recreates the variable. Same name/type variables keep
> their IDs, but that is not protection for incomplete input or a shared/same-name collection.
> Sync can partially fail and has no transaction-wide rollback guarantee. First verify in an
> isolated destination and inspect the result before using an existing production collection.

## Artifact shape

The default theme is the document body; every other theme is a partial tree under
`$themeOverrides`. Each theme becomes one mode on the Figma collection.

```json
{
  "$extensions": { "com.example.tokens": { "themeId": "dark" } },
  "$themeOverrides": {
    "light": {
      "accent": { "primary": { "$type": "color", "$value": "#1d4ed8" } }
    }
  },
  "accent": { "primary": { "$type": "color", "$value": "#155dfc" } }
}
```

Supported `$type`s: `color` (hex, hex8, `rgb()`, `rgba()`), `dimension`, `duration`, `number`,
`string`, `boolean`.

## One rail: the plugin

Publishing runs through the Figma plugin this package builds. There was a second rail — the
Figma Variables REST API — and it was removed rather than kept as a deferred option, because
the comparison never favoured it:

|                         | Plugin                                    | REST API (removed)                                          |
| ----------------------- | ----------------------------------------- | ----------------------------------------------------------- |
| Figma plan              | any                                       | Enterprise / full seat                                      |
| Credentials             | none — runs in Figma                      | OAuth token in `FIGMA_OAUTH_ACCESS_TOKEN`                   |
| Preserves `VariableID`s | **yes** for matching name/type identities | the removed adapter deleted/recreated in its implementation |
| Multi-theme             | yes, one mode per theme                   | the removed adapter emitted only its default-theme behavior |
| Runs in CI              | no                                        | yes                                                         |

The removed adapter, not the REST API as a blanket limitation, deleted and recreated its
collection and emitted only its default-theme behavior. That implementation broke paint bindings;
it never ran successfully in the consumer that wired it. The product remains plugin-only.
Unattended publishing is a future design question, not permission to restore that adapter.

## Drift codes

`MISSING_VARIABLE` · `UNEXPECTED_VARIABLE` · `TYPE_MISMATCH` · `ALIAS_BINDING` ·
`VALUE_MISMATCH` · `MISSING_MODE_VALUE` · `MISSING_MODE` · `UNEXPECTED_MODE`

`ALIAS_BINDING` means someone rebound a variable to an alias inside Figma. Like every other
finding, that is a proposal to be made in your token sources — not a value to copy back.

## Gotchas this package already handles

- **Float32 read-back.** Figma stores numbers in single precision, so `0.7` returns as
  `0.699999988079071`. Comparison tolerates it; a naive differ reports drift on every sync.
- **`resolvedType` cannot change in place.** A token whose type changed is removed and recreated
  rather than failing mid-sync.
- **Mode count is plan-gated.** Adding a theme beyond your Figma tier's limit fails with an
  explicit message instead of an opaque API error.
- **Write-back verification.** `Sync Variables` re-reads the file and runs the same comparison
  `Check Drift` uses, so a write that silently failed cannot report success.

## Version 0.5.1 correction

Token-build preflight tolerates another cooperating builder releasing its exact
lock or coordination guard between filesystem checks. Path, symlink, permission
and protected-input checks remain enforced; ordinary artifact errors still fail.
The directory-lock protocol continues to serialize builds and revalidate ownership.

## Version 0.5.2 correction (historical)

Config resolution tolerates a configured cooperative lock directory disappearing
between path checks. The fallback requires that the exact directory leaf remains
absent and its parent still resolves inside the project. During this fallback, a
missing or non-directory parent and other errors fail closed. Ordinary path,
symlink and containment checks remain unchanged; recreated targets do not take
this fallback.

## Development

```bash
pnpm install
pnpm check      # format, lint, typecheck, LOC, tests, build, smoke, installed-artifact gate
```

`pnpm check` ends with `pack-check`, which stages a release candidate, serves it locally, and
installs it — including the negative cases, the five-platform matrix, and two differently
configured consumers. It needs `tokei` (the LOC guard) and `pwsh` (the Windows installer's
tests); both fail loudly rather than being skipped.

For release verification against private consumer identities, set
`DS_SKILLS_PRIVATE_IDENTIFIERS_FILE` to an external, untracked local file before running
`pnpm pack-check`. Put one nonempty literal identifier on each LF-terminated line, with no
leading or trailing whitespace. The check performs case-insensitive fixed-string matching over
every staged path and text file, including tests and fixtures; without that file it reports only
the structural disclosure checks rather than claiming consumer-identity coverage.

```bash
pnpm release:stage --release <new-version>   # stage candidate assets into ./release
```

Use an isolated real consumer and its explicit project configuration to verify a
cutover through the pinned launcher. The obsolete fixed-layout rehearsal command
is removed: it assumed one consumer's paths and accepted an arbitrary CLI path.
The package gate must not require a particular consumer checkout. Live publication
and actual consumer integration remain separate release requirements; synthetic
package fixtures are not substitutes.

### Consumer-owned source rules

`node .ds-skills/project.mjs sources policy check` and
`node .ds-skills/project.mjs sources contract check` run configured text invariants and static module/slot checks from the installed
product. Library identities, source roots, and local obligations remain consumer
data; they are not fixed supported-package names. See
[configuration, semantics and limits](src/source-checks/README.md). These checks do
not replace application typechecks or establish component publication/readiness.

### Foundations specimens

`node .ds-skills/project.mjs foundations build` and
`node .ds-skills/project.mjs foundations check` assemble and verify a self-contained Figma specimen script from project token/model/presentation data.
The commands do **not** execute it or publish tokens. See the
[configuration, guarded rendering, and verification boundaries](src/foundations/README.md).

### Library source evidence

`node .ds-skills/project.mjs libraries evidence capture/check/diff` commands collect and compare explicit multiple-library source selections, with exact package/Git/content
identity and separately reviewed evidence pins. Source declarations are not yet
semantic skill curation. See [configuration, review lifecycle and limits](src/libraries/README.md).

### Registry snapshots

`node .ds-skills/project.mjs registries capture/check/diff` commands acquire explicit multi-registry sources, preserve full payload/file identity, and keep pin checks
offline. Reviewed snapshots feed the library-evidence pipeline without another
network request. See [supported registry format, limits and review flow](src/registries/README.md).

### Project-specific skill curation

The reusable `curate-component-libraries` skill guides agent-authored, source-grounded
guidance for configured libraries. `curation validate/build/check/diff`
commands validate provenance and build reviewable namespaced skill bundles.
`curation install` materializes exact reviewed bundles into both project discovery
surfaces; `curation installed check` checks owned output and release/input skew.
These operations do not certify semantic correctness or execute examples. See
[the curation contract and current boundaries](src/curation/README.md).

### Portable skill workflows

The pack owns nine reusable workflows: routing, foundations, Storybook,
component round trips, layout assembly, library component implementation, interactive
workspace composition, library curation and quality reconciliation. Start with
[the stack router](skills/stack-orchestrator/SKILL.md) and follow only the workflow
needed by the task. Frameworks, native boundaries, libraries, paths and evidence
profiles come from the consumer, not fixed stack assumptions.

Library-specific API guidance is reviewed, generated project output, not a static
supported-package catalog. AI Elements can be an explicitly configured source just
like a different component library; the shared pack does not embed one consumer's
API imports, registry installation commands or editor choice. Installed core and
custom output have separate integrity gates. Product installation does not establish
consumer readiness, live publication, or repository landing: each requires its own
evidence and applicable review/CI gates. Historical v0.4.0 is unchanged.
