# Storybook policy boundary

`ds-skills storybook policy validate --config <project.json> [--root <dir>] [--json]`
validates the configured inventory, tier policy and version-policy JSON structures.
Paths are explicit project data, resolved against the config directory unless a
project root is supplied. No consumer dependencies or ambient Storybook are loaded.

```json
{
  "projectVersion": "1",
  "tokens": null,
  "storybook": {
    "format": "csf-policy-v1",
    "inventory": "review/story-inventory.json",
    "tierPolicy": "review/component-tier-policy.json",
    "versionPolicy": "review/storybook-version-policy.json"
  }
}
```

Omitted/null `storybook` is unconfigured, not a passing Storybook evaluation. Existing
token-only configs remain valid. All three paths are required for this capability.
Unknown configuration keys, escaped paths, missing/unreadable/non-regular inputs
produce exit 2 and no result. Malformed input JSON or nonconformant structures produce
exit 1 with diagnostics. Exit 0 means only the stated structural checks passed.

## Policy contracts

- Inventory version 1 preserves unique component IDs, known ordered validator kinds,
  unique kind/story references and exact agreement between declared/implemented kinds.
  Empty inventories are structurally valid; they do not establish proof coverage.
- Tier policy version **2** defines `tierOrder`, `consumerIds`, and exactly the `tiers`
  listed in that order. Each tier preserves nonempty required kinds with purposes,
  explicit optional kinds, full known-kind classification, no duplicates/overlap,
  and nonempty unique `consumerScope` drawn from the declared consumers. Arbitrary
  component libraries, consumer IDs and tier names are supported. This is not a
  per-component enrollment list or a recipe schema mirror.
- The 13 proof kinds remain a product-owned vocabulary for the CSF proof contract;
  arbitrary unsupported validator kinds are rejected rather than treated as proof.
- Version policy preserves exact stable Storybook version, framework, addon and
  required import fields. Addon names must also be nonempty and unique. Documented metadata fields are checked against the shipped version-policy schema;
  unknown fields are rejected. This command does not
  resolve installed dependencies or prove that the declared imports exist.

Version 1 tier policies are **not silently reinterpreted**. Migration must set version
2 and declare the real consumer IDs, retaining existing tier definitions, minima and
order. There is no built-in list of project-specific thread IDs. Prior diagnostic identifiers
are retained for traceability, not as project configuration.

## Not proven here

This command does not inspect CSF source, component specs, stories in a browser,
coverage reports, installed package versions, or Figma state. Spec/story linkage and
coverage generation are separate commands; execution and publication remain separate gates.
The existing consumer gate remains authoritative until its installed replacement is
verified; adding this command alone is not consumer cutover or P4 completion.

For product-owned spec/source linkage and coverage generation, see
[static proof tooling](proof-README.md). Those commands are separate from this
policy-only check and carry their own declared evidence scope.
