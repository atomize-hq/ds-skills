# Portable schema contracts

These schemas describe shape. Consumer vocabulary, artifact paths, library selections
and status live in consumer configuration/data, not in edits to installed schemas.

| Schema                                  | Artifact                                         |
| --------------------------------------- | ------------------------------------------------ |
| `component-recipe.schema.json`          | Intrinsic recipe shape                           |
| `storybook-version-policy.schema.json`  | Declared Storybook version/import baseline       |
| `storybook-tier-policy.schema.json`     | Explicit tiers, consumers and story obligations  |
| `storybook-component-spec.schema.json`  | Component contract and optional design reference |
| `storybook-story-inventory.schema.json` | Implemented story identities/kinds               |
| `sync-ledger.schema.json`               | Token artifact publication record                |

Use the verified project launcher with `validate <schema-name> <artifact-path>` for
shape checks. Optional `--profile <profile-path>` supplies the consumer's reviewed
restrictions for `x-repo-profile` extension points. A profile is a JSON object
mapping extension-point names to schema fragments, for example
`{ "tier-policy": { "enum": ["primitive", "interactive"] } }`. These names are
illustrative, not required defaults. Read installed command help for flags and the
selected schema for extension points; keep the profile at the consumer's chosen location.
Do not modify the shared release or assume a sibling product checkout exists.

Extension points include tier/consumer names, generated-artifact names and publication
artifact path/mode/promotion vocabulary. These are schema restrictions, not automatic
readiness requirements. The publication ledger does not enroll components for recipe
use or record per-component review.

## Run the behavioral commands too

- `recipes validate` also checks filename identity, intrinsic axis/default/slot/state
  relationships and token references. `tokens validate` uses configured sources.
- `storybook policy validate` checks inventory kind/reference consistency, version
  policy, exact tier keys/order and explicit consumer scopes. Tier policy version 2
  requires deliberate migration from older data, not a silent validation rewrite.
- `storybook proof validate/build/check` links specs, inventory and supported actual
  story source. This is static coverage, not executed interaction or a11y evidence.
- Component evidence/status and promotion commands apply separate configured profiles.
  No schema or generated report replaces actual execution/review obligations.
- `ledger validate/parity` and `proof validate` check the bound publication record and
  artifact relationship. They do not perform a new live Figma synchronization.

The [installed workflow contract](../skills/stack-orchestrator/references/project-contract.md)
explains command scopes and failure handling. A shape-only pass is insufficient when
cross-file/source rules apply. If schema and command behavior disagree, investigate
and fix the product contract rather than choosing whichever result is green.
