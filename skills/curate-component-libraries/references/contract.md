# Curation contract and review flow

Use the installed project launcher (`node .ds-skills/project.mjs`) for the commands
below. Configuration and evidence paths are project data; do not assume a particular
package, layout, framework, registry URL or Figma target.

## Configuration

Alongside `libraries` with its accepted evidence pin, configure:

```json
{
  "curation": {
    "definition": "curation.json",
    "candidate": "curation-evidence/candidate.json",
    "accepted": null,
    "review": null,
    "lockPath": ".locks/curation"
  }
}
```

Use separate paths for inputs, candidate, accepted bundle and review. All paths stay
inside the project. Commands refuse unrelated/damaged candidate files and edited pins.

## Authored definition

The definition has `curationVersion: "1"`, a lowercase kebab-case `namespace` (up to
20 characters), the exact `evidenceSha256`, and 1–40 `skills`. Each skill contains:

- `id`: unique lowercase kebab-case, at most 29 characters;
- `description`: one-line task routing, at most 500 characters;
- `libraries`: selected evidence library IDs;
- `sections`: objects with `id`, `title`, `category`, meaningful `text`, `citations`
  and `components`;
- `examples`: objects with `id`, `title`, `language` (`ts` or `tsx`), `code`,
  `citations` and `components`.

Citation shape:

```json
{
  "library": "widgets",
  "file": "packages/widgets/index.tsx",
  "sha256": "<exact captured file hash>",
  "start": 1,
  "end": 12
}
```

Lines are one-based and inclusive in the captured source, not the generated JSON
file. An API reference is `{ "library": "widgets", "id": "control" }` and needs a
citation into that selected API's declaration file. Every selected API must have
curated coverage. Every selected library needs cited guidance covering `api`,
`composition`, `accessibility`, `installation`, `compatibility`, `ownership`,
`conventions`, `verification` and `limitations`, across its selected skills.

These categories are coverage prompts, not boilerplate sections to fill with vague
sentences. For a non-rendering contracts library, accessibility guidance should
explain its actual boundary and the renderer's obligations, not invent DOM behavior.
If compatibility or execution is unverified, say so and cite the declarations that
bound what is known. Each skill needs at least one syntactically valid TS/TSX example
using selected APIs. Syntax validation does not establish module resolution,
application type compatibility, runtime behavior or accessibility.

## Candidate, review and acceptance

Run `curation validate --config <project.json> --json`, then `curation build` with
the same options. The bundle contains named project skills, focused guidance and
source-excerpt/provenance references. `curation diff` reports changes against the
accepted bundle. Review the **full prose and examples**, not only changed-file names.

After actual review, explicitly copy the candidate to a separate accepted path and
pin its exact SHA-256 as `curation.accepted: { "file": "...", "sha256": "..." }`.
Write a separate review record:

```json
{
  "reviewVersion": "1",
  "bundleSha256": "<exact accepted bundle hash>",
  "decision": "approved",
  "reviewer": { "kind": "agent", "id": "<actual reviewing agent identity>" },
  "reviewedAt": "<actual ISO timestamp>",
  "notes": "<what was reviewed, actual example checks, unresolved limitations>"
}
```

Reviewer kind is `human` or `agent`; never fabricate identity, timing, approval or
execution. Pin the review file's exact bytes in `curation.review` and run
`curation check`. This record is an attestation, not a signature or proof of reviewer
independence. Repository-required independent review still applies separately.

Exit 0 covers structure/provenance or the requested bundle operation. Exit 1 means
invalid/stale curation, 2 means inability (including missing or corrupt pins), and 3
is an unexpected failure. Failed generation preserves prior output. Build/check are
offline and do not install components, run examples, approve prose, or publish Figma.

## Install and verify reviewed skills

Use `node .ds-skills/project.mjs curation install --config <project.json> --json`
after current core project setup. Then run `curation installed check` through the
same launcher. These commands require that project's verified pinned release,
never a source checkout or arbitrary PATH fallback. Optional `--prefix` selects its
installed location. They install/check both `.agents` and `.claude` discovery copies
and bind config, evidence, review, bundle and release to `.ds-skills/curation.json`.
Core `project check` verifies core product assets only; retain both custom gates.

For refresh: capture/review/pin new evidence, curate/validate/build, inspect full
diffs, review/pin accepted content, run `curation check`, explicitly install, and
check installed output. Only unchanged obsolete owned outputs can be removed;
user edits or extra files are refused. Missing files can be repaired explicitly.
Do not delete user content to force installation. One project configuration owns
this receipt. Installation is per-file atomic with receipt last, not whole-tree
atomic; an interrupted run can require rerunning the same install, and checks must
report any mixed state. No automatic acquisition, model calls or example execution.
