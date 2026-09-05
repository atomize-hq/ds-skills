/**
 * Read-only comparison between a published DTCG artifact and what a Figma
 * file actually contains.
 *
 * The repo is canonical: its token sources are the only authoring surface and
 * the artifact is their published projection. This module never converts Figma
 * back into DTCG — it only reports where the two disagree, so an intentional
 * Figma-side edit surfaces as a reviewable finding instead of being silently
 * written into canon.
 *
 * Everything here is pure so it can be unit tested without the Figma API. The
 * plugin supplies an `ObservedCollection` snapshot; both the SYNC write-back
 * verification and the CHECK drift report run through `compareFigmaVariables`,
 * so the two can never diverge.
 */

import { defaultConfig, type RailConfig } from "./config";
import {
  flattenTokenDocument,
  type FigmaResolvedType,
  type FigmaValue,
} from "./token-mapping";

/** Kept as a named export for consumers that pinned to it. */
export const fallbackThemeId = defaultConfig.fallbackThemeId;

/** The slice of config this module reads. */
export type ThemeResolution = Pick<
  RailConfig,
  "extensionsNamespace" | "fallbackThemeId"
>;

export type ExpectedVariable = {
  name: string;
  resolvedType: FigmaResolvedType;
  /** Value per theme id; every theme in `themeIds` is present. */
  valuesByTheme: Record<string, FigmaValue>;
};

export type ExpectedVariableSet = {
  defaultThemeId: string;
  themeIds: string[];
  variables: ExpectedVariable[];
};

/** One Figma variable as observed in the file, keyed by mode *name*, not id. */
export type ObservedVariable = {
  name: string;
  resolvedType: string;
  valuesByMode: Record<string, unknown>;
};

export type ObservedCollection = {
  name: string;
  modeNames: string[];
  variables: ObservedVariable[];
};

export type DriftCode =
  | "MISSING_VARIABLE"
  | "UNEXPECTED_VARIABLE"
  | "TYPE_MISMATCH"
  | "ALIAS_BINDING"
  | "VALUE_MISMATCH"
  | "MISSING_MODE_VALUE"
  | "MISSING_MODE"
  | "UNEXPECTED_MODE";

export type DriftFinding = {
  code: DriftCode;
  name?: string;
  mode?: string;
  detail: string;
};

export type DriftReport = {
  ok: boolean;
  collectionName: string;
  expectedVariableCount: number;
  observedVariableCount: number;
  themeIds: string[];
  findings: DriftFinding[];
};

export function readDefaultThemeId(
  payload: unknown,
  options: Partial<ThemeResolution> = {},
): string {
  const namespace =
    options.extensionsNamespace ?? defaultConfig.extensionsNamespace;
  const fallback = options.fallbackThemeId ?? defaultConfig.fallbackThemeId;

  if (!payload || typeof payload !== "object" || namespace === null)
    return fallback;
  const extensions = (payload as { $extensions?: Record<string, unknown> })
    .$extensions;
  const declared = extensions?.[namespace] as { themeId?: unknown } | undefined;
  return typeof declared?.themeId === "string" ? declared.themeId : fallback;
}

/**
 * The artifact publishes the default theme as the document body and every other
 * registry theme as a partial tree under `$themeOverrides`. Each theme becomes
 * one mode on the Figma collection.
 */
export function buildExpectedVariables(
  payload: unknown,
  options: Partial<ThemeResolution> = {},
): ExpectedVariableSet {
  const base = flattenTokenDocument(payload);
  const defaultThemeId = readDefaultThemeId(payload, options);

  const overridesByTheme = new Map<string, Map<string, FigmaValue>>();
  const rawOverrides = (
    payload as { $themeOverrides?: Record<string, unknown> }
  ).$themeOverrides;
  if (rawOverrides) {
    for (const themeId of Object.keys(rawOverrides)) {
      const leaves = flattenTokenDocument(rawOverrides[themeId]);
      overridesByTheme.set(
        themeId,
        new Map(leaves.map((leaf) => [leaf.name, leaf.value])),
      );
    }
  }

  // The default theme owns the collection's default mode, so it leads the list
  // even if `$themeOverrides` also names it.
  const themeIds = [
    defaultThemeId,
    ...[...overridesByTheme.keys()].filter((id) => id !== defaultThemeId),
  ];

  const variables = base.map((leaf) => {
    const valuesByTheme: Record<string, FigmaValue> = {};
    for (const themeId of themeIds) {
      valuesByTheme[themeId] =
        overridesByTheme.get(themeId)?.get(leaf.name) ?? leaf.value;
    }
    return { name: leaf.name, resolvedType: leaf.resolvedType, valuesByTheme };
  });

  return { defaultThemeId, themeIds, variables };
}

export function compareFigmaVariables(
  expected: ExpectedVariableSet,
  observed: ObservedCollection,
): DriftReport {
  const findings: DriftFinding[] = [];
  const observedByName = new Map(
    observed.variables.map((entry) => [entry.name, entry]),
  );
  const expectedNames = new Set(expected.variables.map((entry) => entry.name));
  const observedModes = new Set(observed.modeNames);

  for (const themeId of expected.themeIds) {
    if (!observedModes.has(themeId)) {
      findings.push({
        code: "MISSING_MODE",
        mode: themeId,
        detail: `artifact declares theme "${themeId}" but the collection has no such mode`,
      });
    }
  }
  for (const modeName of observed.modeNames) {
    if (!expected.themeIds.includes(modeName)) {
      findings.push({
        code: "UNEXPECTED_MODE",
        mode: modeName,
        detail: `collection has mode "${modeName}" which the artifact does not declare`,
      });
    }
  }

  for (const variable of expected.variables) {
    const actual = observedByName.get(variable.name);
    if (!actual) {
      findings.push({
        code: "MISSING_VARIABLE",
        name: variable.name,
        detail: "published by the artifact but absent from the collection",
      });
      continue;
    }

    if (actual.resolvedType !== variable.resolvedType) {
      findings.push({
        code: "TYPE_MISMATCH",
        name: variable.name,
        detail: `expected ${variable.resolvedType}, found ${actual.resolvedType}`,
      });
      continue;
    }

    for (const themeId of expected.themeIds) {
      if (!observedModes.has(themeId)) continue;

      const actualValue = actual.valuesByMode[themeId];
      if (actualValue === undefined) {
        findings.push({
          code: "MISSING_MODE_VALUE",
          name: variable.name,
          mode: themeId,
          detail: `no value set in mode "${themeId}"`,
        });
        continue;
      }

      // The artifact only ever publishes literals, so an alias here means
      // someone repointed this token at another variable inside Figma.
      if (isVariableAlias(actualValue)) {
        findings.push({
          code: "ALIAS_BINDING",
          name: variable.name,
          mode: themeId,
          detail: `bound to another variable in mode "${themeId}"; the artifact publishes a literal`,
        });
        continue;
      }

      const expectedValue = variable.valuesByTheme[themeId];
      if (!valuesEqual(expectedValue, actualValue)) {
        findings.push({
          code: "VALUE_MISMATCH",
          name: variable.name,
          mode: themeId,
          detail: `mode "${themeId}": expected ${describeValue(expectedValue)}, found ${describeValue(actualValue)}`,
        });
      }
    }
  }

  for (const entry of observed.variables) {
    if (!expectedNames.has(entry.name)) {
      findings.push({
        code: "UNEXPECTED_VARIABLE",
        name: entry.name,
        detail: "present in the collection but not published by the artifact",
      });
    }
  }

  findings.sort(
    (left, right) =>
      left.code.localeCompare(right.code) ||
      (left.name ?? "").localeCompare(right.name ?? "") ||
      (left.mode ?? "").localeCompare(right.mode ?? ""),
  );

  return {
    ok: findings.length === 0,
    collectionName: observed.name,
    expectedVariableCount: expected.variables.length,
    observedVariableCount: observed.variables.length,
    themeIds: expected.themeIds,
    findings,
  };
}

export function valuesEqual(expected: unknown, actual: unknown): boolean {
  if (typeof expected === "number" && typeof actual === "number") {
    // Figma stores variable floats in single precision, so 0.7 reads back as
    // 0.699999988079071. Comparing float64 exactly would reject every value
    // that is not representable in float32; compare in float32 instead.
    // Colors already sidestep this via closeTo() on each channel.
    return Object.is(Math.fround(expected), Math.fround(actual));
  }
  if (typeof expected === "string" && typeof actual === "string")
    return expected === actual;
  if (typeof expected === "boolean" && typeof actual === "boolean")
    return expected === actual;
  if (isRgba(expected) && isRgba(actual)) {
    return (
      closeTo(expected.r, actual.r) &&
      closeTo(expected.g, actual.g) &&
      closeTo(expected.b, actual.b) &&
      closeTo(expected.a ?? 1, actual.a ?? 1)
    );
  }
  return false;
}

export function isVariableAlias(
  value: unknown,
): value is { type: "VARIABLE_ALIAS"; id: string } {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as Record<string, unknown>).type === "VARIABLE_ALIAS"
  );
}

export function formatDriftReport(report: DriftReport): string {
  const header = [
    report.ok
      ? "Figma drift: NONE"
      : `Figma drift: ${report.findings.length} finding(s)`,
    `collection=${report.collectionName}`,
    `modes=${report.themeIds.join(", ")}`,
    `expected=${report.expectedVariableCount} observed=${report.observedVariableCount}`,
  ];
  if (report.ok) {
    return [
      ...header,
      "",
      "The Figma file matches the published artifact.",
    ].join("\n");
  }
  const lines = report.findings.map(
    (finding) =>
      `  [${finding.code}] ${finding.name ?? finding.mode ?? ""} — ${finding.detail}`,
  );
  return [...header, "", ...lines].join("\n");
}

function describeValue(value: unknown): string {
  if (isRgba(value)) return rgbaToHex(value);
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function rgbaToHex(color: {
  r: number;
  g: number;
  b: number;
  a?: number;
}): string {
  const channel = (input: number) =>
    Math.round(Math.max(0, Math.min(1, input)) * 255)
      .toString(16)
      .padStart(2, "0");
  const alpha = color.a ?? 1;
  const base = `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
  return alpha >= 1 - 1 / 510 ? base : `${base}${channel(alpha)}`;
}

function isRgba(
  value: unknown,
): value is { r: number; g: number; b: number; a?: number } {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Record<string, unknown>;
  return (
    typeof maybe.r === "number" &&
    typeof maybe.g === "number" &&
    typeof maybe.b === "number" &&
    (maybe.a === undefined || typeof maybe.a === "number")
  );
}

function closeTo(left: number, right: number) {
  return Math.abs(left - right) < 1e-6;
}
