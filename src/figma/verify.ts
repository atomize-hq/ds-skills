import fs from "node:fs";
import path from "node:path";

import {
  buildExpectedVariables,
  type ExpectedVariable,
  type ExpectedVariableSet,
} from "../drift.js";
import { CannotEvaluateError } from "./profile.mjs";

/**
 * `figma verify` — compare a consumer's real artifact, through its real config,
 * against reviewed baseline data.
 *
 * Two rules make this a check rather than a mirror: the expected side comes from
 * a **reviewed file**, never from the current artifact, and the artifact is read
 * from a **local path**, never from the config's serving origin. A verifier that
 * fetched what the plugin fetches would pass whenever the server agreed with
 * itself.
 */

export interface RailBaseline {
  source: string;
  collectionName: string;
  extensionsNamespace: string | null;
  fallbackThemeId: string;
  summary: {
    leafCount: number;
    firstLeaf: string;
    lastLeaf: string;
    defaultThemeId: string;
    themeIds: string[];
  };
  variables: ExpectedVariable[];
}

export interface VerifyOptions {
  readonly configPath: string;
  readonly expectPath: string;
  readonly artifactPath: string;
  /** How many differing variables to name before summarizing the rest. */
  readonly maxNamed?: number;
}

export interface VerifyResult {
  readonly ok: boolean;
  readonly errors: string[];
  readonly summary: string[];
}

export function verifyMapping(options: VerifyOptions): VerifyResult {
  const config = readJson(options.configPath, "CONFIG");
  const baseline = readJson(options.expectPath, "BASELINE") as RailBaseline;
  const artifact = readJson(options.artifactPath, "ARTIFACT");
  const errors: string[] = [];

  requireBaselineShape(baseline, options.expectPath);
  errors.push(...compareConfig(config, baseline));
  errors.push(...compareArtifactIdentity(options.artifactPath, baseline));

  const expected = buildExpectedVariables(artifact, {
    extensionsNamespace: baseline.extensionsNamespace,
    fallbackThemeId: baseline.fallbackThemeId,
  });

  errors.push(...compareSummary(expected, baseline));
  errors.push(...compareVariables(expected, baseline, options.maxNamed ?? 5));
  errors.push(...checkThemeCompleteness(expected, baseline));
  errors.push(...checkDeclaredTheme(artifact, baseline));

  return {
    ok: errors.length === 0,
    errors,
    summary: [
      `collection=${baseline.collectionName}`,
      `variables=${expected.variables.length}`,
      `themes=${expected.themeIds.join(",")}`,
      `default=${expected.defaultThemeId}`,
    ],
  };
}

function compareConfig(config: unknown, baseline: RailBaseline): string[] {
  const c = config as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of [
    "collectionName",
    "extensionsNamespace",
    "fallbackThemeId",
  ] as const) {
    if (c[key] !== baseline[key]) {
      // A namespace typo silently falls back to the wrong default theme, which
      // is why this is compared rather than simply read from the config.
      errors.push(
        `[RAIL_VERIFY_CONFIG_DRIFT] config.${key} is ${JSON.stringify(c[key])}, the reviewed baseline records ${JSON.stringify(baseline[key])}`,
      );
    }
  }
  return errors;
}

function compareArtifactIdentity(
  artifactPath: string,
  baseline: RailBaseline,
): string[] {
  // Verifying a different artifact than the reference was captured from is a
  // green run that proves nothing about the artifact anyone ships.
  const given = path.resolve(artifactPath);
  const recorded = path.resolve(baseline.source);
  return given === recorded
    ? []
    : [
        `[RAIL_VERIFY_ARTIFACT_MISMATCH] verifying ${given}, but the baseline was captured from ${baseline.source}`,
      ];
}

function compareSummary(
  expected: ExpectedVariableSet,
  baseline: RailBaseline,
): string[] {
  const errors: string[] = [];
  const actual = {
    leafCount: expected.variables.length,
    firstLeaf: expected.variables[0]?.name,
    lastLeaf: expected.variables.at(-1)?.name,
    defaultThemeId: expected.defaultThemeId,
    themeIds: expected.themeIds,
  };

  for (const key of [
    "leafCount",
    "firstLeaf",
    "lastLeaf",
    "defaultThemeId",
  ] as const) {
    if (actual[key] !== baseline.summary[key]) {
      errors.push(
        `[RAIL_VERIFY_SUMMARY_DRIFT] ${key} is ${JSON.stringify(actual[key])}, the baseline records ${JSON.stringify(baseline.summary[key])}`,
      );
    }
  }

  if (
    actual.themeIds.join(",") !== (baseline.summary.themeIds ?? []).join(",")
  ) {
    errors.push(
      `[RAIL_VERIFY_SUMMARY_DRIFT] themeIds are [${actual.themeIds.join(", ")}], the baseline records [${(baseline.summary.themeIds ?? []).join(", ")}]`,
    );
  }

  return errors;
}

/**
 * The full normalized mapping, in order — not the five summary fields. A
 * summary is a diagnostic: an artifact can keep its leaf count and first and
 * last name while every value between them changes.
 */
function compareVariables(
  expected: ExpectedVariableSet,
  baseline: RailBaseline,
  maxNamed: number,
): string[] {
  const differing: string[] = [];
  const length = Math.max(expected.variables.length, baseline.variables.length);

  for (let index = 0; index < length; index += 1) {
    const left = expected.variables[index];
    const right = baseline.variables[index];
    if (left === undefined) {
      differing.push(
        `${right?.name ?? `#${index}`} (missing from the artifact)`,
      );
      continue;
    }
    if (right === undefined) {
      differing.push(`${left.name} (not in the baseline)`);
      continue;
    }
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      differing.push(
        left.name === right.name ? left.name : `${right.name} -> ${left.name}`,
      );
    }
  }

  if (differing.length === 0) return [];

  const named = differing.slice(0, maxNamed);
  const rest =
    differing.length > named.length
      ? ` and ${differing.length - named.length} more`
      : "";
  return [
    `[RAIL_VERIFY_MAPPING_DRIFT] ${differing.length} variable(s) differ from the reviewed baseline: ${named.join(", ")}${rest}`,
  ];
}

/**
 * Every variable carries a value for every theme. Kept as its own check because
 * normalization can conceal it: a variable missing one theme still compares
 * equal to a baseline that was captured while it was missing.
 */
function checkThemeCompleteness(
  expected: ExpectedVariableSet,
  baseline: RailBaseline,
): string[] {
  const wanted = [...baseline.summary.themeIds].sort().join(",");
  const incomplete = expected.variables.filter(
    (variable) =>
      Object.keys(variable.valuesByTheme).sort().join(",") !== wanted,
  );
  return incomplete.length === 0
    ? []
    : [
        `[RAIL_VERIFY_THEME_INCOMPLETE] ${incomplete.length} variable(s) do not carry every theme [${wanted}], first: ${incomplete[0]?.name}`,
      ];
}

/**
 * The real-artifact constraint the consumer's `$themeOverrides` assertion
 * protected: the artifact must actually declare its default theme under the
 * configured namespace. A package fixture cannot inherit this — it is a claim
 * about the shipped artifact, and without it a namespace typo falls through to
 * `fallbackThemeId` and everything else still passes.
 */
function checkDeclaredTheme(
  artifact: unknown,
  baseline: RailBaseline,
): string[] {
  if (baseline.extensionsNamespace === null) return [];

  const extensions = (artifact as { $extensions?: Record<string, unknown> })
    .$extensions;
  const declared = extensions?.[baseline.extensionsNamespace] as
    | { themeId?: unknown }
    | undefined;

  if (declared === undefined) {
    return [
      `[RAIL_VERIFY_NAMESPACE_ABSENT] the artifact declares no $extensions["${baseline.extensionsNamespace}"], so the default theme resolves through the fallback instead of the artifact`,
    ];
  }
  if (declared.themeId !== baseline.summary.defaultThemeId) {
    return [
      `[RAIL_VERIFY_DECLARED_THEME_DRIFT] the artifact declares themeId ${JSON.stringify(declared.themeId)}, the baseline records ${JSON.stringify(baseline.summary.defaultThemeId)}`,
    ];
  }
  return [];
}

function requireBaselineShape(baseline: RailBaseline, label: string): void {
  if (
    baseline === null ||
    typeof baseline !== "object" ||
    !Array.isArray(baseline.variables) ||
    typeof baseline.summary !== "object"
  ) {
    throw new CannotEvaluateError(
      "BASELINE_MALFORMED",
      `${label} is not a rail baseline: expected an object with summary and variables`,
    );
  }
}

function readJson(target: string, what: string): unknown {
  const absPath = path.resolve(target);
  let text: string;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch {
    throw new CannotEvaluateError(
      `${what}_UNREADABLE`,
      `${what.toLowerCase()} could not be read: ${absPath}`,
    );
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CannotEvaluateError(
      `${what}_MALFORMED`,
      `${what.toLowerCase()} is not valid JSON: ${absPath} (${(error as Error).message})`,
    );
  }
}
