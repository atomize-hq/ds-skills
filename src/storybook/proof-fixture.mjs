import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadProject } from "../project/config.mjs";
import { storybookPolicyFixture } from "./fixture.mjs";
export function proofFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ds-proof-"));
  const data = storybookPolicyFixture(options);
  const component = data.inventory.components[0].componentId;
  const storyId = data.inventory.components[0].implementedStoryRefs[0].storyId;
  const write = (file, value) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };
  const config = {
    projectVersion: "1",
    tokens: null,
    storybook: {
      format: "csf-policy-v1",
      inventory: "policy/inventory.json",
      tierPolicy: "policy/tiers.json",
      versionPolicy: "policy/version.json",
      proof: {
        adapter: "csf-ts-v1",
        storyRoots: ["library"],
        componentSpecs: "specs",
        generatedArtifactKeys: ["guidance"],
        coverage: "reports/coverage.json",
        lockPath: "locks/proof.lock",
      },
    },
  };
  const spec = {
    specVersion: "1",
    componentId: component,
    tier: data.tierPolicy.tierOrder[0],
    requiredStoryKinds: ["default"],
    ownedStoryRefs: [{ storyId, kinds: ["default"] }],
    generatedArtifactRefs: { guidance: null },
    downstreamHooks: {
      codeEntrypoint: null,
      figmaComponentRef: null,
      supportedVariantsSource: null,
      slotNamesSource: null,
      exampleStoryIds: [storyId],
    },
  };
  write("project.json", config);
  write(config.storybook.inventory, data.inventory);
  write(config.storybook.tierPolicy, data.tierPolicy);
  write(config.storybook.versionPolicy, data.versionPolicy);
  write(`specs/${component}.json`, spec);
  write(
    "library/demo.stories.tsx",
    `export default { title: '${component}' }; export const Default = {};`,
  );
  return {
    root,
    config,
    data,
    spec,
    component,
    write,
    project: () => loadProject(path.join(root, "project.json")),
  };
}
