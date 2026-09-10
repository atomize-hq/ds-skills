---
name: stage-1-foundation-primitives-system
description: "Establish a project's design-system foundation: token authority, primitive strategy, selected library ownership, Storybook policy and Figma publication conventions where configured."
---

# Establish the foundation

Use the [project contract](../stack-orchestrator/references/project-contract.md).
Inspect the existing baseline before creating files. Extend it at the consumer's
chosen paths; do not introduce a parallel document tree, assumed framework/native
runtime, or a mandatory list of libraries. Select only capabilities the task needs.

Record the decisions that downstream work depends on:

- **Runtime:** rendering framework, shipping model, package manager/toolchain,
  host/transport boundaries and test mocks, grounded in actual app configuration.
- **Libraries:** selected versions/sources, imports and ownership, dependencies versus
  copied files, deviations and relationships. Use [curation](../curate-component-libraries/SKILL.md)
  to obtain reviewed project-specific guidance rather than embedding API manuals here.
- **Tokens:** canonical source, theme/mode policy, semantic names and generated
  artifact/runtime targets. Keep source/build/documentation discovery consistent.
- **Primitives:** inspect what already exists; classify needed work as reuse, wrap or
  new. Choose the smallest useful set for the actual product, not a fixed catalog.
  If a primitive needs a recipe, author its real variants/slots/states and validate
  intrinsic consistency and token references. A recipe is not proof of readiness.
- **Stories:** when Storybook is selected, establish explicit tier/consumer policy,
  source inventory and applicable story kinds through the [Storybook workflow](../storybook-rigorous-spec-system/SKILL.md).
- **Figma:** when selected, record target ownership, collections/modes, token mapping,
  plugin build/serve/publish/verify procedure and proof/ledger locations. Preserve
  IDs/bindings; publication is a distinct obligation from component design review.
- **Verification:** declare applicable evidence profiles, blocking/advisory consumers,
  real execution commands and what has not been demonstrated. Missing selected
  capability inputs are failures, not silent opt-outs.

Use the [baseline worksheet](../../templates/foundation-baseline.template.md) when
it helps collect these decisions. Shipped [schemas](../../schemas/README.md) and
templates are starting contracts, not a demand to use their example vocabulary.
Consumer-specific artifacts belong in the consumer; reusable procedures stay here.

Validate configured source/build and policy artifacts, then exercise a representative
component in the actual test/runtime environment. If token publication is in scope,
run the installed plugin workflow and retain actual live evidence. Foundation script
generation alone does not meet that requirement. Report readiness and publication
separately, including exact missing or stale proof, before scaling component work.
