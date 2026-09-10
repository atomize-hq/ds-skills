# Token compiler and artifact checks

The `family-files-v1` source adapter and `tokens-studio-css-v1` compiler are explicit,
not arbitrary build plugins. See [project configuration](../project/README.md).

`renderTokenArtifacts({ project })` regenerates staged CSS, published runtime CSS,
the typed module (theme registry/maps and recipes), and the Figma document **in
memory**. It reads source/configuration/compatibility data, but never writes an
artifact, changes cwd, or discovers an ambient formatter configuration.

The compiler uses pinned Style Dictionary 5.3.3, Tokens Studio transforms 2.0.3,
and Prettier 3.8.1. It preserves composite expansion, math, CSS transforms and
sorting rather than approximating their output. Product build prebundles the
compiler; the installed release needs Node, not dependencies or a bundler.
Only CSS compilation and TypeScript formatting are exposed by this adapter.
A theme must compile to the same variable names as the default; adding/removing
variables per theme is rejected rather than generating an invalid nested reset.
The runtime projection accepts one root block of single-line custom-property
declarations with comments. Unsupported or duplicate declarations fail rather
than being silently dropped. Default-theme resets support nested themed subtrees.

Build selection is the optional `tokens.build` object (absent/null means not
configured). Once selected, all fields are required:

```json
{
  "compiler": "tokens-studio-css-v1",
  "banner": "Generated design data. Do not edit.",
  "formatting": {
    "semi": true,
    "singleQuote": true,
    "tabWidth": 2,
    "trailingComma": "es5",
    "printWidth": 100
  },
  "runtime": {
    "themeAttribute": "data-theme",
    "identicalThemes": "error",
    "compatibility": null
  },
  "outputs": {
    "stagedCss": "generated/source.css",
    "runtimeCss": "ui/design.css",
    "typescript": "generated/tokens.ts",
    "figma": "generated/figma.json"
  },
  "lockPath": ".cache/design.lock"
}
```

`identicalThemes` is `error` or `allow`. Compatibility is explicitly null or an
object containing project-relative `inventory`, `aliases`, and a `categoryLabels`
map. Version-1 inventory/alias documents must align uniquely; aliases must target
the default theme and existing canonical CSS variables, must not shadow canonical
variables, and use preserve/alias/rename-with-migration actions. Compatibility
aliases are repeated on each theme subtree so `var()` resolves in its local scope.

`tokens artifacts check --config <project.json> [--root <dir>] [--json]` calls this
same renderer and compares **all four artifacts byte-for-byte**. Exit 0: current;
1: missing/stale artifacts or evaluated invalid token/runtime input; 2: cannot
evaluate configuration or required files; 3: unexpected failure. Codes 2/3 produce
no stdout result. The check never repairs output, writes a lock, or certifies
component readiness or Figma publication. `lockPath` reserves the configured build
writer location. The build command uses it; the read-only check never does.
Consumer command cutover is still a separate extraction checkpoint.

## Bundled dependency notices

The release carries `dist/tokens/THIRD-PARTY-NOTICES.txt`, retained source legal
comments, and compiler build metadata. Notice generation records published
license files, embedded source headers, and a digest-pinned upstream license
supplement where the package omitted it. The four bundled-es-modules mirrors and
path-unified publish only license/author declarations; those exact declarations
are retained without invented copyright text. Supplementary upstream notices are
collected for embedded module names from the pinned development dependency tree.
This is not a complete original-version SBOM for opaque prebundled mirrors and is
not a legal approval. New unrecognized license-file omissions fail the build;
these declared upstream omissions remain explicit review inputs before release.

## Build writer

`tokens build --config <project.json> [--root <directory>] [--json]` and the
`buildTokenArtifacts({ project })` API use the same renderer as freshness checks.
A build requires a project returned by `loadProject`, still matching the live
configuration. The command reports versioned per-artifact written/unchanged
statuses. Exit 0: built; 1: evaluated invalid token/runtime input; 2: cannot evaluate
configuration, lock or filesystem writes; 3: unexpected runtime failure. Codes 2/3
emit no stdout result. Explicit build can replace stale generated output; the
read-only check never does.

Before creating locks/output directories, the writer checks the complete target
set. Outputs, lock and coordination guard must be distinct, non-nested, inside the
project, outside input directories, and disjoint from the project config and
compatibility inputs. Source/recipe/theme directories are read-only inputs and
cannot double as output directories. Symlinks below the project root are refused
on write paths, including links to another directory inside the same project.
Invalid, wrong-kind or unwritable destinations fail before publishing output.

Builds serialize on the configured directory lock. Under ownership, the complete
source/configuration snapshot is checked around rendering and again after staging;
changed inputs abort pending publication. All changed files are staged before any
rename. Each rename is atomic, **not the four-file set as a transaction**: a crash
or filesystem failure partway through publication can leave a subset updated and
must not be reported as success. A subsequent explicit build repairs that state.
Unchanged bytes preserve mtimes; replacements preserve existing file permission
bits instead of widening a restrictive artifact mode. Temporary files are uniquely created and cleaned
up; no recursive deletion of arbitrary output directories occurs. Local cooperative
processes are supported, not a distributed lock on a shared/network filesystem or
protection against a hostile actor concurrently replacing filesystem ancestors.

The product's version-2 directory lock serializes claim/recovery/release metadata
operations with an exclusive, short-lived coordination guard. Dead ordinary owners
are recovered; live owners are never stolen because a timestamp looks old. An aged
uninitialized ordinary lock can also be recovered. Unexpected contents or symbolic
links fail closed, without recursive deletion. A dead/abandoned coordination guard
is deliberately **not auto-removed**: concurrent recovery of that guard would
reintroduce the ownership race. The error identifies the exact guard for manual
inspection. Stop all builds and verify no owning process is alive before manually
removing an abandoned guard. Do not remove a live guard to make a timeout pass.
Mixed old/new locking protocols running against one output set are not supported;
consumer cutover must stop old build processes and use one pinned installation.

## Runtime obligations and manual-edit policy

`tokens runtime check --config <project.json> [--root <dir>] [--json]` checks
explicit consumer compatibility obligations, without regenerating output:

```json
{
  "runtimeChecks": {
    "compatibilitySurface": "design/runtime-surface.json",
    "imports": {
      "format": "css-import-v1",
      "entries": [{ "file": "app/global.css", "specifier": "../ui/theme.css" }]
    }
  },
  "manualEditGuard": {
    "policy": "git-input-dirty-v1",
    "generatorInputs": ["ds-skills.release.json"]
  }
}
```

These fields belong under `tokens` alongside `build`. Each capability may be
omitted/null (not configured). If `runtimeChecks` is selected, both fields must
be present, with null explicitly disabling one; disabling both is rejected.
The surface is project-owned data with `surfaceVersion: "1"`, `runtimeCssPath`
bound to the configured runtime output, and a nonempty, unique
`requiredCustomProperties` list. Every import specifier must resolve to that same
output. Unsupported formats, path escapes, duplicate imports and self-imports
fail configuration evaluation. Selected missing/wrong-kind inputs fail closed.
The writer protects these obligation files and generator pin inputs from output
or lock overlap, just like its canonical source inputs.

The CSS adapter checks declaration presence in generated, one-declaration-per-line
CSS, ignoring comments, strings and `var()` references. It is not a general CSS
validator and does not prove values, theme behavior, build freshness or browser
rendering. Import obligations require quoted, unconditional, top-level `@import`
statements; `url()`, conditional/media imports and nested imports do not qualify.
Comments and quoted text cannot satisfy an import obligation. Consumer integration
and browser tests remain necessary. The check reports only selected obligations;
it does not manufacture passing entries for disabled capabilities.

`tokens guard --config <project.json> [--root <dir>] [--json]` runs **before**
regeneration and requires Git. The named policy preserves the existing heuristic:
reject a dirty runtime artifact only when its canonical token/theme/compatibility
inputs, project config and configured generator pin inputs are all clean. It
includes staged, unstaged and ordinary untracked changes. A change to unrelated
application data cannot excuse runtime edits. Paths are literal and status is
NUL-delimited; nested project roots, renames and unusual filenames are supported.
Ignored untracked runtime output cannot be evaluated. Ambient `GIT_*` overrides
cannot redirect this check to another repository/index, and optional index-refresh
writes are disabled.

This is **not provenance or freshness proof**: simultaneous source/pin dirt can
coexist with an unrelated hand edit. The separate `tokens artifacts check` compares
all generated bytes. The guard does not validate a release pin's digest or install
it; that is the installation trust chain's responsibility. Generator inputs may
not contain/overlap the output they are supposed to explain.

Both commands return 0 for evaluated success, 1 for evaluated nonconformance, 2
for cannot-evaluate, and 3 for unexpected failure; 2/3 emit no stdout result. The
old consumer manual-edit wrapper used exit 2 for an evaluated failure; the product
normalizes it to its established 0/1/2/3 contract. Governance still stops on any
nonzero result. Neither command asserts component readiness or Figma publication.
Consumer CLI/governance cutover and deletion of old implementations remain a
separate required checkpoint, not a permanent compatibility layer.

The [fixed governance pipeline](governance.md) composes these checks with configured
publication verification, preserving first-failure behavior and separate state meanings.
