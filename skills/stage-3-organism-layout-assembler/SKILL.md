---
name: stage-3-organism-layout-assembler
description: "Assemble existing components into organisms, layouts and screens using the project's actual state, runtime and evidence boundaries without hiding new primitives inside page work."
---

# Assemble verified components

Read the [project contract](../stack-orchestrator/references/project-contract.md).
Identify the feature/screen boundary, real reusable components, their relevant
readiness evidence and the consumer's runtime/host conventions. Do not infer that a
source file, recipe or token publication makes a component behaviorally verified.

Use the [composition worksheet](../../templates/composition-plan.template.json)
only if it helps the task; choose a consumer-owned location rather than inventing a
fixed assembly directory. Record regions, reusable components, wrappers, state
owners, routing/host interactions, design references and verification obligations.

- Reuse or compose existing public APIs first. Keep screen-only spacing/arrangement
  local unless reuse justifies a system change. If a new primitive is necessary,
  route it through the [component loop](../stage-2-component-roundtrip-loop/SKILL.md)
  instead of silently adding a public variant inside screen code.
- Use the project's real routing and shipping model. Do not assume a runtime server,
  native bridge or privileged frontend API. Keep host intents typed and mocked at
  the correct boundary; document actual permission, cancellation and failure paths.
- Assign each state one authority. For interactive presentation/editor composition,
  use the [workspace workflow](../interactive-workspace-builder/SKILL.md) and current
  installed library-specific guidance, not a predetermined library pair.
- Build screen stories/tests for the meaningful happy, empty, loading, error,
  constrained-viewport, permission/offline and multi-step transitions. Apply actual
  consumer policy; do not force Storybook onto an unconfigured project.
- Preserve focus/keyboard order, live announcements, scrolling, responsive behavior
  and reduced-motion semantics across composed boundaries, not just within each
  isolated primitive. Verify async and cancellation carryover into the next state.

Run the configured component/source checks plus actual screen interactions and app
build. Inspect rendered layout states against the explicit design target where
required. Verify live host behavior separately from mocks. Use the
[quality governor](../sync-quality-governor/SKILL.md) for promotion claims, recording
which evidence was executed/reviewed and which remains missing. Token publication
and layout readiness remain separate; composition does not need a duplicate recipe
or an enrollment ledger.
