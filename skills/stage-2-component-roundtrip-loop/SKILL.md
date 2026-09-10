---
name: stage-2-component-roundtrip-loop
description: "Run a bounded reusable component through story contract, design inspection, code reconciliation and actual verification, preserving independent readiness and token-publication evidence."
---

# Round-trip one component

Use the [project contract](../stack-orchestrator/references/project-contract.md).
Bound the task to one component or a tightly related batch. Locate actual component
source, ownership, specs, story inventory, selected library guidance and explicit
Figma target. Do not assume a component directory or inventory document filename.
If design access is required but unavailable, record that missing proof rather than
pretending a code-only pass completed the round trip.

1. **Define the executable contract.** Inspect real props/variants/slots/events and
   the configured tier policy. Use the [Storybook workflow](../storybook-rigorous-spec-system/SKILL.md)
   for applicable state, interaction, keyboard/focus, workflow, async and motion
   obligations. Do not create a redundant list defining whether recipes are allowed.
2. **Seed or reuse code deliberately.** Use [configured library guidance](../library-component-builder/SKILL.md).
   Distinguish new acquisition from an owned local copy; do not overwrite edited
   components with a registry command. Verify imports in the actual consumer.
3. **Inspect/seed the design target.** Load available Figma tooling instructions,
   inspect the explicit destination and preserve existing IDs, properties and bindings.
   Capture the relevant executable state and viewport. An isolated demonstration
   frame does not automatically replace the reusable library component.
4. **Reconcile design and code.** Translate reviewed visual intent into actual token,
   layout, variant, slot and interaction changes. Keep transport/privileged behavior
   outside presentational components. If the shared token system changes, update
   canonical token source and publish through the separate supported plugin workflow.
5. **Record real references.** Update configured specs' code entrypoints and Figma
   node references, inventory/story IDs and applicable ownership/deviation data.
   A node link is neither visual approval nor publication proof.
6. **Verify the actual behavior.** Run configured static checks, typecheck, story/UI
   interaction tests and build. Inspect rendered design states and applicable visual
   review evidence at the current revision. Include failure/cancellation/recovery,
   keyboard/focus and reduced-motion cases when part of this component's contract.
7. **Evaluate the requested claim.** Use [quality reconciliation](../sync-quality-governor/SKILL.md)
   with explicit consumer/profile policy. Report static, executed, reviewed and live
   publication evidence separately. Do not write component notes into the token
   publication ledger or manufacture a success for a missing observation.

Finish with the exact component/spec/story paths, design target, actual commands
and evidence, unresolved drift and the smallest follow-up. If a new primitive is
needed during a larger layout task, finish its bounded contract before resuming
assembly rather than hiding a new public API inside a screen.
