/**
 * @atomize-hq/figma-token-rail
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
