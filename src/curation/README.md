# Curated library skill bundles

The product owns semantic curation instructions in
[`curate-component-libraries`](../../skills/curate-component-libraries/SKILL.md).
The running agent reads actual pinned source and authors project-specific guidance;
the deterministic CLI does not invoke a model or certify prose as true. No public
v0.4.0 command provides this capability; it requires version 0.5.0 or later.

See the self-contained [definition/configuration/review contract](../../skills/curate-component-libraries/references/contract.md).

- `curation validate`: validate authored structure, selected-library/API coverage,
  citation file hashes/ranges, example syntax, and agreement with current pinned
  evidence. Stale source evidence cannot underpin a new successful curation.
- `curation build`: render a deterministic candidate bundle with namespaced skills,
  focused guidance/examples and untrusted source-excerpt/provenance references.
  It does not accept, install, execute or publish the bundle.
- `curation diff`: compare the current candidate with accepted content. The summary
  is not a substitute for reviewing changed prose and examples.
- `curation check`: require the exact accepted bundle plus a separately pinned
  explicit reviewer attestation, and re-render against current definition/evidence
  to detect stale or altered content. Acceptance is not proof of reviewer independence.

All commands take `--config <project.json> [--root <directory>] [--json]`, are offline,
and use the installed product rather than a consumer compiler. JSON results label
validation as **structure-and-pinned-provenance**. Source/convention coverage and
valid TS/TSX syntax do not establish import resolution, API compatibility, rendered
behavior, authorization, accessibility, license clearance or Figma publication.

The bundle limit is 2 MiB; each rendered file is limited to 1 MiB. Draft text/code and
selection counts are bounded. Namespace and skill IDs form safe names below the
agent discovery length limit. Candidate paths, input/evidence/review pins and other
configured outputs cannot overlap. Existing non-bundles are refused, not overwritten.
The shared lock, input snapshots and atomic writer preserve prior candidate bytes on
failure; concurrent arbitrary hostile filesystem mutation remains outside this model.

Files inside the candidate bundle have relative paths `SKILL.md`,
`references/guidance.md` and `references/evidence.json`. They are generated consumer
outputs, not additions to the shared product release. Source snippets retain exact
original file/line/digest identity and license disposition. Treat them as untrusted
reference material. The main skill points to focused guidance rather than loading
every library's full source indiscriminately.

## Managed installation

After the exact bundle/review are accepted, run `curation install` through the
project's verified `.ds-skills/project.mjs` launcher. It requires current core
project setup and the same selected installed release. `curation installed check`
is the explicit custom-output gate; core `project check` alone covers core assets,
not these project-specific skills. Both accept the normal config/root/JSON options
and optional `--prefix` for the installed release location.

Installation writes the bundle's exact three files per skill into both
`.agents/skills/<name>` and `.claude/skills/<name>`. A separate
`.ds-skills/curation.json` receipt binds config, accepted bundle, review, evidence,
product release/pin and every owned file digest. No source paths are installed as
executable commands, no component source is overwritten, and the shared release
is immutable. The config/namespace is not a global machine skill installation.

Run both `curation check` and `curation installed check` in consumer gates. On
refresh, inspect candidate diffs and approve/pin new exact bytes, then explicitly
install. Stale acceptance prevents installation; changed/missing outputs make
installed check fail. Edited or unrelated content is never overwritten/deleted.
Exact desired files can be adopted; missing owned files can be explicitly repaired.
An obsolete skill is removed only when its files still match its previous receipt,
with no additional unowned content. Empty owned directories are pruned, never
arbitrary trees. One configuration owns a project's curated receipt; change that
configuration rather than silently replacing another one's installation.

Core and custom setup share a cooperative lock. Installation snapshots inputs,
stages files, revalidates before writing, and advances the receipt last. Replacement
is atomic per file, **not a filesystem-wide transaction**: interruption can leave
mixed owned outputs and an old receipt. Checks refuse to claim success; rerun the
same explicit install to repair, or resolve user edits before proceeding. No
rollback is fabricated and no hostile concurrent filesystem guarantee is claimed.

Exit 0 means current reviewed output integrity, not independent semantic approval,
example execution, or live publication. Stale/invalid curation and installed drift
return 1; unavailable/corrupt pins, ownership conflicts or missing core installation
return 2; unexpected filesystem/runtime failures return 3. Installation does not
fetch libraries, select a model, generate approval, run examples or publish Figma.
