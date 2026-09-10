# Project configuration

`loadProject(configPath, { rootDir? })` reads project data, never executable
plugins. The default project root is the config's directory; `--root` selects an
explicit root when configuration is nested. Product release identity and pins
are a separate installation contract.

The root contract supports `tokens`, `storybook`, `components`, `sourceChecks`,
`foundations`, `libraries`, `registries`, and `curation`. `tokens` must be configured
or explicitly `null`; token commands return cannot-evaluate when disabled, not a
passing empty run. The other capabilities are optional and validated when configured.
Unknown fields, omitted token capability selection, unsupported source formats, path
escapes and existing symlinks outside the project root are rejected.

See the [token compiler](../tokens/README.md), [Storybook policy](../storybook/README.md),
[component contracts](../components/README.md), [source checks](../source-checks/README.md),
[foundations](../foundations/README.md), [library evidence](../libraries/README.md),
[registry snapshots](../registries/README.md), and [curation](../curation/README.md)
for each capability. The example below enables only tokens.

```json
{
  "projectVersion": "1",
  "tokens": {
    "format": "family-files-v1",
    "sourceDir": "design/source",
    "recipesDir": "ui/recipes",
    "extensionsNamespace": "dev.example.design",
    "themes": {
      "registry": "design/modes/list.json",
      "directory": "design/modes"
    },
    "figma": { "excludedFamilies": ["private"] }
  }
}
```

Paths are project-relative. Source discovery recursively selects regular
`<family>.tokens.json` files, with unique lowercase kebab-case family names. The
configured theme directory is excluded, regardless of its folder name. Symlinks
inside the canonical source directory are rejected rather than followed.

The theme registry supplies `registryVersion: "1"`, `defaultThemeId`,
`terminalFallbackThemeId`, `unknownThemeIdBehavior: "error"`, and a nonempty
`themes` array. Entries have unique IDs, a relative `file`, a boolean `required`,
and `extends` naming another theme or `null`. Default/fallback IDs must name required themes,
and every inheritance chain must terminate without cycles or unknown parents.
Each theme document declares its ID under the configured `$extensions` namespace.
Overrides may only address source-defined token families.

Explicit and group-inherited token types are supported. Materialization resolves
references, including nested value objects/arrays, and rejects unknown or cyclic
references. References in source declarations remain checked even if a theme
overwrites their values. These are graph checks; token value semantics and CSS rendering are
not certified merely by passing them. The adapter is not a universal loader for
arbitrary token formats or executable source modules.

Recipe discovery uses the product's shared regular-file selector. `recipesDir`
may be explicitly `null`; otherwise an absent directory fails. Every recipe must
pass intrinsic validation against each materialized theme's token inventory.
No separately maintained component enrollment index is consumed.

`tokens validate --config <file> [--root <dir>] [--json]` evaluates all registered
themes. Exit 0 means evaluated source/graph/recipe checks passed; exit 1 reports
invalid token inputs; exit 2 means configuration/capability could not be evaluated.
It writes no files and does not claim a current build or Figma publication.

The graph API additionally projects a Figma document with configured family
exclusions and theme overrides, and typed-module theme-override maps. Figma
exclusions do not remove canonical tokens or recipe eligibility. The [compiler and artifact check](../tokens/README.md) provide complete in-memory
rendering, configured runtime compatibility and serialized output writing.
Consumer command cutover and removal of duplicate implementations remain separate
extraction work.

The [token governance contract](../tokens/governance.md) explicitly selects runtime
and publication obligations and runs the product-owned fixed pipeline.
