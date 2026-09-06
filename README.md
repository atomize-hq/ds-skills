# @atomize-hq/figma-token-rail

Publish a [DTCG](https://tr.designtokens.org/) token artifact into Figma variables, and check a
Figma file for drift against it.

**The repo is canonical.** Nothing here ever writes Figma's state back into token sources. A
value someone changed inside Figma surfaces as a reviewable finding, not a silent commit.

## What you get

- **A Figma plugin** with two actions — _Sync Variables_ (write) and _Check Drift_ (read-only).
- **A pure comparison core** you can call from CI or a script: `buildExpectedVariables`,
  `compareFigmaVariables`, `formatDriftReport`. No Figma API dependency, so it unit-tests without
  a browser or a token.
- **Upsert semantics that preserve `VariableID`s**, so paint bindings on existing components
  survive a re-sync. This is the part that is genuinely hard to get right.

## Configure

One file, `figma-token-rail.config.json`:

```json
{
  "collectionName": "Design Tokens",
  "artifactUrl": "http://localhost:4173/tokens.json",
  "tokenSourcePath": "tokens/",
  "extensionsNamespace": "com.example.tokens",
  "fallbackThemeId": "light",
  "plugin": { "name": "Design Token Sync", "id": "design-token-sync-dev" }
}
```

| Field                       | Meaning                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `collectionName`            | The Figma variable collection this rail owns. Created on first sync.                             |
| `artifactUrl`               | Where the plugin fetches your published artifact from.                                           |
| `tokenSourcePath`           | Where you author token sources. The plugin names it as the only place to fix drift.              |
| `extensionsNamespace`       | `$extensions` key carrying `{ themeId }` for the default theme. `null` if you don't declare one. |
| `fallbackThemeId`           | Theme id assumed when the artifact declares none.                                                |
| `plugin.name` / `plugin.id` | Figma manifest fields. The id must be unique in your Figma account.                              |

## Build the plugin

```bash
pnpm build:plugin --config figma-token-rail.config.json --out figma/plugin
```

Then import the generated `manifest.json` into Figma. Nothing repo-specific is baked into this
package — the config is injected at build time.

## Artifact shape

The default theme is the document body; every other theme is a partial tree under
`$themeOverrides`. Each theme becomes one mode on the Figma collection.

```json
{
  "$extensions": { "com.example.tokens": { "themeId": "dark" } },
  "$themeOverrides": {
    "light": {
      "accent": { "primary": { "$type": "color", "$value": "#1d4ed8" } }
    }
  },
  "accent": { "primary": { "$type": "color", "$value": "#155dfc" } }
}
```

Supported `$type`s: `color` (hex, hex8, `rgb()`, `rgba()`), `dimension`, `duration`, `number`,
`string`, `boolean`.

## One rail: the plugin

Publishing runs through the Figma plugin this package builds. There was a second rail — the
Figma Variables REST API — and it was removed rather than kept as a deferred option, because
the comparison never favoured it:

|                         | Plugin                  | REST API (removed)                        |
| ----------------------- | ----------------------- | ----------------------------------------- |
| Figma plan              | any                     | Enterprise / full seat                    |
| Credentials             | none — runs in Figma    | OAuth token in `FIGMA_OAUTH_ACCESS_TOKEN` |
| Preserves `VariableID`s | **yes**                 | no — deletes and recreates the collection |
| Multi-theme             | yes, one mode per theme | no, default theme only                    |
| Runs in CI              | no                      | yes                                       |

The REST API has no upsert, so a sync deleted the collection and recreated it, breaking every
paint binding pointing at those variables. It bought unattended CI publishing at the cost of
binding stability, single-theme output, and a seat tier most consumers do not have — and in the
one repo that wired it, it never ran to success. Unattended publishing is a real want; when it
comes back it will be a new design that preserves bindings, not this one restored.

## Drift codes

`MISSING_VARIABLE` · `UNEXPECTED_VARIABLE` · `TYPE_MISMATCH` · `ALIAS_BINDING` ·
`VALUE_MISMATCH` · `MISSING_MODE_VALUE` · `MISSING_MODE` · `UNEXPECTED_MODE`

`ALIAS_BINDING` means someone rebound a variable to an alias inside Figma. Like every other
finding, that is a proposal to be made in your token sources — not a value to copy back.

## Gotchas this package already handles

- **Float32 read-back.** Figma stores numbers in single precision, so `0.7` returns as
  `0.699999988079071`. Comparison tolerates it; a naive differ reports drift on every sync.
- **`resolvedType` cannot change in place.** A token whose type changed is removed and recreated
  rather than failing mid-sync.
- **Mode count is plan-gated.** Adding a theme beyond your Figma tier's limit fails with an
  explicit message instead of an opaque API error.
- **Write-back verification.** `Sync Variables` re-reads the file and runs the same comparison
  `Check Drift` uses, so a write that silently failed cannot report success.

## Development

```bash
pnpm install
pnpm check      # format:check + typecheck + test
```
