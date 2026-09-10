import path from "node:path";
import {
  captureProofInputs,
  assertProofInputsUnchanged,
} from "./proof-inputs.mjs";
import { parseStorySource } from "./csf-parser.mjs";
import { validateStoryInventory } from "./inventory.mjs";
import { validateComponentTierPolicy } from "./tier-policy.mjs";
import { validateStorybookVersionPolicy } from "./version-policy.mjs";
import { validateComponentSpec } from "./component-spec.mjs";
import { linkProofInputs } from "./proof-links.mjs";

export function validateStorybookProofStructure(
  project,
  snapshot = captureProofInputs(project),
) {
  const errors = [],
    specs = [],
    proof = project.storybook.proof;
  function read(file, validate) {
    let data;
    try {
      data = JSON.parse(snapshot.files.get(file));
    } catch {
      errors.push(`[STORYBOOK_PROOF_JSON] Invalid JSON: ${file}`);
      return null;
    }
    const findings = validate(data);
    errors.push(...findings.map((error) => `${file}: ${error}`));
    return findings.length ? null : data;
  }
  const inventory = read(project.storybook.inventory, validateStoryInventory);
  const tierPolicy = read(
    project.storybook.tierPolicy,
    validateComponentTierPolicy,
  );
  read(project.storybook.versionPolicy, validateStorybookVersionPolicy);
  for (const file of snapshot.specFiles) {
    const data = read(file, (value) =>
      validateComponentSpec(value, {
        filenameStem: path.basename(file, ".json"),
        generatedArtifactKeys: proof.generatedArtifactKeys,
      }),
    );
    if (data) specs.push(data);
  }
  const storyIndex = { fileByStoryId: new Map(), storiesByFile: new Map() };
  for (const file of snapshot.storyFiles) {
    const parsed = parseStorySource(snapshot.files.get(file), file);
    errors.push(...parsed.errors);
    storyIndex.storiesByFile.set(file, parsed.storyIds);
    for (const id of parsed.storyIds) {
      if (storyIndex.fileByStoryId.has(id))
        errors.push(
          `[CT-9B_PROOF_STRUCTURE_DUPLICATE_STORY_ID] ${id}: ${storyIndex.fileByStoryId.get(id)} and ${file}`,
        );
      else storyIndex.fileByStoryId.set(id, file);
    }
  }
  let componentFacts = null;
  if (!errors.length) {
    const result = linkProofInputs({
      inventory,
      tierPolicy,
      specs,
      storyIndex,
      rootDir: project.rootDir,
    });
    errors.push(...result.errors);
    componentFacts = result.componentFacts;
  }
  assertProofInputsUnchanged(project, snapshot);
  return {
    ok: errors.length === 0,
    errors,
    componentFacts,
    storyCount: storyIndex.fileByStoryId.size,
    sourceCount: snapshot.storyFiles.length,
  };
}
