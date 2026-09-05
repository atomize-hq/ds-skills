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
} from "./config";

export {
  flattenTokenDocument,
  type FigmaColor,
  type FigmaResolvedType,
  type FigmaValue,
  type TokenLeaf,
  type TokenLeafType,
} from "./token-mapping";

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
} from "./drift";

export {
  createSyncPlan,
  FigmaVariablesSyncError,
  formatSyncError,
  normalizeSyncError,
  parseFigmaFileKey,
  resolveAccessToken,
  syncVariablesViaRest,
  verifySyncOutcome,
  type RestSyncOptions,
  type RestSyncResult,
  type SyncPhase,
  type SyncPlan,
  type SyncVerification,
} from "./rails/rest-variables";
