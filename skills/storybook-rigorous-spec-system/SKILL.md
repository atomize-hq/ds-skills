---
name: storybook-rigorous-spec-system
description: "Establish or repair a configured Storybook baseline, tiered story contracts, replayable interactions, async and motion coverage, and explicit execution and visual-review evidence."
---

# Govern the executable story contract

Read the [project contract](../stack-orchestrator/references/project-contract.md).
Use actual framework packages and the project's declared version policy, not a
preferred consumer's framework. Consult the [decision worksheet](references/storybook-decision-matrix.md)
when choosing or upgrading tooling. Do not silently switch bundlers or introduce an
external visual provider to satisfy a documentation checklist.

## Inputs and policy

Find the configured version policy, tier policy, component specs, story inventory,
source roots and proof outputs. Their paths and tier/consumer names are project data.
The shipped [schemas](../../schemas/README.md) describe their contracts. Tier policy
version 2 explicitly names consumers; migrate older data deliberately rather than
loosening validation. Derive requirements from actual tier policy and component
specs, not a second hardcoded component list.

The product's [story vocabulary](../../templates/storybook-story-taxonomy.template.md)
has thirteen supported kinds. For each relevant component, record which apply and
why: public variants/states, observable actions, controlled state, keyboard/focus,
multi-step workflow, motion, async, responsive, composition and docs. Do not label a
static screenshot as an executed workflow or claim every component needs every kind.

## Author and exercise

- Keep real component imports and public API contracts in stories. Document provider,
  router, host and network mocks; do not call privileged services from the story.
- Expose deliberate controls and observable events. Demonstrate caller-controlled
  state rather than duplicating a hidden authoritative store inside the example.
- For meaningful multi-step behavior, test the starting state, named actions and
  observable end state. Include error/cancel/empty transitions where applicable.
- For motion, make progression and reduced-motion behavior inspectable. Avoid sleeps
  standing in for a real readiness condition. For async/native behavior, use explicit
  deterministic states and verify failure and recovery as well as success.
- Keep inventory IDs, owned references, required kinds and code entrypoints aligned.
  Record Figma node references when applicable, without treating a link as proof of
  current visual review or token publication.

Run `storybook policy validate` and `storybook proof validate/build/check` through
the installed launcher. Their output proves **static story-reference coverage**, not
UI execution. Separately run the actual configured interaction/a11y tests and build;
record versions, revision and results. Inspect rendered states where visual proof is
required. If external review is selected, retain fresh scope-bound evidence; failed,
changed and deferred outcomes remain distinct from approval.

Use `components status` and explicit promotion profiles only for claims their evidence
can support. A generated report is not automatic permission to merge. On failure,
fix the actual story/policy/implementation boundary; do not weaken requirements or
reuse stale success output. Keep non-Storybook consumer tests separate rather than
forcing this workflow on a project that did not select it.
