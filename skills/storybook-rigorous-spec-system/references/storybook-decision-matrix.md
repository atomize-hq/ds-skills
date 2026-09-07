# Storybook decision matrix for this stack

| Need                                                  | Recommended choice                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Best overall path for Next.js Storybook in this stack | `@storybook/nextjs-vite`                                                              |
| Modern Storybook test widget / Vitest integration     | `@storybook/addon-vitest`                                                             |
| Replayable multi-step UI flows                        | `play` functions + Interactions/Test panel                                            |
| CI visual regression                                  | Chromatic                                                                             |
| CI interaction validation from stories                | Chromatic interaction tests                                                           |
| Figma ↔ story linking                                 | `@storybook/addon-designs`, or Storybook Connect if published                         |
| Keep strict Webpack/Babel compatibility               | `@storybook/nextjs` (Webpack)                                                         |
| Webpack-based fallback                                | use `play` functions + Interactions panel + Chromatic, skip `@storybook/addon-vitest` |

## Where this repo actually sits

The rows above are recommendations. A repo adopting them should record its own position against
each one, because the gap between "recommended" and "in place" is the thing worth knowing:

- **Framework** — which of the two paths is installed, and whether the test-runner addon is wired.
- **Figma ↔ story linking** — which addon, and where the durable link is stored. If Code Connect
  is not in use, say so plainly rather than leaving a missing mapping to read as drift.
- **Visual regression** — whether a baseline actually exists. A working publish rail with no
  approved baseline is not a gate you can lean on, and a row recommending one describes where the
  stack should end up rather than where it is.

Record it where the repo's own status lives, not in this skill: a skill that carries one repo's
status stops being portable the moment a second repo installs it.
