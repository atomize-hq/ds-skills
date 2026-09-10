# Static Storybook proof tooling

The product owns spec validation, a bounded CSF source indexer, reference linkage,
coverage generation and the required-kind gate. These are not test runners or Figma
publication checks. The explicit report scope is `static-story-reference-coverage`.

Add `proof` to the project's existing `storybook` capability:

```json
{
  "proof": {
    "adapter": "csf-ts-v1",
    "storyRoots": ["packages/ui/src", "review/stories"],
    "componentSpecs": "review/component-specs",
    "generatedArtifactKeys": ["guidance", "runtimeExamples"],
    "coverage": "artifacts/storybook/proof-coverage.json",
    "lockPath": ".ds-artifacts/locks/storybook-proof.lock",
    "formatting": { "printWidth": 100, "tabWidth": 2, "useTabs": false }
  }
}
```

All paths are project-relative, confined by the project loader. Roots must exist.
Artifact key names are required configuration, not hardcoded token/recipe categories;
an empty key list permits no generated surfaces. Every spec must have exactly the
configured key set, with each value null or a normalized relative story-source path.
The portable spec schema validates value shapes without assuming a consumer key set.
An omitted/null proof capability cannot satisfy any of the commands below.

## Commands and results

Each accepts `--config <project.json> [--root <dir>] [--json]`:

- `storybook proof validate`: read-only structure check. Validates the three policies,
  each component spec, source index, tier minima, reciprocal spec/inventory references,
  owned kind agreement, examples and generated story surfaces. Missing _coverage_
  kinds appear in the returned coverage but do not make a structural check fail.
- `storybook proof build`: regenerates coverage and applies required-kind gating.
  Missing required kinds generate an accurate failing report and exit 1. Invalid
  structure does not overwrite a previous report. An existing report is not accepted
  merely because its `ready` counts say so: all facts derive anew from source inputs.
- `storybook proof check`: read-only required-kind gate plus exact stored report
  freshness against current regenerated content. Missing/malformed/stale/edited
  report bytes cannot pass, even if their own status fields claim success.

Exit 0 is the stated evaluated pass; 1 is evaluated nonconformance. Unconfigured,
missing, unreadable, unsafe or unsupported input layout is exit 2 with no machine
result. Unexpected internal/runtime errors are exit 3 with no result. Supported
source syntax that cannot be indexed declaratively is diagnosed as nonconformant,
not silently skipped. `--json` results use resultVersion 1 and exact command identity.

Coverage **version 2** adds the explicit static scope. Existing version 1 reports must
be regenerated, and consumers of that schema must migrate deliberately. `ready` in
this report means only that every configured required kind has a structurally valid
story reference. It does not establish behavior, a11y, visual or publication success.
An empty inventory/spec set has zero covered components, not proof about any component.

## Source adapter limits

`csf-ts-v1` bundles TypeScript 5.9.3 and the upstream `@storybook/csf` 0.1.13 naming
helpers. Sources are never imported or executed. No installed consumer dependency,
network lookup, bundler, or formatter plugin is needed at runtime. Prettier 3.8.1 is
bundled for deterministic report formatting; only the three declared options are
accepted (defaults match the example). Runtime library notices accompany the bundle.

- Recursively indexes regular `*.stories.ts` and `*.stories.tsx` files in explicit
  roots. Other `.stories.*` extensions and symlinked entries fail rather than disappear.
- Supports literal metadata title/id, local identifier aliases and TypeScript wrappers;
  local exported variables/functions; literal string-array or regex export filters.
  `__namedExportsOrder` is reserved metadata, not a story. Ordinary exported names
  are classified using CSF filters, not a project-specific exclusion list.
- Rejects cycles, unresolved/dynamic metadata, metadata spreads/computed keys, runtime
  export lists/re-exports/destructuring, explicit top-level expression mutations,
  runtime `__id` overrides, invalid syntax and duplicate derived IDs.
- This is static source-contract validation, not a full JavaScript evaluator or the
  runtime Storybook index. It does not infer automatic titles, imported meta, framework
  transforms or arbitrary runtime side effects. Different source formats require a
  separately implemented adapter, not a renamed setting that claims universal support.

Upstream semantics: [CSF exports and filters](https://storybook.js.org/docs/9/api/csf).
The naming helpers are pinned independently of the consumer's declared Storybook
version; dependency/version conformance and browser execution remain separate checks.

## Safe generation

Build preflights output/lock paths against configured inputs and each other before
locking. It uses the shared product owner-aware directory lock, rechecks inputs under
that lock, formats without ambient config, stages one file and publishes by atomic
rename after source/output checks. Healthy regeneration preserves bytes and mtime.
Symlink outputs/parents, overlapping source/write targets and concurrent source drift
are refused. Temporary files are cleaned on failure. This is not a hostile-OS sandbox;
use normal filesystem ownership and do not run incompatible old/new writers together.

## Extraction status

The installed command is exercised against synthetic consumers; real consumer cutover
must additionally migrate policy version, spec key configuration, coverage readers,
commands, CI and application integration tests. Do not delete the existing consumer
implementation merely because this module exists. Later promotion/review tooling must
use these static findings alongside, not in place of, legitimate execution evidence.
