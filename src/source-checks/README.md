# Configured source checks

These read-only commands own the reusable checks; the consumer owns source paths,
module prefixes, slot conventions, and policy rules. Neither command downloads
upstream code, modifies components, establishes readiness, or publishes to Figma.

```sh
ds-skills sources policy check --config project.json --json
ds-skills sources contract check --config project.json --json
```

Add `sourceChecks` to the version-1 project configuration (either subcheck may be
`null`, but both keys must be present when this section is configured):

```json
{
  "sourceChecks": {
    "policy": {
      "file": "component-policy.json",
      "extensions": [".tsx"],
      "recursive": false,
      "timeoutMs": 2000
    },
    "contract": {
      "adapter": "ts-named-imports-slots-v1",
      "providers": [
        {
          "id": "widgets",
          "root": "packages/widgets/src",
          "modulePrefix": "@workspace/widgets",
          "entrypoint": "index"
        }
      ],
      "consumers": ["features"],
      "recursive": true,
      "slots": { "mode": "filename-prefix", "owners": {} }
    }
  }
}
```

## Text policy

The existing policy-version-1 document retains `invariants` (directory scopes),
`deviations` (exact files), and `contracts` (exact files). Rules have unique `id`,
`reason`, optional `instead`, and `require`/`forbid` regular-expression arrays;
contracts permit only `require`. Optional `upstream` is a string-valued provenance
map, not a network authority or proof of current upstream contents. Empty/missing
exact scopes fail; inaccessible directories cannot be evaluated.

Patterns match source text, including comments. This preserves the existing text
policy semantics and is not an AST or behavioral guarantee. Evaluation runs in a
bounded disposable worker; timeout is an inability to evaluate, never a pass.

## Static module and slot contract

The bundled TypeScript parser reads selected TS/TSX files without executing them.
Configured provider prefixes resolve to root-relative module filenames; an explicit
`entrypoint` handles imports from the bare package prefix (`null` rejects them).
This is a syntax-level declared export check, **not** a TypeScript typechecker or
module resolver: named reexports are recorded as declarations, not transitively
verified. Pair this gate with the consumer's typecheck/build/tests. Inline, default,
and export-list declarations and named/default imports are supported. Type-only
exports cannot satisfy runtime imports. Wildcard-dependent bindings, selected
namespace/dynamic/CommonJS imports, ambiguous module files, and unsupported source
syntax cannot be evaluated rather than silently passing.

With `filename-prefix`, literal slot selectors in value strings are checked against
literal JSX `data-slot` declarations. The longest component filename prefix owns
a slot; duplicate owners fail instead of selecting whichever file was scanned last.
`owners` maps exact slot names to explicit selected source files. A declaration in
an unrelated file does not satisfy the owner. Comments and JSX prose do not count
as declarations. Dynamic selected slots/selectors are unsupported. This adapter
checks recognizable literal selector syntax, not arbitrary CSS, runtime object
spreads, or DOM behavior. `mode: "off"` explicitly disables this convention while
retaining configured API checks; it is not a general slot-validation pass.

## Results and bounds

- Exit 0: evaluated policy/static contract passed.
- Exit 1: evaluated rules failed; JSON includes diagnostics and input digest.
- Exit 2: cannot evaluate (configuration/input/unsupported syntax/timeout); no
  result JSON is emitted.
- Exit 3: unexpected runtime failure.

Scopes are `source-text-policy` and `static-module-slot-contract`. No result is a
recipe validity, test execution, component promotion, or publication receipt.
Inputs are recaptured to reject changes during evaluation. Sources are confined to
the configured root, reject symbolic links, and are bounded to 2 MiB per file,
16 MiB aggregate, 10,000 files, 20,000 scanned directory entries and depth 64.
Story/test/spec files are excluded. Regex timeout is explicitly 10–10,000 ms and
reported diagnostics are bounded. These limits are not an OS security sandbox.
