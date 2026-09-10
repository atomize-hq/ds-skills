# Pinned project installation

Available in version 0.5.0; not in the historical v0.4.0 release. Requires a reviewed version-2 release pin and a release containing the
prebuilt project launcher. Do not rewrite an existing release's identity to adopt
this interface.

## Setup and execution

From a trusted, already installed product, provision the reviewed release and
then set up its project entry point:

```sh
"$TRUSTED_DS_SKILLS" release install --record /project/ds-skills.release.json
"$TRUSTED_DS_SKILLS" project setup --root /project
"$TRUSTED_DS_SKILLS" project check --root /project --json
```

`--prefix <directory>` selects the installation location for these commands;
otherwise `DS_SKILLS_PREFIX` or the platform default applies. The pin selects the
release, never PATH, an npm registry, a global current pointer, or the working
directory. Initial acquisition of the trusted product still follows the bootstrap
digest verification procedure in the release guide.

Setup copies the exact sealed bundle into `.ds-skills/project.mjs` and writes
`.ds-skills/installation.json`. The receipt records its version, release/source
identity, pin hash and a version-2 owned-file manifest (content hashes and executable
requirements), with no absolute project or install paths.
These are generated installation outputs, not consumer-maintained implementations.
Commit the reviewed pin and generated launcher so a fresh clone has an explicit
bootstrap; the receipt may be committed as a deterministic generated output, or
reconstructed by explicit setup. Missing receipts or skill files cannot satisfy
ordinary gates. Generated skill assets may be committed or recreated by explicit
installation; they must not become a hand-maintained source.

```sh
node /project/.ds-skills/project.mjs --install
node /project/.ds-skills/project.mjs --check
node /project/.ds-skills/project.mjs tokens govern --config ds-skills.project.json
```

`--install` alone explicitly acquires or repairs the selected release, verifying
bootstrap bytes before execution and full installed content afterwards. It then
invokes that verified product's setup command to refresh owned project outputs.
`DS_SKILLS_BASE_URL` can select a mirror, but cannot change the pinned digests.
Normal invocations, including checks, never acquire, repair or access the network
on the launcher's behalf. The selected command retains its own documented effects.

The generated entry point binds its root to its own location. Relative command
paths resolve inside that project even when invoked from another directory. Its
dependencies are only Node built-ins; it needs neither a consumer package install
nor a bundler. It executes the selected release with the current Node executable,
not an ambient `ds-skills`. Ordinary command stdio is inherited, so `figma serve`
readiness streams immediately on stderr while the child is alive.

## Skill discovery and asset layout

Setup installs every discoverable skill in the selected release into both
`.agents/skills/<name>` and `.claude/skills/<name>`, including nested references,
agent metadata and scripts. Each release skill must have a nonempty `SKILL.md`;
missing assets and unsupported names fail instead of silently disappearing.

The matching schemas and templates go in `.agents/schemas`, `.agents/templates`,
`.claude/schemas` and `.claude/templates`. This mirrors the release's layout:
`../../schemas` and `../../templates` still resolve from a skill directory without
rewriting source instructions or relying on a home-directory symlink. Outputs
are regular project-local copies, and checks compare all bytes against the
verified release plus the owned-file manifest. POSIX executable requirements are
preserved and checked; Windows uses content integrity without POSIX mode claims.

The manifest is derived from actual selected files, not a separate skill enrollment
list. New core skills become discoverable through the release itself. Core skill
installation is complete here; project-specific library curation and installation
of its evidence-grounded outputs remain a separate required extension.

Unrelated skill directories, user settings and discovery symlinks outside owned
roots are preserved. Existing incompatible files or links at desired roots require
explicit user disposition; setup does not force-adopt them or delete them. An extra
file, directory or link _inside_ a managed skill/support root makes the installation
nonconformant and blocks setup, preserving that data for inspection. This prevents
stale or untracked guidance from silently surviving as if it were part of the pin.

## Machine callers

Import the generated entry point instead of maintaining a second consumer helper:

```js
import { readPinnedResult, runPinned } from "./.ds-skills/project.mjs";

const outcome = readPinnedResult(
  ["tokens", "validate", "--config", "ds-skills.project.json"],
  "tokens validate",
);
// outcome.evaluated is true for completed evaluations, including nonconformance.
// outcome.status is 0 or 1; outcome.result.ok agrees with that status.

const { status } = runPinned([
  "figma",
  "serve",
  "--config",
  "figma.json",
  "--artifact",
  "tokens.json",
]);
```

The result helper adds `--json` when absent, validates the requested command
prefix and returned exact identity, requires result version `1`, and accepts only
exit 0/1 with a matching boolean conformance result. Exit 2/3, signal termination,
spawn failure, invalid JSON, arrays, unknown versions and contradictory status
are errors, never passing or nonconformant evaluations. Importing the module does
not execute a command, including from Node stdin/eval modules.

## Ownership and failure contract

- Setup preflights all outputs before creating its lock. Unowned or edited
  launcher, skill or support bytes are never overwritten. Byte-identical desired content can be
  adopted without rewriting it; an intact recognized receipt permits updating
  previously owned bytes. Unknown or malformed receipts fail explicitly.
- Deleted owned outputs can be repaired by explicit setup. A partial update with
  the exact new launcher but the old/missing receipt can complete safely. Healthy
  setup preserves all unchanged files' modification times.
- Symlinks/non-files at output or pin paths and symbolic/non-directory
  `.ds-skills`, `.agents` and `.claude` output parents fail. No discovery directories or unrelated skills are
  recursively deleted. Setup cannot write inside its selected immutable release.
- Cooperating writers use the product directory lock. Pin, release and output
  snapshots are rechecked; changed files stage before per-file atomic renames, with
  the receipt last. This is **not** a multi-file transaction or hostile-OS sandbox.
- Direct `project check` is read-only: intact outputs return 0, missing/skewed
  outputs 1, and missing/corrupt release or invalid input 2 without stdout.
  Unexpected runtime failures use 3. The generated launcher refuses ordinary
  execution on project/release skew before executing the target (exit 2); use
  the trusted product's direct check for a structured skew report.
- A receipt tracks local ownership/drift; it does not authenticate a hostile user
  who can rewrite trusted pins, generated launchers or receipts. Trust starts in
  the reviewed repository and release record. Verification does not defend
  against concurrent hostile replacement between verification and execution.

Intact previously owned files no longer selected by a release are removed during
explicit setup. Edited retired files block the entire operation; unexpected files
are preserved. Only proven managed, empty directories are pruned, never unrelated
skill roots or shared discovery parents. A partial update can be retried when its
new files are exact desired bytes. The earlier unpublished version-1 receipt can
be upgraded, but grants ownership only of its launcher, never pre-existing skills.

[Product-owned CI setup](../../.github/actions/setup-ds-skills/README.md) shares the
explicit provisioning API with `--install`; no second consumer acquisition helper
is needed. Consumer caller/CI migration, source-grounded curation and final
release/pin updates remain required. A successful core installation check does not
claim that those later integrations have been completed.
