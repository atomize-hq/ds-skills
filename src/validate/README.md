# Installed shape validation

Use the exact installed product through the generated launcher. The package resolves a shipped
schema by name, so consumer docs never reach into an internal `.agents` or install-prefix layout.

```sh
node .ds-skills/project.mjs validate <shipped-schema-name> <instance.json> [--profile <profile.json>]
# Example:
node .ds-skills/project.mjs validate sync-ledger figma/sync-ledger.json --profile profile.json
```

A path remains valid only for a consumer-owned schema. `validate-artifact.mjs` is an internal
implementation detail of the installed CLI, not the documented consumer command.

## What it is for

A repo that has adopted the schemas but has not yet written its own tooling, and hand-authored
files you want to shape-check before committing.

## What it is not for

Replacing application-specific validators. It checks shape only — it cannot see cross-field rules,
the filesystem, or other files, and [the shipped schema guide](../../schemas/README.md) lists exactly what it therefore misses.

**A shape pass is not a semantic/publish pass.** This product ships semantic token-rail commands;
run them through the same verified launcher when the consumer has supplied its profile and
applicable proof:

```sh
node .ds-skills/project.mjs ledger validate --ledger <path> --profile <path>
node .ds-skills/project.mjs ledger parity --ledger <path> --profile <path>
node .ds-skills/project.mjs proof validate --proof <path> --profile <path>
node .ds-skills/project.mjs storybook policy validate --config <project.json>
```

The shipped v3 ledger starter is deliberately `not-run` with deferred parity and no `publication`:
it shape-validates but grants no materialization, publication, promotion, or readiness claim. Once
a materialization attempt is recorded (`passed` or `failed`), v3 requires a publication binding to
an exact proof digest; `ledger validate` and `ledger parity` additionally need the consumer profile
to evaluate consumer vocabulary and proof applicability. Consumer-specific application validators
may add obligations, but they do not turn the starter's placeholder into evidence.

This directory previously held three forks of those validators. They drifted for six months,
ended up asserting a schema the repo had abandoned, and crashed on the repo's own artifacts.
One generic validator driven by the schemas cannot drift that way: if a schema is wrong, the
error shows up the first time it is run against a real file.

## Supported keywords

`type` · `enum` · `const` · `required` · `properties` · `additionalProperties` · `items` ·
`minLength` · `minItems` · `minProperties` · `uniqueItems` · `pattern` · `oneOf` · `anyOf` ·
`allOf` · `not` · `if`/`then`/`else` · local `$ref`

An unsupported keyword is reported as an error rather than silently ignored, so a schema can
never quietly pass because the validator did not understand it.
