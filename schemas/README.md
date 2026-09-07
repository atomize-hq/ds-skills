# Schemas

Five JSON Schemas describing the artifacts this skill pack's workflow produces. They are the
portable half of the pack: the shapes travel to any repo, the values do not.

| Schema                                  | Artifact it describes                     |
| --------------------------------------- | ----------------------------------------- |
| `storybook-version-policy.schema.json`  | The declared Storybook baseline           |
| `storybook-tier-policy.schema.json`     | Which tiers exist and what each owes      |
| `storybook-component-spec.schema.json`  | Per-component contract + design↔code link |
| `storybook-story-inventory.schema.json` | Repo-wide registry of implemented stories |
| `sync-ledger.schema.json`               | State of the token → Figma publish rail   |

Where a consumer keeps each artifact is the consumer's business — it passes the path in.

## The portability contract

A schema here describes **shape**. Anything that is one repo's vocabulary is marked
`"x-repo-profile": "<name>"` and left deliberately loose — an open string, or an enum a repo is
expected to narrow. A consumer writes a profile supplying its values for those names, and changes
nothing here. `../profiles/example.json` is a worked example; its vocabulary is deliberately
unlike any real consumer's, so a test using it fails if a consumer's values have been baked into
the validator.

```bash
# shape only — what any repo must satisfy
ds-skills validate sync-ledger.schema.json <path-to-ledger>

# shape + the consumer's vocabulary
ds-skills validate sync-ledger.schema.json <path-to-ledger> --profile <path-to-profile>
```

Current extension points:

| `x-repo-profile`      | Where                                  | What a new repo changes                 |
| --------------------- | -------------------------------------- | --------------------------------------- |
| `tier-policy`         | component spec `tier`                  | The tier names it uses                  |
| `tier-names`          | tier policy `tierOrder`                | Same list, machine-readable             |
| `consumer-ids`        | tier policy `consumerScope`            | How it names downstream consumers       |
| `generated-artifacts` | component spec `generatedArtifactRefs` | Its own set of generated proof surfaces |
| `artifact-path`       | ledger `artifact.path`                 | The artifact its publish rail moves     |
| `publish-modes`       | ledger `publish.mode`                  | The rails it actually has               |
| `promotion-levels`    | ledger `promotion.highestEarnedLevel`  | Its own promotion ladder                |

Porting the pack means writing a new file in `../profiles/`. It should not mean editing anything
in this directory.

## What these schemas do not check

Shape is not the whole contract. Rules that need more than one field, the filesystem, or another
file are documented in `description` here but enforced only by a repo's own validators:

- story-inventory `validatorKinds` must be in canonical `storyKind` order, and its set must equal
  the set of `implementedStoryRefs[].kind`
- component-spec `componentId` must equal the spec's filename stem
- component-spec `requiredStoryKinds` must be a superset of the tier policy's minimum for that tier
- every `storyId` in a spec must exist in the story inventory, and vice versa
- tier-policy `tiers` keys must match `tierOrder` exactly
- ledger `verification.lastVerifiedRevision` must equal `artifact.revision` to count as current

Those live in this package's own validators (`src/figma/`, `src/validate/`), and they are the
authority. **These schemas are a second opinion, never the gate.** If one disagrees with a
validator, the validator is right and the schema needs updating — the authority relationship is
unchanged by the move; only its address is.
