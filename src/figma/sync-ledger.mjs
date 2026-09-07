import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { CannotEvaluateError, portablePublishModes } from "./profile.mjs";

export const syncLedgerUsage =
  "Usage: ds-skills ledger validate --ledger <path> --profile <path>";
export const syncLedgerStates = new Set([
  "declared",
  "verified-current",
  "verified-stale",
  "blocked-exception",
  "incomplete",
]);
export const topLevelKeys = [
  "ledgerVersion",
  "artifact",
  "publish",
  "verification",
  "promotion",
  "exceptions",
];
/**
 * Conditionally required, per the boundary contract §4.3: forbidden when
 * materialization has not run, required when it has. Adding it is what moves
 * `ledgerVersion` 2 -> 3.
 */
export const publicationKeys = ["proof", "sha256"];
export const artifactKeys = ["path", "revision"];
export const publishKeys = ["mode", "tokensStudioCarrier", "figmaFile"];
export const verificationKeys = [
  "materializationStatus",
  "lastVerifiedRevision",
];
export const basePromotionKeys = ["parityMode", "highestEarnedLevel"];
export const exceptionRequiredKeys = ["code", "message", "blocking", "status"];
export const exceptionOptionalKeys = ["field"];
export const supportedLedgerVersion = "3";
export const publishModes = new Set(portablePublishModes);
export const materializationStatuses = new Set(["not-run", "passed", "failed"]);
export const parityModes = new Set(["deferred", "required"]);
export const earnedLevels = new Set([
  "A-source-valid",
  "B-projection-valid",
  "C-consumption-valid",
  "D-publish-valid",
  "E-promotion-complete",
]);
export const exceptionStatuses = new Set(["open", "resolved"]);

const shaPattern = /^[a-f0-9]{40}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const publishValidLevels = new Set(["D-publish-valid", "E-promotion-complete"]);

export function readSyncLedger(target) {
  const absPath = path.resolve(target);
  let text;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch {
    throw new CannotEvaluateError(
      "LEDGER_UNREADABLE",
      `sync ledger could not be read: ${absPath}`,
    );
  }

  try {
    return { absPath, data: JSON.parse(text) };
  } catch (error) {
    throw new CannotEvaluateError(
      "LEDGER_MALFORMED",
      `sync ledger is not valid JSON: ${absPath} (${error.message})`,
    );
  }
}

export function loadAndValidateSyncLedger(target, profile) {
  const { absPath, data } = readSyncLedger(target);
  return {
    absPath,
    data,
    errors: validateSyncLedger(data, profile),
  };
}

export function validateSyncLedgerWithState(target, profile) {
  const { absPath, data, errors } = loadAndValidateSyncLedger(target, profile);
  return {
    absPath,
    data,
    errors,
    evaluation:
      errors.length === 0 ? evaluateSyncLedgerConformance(data) : null,
  };
}

export function validateSyncLedger(data, profile) {
  requireProfile(profile);
  const errors = [];

  assertPlainObject(errors, data, "Ledger must be a JSON object");
  if (errors.length > 0) {
    return errors;
  }

  validateKeySpec(
    errors,
    data,
    { required: topLevelKeys, optional: ["publication"] },
    "ledger",
  );
  requireLiteral(
    errors,
    data.ledgerVersion,
    supportedLedgerVersion,
    "ledgerVersion",
  );
  validateArtifact(errors, data.artifact, profile);
  validatePublish(errors, data.publish, profile);
  validateVerification(errors, data.verification);
  validatePromotion(errors, data.promotion);
  validateExceptions(errors, data.exceptions);
  validatePublication(errors, data);
  validateLedgerGuardrails(errors, data);

  return errors;
}

export function evaluateSyncLedgerConformance(ledger) {
  const openBlockingExceptions = getOpenBlockingExceptions(ledger.exceptions);
  const evidence = {
    "artifact.path": ledger.artifact.path,
    "artifact.revision": ledger.artifact.revision,
    "publish.mode": ledger.publish.mode,
    "publish.tokensStudioCarrier": ledger.publish.tokensStudioCarrier,
    "verification.materializationStatus":
      ledger.verification.materializationStatus,
    "verification.lastVerifiedRevision":
      ledger.verification.lastVerifiedRevision,
    "promotion.parityMode": ledger.promotion.parityMode,
    "promotion.highestEarnedLevel": ledger.promotion.highestEarnedLevel,
    "exceptions.openBlockingCount": openBlockingExceptions.length,
  };

  if (openBlockingExceptions.length > 0) {
    return {
      state: "blocked-exception",
      promotable: false,
      blockers: openBlockingExceptions.map((entry, index) => ({
        code: entry.code,
        field: entry.field ?? `exceptions[${index}]`,
        message: entry.message,
      })),
      evidence,
    };
  }

  if (ledger.verification.materializationStatus === "not-run") {
    return {
      state: "declared",
      promotable: false,
      blockers: [],
      evidence,
    };
  }

  if (ledger.verification.materializationStatus === "failed") {
    return {
      state: "incomplete",
      promotable: false,
      blockers: [
        {
          code: "verification-materialization-failed",
          field: "verification.materializationStatus",
          message:
            "verification.materializationStatus is failed, so the current artifact revision is not verified.",
        },
      ],
      evidence,
    };
  }

  if (ledger.verification.lastVerifiedRevision !== ledger.artifact.revision) {
    return {
      state: "verified-stale",
      promotable: false,
      blockers: [
        {
          code: "verification-stale-revision",
          field: "verification.lastVerifiedRevision",
          message:
            "verification.lastVerifiedRevision does not match artifact.revision for the active ledger.",
        },
      ],
      evidence,
    };
  }

  return {
    state: "verified-current",
    promotable: true,
    blockers: [],
    evidence,
  };
}

export function runValidateSyncLedgerCli(options = {}) {
  const args = options.args ?? process.argv.slice(2);
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const runValidation = options.runValidation ?? validateSyncLedgerWithState;

  if (args.length !== 1) {
    writeLine(stderr, syncLedgerUsage);
    return 1;
  }

  try {
    const { absPath, errors, evaluation } = runValidation(
      args[0],
      options.profile,
    );

    if (errors.length > 0) {
      for (const error of errors) {
        writeLine(stderr, error);
      }
      return 1;
    }

    writeLine(stdout, `✓ Sync ledger is structurally valid: ${absPath}`);
    writeLine(
      stdout,
      `[FIGMA_SYNC_LEDGER_STATE] state=${evaluation.state} promotable=${evaluation.promotable}`,
    );
    writeLine(
      stdout,
      `[FIGMA_SYNC_LEDGER_EVIDENCE] ${formatEvidenceLine(evaluation.evidence)}`,
    );

    for (const blocker of evaluation.blockers) {
      writeLine(
        stdout,
        `[FIGMA_SYNC_LEDGER_BLOCKER] code=${blocker.code} field=${blocker.field} message=${blocker.message}`,
      );
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeLine(stderr, `[UNEXPECTED_RUNTIME_FAILURE] ${message}`);
    return 3;
  }
}

function validateArtifact(errors, artifact, profile) {
  if (!assertPlainObject(errors, artifact, "artifact must be an object")) {
    return;
  }

  validateKeySpec(
    errors,
    artifact,
    { required: artifactKeys, optional: [] },
    "artifact",
  );
  requireLiteral(errors, artifact.path, profile.artifactPath, "artifact.path");
  requireSha(errors, artifact.revision, "artifact.revision");
}

function validatePublish(errors, publish, profile) {
  if (!assertPlainObject(errors, publish, "publish must be an object")) {
    return;
  }

  validateKeySpec(
    errors,
    publish,
    { required: publishKeys, optional: [] },
    "publish",
  );

  if (!profile.publishModes.includes(publish.mode)) {
    errors.push(
      `[CT-8B_INVALID_PUBLISH_MODE] publish.mode must be one of: ${profile.publishModes.join(", ")}`,
    );
  }

  if (typeof publish.tokensStudioCarrier !== "boolean") {
    errors.push(
      "[CT-8B_INVALID_TOKENS_STUDIO_CARRIER] publish.tokensStudioCarrier must be a boolean",
    );
  }

  requireNonEmptyString(errors, publish.figmaFile, "publish.figmaFile");

  if (
    typeof publish.tokensStudioCarrier === "boolean" &&
    typeof publish.mode === "string" &&
    publish.tokensStudioCarrier !== (publish.mode === "tokens-studio-carried")
  ) {
    errors.push(
      "[CT-8B_INVALID_TOKENS_STUDIO_CARRIER_COMBINATION] publish.tokensStudioCarrier must be true only when publish.mode is tokens-studio-carried",
    );
  }
}

function validateVerification(errors, verification) {
  if (
    !assertPlainObject(errors, verification, "verification must be an object")
  ) {
    return;
  }

  validateKeySpec(
    errors,
    verification,
    { required: verificationKeys, optional: [] },
    "verification",
  );

  if (!materializationStatuses.has(verification.materializationStatus)) {
    errors.push(
      "[CT-8B_INVALID_MATERIALIZATION_STATUS] verification.materializationStatus must be not-run, passed, or failed",
    );
  }

  if (verification.materializationStatus === "not-run") {
    if (verification.lastVerifiedRevision !== null) {
      errors.push(
        "[CT-8B_NOT_RUN_REQUIRES_NULL_REVISION] verification.lastVerifiedRevision must be null when verification.materializationStatus is not-run",
      );
    }
    return;
  }

  requireSha(
    errors,
    verification.lastVerifiedRevision,
    "verification.lastVerifiedRevision",
  );
}

function validatePromotion(errors, promotion) {
  if (!assertPlainObject(errors, promotion, "promotion must be an object")) {
    return;
  }

  const promotionKeySpec =
    promotion.parityMode === "deferred"
      ? {
          required: [...basePromotionKeys, "parityDeferredReason"],
          optional: [],
        }
      : { required: basePromotionKeys, optional: ["parityDeferredReason"] };

  validateKeySpec(errors, promotion, promotionKeySpec, "promotion");

  if (!parityModes.has(promotion.parityMode)) {
    errors.push(
      "[CT-8B_INVALID_PARITY_MODE] promotion.parityMode must be deferred or required",
    );
  }

  if (!earnedLevels.has(promotion.highestEarnedLevel)) {
    errors.push(
      "[CT-8B_INVALID_EARNED_LEVEL] promotion.highestEarnedLevel must be A-source-valid, B-projection-valid, C-consumption-valid, D-publish-valid, or E-promotion-complete",
    );
  }

  if (promotion.parityMode === "deferred") {
    requireNonEmptyString(
      errors,
      promotion.parityDeferredReason,
      "promotion.parityDeferredReason",
    );
  } else if (
    promotion.parityMode === "required" &&
    promotion.parityDeferredReason !== undefined
  ) {
    errors.push(
      "[CT-8B_FORBIDDEN_PARITY_DEFERRED_REASON] promotion.parityDeferredReason must be omitted when promotion.parityMode is required",
    );
  }
}

function validateExceptions(errors, exceptions) {
  if (!Array.isArray(exceptions)) {
    errors.push("[CT-8B_INVALID_EXCEPTIONS] exceptions must be an array");
    return;
  }

  for (const [index, entry] of exceptions.entries()) {
    if (
      !assertPlainObject(
        errors,
        entry,
        `exceptions[${index}] must be an object`,
      )
    ) {
      continue;
    }

    validateKeySpec(
      errors,
      entry,
      { required: exceptionRequiredKeys, optional: exceptionOptionalKeys },
      `exceptions[${index}]`,
    );
    requireNonEmptyString(errors, entry.code, `exceptions[${index}].code`);
    requireNonEmptyString(
      errors,
      entry.message,
      `exceptions[${index}].message`,
    );

    if (typeof entry.blocking !== "boolean") {
      errors.push(
        `[CT-8B_INVALID_EXCEPTION_BLOCKING] exceptions[${index}].blocking must be a boolean`,
      );
    }

    if (!exceptionStatuses.has(entry.status)) {
      errors.push(
        `[CT-8B_INVALID_EXCEPTION_STATUS] exceptions[${index}].status must be open or resolved`,
      );
    }

    if (
      entry.field !== undefined &&
      (typeof entry.field !== "string" || entry.field.length === 0)
    ) {
      errors.push(
        `[CT-8B_INVALID_EXCEPTION_FIELD] exceptions[${index}].field must be a non-empty string when present`,
      );
    }
  }
}

/**
 * Presence, absence and shape only. Whether the named proof exists, matches its
 * digest and agrees with this ledger is the binding check's question, because
 * answering it needs a second file — see publication-binding.mjs.
 */
function validatePublication(errors, ledger) {
  const status = ledger.verification?.materializationStatus;
  const publication = ledger.publication;

  if (status === "not-run") {
    if (publication !== undefined) {
      errors.push(
        "[CT-8B_NOT_RUN_FORBIDS_PUBLICATION] publication must be absent when verification.materializationStatus is not-run",
      );
    }
    return;
  }

  if (status === "passed" || status === "failed") {
    if (publication === undefined) {
      errors.push(
        "[CT-8B_MATERIALIZATION_REQUIRES_PUBLICATION] publication is required when verification.materializationStatus is passed or failed",
      );
      return;
    }
  } else if (publication === undefined) {
    // The status itself is already invalid; do not pile on.
    return;
  }

  if (
    !assertPlainObject(errors, publication, "publication must be an object")
  ) {
    return;
  }

  validateKeySpec(
    errors,
    publication,
    { required: publicationKeys, optional: [] },
    "publication",
  );
  requireNonEmptyString(errors, publication.proof, "publication.proof");

  if (
    typeof publication.sha256 !== "string" ||
    !digestPattern.test(publication.sha256)
  ) {
    errors.push(
      "[CT-8B_INVALID_PUBLICATION_DIGEST] publication.sha256 must be a 64-character lowercase sha256 digest",
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
      "validateSyncLedger requires a resolved profile; see readProfile()",
    );
  }
}

function validateLedgerGuardrails(errors, ledger) {
  const { artifact, verification, promotion, exceptions } = ledger;

  if (
    promotion?.highestEarnedLevel === "E-promotion-complete" &&
    promotion?.parityMode !== "required"
  ) {
    errors.push(
      "[CT-8B_EARNED_LEVEL_REQUIRES_REQUIRED_PARITY] promotion.highestEarnedLevel cannot be E-promotion-complete when promotion.parityMode is deferred",
    );
  }

  if (
    publishValidLevels.has(promotion?.highestEarnedLevel) &&
    verification?.materializationStatus !== "passed"
  ) {
    errors.push(
      "[CT-8B_PUBLISH_VALID_REQUIRES_PASSED_MATERIALIZATION] promotion.highestEarnedLevel requires verification.materializationStatus to be passed",
    );
  }

  if (
    publishValidLevels.has(promotion?.highestEarnedLevel) &&
    verification?.lastVerifiedRevision !== null &&
    artifact?.revision !== undefined &&
    verification.lastVerifiedRevision !== artifact.revision
  ) {
    errors.push(
      "[CT-8B_PUBLISH_VALID_REQUIRES_CURRENT_REVISION] verification.lastVerifiedRevision must match artifact.revision when promotion.highestEarnedLevel is D-publish-valid or E-promotion-complete",
    );
  }

  if (
    publishValidLevels.has(promotion?.highestEarnedLevel) &&
    verification?.lastVerifiedRevision === null
  ) {
    errors.push(
      "[CT-8B_PUBLISH_VALID_REQUIRES_VERIFIED_REVISION] verification.lastVerifiedRevision must be present when promotion.highestEarnedLevel is D-publish-valid or E-promotion-complete",
    );
  }

  if (
    promotion?.highestEarnedLevel === "E-promotion-complete" &&
    Array.isArray(exceptions) &&
    exceptions.some(
      (entry) => entry.blocking === true && entry.status === "open",
    )
  ) {
    errors.push(
      "[CT-8B_COMPLETE_PROMOTION_FORBIDS_OPEN_BLOCKING_EXCEPTIONS] promotion.highestEarnedLevel cannot be E-promotion-complete while blocking exceptions remain open",
    );
  }
}

function getOpenBlockingExceptions(exceptions) {
  if (!Array.isArray(exceptions)) {
    return [];
  }

  return exceptions.filter(
    (entry) => entry.blocking === true && entry.status === "open",
  );
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
      errors.push(`[CT-8B_MISSING_REQUIRED_KEY] ${label}.${key} is required`);
    }
  }

  for (const key of actualKeys) {
    if (!allowedKeys.includes(key)) {
      errors.push(`[CT-8B_UNEXPECTED_KEY] ${label}.${key} is not allowed`);
    }
  }
}

function requireLiteral(errors, actual, expected, label) {
  if (actual !== expected) {
    errors.push(`[CT-8B_INVALID_LITERAL] ${label} must be ${expected}`);
  }
}

function requireNonEmptyString(errors, value, label) {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`[CT-8B_INVALID_STRING] ${label} must be a non-empty string`);
  }
}

function requireSha(errors, value, label) {
  if (typeof value !== "string" || !shaPattern.test(value)) {
    errors.push(
      `[CT-8B_INVALID_SHA] ${label} must be a 40-character lowercase git SHA`,
    );
  }
}

function formatEvidenceLine(evidence) {
  return Object.entries(evidence)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}

function writeLine(stream, message) {
  stream.write(`${message}\n`);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
