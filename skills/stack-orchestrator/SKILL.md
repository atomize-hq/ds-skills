---
name: stack-orchestrator
description: "Route design-system work to foundation, component, composition, library-curation, Storybook, or drift workflows using the project's configured stack and ownership boundaries."
---

# Route design-system work

Start with the user's actual task, repository instructions, reviewed product pin and
project configuration. Read the [project contract](references/project-contract.md)
for installed execution, evidence boundaries and path ownership. Do not infer a
framework, native runtime, library pair or directory layout from this skill pack.

Choose the smallest relevant workflow; do not turn a component edit into a stack
migration or make every task run every stage:

| Task                                                                 | Installed workflow                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Define tokens, primitive strategy and selected baseline capabilities | [Foundation](../stage-1-foundation-primitives-system/SKILL.md)     |
| Set or repair Storybook policy, stories and execution                | [Storybook](../storybook-rigorous-spec-system/SKILL.md)            |
| Select libraries or refresh source-grounded project guidance         | [Curation](../curate-component-libraries/SKILL.md)                 |
| Implement using configured library APIs                              | [Library component builder](../library-component-builder/SKILL.md) |
| Round-trip a bounded component through design and code               | [Component loop](../stage-2-component-roundtrip-loop/SKILL.md)     |
| Assemble existing components into a screen or layout                 | [Layout assembly](../stage-3-organism-layout-assembler/SKILL.md)   |
| Compose interactive presentation, editing and application state      | [Interactive workspace](../interactive-workspace-builder/SKILL.md) |
| Reconcile drift or evaluate a specific promotion claim               | [Quality governor](../sync-quality-governor/SKILL.md)              |

Respect the actual runtime boundary: UI emits the application's documented intents;
privileged operations stay with the declared host/service adapter. A native bridge,
server or transport library is not implied merely because one consumer uses it.
Check shipped-runtime and test-runtime constraints separately.

Keep copied-source ownership and upstream evidence distinct. Registry acquisition
is not permission to overwrite application files. Generated project skills carry
local vocabulary; reusable instructions belong in the product. Never edit a shared
installed release to customize a project.

Report the selected workflow, concrete inputs, changed outputs, commands actually
run and unresolved evidence. Recipe validity, component readiness and token
publication are separate answers; none stands in for the other two.
