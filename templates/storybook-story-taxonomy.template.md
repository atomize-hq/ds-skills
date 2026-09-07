# Storybook Story Taxonomy

## Default

The canonical happy path.

## Variant Matrix

Use when the component has more than one public variant axis.

## State Matrix

Use for meaningful public states:

- disabled
- invalid
- loading
- selected
- success
- destructive
- empty
- blocked
- etc.

## Actions

Use when the component emits events or callbacks that must be visible in Storybook.

## Controlled

Use when parent state drives the component or when internal behavior must be reflected back through args/state.

## Keyboard

Use when keyboard operation is part of the contract: tab order, arrow-key navigation,
Escape/Enter handling, type-ahead, shortcut conflicts.

## Focus

Use when focus movement is meaningful: focus trapping, restore-on-close, roving tabindex,
or a visible focus treatment that must survive a restyle.

## Workflow

Use for replayable multi-step paths.
A workflow story should define:

- start state
- steps
- final expected state
- mocks
- acceptance notes

## Motion

Use when UX depends on animation, reveal timing, transition choreography, or streaming progression.

## Async

Use when network/native/streaming/permissions affect what the user sees.

## Docs

Use to record:

- controls policy
- prop contract
- design links
- mapping notes
- accessibility notes

## Responsive

Use when layout changes materially across breakpoints, or when a component must survive a
narrow container rather than a narrow viewport.

## Composition

Use when the component is only meaningful inside a parent arrangement, and the thing under
review is the arrangement rather than the leaf.

---

The thirteen sections above are the full canonical set, in order.
The machine-readable form is the `storyKind` enum in `../schemas/storybook-story-inventory.schema.json`
and `../schemas/storybook-component-spec.schema.json`; the order above is the order those enums
require. Which kinds a component _must_ have is not decided here — that comes from the tier policy.
