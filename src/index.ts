/**
 * @atomize-hq/ds-skills
 *
 * Moves a DTCG token artifact into Figma variables, and reports where a Figma
 * file has drifted from it. The repo that owns the tokens stays canonical:
 * nothing here ever writes Figma's state back into token sources.
 */

export {
  defaultConfig,
  resolveConfig,
  type PartialRailConfig,
  type RailConfig,
} from "./config.js";

export {
  flattenTokenDocument,
  type FigmaColor,
  type FigmaResolvedType,
  type FigmaValue,
  type TokenLeaf,
  type TokenLeafType,
} from "./token-mapping.js";

export {
  buildExpectedVariables,
  compareFigmaVariables,
  fallbackThemeId,
  formatDriftReport,
  isVariableAlias,
  readDefaultThemeId,
  valuesEqual,
  type DriftCode,
  type DriftFinding,
  type DriftReport,
  type ExpectedVariable,
  type ExpectedVariableSet,
  type ObservedCollection,
  type ObservedVariable,
  type ThemeResolution,
} from "./drift.js";

export { validateRecipe, createTokenInventory } from "./recipes/index.mjs";
export { discoverRecipeSources } from "./recipes/sources.mjs";

export { loadProject } from "./project/config.mjs";
export {
  loadBuildGraph,
  createFigmaTokenDocument,
  createThemeOverrideMaps,
} from "./tokens/graph.mjs";

export { renderTokenArtifacts } from "./tokens/render.mjs";
export { checkTokenArtifacts } from "./tokens/artifact-check.mjs";
export { buildTokenArtifacts } from "./tokens/build.mjs";

export { checkTokenRuntime } from "./tokens/runtime-check.mjs";

export { checkTokenManualEdits } from "./tokens/manual-guard.mjs";

export { governTokenProject } from "./tokens/governance.mjs";

export { readReleaseRecord } from "./install/record.mjs";
export { resolveRelease, installPrefix } from "./install/resolve.mjs";

export { acquireRelease } from "./install/acquire.mjs";

export { setupProjectInstallation } from "./project-host/setup.mjs";
export { checkProjectInstallation } from "./project-host/state.mjs";

export { provisionProject } from "./project-host/provision.mjs";

export {
  validateStoryInventory,
  allowedStorybookValidatorKinds,
} from "./storybook/inventory.mjs";
export { validateComponentTierPolicy } from "./storybook/tier-policy.mjs";
export { validateStorybookVersionPolicy } from "./storybook/version-policy.mjs";
export { validateStorybookPolicyProject } from "./storybook/command.mjs";

export { validateComponentSpec } from "./storybook/component-spec.mjs";
export { validateStorybookProofStructure } from "./storybook/proof-structure.mjs";
export { createStorybookProofCoverageReport } from "./storybook/proof-coverage.mjs";
export { evaluateStorybookProof } from "./storybook/proof-command.mjs";

export { evaluateChromaticStatus } from "./chromatic/status.mjs";
export { validateChromaticStatusProject } from "./chromatic/command.mjs";
export { restoreChromaticStatus } from "./chromatic/restore.mjs";

export { publishChromaticReview } from "./chromatic/publish.mjs";

export { evaluateComponentStatus } from "./components/evaluate.mjs";
export { runComponentOperation } from "./components/command.mjs";

export { checkSourcePolicy } from "./source-checks/policy.mjs";
export { checkSourceContract } from "./source-checks/contract.mjs";
