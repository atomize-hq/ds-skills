# Token governance

`tokens govern --config <project.json> [--root <directory>] [--json]` and
`governTokenProject({ project })` run the product's fixed pipeline. They do not
execute consumer scripts, load arbitrary plugins, invoke pnpm, discover ambient
configuration, publish into Figma, or rewrite publication evidence.

Enable it under `tokens`, alongside the existing source/build configuration:

```json
{
  "manualEditGuard": null,
  "runtimeChecks": null,
  "governance": {
    "publication": {
      "config": "figma/token-sync.config.json",
      "baseline": "figma/token-rail.baseline.json",
      "ledger": "figma/sync-ledger.json",
      "profile": "design/publication-profile.json",
      "proof": "figma/publish-proof.json"
    }
  }
}
```

This example explicitly disables optional runtime obligations, not token
validation or artifact checking. Consumers needing those obligations configure
`manualEditGuard` and `runtimeChecks` as documented in [the token guide](README.md).
For governance, both keys must be explicitly present (object or null); omission
is an error, not an implicit skipped gate. `governance.publication` is similarly
required and explicitly null when publication is not configured. If selected,
all five project-relative publication paths are required. A missing selected
input fails rather than downgrading publication to an optional capability.
Omitted/null `governance` means this command cannot evaluate the project.

## Execution and failure contract

The order is fixed:

1. Canonical token/theme/recipe validation.
2. Configured Git manual-edit guard, if selected, **before regeneration**.
3. Complete token build using the product writer and its lock.
4. Configured runtime property/import checks, if selected.
5. Exact regeneration/freshness comparison for all four artifacts.
6. Configured Figma mapping verification against the reviewed baseline.
7. Configured ledger validation and publication identity checks.
8. Configured ledger parity policy.
9. Configured standalone publish-proof validation.

Steps 6–9 run together only when publication is selected. The report lists actual
executed steps, explicit capability selections and the first failed step. It
never adds synthetic passing entries for disabled capabilities. Exit 0 means all
selected local checks passed; 1 is evaluated nonconformance; 2 is cannot-evaluate;
3 is unexpected failure. Execution stops on every failure. Codes 2/3 print no
partial aggregate result to stdout. Earlier build writes may already have
occurred; absence of a result is not a rollback claim.

Publication checks consume the **artifact just built**, not a separately selected
artifact or network response. The reviewed profile must describe that same output.
When a ledger binds a proof, it must bind the exact proof path selected by this
configuration; even an identical copy at another path does not qualify. A ledger's
own evaluation is retained as a nested result, distinct from governance's added
project-identity constraints. Recorded proof digests are checked, never recomputed
to make drift disappear. Publication input files are protected from all token
output/lock destinations.

## What a passing result means

Intrinsic recipe validity is not component readiness. A structurally valid ledger
can report a blocked or stale publication state; that does not retroactively
invalidate recipes. The separate parity step applies the consumer's declared
publication policy. Do not use the aggregate result as an unconditional
`promotable` flag or claim of observed remote synchronization.

The pipeline fingerprints canonical sources, configuration and selected runtime,
pin and publication inputs around its steps. After building it also fingerprints
all artifacts. A change during the run invalidates the aggregate answer instead
of certifying a mixture of states. Missing later inputs are fingerprinted as
missing, allowing an earlier recipe/source rejection to keep its correct place in
the execution order. Unsupported symbolic snapshot inputs or unreadable state
cannot be evaluated. This is local drift detection, not a distributed transaction
or a lock against arbitrary editors; the per-file build atomicity and cooperative
locking limits still apply.

The built release is tested as two differently configured installed consumers,
including intentionally wrong baseline values, proof bytes and missing inputs.
That synthetic matrix does not replace actual consumer integration, second-consumer
portability, independent review, live plugin publication, or final release/landing.
