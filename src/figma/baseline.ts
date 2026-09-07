import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildExpectedVariables } from "../drift.js";
import { buildPlugin } from "../plugin/build.js";
import { CannotEvaluateError } from "./profile.mjs";

/**
 * `figma baseline` — capture the reviewed references, or check against them.
 *
 * Capture and verification are separate behaviours on purpose. A tool that
 * refreshes its own expectations when they disagree is not a check, and the
 * whole value of a pre-migration reference is that the new code never wrote it.
 */

export type BaselineName = "plugin-manifest" | "token-rail";

export interface BaselineOptions {
  readonly configPath: string;
  readonly artifactPath: string;
  readonly outDir: string;
  /**
   * Where the consumer's built plugin lives. Supplying it names the manifest
   * the baseline describes, and lets the capture notice that the committed
   * build has drifted from what this config now produces.
   */
  readonly pluginOutDir?: string;
  readonly force?: boolean;
}

export interface BaselineOutcome {
  readonly name: BaselineName;
  readonly file: string;
  readonly status: "written" | "unchanged" | "drifted" | "missing";
}

export interface BaselineResult {
  readonly ok: boolean;
  readonly outcomes: BaselineOutcome[];
  readonly errors: string[];
}

const fileNames: Record<BaselineName, string> = {
  "plugin-manifest": "plugin-manifest.baseline.json",
  "token-rail": "token-rail.baseline.json",
};

/** Never writes. Fails when a required reference is absent. */
export function checkBaselines(options: BaselineOptions): BaselineResult {
  const { entries: captured, errors } = captureAll(options);
  const outcomes: BaselineOutcome[] = [];

  for (const [name, data] of captured) {
    const file = path.join(path.resolve(options.outDir), fileNames[name]);
    if (!fs.existsSync(file)) {
      outcomes.push({ name, file, status: "missing" });
      // A missing reference is a failure, not an invitation to create one:
      // "there is nothing to compare against" and "it matches" are different
      // answers, and only one of them is a pass.
      errors.push(
        `[RAIL_BASELINE_MISSING] no reviewed reference at ${file}; capture it deliberately with \`figma baseline\``,
      );
      continue;
    }
    const same = readExisting(file) !== null && matches(file, data);
    outcomes.push({ name, file, status: same ? "unchanged" : "drifted" });
    if (!same) {
      errors.push(
        `[RAIL_BASELINE_DRIFT] ${path.basename(file)} does not match what the current inputs produce`,
      );
    }
  }

  return { ok: errors.length === 0, outcomes, errors };
}

/**
 * Captures both references, and writes **neither** if either has drifted. A
 * partial write leaves the reference set internally inconsistent, which is
 * worse than not writing at all — half a baseline still looks like a baseline.
 */
export function captureBaselines(options: BaselineOptions): BaselineResult {
  const { entries: captured, errors: captureErrors } = captureAll(options);
  const outDir = path.resolve(options.outDir);
  const planned: Array<{
    name: BaselineName;
    file: string;
    data: Record<string, unknown>;
  }> = [];
  const drifted: string[] = [];

  for (const [name, data] of captured) {
    const file = path.join(outDir, fileNames[name]);
    if (fs.existsSync(file) && !matches(file, data)) drifted.push(file);
    planned.push({ name, file, data });
  }

  if (drifted.length > 0 && options.force !== true) {
    return {
      ok: false,
      outcomes: planned.map(({ name, file }) => ({
        name,
        file,
        status: drifted.includes(file) ? "drifted" : "unchanged",
      })),
      errors: [
        ...captureErrors,
        `[RAIL_BASELINE_WOULD_OVERWRITE] ${drifted.length} reference(s) differ from what the current inputs produce; nothing was written. ` +
          `Reconcile the difference, or re-capture deliberately with --force: ${drifted.map((f) => path.basename(f)).join(", ")}`,
      ],
    };
  }

  fs.mkdirSync(outDir, { recursive: true });
  const outcomes: BaselineOutcome[] = [];
  for (const { name, file, data } of planned) {
    const existing = readExisting(file);
    const existed = existing !== null && matches(file, data);

    // An unchanged reference is left alone, byte for byte. Rewriting it would
    // reformat a reviewed file — a consumer's formatter and JSON.stringify
    // disagree about short arrays — turning "nothing changed" into a diff.
    if (existed) {
      outcomes.push({ name, file, status: "unchanged" });
      continue;
    }

    // Provenance carries forward; only the captured facts are replaced. A key
    // this tool generates is never re-hoisted from the existing file — doing so
    // reorders the output, and a capture whose second run is not a no-op diff
    // cannot be told apart from one that found real drift.
    const preserved: Record<string, unknown> = {};
    for (const key of provenanceKeys) {
      if (existing !== null && key in existing && !(key in data)) {
        preserved[key] = existing[key];
      }
    }
    fs.writeFileSync(file, serialize({ ...preserved, ...data }));
    outcomes.push({ name, file, status: existed ? "unchanged" : "written" });
  }
  return { ok: captureErrors.length === 0, outcomes, errors: captureErrors };
}

function captureAll(options: BaselineOptions): {
  entries: Array<[BaselineName, Record<string, unknown>]>;
  errors: string[];
} {
  const manifest = captureManifest(options);
  return {
    entries: [
      ["plugin-manifest", manifest.data],
      ["token-rail", captureMapping(options)],
    ],
    errors: manifest.errors,
  };
}

/**
 * The manifest is a template with three substitutions and carries no generated
 * field, so it is recorded literally: nothing is excluded, and the comparison
 * stays byte-for-byte rather than a comparison of a filtered subset.
 */
function captureManifest(options: BaselineOptions): {
  data: Record<string, unknown>;
  errors: string[];
} {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ds-skills-baseline-"));
  try {
    // Built into a scratch directory rather than read from a previous build:
    // capturing whatever happens to be on disk records a stale artifact as the
    // reference for the current one.
    const { manifest } = buildPlugin({
      configPath: options.configPath,
      outDir: scratch,
      skipBundle: true,
    });
    const bytes = Buffer.from(manifest, "utf8");
    const builtManifest =
      options.pluginOutDir === undefined
        ? undefined
        : path.resolve(options.pluginOutDir, "manifest.json");
    const errors: string[] = [];

    // A committed plugin build that no longer matches its config is a real
    // finding, and it is invisible to a baseline captured from a scratch build.
    if (builtManifest !== undefined && fs.existsSync(builtManifest)) {
      if (fs.readFileSync(builtManifest, "utf8") !== manifest) {
        errors.push(
          `[RAIL_BASELINE_STALE_BUILD] ${builtManifest} differs from what this config produces; rebuild the plugin`,
        );
      }
    }

    const data = {
      source:
        builtManifest === undefined
          ? fileNames["plugin-manifest"]
          : toPosix(path.relative(process.cwd(), builtManifest)),
      producedBy: "ds-skills figma plugin build",
      excludedFields: [],
      excludedFieldsRationale:
        "The manifest is a static template with three config substitutions. No timestamp, " +
        "digest, path or version is interpolated into it, so no field is excluded and the " +
        "comparison is literal.",
      byteLength: bytes.byteLength,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      bytes: manifest,
    };
    return { data, errors };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function captureMapping(options: BaselineOptions): Record<string, unknown> {
  const config = readJson(options.configPath, "CONFIG") as {
    collectionName: string;
    extensionsNamespace: string | null;
    fallbackThemeId: string;
  };
  const artifact = readJson(options.artifactPath, "ARTIFACT");
  const expected = buildExpectedVariables(artifact, {
    extensionsNamespace: config.extensionsNamespace,
    fallbackThemeId: config.fallbackThemeId,
  });

  return {
    source: toPosix(
      path.relative(process.cwd(), path.resolve(options.artifactPath)),
    ),
    collectionName: config.collectionName,
    extensionsNamespace: config.extensionsNamespace,
    fallbackThemeId: config.fallbackThemeId,
    excludedFields: [],
    excludedFieldsRationale:
      "flattenTokenDocument walks the artifact in document order and buildExpectedVariables " +
      "preserves it; every recorded value is resolved from committed token sources. Nothing is " +
      "generated per run, so nothing is excluded.",
    summary: {
      leafCount: expected.variables.length,
      firstLeaf: expected.variables[0]?.name ?? null,
      lastLeaf: expected.variables.at(-1)?.name ?? null,
      defaultThemeId: expected.defaultThemeId,
      themeIds: expected.themeIds,
    },
    variables: expected.variables,
  };
}

/**
 * Fields describing *who captured this*, not *what was captured*. They are
 * preserved from an existing file rather than compared: a capturer that erased
 * the reviewer's note would be editing the review, and one that reported drift
 * because the tool renamed itself would be crying wolf about its own byline.
 */
export const provenanceKeys = ["$comment", "producedBy", "railDependency"];

/** Compares only the substantive fields this tool generates. */
function matches(file: string, data: Record<string, unknown>): boolean {
  const existing = readExisting(file);
  if (existing === null) return false;
  for (const [key, value] of Object.entries(data)) {
    if (provenanceKeys.includes(key)) continue;
    if (JSON.stringify(existing[key]) !== JSON.stringify(value)) return false;
  }
  return true;
}

function readExisting(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function serialize(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
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
