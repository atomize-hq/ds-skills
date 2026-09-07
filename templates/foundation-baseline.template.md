# Foundation Baseline Template

## 1. Architecture

- Next.js App Router structure:
- Tauri boundary assumptions:
- AI Elements ownership:
- Plate ownership:
- Token source-of-truth split:

## 2. Storybook Version Policy

- Framework:
- Exact Storybook version line:
- Required addons:
- Required import paths:
- Disallowed legacy packages:
- Upgrade command/process:
- Validation commands:

## 3. Storybook Baseline Decisions

- Story file naming:
- Global decorators/providers:
- Router/app-directory strategy:
- Native mock strategy:
- Async/network mock strategy:
- Docs/autodocs policy:
- Code panel/source snippet policy:
- Controls sorting/visibility policy:
- Tags policy:
- Chromatic/visual review policy:
- Figma design-link policy:

## 4. Story Taxonomy Rules

- Default stories:
- Variant Matrix stories:
- State Matrix stories:
- Actions stories:
- Controlled stories:
- Workflow stories:
- Motion stories:
- Async stories:
- Screen/layout story rules:

## 5. Primitive Wave

| Primitive | Status (`[REUSE]` / `[WRAP]` / `[NEW]`) | Story expectations | Design mapping notes |
| --------- | --------------------------------------- | ------------------ | -------------------- |
| Button    |                                         |                    |                      |
| Input     |                                         |                    |                      |
| Dialog    |                                         |                    |                      |

## 6. Figma Variables Plan

- Collections:
- Modes:
- Alias strategy:
- Semantic token naming:
- Code token parity notes:

## 7. Design↔Code Link

The link lives in `storybook/component-specs/<component-id>.json` under `downstreamHooks`.

- Spec directory:
- `figmaComponentRef` format (figma-use `<fileKey>#<a>:<b>` / web URL / both — see BL-1):
- `codeEntrypoint` convention:
- Who updates the link when a component is re-seeded:

> **Code Connect is retired.** Do not bootstrap it, and do not make `figma:connect:validate` a
> baseline gate. The CT-11B rail reports `not-applicable`; a component with no mapping is not drift.

## 8. Native Boundary

- Typed bridge strategy:
- Command/event naming:
- Permission/capability naming:
- Storybook mock rules:

## 9. Sync Policy

- Drift categories:
- Required links (Storybook/Figma/Chromatic):
- Promotion criteria:
