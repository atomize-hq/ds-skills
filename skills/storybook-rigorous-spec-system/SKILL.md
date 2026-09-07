---
name: storybook-rigorous-spec-system
description: Install, upgrade, pin, and govern a modern Storybook baseline for Next.js + Tauri with rigorous story contracts, replayable workflows, motion stories, async mocks, and Figma and Chromatic links. Use when the agent needs to treat Storybook as a structured contract system instead of just a component gallery.
---

# Storybook Rigorous Spec System

Use this skill whenever Storybook needs to be treated as a **structured contract system**, not just a component gallery.

This is the skill that makes the rest of the workflow dependable.

## Use this when

- installing Storybook for the first time
- upgrading Storybook
- pinning Storybook package versions
- choosing the framework and addon stack
- replacing legacy Storybook imports/packages
- defining the repo-wide story taxonomy
- adding replayable interaction/workflow stories
- adding motion stories
- tightening docs/controls behavior
- adding visual, accessibility, and test gates
- wiring Figma and Chromatic links into stories

## Required outputs

Produce or update some or all of the following:

1. `.storybook/storybook-version-policy.json` — the pinned baseline
2. `storybook/component-tier-policy.json` — which tiers exist and the minimum kinds each owes
3. `storybook/component-specs/<component-id>.json` — one contract per component
4. `storybook/story-inventory.json` — the repo-wide registry of implemented stories
5. `.storybook/preview.ts`
6. `.storybook/main.ts`
7. story files and docs pages
8. a migration/remediation task list if legacy Storybook setup exists

These four JSON artifacts have schemas in `../../schemas` and starting points in `../../templates`.
The story-kind vocabulary they share is documented in `../../templates/storybook-story-taxonomy.template.md`;
it is a fixed set of thirteen, not a per-repo invention. There is no `storybook-baseline.md`,
`story-taxonomy.md`, or `story-specs/` directory — the JSON artifacts above replaced all three.

## Reference

`references/storybook-decision-matrix.md` — framework, test-runner, visual-regression, and
design-link choices for this stack, plus how a repo records where it actually sits against
each row.

## Primary goals

### 1. Keep the baseline modern and pinned

The repo must have a declared Storybook version policy.

That policy should explicitly define:

- the Storybook framework package
- the exact Storybook version line
- required addons
- required modern imports
- disallowed legacy packages
- upgrade policy
- validation commands

### 2. Make stories represent the real component contract

A good Storybook setup must expose:

- variants
- public states
- actions/events
- controlled behavior
- async behavior
- workflows
- motion
- docs and design links

### 3. Make interaction flows replayable

Interactive UI should not stop at isolated click tests.
This skill requires workflow stories for multi-step paths when behavior is meaningful.

### 4. Make Storybook useful for design sync

Story files should have a clear relationship to:

- Figma nodes/components, via the component spec's `downstreamHooks.figmaComponentRef`
- Chromatic or equivalent visual links
- the sync ledger

## Baseline policy rules

### Framework rule

Prefer the Next.js Storybook framework that is aligned with the modern Vite-based path for this stack.

### Exact version rule

All Storybook-owned packages must stay on the same exact release line.
Do not leave them partially upgraded.

### Modern import rule

Standardize new code on the modern Storybook import surface.
Do not keep older import paths just because they still happen to compile.

### Legacy cleanup rule

When upgrading, explicitly remove obsolete or superseded Storybook packages rather than letting them remain in `package.json`.

### Config format rule

Treat `.storybook/main.*` and related config as repo-level contract files.
Keep them clean, reviewable, and aligned with the current Storybook package surface.

## Required story taxonomy

For reusable components, define stories across the following categories whenever applicable.

### A. Contract stories

These define the public surface.

- `Default`
- `VariantMatrix`
- `StateMatrix`

### B. Event and control stories

These verify interaction surfaces.

- `Actions`
- `Controlled`
- `Keyboard`
- `Focus`

### C. Workflow stories

These are replayable multi-step stories.
Examples:

- open dialog → edit fields → submit
- hover menu → arrow navigation → select item
- stream partial AI output → finish → apply result
- expand section → change tab → confirm destructive action

Workflow stories should:

- use step-labeled interaction sequences
- make the intended flow obvious
- be stable and deterministic enough to replay

### D. Motion stories

Create explicit motion stories when animation is meaningful.
Examples:

- open/close transitions
- accordion expand/collapse
- optimistic insert/remove
- assistant streaming progression
- sheet/dialog/drawer choreography

Motion stories should:

- show the animation path intentionally
- avoid flaky timing assumptions
- expose reduced-motion considerations if the component supports them

### E. Async stories

Use mocked async states when the component depends on:

- network responses
- streaming
- delayed native calls
- permission gates
- loading/error/empty paths

### F. Docs stories

Use docs to record:

- prop surface
- controls rules
- design links
- mapping notes
- known limitations
- accessibility notes

## Story file requirements

### Meta requirements

Each reusable component story file should clearly define:

- title
- component
- decorators/providers if needed
- tags/docs policy
- design links when relevant

### Arg and controls requirements

Controls should be intentional, not accidental.

Document:

- which props are user-editable in the controls panel
- which props are hidden/internal
- which controls are conditional
- which required controls should appear first
- how controlled stories sync state back into args

### Action/event requirements

Interactive props should be visible in Storybook.
Prefer an explicit spy-oriented approach for event handlers.

### Mock requirements

If the story depends on routing, native boundaries, or data, document and implement the mock strategy clearly.

## Replayable workflow requirements

For interactive components, at least one workflow story is required when any of the following are true:

- more than one user step matters
- there is visible state progression
- there are animations/transitions worth observing
- the component is part of a critical product flow
- Figma approval depends on seeing the sequence, not just the end state

A workflow story should describe:

- the starting state
- each step
- the final expected state
- any mocks required
- whether motion is part of acceptance

## Design-link requirements

When the component is part of the design system, record:

- Figma component or node link
- Chromatic/story link if available
- whether the story represents a library component, a wrapper, or a composed view

## Acceptance criteria

A Storybook baseline is acceptable when:

- versions are pinned
- modern packages/imports are used consistently
- legacy package drift is removed or explicitly tracked
- provider/mock strategy is documented
- story taxonomy is documented
- at least one representative component has full contract coverage
- validators pass for the Storybook policy artifacts

A component Storybook contract is acceptable when:

- public variants are represented
- meaningful states are represented
- actions/events are observable
- controlled behavior is demonstrated when applicable
- a workflow story exists when behavior is multi-step
- motion is represented when it materially affects UX
- docs/design links are present
- verification status is recorded

## Hard rules

### 1. No reusable component without a structured story contract

A single default story is not enough for a reusable design-system component.

### 2. Do not let Storybook lag behind the design/code loop

If the component changed, the stories changed.

### 3. Workflow stories are required for meaningful interactions

Do not reduce a multi-step flow to a static final screenshot.

### 4. Motion must be represented where UX depends on it

If timing, transitions, or reveal behavior matter, create motion-aware stories.

### 5. Version pinning is non-optional

Do not leave Storybook package versions floating loosely across the repo.

## Suggested output structure

```text
.storybook/
  main.ts
  preview.ts
  storybook-version-policy.json     # schema: storybook-version-policy.schema.json

storybook/
  component-tier-policy.json        # schema: storybook-tier-policy.schema.json
  story-inventory.json              # schema: storybook-story-inventory.schema.json
  component-specs/
    button.json                     # schema: storybook-component-spec.schema.json
    dialog.json
```
