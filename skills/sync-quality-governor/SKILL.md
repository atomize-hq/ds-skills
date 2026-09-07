---
name: sync-quality-governor
description: Audit and reconcile code, Storybook, Figma, tokens, and native-boundary drift so features can move cleanly between stages and toward merge or handoff. Use when the agent needs to assess alignment, classify drift, or produce the smallest reconciliation plan needed to safely promote work.
---

# Sync Quality Governor

Use this skill whenever you need to answer:

- “Are design and code still aligned?”
- “Is Storybook still a trustworthy contract surface?”
- “What is the smallest set of tasks needed to fix drift?”
- “Can this component/feature be promoted or merged safely?”

## Use this when

- finishing a Stage 2 loop
- finishing a Stage 3 assembly
- preparing a PR or handoff
- auditing a component library
- checking whether Storybook, Figma, and the component specs agree
- reviewing token drift or native-boundary drift
- checking Storybook tooling/version drift

## What this skill produces

Produce:

1. a prioritized reconciliation task list, classified by the drift types below
2. edits to the artifacts that actually carry the drift — the component spec, the story
   inventory, the token source, or the code

There is **one** sync ledger per repo and it is schema-enforced: `src/figma/sync-ledger.json`,
validated by `pnpm validate:sync-ledger`. It records the state of the token → Figma publish rail,
not per-component review notes. Do not author a second ledger under a `sync/<scope>/` path — no
such directory exists, and a file in that older per-component shape fails the validator. Touch the
ledger only when the publish rail's state genuinely changed.

## Drift types this skill must classify

### 1. Visual drift

The Storybook render no longer matches the latest approved Figma design closely enough.

### 2. Contract drift

Figma properties/variants/slots and code props/variants/slots no longer line up.
This usually shows up as a spec whose `ownedStoryRefs` no longer cover the component's real states, or a `figmaComponentRef` pointing at a node that has moved on.

### 3. Token drift

Figma variables and code tokens/CSS variables no longer reflect the same semantic system.

Direction matters here. `design-tokens/src/tokens/` is the only authoring surface; the runtime CSS,
the typed module, and the Figma variables are all _derived_ from it. Never reconcile token drift by
reading values out of Figma into the token files — classify it, then fix it in the canonical source
and re-publish. Three subtypes:

- **Publish drift**: the canonical tokens changed but Figma was never re-synced, so the file's
  variables lag the artifact. Detect with the repo plugin's **Check Drift** action (read-only);
  fix by running **Sync Variables**.
- **Figma-side edit**: someone changed a value, added a variable, or re-bound one to an alias
  inside Figma. `Check Drift` reports these as `VALUE_MISMATCH`, `UNEXPECTED_VARIABLE`, and
  `ALIAS_BINDING`. This is a _proposal_, not a source of truth: make the equivalent edit in
  `design-tokens/src/tokens/`, rebuild, then sync forward so Figma matches again.
- **Raw-value bypass**: A visual value was changed directly in a CSS module or TSX without going
  through the token system, creating a fork between the Figma variable and the code value. Flag
  this if the value _should_ be token-backed but isn't.

### 4. Native drift

The UI exposes desktop behavior that is not accurately represented by bridge docs, stories, mocks, or permissions.

### 5. Story drift

Reusable code exists but:

- Storybook coverage is missing,
- design links are stale,
- edge/error states are missing,
- workflow stories are missing,
- motion/async coverage is missing,
- or stories do not reflect the current contract.

### 6. Tooling drift

The Storybook baseline itself has drifted.
Examples:

- mixed Storybook versions
- legacy Storybook packages still installed
- modern imports not adopted consistently
- addons/framework choice drifting from the declared baseline

### 7. Upstream drift

A vendored registry component has diverged from what the repo decided about it.
Examples:

- an intentional deviation reverted by a registry overwrite
- upstream API we depend on (AI SDK types, Streamdown, `useControllableState`) replaced by a
  hand-rolled local equivalent
- a newly added primitive violating a repo-wide invariant such as the focus-ring policy
- a deviation entry describing a difference upstream has since closed, so the manifest now
  records a divergence that no longer exists

## Audit checklist

### Storybook checks

- does the reusable component have current stories?
- are default, variant, state, action, and controlled coverage present where meaningful?
- are workflow stories present for multi-step interaction paths?
- are motion stories present when motion materially affects UX?
- do stories still reflect current props and behavior?
- are async/native mocks current?
- are interaction/a11y/visual checks current?
- are design and Chromatic links current?

### Tooling/version checks

- are Storybook packages pinned to the declared baseline?
- are packages on one release line?
- are legacy Storybook packages/imports still present?
- does the baseline policy still match the actual repo state?
- do validators still pass for the Storybook policy artifacts?

### Upstream component checks

- does `just check` still pass the upstream policy?
- does every intentional divergence have a `deviations` entry with a reason?
- do any entries describe a difference that no longer exists upstream?
- has a registry CLI been re-run over an existing file?

### Figma checks

- is the current reusable design represented by a library component or a reviewed frame?
- were variable or variant changes made in the right place?
- have recent design changes been reviewed and compared through the operational surfaces the repo actually uses: figma-use, Figma MCP, and the repo-owned plugin?
- does the repo plugin's **Check Drift** report come back clean, and is `artifacts/figma/drift-report.json` current for the artifact revision under review?

### Component spec checks

- does `downstreamHooks.codeEntrypoint` point at a file that still exists?
- does `downstreamHooks.figmaComponentRef` resolve to a node that still exists in the file?
- does `ownedStoryRefs` still cover every story kind the component's tier requires?
- do the story IDs in the spec exist in `storybook/story-inventory.json`?

Code Connect is retired: a component with no mapping is not drift, and the CT-11B rail reporting
`not-applicable` is the expected state, not a failure. See `docs/stage1/sync-policy.md`.

### Token checks

- do semantic names still line up between code and Figma?
- did a local visual change accidentally create a token fork?
- should a one-off remain local, or be elevated into the system?
- has any drift been reconciled _into_ `design-tokens/src/tokens/` rather than out of Figma? A fix
  that edits a token file to match Figma is correct; a fix that copies Figma's state into canon
  wholesale is not.

### Native boundary checks

- are privileged flows documented?
- are bridge wrappers and story mocks aligned?
- did the UI add a new native assumption without updating the bridge or permissions plan?

## Severity rules

### `block`

Use for:

- contract drift on reusable components
- native drift affecting real behavior
- severe Storybook drift on a shared primitive
- tooling drift that breaks the declared Storybook baseline
- token drift that breaks system consistency
- upstream drift that reverts a recorded deviation or drops a recorded contract

### `warn`

Use for:

- minor visual mismatches
- missing optional mappings
- story coverage gaps that do not yet break core behavior
- missing motion or workflow stories on non-critical flows

### `info`

Use for:

- deferred documentation polish
- optional link hygiene
- non-blocking metadata improvements

## Reconciliation strategy

When drift is found, produce the **smallest possible corrective tasks**.

Prefer:

1. update story and mapping if only the contract drifted,
2. update tooling config if the Storybook baseline drifted,
3. update tokens/variables if the system drifted,
4. update code and story together if behavior drifted,
5. update bridge docs/mocks if native assumptions drifted,
6. route back to Stage 1 or Stage 2 only when required.

Do not respond with vague “sync everything” work.

## Promotion rules

### Promote a reusable component when

- story coverage is current
- Figma truth is current
- the component spec's `figmaComponentRef` and `codeEntrypoint` are current
- no blocking drift remains

### Promote an assembled screen/feature when

- page/screen stories are current
- native flows are documented/mocked
- no new hidden primitive drift exists
- blocking drift is absent

## Hard rules

- No merge/handoff with unresolved blocking contract drift.
- No stage promotion with unresolved blocking native drift.
- No baseline promotion when Storybook tooling drift is unresolved.
- Page-specific one-offs may skip the component spec only if explicitly documented as non-system components.
- Do not reintroduce Code Connect as a promotion gate, and do not run `figma:connect:validate` — both are retired. The repo-owned plugin rail is the active path.
