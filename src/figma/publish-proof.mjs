import fs from "node:fs";
import path from "node:path";

import { CannotEvaluateError, portablePublishModes } from "./profile.mjs";

export const publishProofUsage =
  "Usage: ds-skills proof validate --proof <path> --profile <path>";

/**
 * Portable invariants. Deliberately not profile-configurable: a profile may
 * narrow the mode set (see profile.mjs) but may not add to it, and the status
 * set, SHA format and timestamp format are the package's guarantees.
 */
export const publishProofModes = new Set(portablePublishModes);
export const materializationStatuses = new Set(["passed", "failed"]);

const shaPattern = /^[a-f0-9]{40}$/;
const utcIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/**
 * Reads the proof's bytes as well as its data. The bytes are what the ledger's
 * `publication.sha256` binds to, so they must not be re-serialized on the way
 * to the digest — a reformat would change the digest and a normalization would
 * hide one.
 */
export function readPublishProof(target) {
  const absPath = path.resolve(target);
  let bytes;
  try {
    bytes = fs.readFileSync(absPath);
  } catch {
    throw new CannotEvaluateError(
      "PROOF_UNREADABLE",
      `publish proof could not be read: ${absPath}`,
    );
  }

  let data;
  try {
    data = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new CannotEvaluateError(
      "PROOF_MALFORMED",
      `publish proof is not valid JSON: ${absPath} (${error.message})`,
    );
  }

  return { absPath, bytes, data };
}

export function loadAndValidatePublishProof(target, profile) {
  const { absPath, bytes, data } = readPublishProof(target);
  return {
    absPath,
    bytes,
    data,
    errors: validatePublishProof(data, profile),
  };
}

export function validatePublishProof(data, profile) {
  requireProfile(profile);
  const errors = [];

  if (!assertPlainObject(errors, data, "publish proof must be a JSON object")) {
    return errors;
  }

  validateKeySpec(
    errors,
    data,
    {
      required: [
        "proofVersion",
        "mode",
        "artifact",
        "destination",
        "materialization",
        "carrier",
      ],
      optional: [],
    },
    "publishProof",
  );
  requireLiteral(errors, data.proofVersion, "1", "proofVersion");

  if (!profile.publishModes.includes(data.mode)) {
    errors.push(
      `[CT-7B_PUBLISH_PROOF_INVALID_MODE] mode must be one of: ${profile.publishModes.join(", ")}`,
    );
  }

  validateArtifact(errors, data.artifact, profile);
  validateDestination(errors, data.destination, profile);
  validateMaterialization(errors, data.materialization);
  validateCarrier(errors, data.carrier, data.mode);

  return errors;
}

function validateArtifact(errors, artifact, profile) {
  if (!assertPlainObject(errors, artifact, "artifact must be an object")) {
    return;
  }

  validateKeySpec(
    errors,
    artifact,
    { required: ["path", "gitSha"], optional: [] },
    "artifact",
  );
  requireLiteral(errors, artifact.path, profile.artifactPath, "artifact.path");

  if (
    typeof artifact.gitSha !== "string" ||
    !shaPattern.test(artifact.gitSha)
  ) {
    errors.push(
      "[CT-7B_PUBLISH_PROOF_INVALID_ARTIFACT_GIT_SHA] artifact.gitSha must be a 40-character lowercase git SHA",
    );
  }
}

function validateDestination(errors, destination, profile) {
  if (
    !assertPlainObject(errors, destination, "destination must be an object")
  ) {
    return;
  }

  validateKeySpec(
    errors,
    destination,
    { required: ["name", "figmaFile"], optional: [] },
    "destination",
  );
  requireLiteral(
    errors,
    destination.name,
    profile.destinationName,
    "destination.name",
  );
  requireLiteral(
    errors,
    destination.figmaFile,
    profile.destinationFigmaFile,
    "destination.figmaFile",
  );
}

function validateMaterialization(errors, materialization) {
  if (
    !assertPlainObject(
      errors,
      materialization,
      "materialization must be an object",
    )
  ) {
    return;
  }

  const materializationKeySpec =
    materialization.status === "failed"
      ? { required: ["status", "attemptedAt", "notes"], optional: [] }
      : { required: ["status", "attemptedAt"], optional: ["notes"] };

  validateKeySpec(
    errors,
    materialization,
    materializationKeySpec,
    "materialization",
  );

  if (!materializationStatuses.has(materialization.status)) {
    errors.push(
      "[CT-7B_PUBLISH_PROOF_INVALID_STATUS] materialization.status must be passed or failed",
    );
  }

  if (
    typeof materialization.attemptedAt !== "string" ||
    !utcIsoPattern.test(materialization.attemptedAt) ||
    Number.isNaN(Date.parse(materialization.attemptedAt))
  ) {
    errors.push(
      "[CT-7B_PUBLISH_PROOF_INVALID_ATTEMPTED_AT] materialization.attemptedAt must be an ISO-8601 UTC timestamp",
    );
  }

  if (
    materialization.notes !== undefined &&
    (typeof materialization.notes !== "string" ||
      materialization.notes.length === 0)
  ) {
    errors.push(
      "[CT-7B_PUBLISH_PROOF_INVALID_NOTES] materialization.notes must be a non-empty string when present",
    );
  }

  if (
    materialization.status === "failed" &&
    materialization.notes === undefined
  ) {
    errors.push(
      "[CT-7B_PUBLISH_PROOF_MISSING_NOTES] materialization.notes is required when materialization.status is failed",
    );
  }
}

function validateCarrier(errors, carrier, mode) {
  if (!assertPlainObject(errors, carrier, "carrier must be an object")) {
    return;
  }

  validateKeySpec(
    errors,
    carrier,
    { required: ["used", "reason", "exitExpectation"], optional: [] },
    "carrier",
  );

  if (typeof carrier.used !== "boolean") {
    errors.push(
      "[CT-7B_PUBLISH_PROOF_INVALID_CARRIER_USED] carrier.used must be a boolean",
    );
    return;
  }

  if (carrier.used) {
    requireNonEmptyString(errors, carrier.reason, "carrier.reason");
    requireNonEmptyString(
      errors,
      carrier.exitExpectation,
      "carrier.exitExpectation",
    );

    if (mode !== "tokens-studio-carried") {
      errors.push(
        "[CT-7B_PUBLISH_PROOF_CARRIER_MODE_MISMATCH] carrier.used=true requires mode=tokens-studio-carried",
      );
    }
    return;
  }

  if (carrier.reason !== null) {
    errors.push(
      "[CT-7B_PUBLISH_PROOF_FORBIDDEN_CARRIER_REASON] carrier.reason must be null when carrier.used is false",
    );
  }

  if (carrier.exitExpectation !== null) {
    errors.push(
      "[CT-7B_PUBLISH_PROOF_FORBIDDEN_CARRIER_EXIT] carrier.exitExpectation must be null when carrier.used is false",
    );
  }

  if (mode === "tokens-studio-carried") {
    errors.push(
      "[CT-7B_PUBLISH_PROOF_CARRIER_MODE_MISMATCH] mode=tokens-studio-carried requires carrier.used=true",
    );
  }
}

function requireProfile(profile) {
  if (
    profile === undefined ||
    profile === null ||
    typeof profile.artifactPath !== "string"
  ) {
    throw new CannotEvaluateError(
      "PROFILE_REQUIRED",
      "validatePublishProof requires a resolved profile; see readProfile()",
    );
  }
}

function assertPlainObject(errors, value, message) {
  if (!isPlainObject(value)) {
    errors.push(message);
    return false;
  }

  return true;
}

function validateKeySpec(errors, value, keySpec, label) {
  const requiredKeys = [...keySpec.required].sort();
  const optionalKeys = [...(keySpec.optional ?? [])].sort();
  const allowedKeys = [...requiredKeys, ...optionalKeys].sort();
  const actualKeys = Object.keys(value).sort();

  for (const key of requiredKeys) {
    if (!actualKeys.includes(key)) {
      errors.push(
        `[CT-7B_PUBLISH_PROOF_MISSING_REQUIRED_KEY] ${label}.${key} is required`,
      );
    }
  }

  for (const key of actualKeys) {
    if (!allowedKeys.includes(key)) {
      errors.push(
        `[CT-7B_PUBLISH_PROOF_UNEXPECTED_KEY] ${label}.${key} is not allowed`,
      );
    }
  }
}

function requireLiteral(errors, actual, expected, label) {
  if (actual !== expected) {
    errors.push(
      `[CT-7B_PUBLISH_PROOF_INVALID_LITERAL] ${label} must be ${expected}`,
    );
  }
}

function requireNonEmptyString(errors, actual, label) {
  if (typeof actual !== "string" || actual.length === 0) {
    errors.push(
      `[CT-7B_PUBLISH_PROOF_INVALID_STRING] ${label} must be a non-empty string`,
    );
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
