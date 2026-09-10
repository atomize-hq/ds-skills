import path from "node:path";
import { allowedStorybookValidatorKinds } from "./inventory.mjs";
const sortKinds = (kinds) =>
  [...new Set(kinds)].sort(
    (a, b) =>
      allowedStorybookValidatorKinds.indexOf(a) -
      allowedStorybookValidatorKinds.indexOf(b),
  );

export function linkProofInputs({
  inventory,
  tierPolicy,
  specs,
  storyIndex,
  rootDir,
}) {
  const errors = [],
    facts = [];
  const records = new Map(specs.map((spec) => [spec.componentId, spec]));
  const entries = new Map(
    inventory.components.map((component) => [component.componentId, component]),
  );
  if (records.size !== specs.length)
    errors.push(
      "[CT-9B_PROOF_STRUCTURE_DUPLICATE_COMPONENT_ID] duplicate component specification IDs",
    );
  for (const component of inventory.components) {
    const spec = records.get(component.componentId);
    if (!spec) {
      errors.push(
        `[CT-9B_PROOF_STRUCTURE_MISSING_SPEC_FILE] no spec for ${component.componentId}`,
      );
      continue;
    }
    const tier = tierPolicy.tiers[spec.tier];
    if (!Object.hasOwn(tierPolicy.tiers, spec.tier)) {
      errors.push(
        `[CT-9B_PROOF_STRUCTURE_UNKNOWN_TIER] ${spec.componentId}: ${spec.tier}`,
      );
      continue;
    }
    for (const { kind } of tier.minimumRequiredKinds)
      if (!spec.requiredStoryKinds.includes(kind))
        errors.push(
          `[CT-9B_PROOF_STRUCTURE_TIER_MINIMUM_KIND_MISSING] ${spec.componentId}: ${kind}`,
        );
    const owned = new Map(
      spec.ownedStoryRefs.map((ref) => [ref.storyId, ref.kinds]),
    );
    const generated = new Set(
      Object.values(spec.generatedArtifactRefs)
        .filter(Boolean)
        .map((file) => path.resolve(rootDir, file)),
    );
    for (const ref of component.implementedStoryRefs) {
      const file = storyIndex.fileByStoryId.get(ref.storyId);
      if (!file)
        errors.push(
          `[CT-9B_PROOF_STRUCTURE_UNRESOLVED_STORY_REF] ${spec.componentId}: ${ref.storyId}`,
        );
      else if (!owned.has(ref.storyId) && !generated.has(file))
        errors.push(
          `[CT-9B_PROOF_STRUCTURE_STORY_NOT_OWNED_BY_SPEC] ${spec.componentId}: ${ref.storyId}`,
        );
      if (owned.has(ref.storyId) && !owned.get(ref.storyId).includes(ref.kind))
        errors.push(
          `[STORYBOOK_PROOF_KIND_MISMATCH] ${spec.componentId}: ${ref.storyId} does not own kind ${ref.kind}`,
        );
    }
    for (const ref of spec.ownedStoryRefs) {
      if (!storyIndex.fileByStoryId.has(ref.storyId))
        errors.push(
          `[CT-9B_PROOF_STRUCTURE_UNRESOLVED_STORY_REF] owned ${spec.componentId}: ${ref.storyId}`,
        );
      for (const kind of ref.kinds)
        if (
          !component.implementedStoryRefs.some(
            (entry) => entry.storyId === ref.storyId && entry.kind === kind,
          )
        )
          errors.push(
            `[STORYBOOK_PROOF_OWNED_REF_MISSING] ${spec.componentId}: ${ref.storyId}/${kind} not in inventory`,
          );
    }
    for (const storyId of spec.downstreamHooks.exampleStoryIds)
      if (
        !component.implementedStoryRefs.some((ref) => ref.storyId === storyId)
      )
        errors.push(
          `[STORYBOOK_PROOF_EXAMPLE_MISSING] ${spec.componentId}: ${storyId}`,
        );
    facts.push({
      componentId: spec.componentId,
      tier: spec.tier,
      generatedArtifactRefs: { ...spec.generatedArtifactRefs },
      requiredKinds: sortKinds([
        ...tier.minimumRequiredKinds.map((entry) => entry.kind),
        ...spec.requiredStoryKinds,
      ]),
      implementedKinds: sortKinds(
        component.implementedStoryRefs.map((entry) => entry.kind),
      ),
    });
  }
  for (const spec of specs) {
    if (!entries.has(spec.componentId))
      errors.push(`[CT-9B_PROOF_STRUCTURE_ORPHAN_SPEC] ${spec.componentId}`);
    for (const [key, file] of Object.entries(spec.generatedArtifactRefs))
      if (
        file !== null &&
        !storyIndex.storiesByFile.get(path.resolve(rootDir, file))?.length
      )
        errors.push(
          `[CT-9B_PROOF_STRUCTURE_UNRESOLVED_GENERATED_ARTIFACT_REF] ${spec.componentId}: ${key}=${file}`,
        );
  }
  return {
    errors,
    componentFacts: errors.length
      ? null
      : facts.sort((a, b) => a.componentId.localeCompare(b.componentId)),
  };
}
