---
name: interactive-workspace-builder
description: "Compose interactive presentation, document editing and application actions across user-selected libraries, keeping state ownership, streaming, focus and apply/revert behavior explicit."
---

# Compose an interactive workspace

Use the [project contract](../stack-orchestrator/references/project-contract.md)
and current installed skills for the project's selected libraries. Decide roles
from their actual capabilities and APIs, not library names: presentation, editing,
contracts, transport and host execution may be supplied by different packages or
by application-owned code. Do not add an editor or chat framework the task did not
request. If a needed capability is absent, report it and resolve the selection
rather than pretending another library implements it.

Read [ownership and transition checks](references/ownership-and-transitions.md)
when designing a composer, editor, assistant panel or another multi-region workflow.
Record component decomposition, state authorities, intent contracts, persistence,
focus/keyboard behavior, apply/revert actions and error/cancellation recovery.

Preserve these distinctions:

- Presentation renders the conversation/status/result supplied to it; it does not
  silently become the canonical document, provider client or authorization layer.
- A selected editor, when present, owns its actual document/selection model and
  editing transactions. Do not mirror that state into an incompatible text store.
- The application owns domain orchestration, transport, persistence, permission
  decisions and host execution at its declared boundaries.
- Generated suggestions or streamed partial results are proposals. Explicitly define
  preview, apply, accept/reject and undo behavior; do not mutate user content invisibly.

Use typed wrappers only where the selected APIs need them. Build replayable tests
for meaningful transitions, including concurrent pending actions, stale revisions,
errors and recovery. Verify actual imports/runtime behavior, not just examples'
syntax. Use screen-level tests and the [layout workflow](../stage-3-organism-layout-assembler/SKILL.md)
for cross-region behavior. Do not claim host execution, accessibility certification
or publication from a mock story or valid envelope alone.
