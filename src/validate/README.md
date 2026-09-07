# Scripts

One script: `validate-artifact.mjs`, a dependency-free validator for the JSON Schema subset used
in `../schemas`.

```bash
node validate-artifact.mjs <schema.json> <instance.json> [--profile <profile.json>]
```

## What it is for

A repo that has adopted the schemas but has not yet written its own tooling, and hand-authored
files you want to shape-check before committing.

## What it is not for

Replacing a repo's own validators. It checks shape only — it cannot see cross-field rules, the
filesystem, or other files, and `../schemas/README.md` lists exactly what it therefore misses.

**Where a repo has its own semantic validators, those are the gate, not this.** This one sees
shape; they see cross-field rules, the filesystem and referential integrity. For the token rail
specifically, the semantic gate ships in this package as its own commands:

```bash
ds-skills ledger validate --ledger <path> --profile <path>
ds-skills ledger parity   --ledger <path> --profile <path>
ds-skills proof validate  --proof  <path> --profile <path>
```

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
