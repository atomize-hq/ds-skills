---
name: stage-1-foundation-primitives-system
description: Establish the baseline Next.js + Tauri + Storybook environment, primitive wave, Figma variables and modes, and sync policy before the component round-trip loop begins. Use when the agent is bootstrapping the system, defining primitives and tokens, or setting the initial desktop-safe design system conventions.
---

# Stage 1 — Foundation, Primitives, and Design System

Use this skill to create the **baseline system** that makes the rest of the workflow predictable.

Do this stage before scaling the round-trip component loop.

## Use this when

- bootstrapping a new repo
- creating the first stable desktop-safe UI environment
- defining primitives and tokens
- setting up Storybook
- pinning Storybook version policy
- designing the Figma variables strategy
- establishing conventions for each vendored component family
- defining how code/design/story stay in sync

## What this stage must deliver

Produce a baseline pack with some or all of these files:

1. `architecture.md`
   - high-level stack decisions
   - desktop-safe rendering assumptions
   - frontend/native boundaries
   - ownership split for each vendored component family

2. `baseline-environment.md`
   - app setup choices
   - Storybook framework/addons plan
   - build/dev commands
   - baseline verification checklist

3. `primitives-wave.md`
   - the first batch of primitives/atoms to build
   - order of implementation
   - `[REUSE]`, `[WRAP]`, `[NEW]` status for each

4. `figma-variables-plan.md`
   - variable collections
   - groups
   - modes
   - alias strategy
   - semantic token naming

5. `storybook/component-tier-policy.json`
   - which tiers exist, in ascending order of rigour
   - the minimum story kinds each tier owes, each with a stated purpose
   - schema in `../../schemas`, starting point in `../../templates`

6. `.storybook/storybook-version-policy.json`
   - exact Storybook framework/version line
   - required addons
   - required import paths
   - disallowed legacy packages
   - validation commands

7. story-kind vocabulary
   - the canonical thirteen kinds, documented in `../../templates/storybook-story-taxonomy.template.md`
   - which of them a component _must_ have comes from the tier policy, not from prose

8. `native-boundary.md`
   - typed bridge strategy
   - command/event ownership
   - permission/capability plan

9. `sync-policy.md`
   - what counts as drift
   - required links between story, Figma, and code
   - promotion criteria from Stage 1 → Stage 2 → Stage 3

## Baseline architecture rules

### 1. Keep the shipped app Tauri-safe

- Assume the desktop app uses a static-export-friendly frontend.
- Anything privileged must go through Tauri.
- No hidden dependency on a Next.js server for core desktop use.

### 2. Use Next.js App Router deliberately

Prefer a structure like:

- route shells and pages
- design-system primitives, kept separate from anything that composes them
- one directory per vendored component family, so ownership is legible at a glance
- feature-local composition
- a typed bridge to the native layer, if there is one
- `src/lib/tokens/` — token exports and mapping utilities
- `src/figma/` — the Figma sync rail: `sync-ledger.json`, `publish-proof.json`, and the policies that govern them
- `src-tauri/` — native code, permissions, capabilities

### 3. Storybook is part of the foundation, not an afterthought

At baseline, decide:

- the Storybook framework package
- exact version pinning policy
- modern import policy
- story file naming
- provider/decorator strategy
- how Tauri commands are mocked
- how async/network states are mocked
- when to use play-based workflow tests
- when motion stories are required
- when to use accessibility checks
- whether Chromatic/visual testing is enabled
- how Figma and Storybook links are recorded

### 4. Primitive wave comes before organism work

A repo part-way through this will already hold primitives that arrived as dependencies of
component work rather than as a deliberate wave. Where that is so, treat the list below as a
coverage checklist to audit against, not a greenfield plan.

This layer is also where **component recipes (CT-3) attach**. The recipe shape — variantAxes /
slots / states / defaults / fallbacks — is a CVA atom shape; it does not describe an organism.
Organisms get tokens transitively through the atoms they compose and never need recipes of
their own. Where only some primitives declare CVA variants, "author recipes for the primitives"
is partly recording what exists and partly designing a variant surface that does not.

The first wave should usually include things like:

- button
- icon button
- input
- textarea
- select or combobox
- badge/tag
- dialog/sheet
- tooltip/popover
- card/panel
- tabs/segmented control
- menu/dropdown
- layout container primitives
- AI/chat row wrappers if core to the product
- editor shell wrappers if core to the product

Do not jump to organism/layout work until the primitive wave is defined.

## Storybook baseline rules

### Version pinning rules

The baseline must explicitly document:

- the exact Storybook release line being used
- the framework package
- required addons
- modern Storybook import paths
- which old packages/imports are banned from new work
- who owns future upgrades and how they are validated

### Required baseline story behavior

Every primitive in the first wave should have at least:

- a default/happy story
- a variant matrix if there is more than one public variant axis
- a state matrix for meaningful public states
- an action story if it emits events
- a controlled story if it is controlled by parent state
- a workflow story if behavior is multi-step
- a motion story if motion materially affects UX
- provider mocks if native/async behavior is involved
- design links if it belongs to the shared design system

### Required Storybook baseline configuration decisions

Document:

- global decorators/providers
- router/app-directory handling
- native bridge mock strategy
- async/network mock strategy
- test/addon strategy
- docs/autodocs policy
- code panel/source snippet policy
- controls sorting/visibility policy
- tags policy
- visual review link policy

## Figma variables and token rules

### Use semantic tokens first

Define semantic names before component-specific names.

Good examples:

- `color.surface.default`
- `color.surface.subtle`
- `color.text.default`
- `space.2`
- `radius.md`

Less stable examples:

- `button-blue-bg`
- `sidebar-special-padding`

### Plan variable collections and modes intentionally

Prefer a documented strategy for:

- colors
- spacing and sizing
- radius
- motion/duration (if represented)
- strings/booleans only where they genuinely help design contexts

Prefer modes for contexts such as:

- light/dark
- density
- platform nuance if needed

### Keep naming parity with code tokens

Every important semantic token should have:

- a code token name or CSS variable,
- a Figma variable name,
- a documented mapping.

If the naming diverges, document the translation explicitly.

## Figma rail rules

### Operational Figma surfaces

Document the split between the repo-owned operational surfaces:

- `figma-use` for scripted canvas edits, patching, bulk operations, and exports
- Figma MCP for capture, inspection, and code-to-canvas / canvas-to-code iteration
- the repo-owned Figma plugin for the canonical `plugin-import-manual` publish/sync rail, which
  carries two actions: **Sync Variables** (writes the published artifact into the file) and
  **Check Drift** (read-only; reports where the file disagrees with the artifact)

The rail is one-way by design. Tokens are authored only in `design-tokens/src/tokens/`; there is no
Figma-to-canonical writer, because Figma's four variable types cannot round-trip DTCG `$type`,
aliases, or composite tokens without loss. A change made in Figma is reported by `Check Drift` and
then re-made in the canonical source.

### Design↔code link strategy

- The link is a pair of fields in `storybook/component-specs/<component-id>.json`: `downstreamHooks.figmaComponentRef` (the Figma node) and `downstreamHooks.codeEntrypoint` (the TSX file).
- **Code Connect is retired.** Do not bootstrap it, do not make `figma:connect:validate` a baseline gate, and do not read a missing mapping as drift — the CT-11B rail reports `not-applicable`. Its implementing code was kept so a revival would be a data change rather than a rebuild; see `docs/stage1/sync-policy.md`.

## Upstream component ownership

Registry components are vendored **by copy**. They are not a dependency you can bump — once
installed the repo owns the file, and the CLI that installed it can silently overwrite it.

- Keep a policy manifest recording what must stay true, enforced by the repo's own check:
  directory **invariants** (rules every file in a directory obeys, so a newly added primitive
  is covered without a manifest edit), per-file **deviations** (intentional divergences), and
  **contracts** (upstream API you depend on and could lose by refactoring rather than
  overwriting).
- A deliberate divergence means adding a `deviations` entry with its reason. The manifest is
  the answer to "why does this differ from upstream?"
- A failing rule is a decision — a real regression, or a deviation upstream has since adopted.
  Never delete an entry to go green.
- **Some corrections belong in the primitive, not the wrapper.** The focus-ring policy and
  contrast fixes are base-class changes; pushing them up into wrappers moves the duplication
  to every call site instead of removing it. "Leave primitives pristine" is the default, not
  an absolute.

## Native boundary rules

For baseline setup, define:

- which desktop features are expected soon
- which commands/events will likely exist
- how bridge adapters are named
- how Storybook will mock native behavior
- what permission/capability naming convention is used

## Promotion criteria: Stage 1 is complete when

- baseline app and Storybook conventions are documented
- Storybook version policy is explicit
- Tauri-safe assumptions are explicit
- primitive wave is defined
- semantic tokens and Figma variables plan exist
- Storybook story taxonomy exists
- vendored-component ownership boundaries are documented
- sync policy exists
- the Figma operational surfaces and plugin rail are documented

Only then move into Stage 2 at scale.
