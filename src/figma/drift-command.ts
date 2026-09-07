import fs from "node:fs";
import path from "node:path";

import {
  buildExpectedVariables,
  compareFigmaVariables,
  formatDriftReport,
  type DriftReport,
  type ObservedCollection,
} from "../drift.js";
import { CannotEvaluateError } from "./profile.mjs";

/**
 * `figma drift` — compare a recorded observation of the Figma file against the
 * artifact.
 *
 * The source of observed state is a **file**, named on the command line, and
 * that is the whole design decision. Figma's variables are readable only from
 * inside a plugin session, so a command that produced its own observation would
 * need a live editor — which would make it useless as a gate and impossible to
 * run in CI. Recording the observation and checking it are two steps on
 * purpose, and only the second one is a check.
 */

export interface DriftOptions {
  readonly configPath: string;
  readonly artifactPath: string;
  readonly observedPath: string;
}

export interface DriftResult {
  readonly ok: boolean;
  readonly report: DriftReport;
  readonly rendered: string;
  readonly observedFrom: string;
}

export const observedStateGuidance =
  "--observed <path> is required: a recorded observation of the Figma collection, " +
  "as posted by the plugin to the serve endpoint. Figma variables are readable only " +
  "inside a plugin session, so this command never reads them itself — which is what " +
  "lets it run as a gate.";

export function checkDrift(options: DriftOptions): DriftResult {
  const config = readJson(options.configPath, "CONFIG") as {
    collectionName: string;
    extensionsNamespace: string | null;
    fallbackThemeId: string;
  };
  const artifact = readJson(options.artifactPath, "ARTIFACT");
  const observed = readObserved(options.observedPath, config.collectionName);

  const expected = buildExpectedVariables(artifact, {
    extensionsNamespace: config.extensionsNamespace,
    fallbackThemeId: config.fallbackThemeId,
  });
  const report = compareFigmaVariables(expected, observed);

  return {
    ok: report.ok,
    report,
    rendered: formatDriftReport(report),
    observedFrom: path.resolve(options.observedPath),
  };
}

/**
 * Accepts either a bare `ObservedCollection` or the envelope the serve endpoint
 * writes, which wraps one alongside its provenance. Both are things a consumer
 * genuinely has; guessing between them is worse than accepting both explicitly.
 */
function readObserved(
  target: string,
  collectionName: string,
): ObservedCollection {
  const data = readJson(target, "OBSERVED") as Record<string, unknown>;
  const collection = (
    isObservedCollection(data) ? data : data["collection"]
  ) as ObservedCollection | undefined;

  if (!isObservedCollection(collection)) {
    throw new CannotEvaluateError(
      "OBSERVED_MALFORMED",
      `${path.resolve(target)} is not an observed collection: expected name, modeNames and variables, ` +
        "either at the top level or under a `collection` key",
    );
  }
  if (collection.name !== collectionName) {
    throw new CannotEvaluateError(
      "OBSERVED_WRONG_COLLECTION",
      `the observation is of collection "${collection.name}", the config names "${collectionName}"`,
    );
  }
  return collection;
}

function isObservedCollection(value: unknown): value is ObservedCollection {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["name"] === "string" &&
    Array.isArray(candidate["modeNames"]) &&
    Array.isArray(candidate["variables"])
  );
}

function readJson(target: string, what: string): unknown {
  const absPath = path.resolve(target);
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch (error) {
    throw new CannotEvaluateError(
      `${what}_UNREADABLE`,
      `${what.toLowerCase()} could not be read as JSON: ${absPath} (${(error as Error).message})`,
    );
  }
}
