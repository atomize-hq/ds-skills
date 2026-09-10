# Component evidence and explicit promotion policy

The product owns status aggregation and promotion mechanics. Consumers supply
reviewed policy data and their actual stories, specs and publication records. No
per-component enrollment, mirrored recipe shape, fixed library name, or phase/thread
identifier determines eligibility.

## Configuration

Add optional top-level `components` to the project config:

```json
{
  "components": {
    "report": "artifacts/components/status.json",
    "lockPath": ".ds-artifacts/locks/components.lock",
    "maxAgeMinutes": 60,
    "profiles": {
      "component-review": {
        "requirements": ["story-coverage", "visual-review"],
        "consumers": { "local": "advisory", "ci": "blocking" }
      },
      "publication-review": {
        "requirements": ["figma-publication"],
        "consumers": { "release": "blocking" }
      },
      "reference-docs": {
        "requirements": ["story-coverage"],
        "consumers": { "docs": "blocking" }
      },
      "out-of-scope": {
        "requirements": [],
        "consumers": { "local": "advisory" }
      }
    }
  }
}
```

Profile/consumer IDs are arbitrary lowercase identifiers. Requirements are unique
members of the three supported evidence capabilities. Consumers and enforcement are
explicit; there is no implicit `local` default, no environment-variable downgrade,
and no change-path heuristic allowed to disable blocking. An empty requirement list
means not-applicable, not an earned readiness claim. Policy configuration is a trusted,
reviewed project input: choosing too few requirements is not repaired by inventing a
hidden policy based on the profile's name.

## Commands and exit meanings

All commands accept `--config <project.json> [--root <dir>] [--json]`.

- `components status evaluate`: freshly aggregate evidence, ignoring any saved component
  report. Read-only; exit 0 means the report was evaluated, not that its policies pass.
- `components status build`: write that report with the shared lock, input/output safety
  checks and atomic rename. Truthful unsatisfied/unavailable evidence can be recorded
  successfully. Identical current content retains bytes/mtime; an aged report refreshes.
- `components status check`: compare the saved report with current source-derived evidence
  and policy, including revision/input digest and bounded UTC report freshness. Exit 1
  means absent, stale, malformed or tampered report. A current failing report is conformant
  as a report, but does not satisfy promotion requirements.
- `components promote --profile <id> --consumer <id>`: always evaluate current evidence
  and apply exactly the selected configured policy, without trusting the saved report.
  Required unsatisfied, invalid, missing, deferred or changed evidence blocks a blocking
  consumer (1); an advisory consumer receives an explicit advisory result (0) with
  `requirementsSatisfied: false`. Missing/unknown selection returns 2, not a fallback.

Unusable project/Git context, unsafe paths, changed inputs and filesystem failures
return inability-to-evaluate (2) with no JSON result; unexpected failures remain 3.
An individual configured evidence source that cannot be evaluated is retained as
`unavailable` with its diagnostic. The promotion decision then treats that requirement
as unmet, not satisfied. This preserves the reason rather than fabricating an evaluation.

Machine results use resultVersion 1 and exact command identity. The embedded component
report is **statusVersion 3**, scope `configured-component-evidence`, and contains
`generatedAt`, project `revision`, root-independent `inputDigest`, independent `evidence`
records and source-derived `policies`. No synthetic highest-earned-claim ladder is emitted.
The previous consumer-owned version-2 aggregation is not silently accepted as version 3.

## Independent evidence scopes

- **story-coverage**: product `storybook proof check` rederives required-kind coverage from
  actual inventory/spec/TS/TSX sources and rejects stale or forged stored coverage.
  This is `static-story-reference-coverage`, **not test execution**. It cannot by itself
  establish all implementation behavior, accessibility or runtime correctness.
- **visual-review**: product status validation binds inventory/version, current Git SHA,
  component/story/tier selection, configured review policy and freshness. Only `passed`
  satisfies this evidence requirement. `changed`, `failed` and `deferred` stay distinct
  unmet states; malformed/stale/mismatched evidence is invalid. The artifact's
  required-for-claim field must match Chromatic configuration, but cannot alter the
  independently configured component profile requirements.
- **figma-publication**: existing ledger validation and proof binding are reused, including
  configured artifact/profile/proof agreement. A ledger that points at another proof is
  rejected before that path is opened. This scope is `publication-ledger-conformance`:
  current/satisfied means what the validated, bound record attests, not a newly performed
  live Figma inspection or proof that current token sources have no drift. The token
  governance pipeline and actual plugin/live verification remain independent obligations.

A profile can require any applicable combination; one dimension never enrolls components
or silently substitutes for another. Recipe validity remains the separate intrinsic
recipe/token validation workflow. This command does not introduce a recipe registry.

## Integrity and migration

Inputs, configuration, source directories, selected evidence records and Git HEAD are
snapshotted before/after evaluation. Report/config/source/install/lock path overlaps,
links and oversized reads are refused. Report writes detect concurrent input or output
changes and preserve previous bytes on refusal. This is local race detection, not a
hostile-OS sandbox or a signed provenance service; trusted workflows must produce honest
review and publication evidence in the first place.

Consumers must use the explicit `promote` command to enforce promotion policy, not infer
approval from a successful status generation or integrity check. CI must select a reviewed
profile/consumer directly. The former unknown-change-class/advisory fallback is not retained.
GitHub summary presentation may consume this result, but is not product policy authority.

Canonical consumer wrapper removal, workflow/profile migration, remaining authoring
instructions, real consumer integration and live verification are separate required
cutover steps. These source and fixture tests do not claim those steps are complete.
