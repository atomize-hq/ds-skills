# Ownership and transition checks

Choose patterns by the user's task and actual selected capabilities:

- **Side-by-side:** presentation/history and an editable document remain separate;
  an explicit handoff identifies what is inserted, where and under which revision.
- **Composer-first:** draft content has one owner; submit freezes or snapshots the
  intended version, presentation reflects pending/result state, and retry does not
  silently send a later edited draft.
- **Inline assist:** the document stays canonical. Suggestions are previews or
  diffable proposals until an explicit apply operation; rejecting/cancelling must
  preserve existing content and selection behavior.
- **Action workspace without an editor:** render validated snapshots and emit narrow
  advertised intents. Avoid inventing editor state or treating an available button
  as authorization. Execution and concurrency rules stay at their actual boundaries.

For each relevant state, identify ephemeral UI, persistent domain data, selected
library-owned state and host-mediated state. Define serialization/import/export
using the real contract, including unsupported input handling. Do not flatten rich
structure into plain text unless that loss is explicitly intended.

For streaming or async work, distinguish partial, completed, failed, cancelled and
superseded results. Keep provider/transport details out of leaf presentation code.
Use revision/action identity to prevent stale completion from applying to the next
draft or selection. Decide whether pending actions disable only one action or a
whole exclusive group; respect the actual contract rather than using a generic
loading flag that loses concurrency semantics.

Test the handoff across regions: focus entering/leaving the composer/editor, keyboard
ownership, selection preservation, confirmation, apply/revert/undo, scrolling and
announcements. Include failure followed by a fresh attempt, cancellation followed
by the next input, and stale revisions or out-of-order results. Use mocked services
for deterministic UI tests and separate live host proof when required.

State precisely what was observed: a structurally valid snapshot is not permission;
an emitted intent is not execution; a successful mock is not a live service; rendered
source presence is not visual approval or assistive-technology verification.
