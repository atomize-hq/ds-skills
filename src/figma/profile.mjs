import fs from "node:fs";
import path from "node:path";

/**
 * A consumer's declared expectations, read from the same profile file the
 * schema validator uses (`x-repo-profile` fragments — see schemas/README.md).
 * One profile per consumer, not one per validator: the duplication §4.5 of the
 * boundary contract closes is `publishProofArtifactPath` and
 * `syncLedgerArtifactPath` declaring the same literal independently, and it is
 * closed here by both validators reading the single `artifact-path` key.
 */

/** Thrown when the rail cannot be evaluated at all — CLI exit 2, no stdout. */
export class CannotEvaluateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CannotEvaluateError";
    this.code = code;
  }
}

export const portablePublishModes = [
  "plugin-import-manual",
  "tokens-studio-carried",
];

/**
 * Extension points that would relax something the package guarantees. A profile
 * naming one is rejected rather than ignored: silently dropping the key would
 * let a consumer believe it had relaxed an invariant that in fact still holds,
 * which is worse than either honouring or refusing it.
 */
export const portableInvariantKeys = [
  "carrier-rule",
  "exception-statuses",
  "ledger-version",
  "materialization-statuses",
  "parity-modes",
  "proof-version",
  "sha-format",
];

export const requiredProfileKeys = [
  "artifact-path",
  "destination-figma-file",
  "destination-name",
];

export function readProfile(target) {
  const absPath = path.resolve(target);
  let text;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch {
    throw new CannotEvaluateError(
      "PROFILE_UNREADABLE",
      `profile could not be read: ${absPath}`,
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new CannotEvaluateError(
      "PROFILE_MALFORMED",
      `profile is not valid JSON: ${absPath} (${error.message})`,
    );
  }

  return { absPath, profile: resolveProfile(data, absPath) };
}

/** Turns the schema-fragment profile into the literals the validators compare. */
export function resolveProfile(data, label = "<profile>") {
  if (!isPlainObject(data)) {
    throw new CannotEvaluateError(
      "PROFILE_MALFORMED",
      `profile must be a JSON object: ${label}`,
    );
  }

  const offending = portableInvariantKeys.filter((key) =>
    Object.prototype.hasOwnProperty.call(data, key),
  );
  if (offending.length > 0) {
    throw new CannotEvaluateError(
      "PROFILE_OVERRIDES_INVARIANT",
      `profile may not override portable invariants: ${offending.join(", ")} (${label})`,
    );
  }

  for (const key of requiredProfileKeys) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) {
      throw new CannotEvaluateError(
        "PROFILE_MISSING_KEY",
        `profile is missing required key "${key}": ${label}`,
      );
    }
  }

  return {
    artifactPath: readConst(data, "artifact-path", label),
    destinationName: readConst(data, "destination-name", label),
    destinationFigmaFile: readConst(data, "destination-figma-file", label),
    publishModes: readPublishModes(data, label),
  };
}

function readConst(data, key, label) {
  const fragment = data[key];
  if (
    !isPlainObject(fragment) ||
    typeof fragment.const !== "string" ||
    fragment.const.length === 0
  ) {
    throw new CannotEvaluateError(
      "PROFILE_INVALID_KEY",
      `profile key "${key}" must be a fragment with a non-empty string "const": ${label}`,
    );
  }
  return fragment.const;
}

function readPublishModes(data, label) {
  if (!Object.prototype.hasOwnProperty.call(data, "publish-modes")) {
    return [...portablePublishModes];
  }

  const fragment = data["publish-modes"];
  if (
    !isPlainObject(fragment) ||
    !Array.isArray(fragment.enum) ||
    fragment.enum.length === 0
  ) {
    throw new CannotEvaluateError(
      "PROFILE_INVALID_KEY",
      `profile key "publish-modes" must be a fragment with a non-empty "enum": ${label}`,
    );
  }

  // Narrowing only. A profile that could widen this enum could re-enable the
  // retired REST mode by declaring it, which is the one thing the retirement
  // has to stay retired against.
  const widened = fragment.enum.filter(
    (mode) => !portablePublishModes.includes(mode),
  );
  if (widened.length > 0) {
    throw new CannotEvaluateError(
      "PROFILE_WIDENS_PUBLISH_MODES",
      `profile may only narrow publish modes; unknown mode(s): ${widened.join(", ")} (${label})`,
    );
  }

  return [...fragment.enum];
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
