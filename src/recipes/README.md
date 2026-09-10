# Recipe validation

The product owns source shape, intrinsic relationship checks, source discovery,
and token-existence validation. A recipe declares its own component, axes,
defaults, slots, states and fallbacks; no enrollment index is read.

```sh
ds-skills recipes validate --recipes ./design/recipes --tokens ./build/tokens.json --json
```

Both paths are explicit and relative to the caller's working directory (absolute
paths work too). Discovery selects regular `*.recipe.json` files immediately
inside the given directory, in filename order. An existing empty directory is
valid; an absent/unreadable directory and matching symlink/directory entries fail.
There is no hidden recursive glob, library allowlist or package-root fallback.

The token input is a DTCG-style document with explicit or inherited string `$type`
and `$value` leaves. Metadata keys beginning with `$` do not create token IDs.
The command checks that recipe references name those leaves; it does not prove
that token values or their reference graph are valid. Token references are
brace-wrapped, dot-qualified, lowercase kebab-case identifiers. The namespace is
not hardcoded. Token builds and full source validation remain separate work.

The pure package API exports `validateRecipe(recipe, { filenameStem, tokenIds })`
and `createTokenInventory(document)`. The first returns the first diagnostic or
`null`; it checks shape before intrinsic relationships before token existence.
`discoverRecipeSources(directory)` is shared discovery for future build/docs
consumers, not a separate manually maintained selector.

Exit 0 means all selected recipes are valid. Exit 1 is an evaluated recipe
failure. Exit 2 means inputs/arguments could not be evaluated and emits no stdout.
With `--json`, exits 0/1 emit one versioned report containing the source and token
paths, component results, and diagnostics. Human output reports the same scope.
The command writes no files. It does not certify implementation readiness,
Storybook evidence, Figma publication or release eligibility.

`ds-skills validate component-recipe <file>` checks schema shape only. Use the
recipe command for filename, cross-field and token-existence checks.
