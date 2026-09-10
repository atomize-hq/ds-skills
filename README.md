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
- **Upsert semantics that preserve `VariableID`s**, so paint bindings on existing components
  survive a re-sync. This is the part that is genuinely hard to get right.

## Install

This checkout describes version 0.5.2. Use the following URL after that immutable
release is published; a missing release is an error, not permission to fall back.

Provisioning and execution are separate operations. Provisioning installs one exact reviewed
release and may reach the network; execution runs that binary and resolves nothing — no registry,
no `latest`, no PATH lookup.

```bash
curl -fsSL https://github.com/atomize-hq/ds-skills/releases/download/v0.5.2/install.sh -o install.sh
# CI: verify install.sh against your committed ds-skills.release.json, then run it. Never pipe.
bash install.sh
```

There is **no `--version` flag**: the asset _is_ the version, so the URL you fetched and the
version you get cannot disagree. Installing a different release means using that release's URL.

| Variable             | Default                        | Purpose                                            |
| -------------------- | ------------------------------ | -------------------------------------------------- |
| `DS_SKILLS_PREFIX`   | `~/.local/share/ds-skills`     | Install root. CI should use a job-local directory. |
| `DS_SKILLS_BASE_URL` | the release's own download URL | A mirror to download from.                         |

`DS_SKILLS_BASE_URL` is **selection only**. Every payload digest is baked into the installer and
enforced, so a mirror can serve different bytes but cannot install them.

The executable lands at `<prefix>/<release>/bin/ds-skills`. Resolve it from that exact path
rather than from `PATH`: an ambient `ds-skills` on someone's machine must not be able to satisfy
a gate. Versions coexist by construction — the prefix carries the version and there is no global
`current` pointer, so nothing can override a project's selection.

**Requires Node >= 22, provided by your environment.** The release ships no runtime; every
environment that runs these gates already provisions Node, and bundling one would add ~25MB per
platform to solve a problem nobody has.

### What the installer verifies

`SHA256SUMS` is published beside the archives, so whoever can replace one can replace the other.
It is a consistency check layered on top, never the authority. The chain is:

> your reviewed record → verified bootstrap bytes → verified payload bytes → installed executable

The bootstrap carries the per-platform digests baked in and enforces them itself, so a verified
bootstrap establishes payload integrity rather than moving the question along. Two deliberate
divergences from the reference installer it is modelled on: a missing `SHA256SUMS` **fails**
rather than warning and skipping, and a tag that will not resolve **fails** rather than falling
back to a branch.

### Version 0.5.2 release management

Version 0.5.0 provides a [generated project launcher and ownership-safe setup](src/project-host/README.md).
A [product-owned CI setup action](.github/actions/setup-ds-skills/README.md) uses the same provisioning API.
These capabilities are not available in the historical v0.4.0 release.

Version 0.5.0 adds [product-owned v2 release verification and acquisition](src/install/README.md),
including sealed installed-file digests. These commands require a new v2 reviewed pin;
they are not features of v0.4.0. Each consumer must explicitly adopt a reviewed
pin and regenerate its launcher and discovery outputs.

### Storybook policy checks

Version 0.5.0 includes [configured Storybook policy validation](src/storybook/README.md):
inventory consistency, policy-defined tiers/consumers, and version-policy structure.
This is a structural check, not executed component readiness or publication proof.
It requires tier policy version 2 and is not in the published v0.4.0 release.

## Configure

One file, `ds-skills.config.json`:

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

```bash
ds-skills figma plugin build --config ds-skills.config.json --out figma/plugin
```

The bundle is prebuilt inside the release, so this step is substitution and file writes — no
bundler, and nothing to install alongside.

Then import the generated `manifest.json` into Figma. Nothing repo-specific is baked into this
package — the config is injected at build time.

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

|                         | Plugin                  | REST API (removed)                        |
| ----------------------- | ----------------------- | ----------------------------------------- |
| Figma plan              | any                     | Enterprise / full seat                    |
| Credentials             | none — runs in Figma    | OAuth token in `FIGMA_OAUTH_ACCESS_TOKEN` |
| Preserves `VariableID`s | **yes**                 | no — deletes and recreates the collection |
| Multi-theme             | yes, one mode per theme | no, default theme only                    |
| Runs in CI              | no                      | yes                                       |

The REST API has no upsert, so a sync deleted the collection and recreated it, breaking every
paint binding pointing at those variables. It bought unattended CI publishing at the cost of
binding stability, single-theme output, and a seat tier most consumers do not have — and in the
one repo that wired it, it never ran to success. Unattended publishing is a real want; when it
comes back it will be a new design that preserves bindings, not this one restored.

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

## Version 0.5.2 correction

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

`ds-skills sources policy check` and `ds-skills sources contract check` run
configured text invariants and static module/slot checks from the installed
product. Library identities, source roots, and local obligations remain consumer
data; they are not fixed supported-package names. See
[configuration, semantics and limits](src/source-checks/README.md). These checks do
not replace application typechecks or establish component publication/readiness.

### Foundations specimens

`ds-skills foundations build` and `ds-skills foundations check` assemble and verify
a self-contained Figma specimen script from project token/model/presentation data.
The commands do **not** execute it or publish tokens. See the
[configuration, guarded rendering, and verification boundaries](src/foundations/README.md).

### Library source evidence

`ds-skills libraries evidence capture/check/diff` commands collect and
compare explicit multiple-library source selections, with exact package/Git/content
identity and separately reviewed evidence pins. Source declarations are not yet
semantic skill curation. See [configuration, review lifecycle and limits](src/libraries/README.md).

### Registry snapshots

`ds-skills registries capture/check/diff` commands acquire explicit
multi-registry sources, preserve full payload/file identity, and keep pin checks
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
