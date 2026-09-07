/**
 * The sync ledger's structural rules, split out of sync-ledger.mjs when the
 * package adopted the consumer's 300-code-line guard. Shape only: whether a
 * ledger is internally well formed. What it *means* — the conformance state,
 * its blockers, and its relationship to a publish proof — lives elsewhere, and
 * keeping the two apart is why this split falls here rather than by line count.
 */
import { CannotEvaluateError, portablePublishModes } from "./profile.mjs";
import {
  getOpenBlockingExceptions,
  validateLedgerGuardrails,
  validatePublication,
} from "./sync-ledger-guardrails.mjs";

export { getOpenBlockingExceptions };
import {
  assertPlainObject,
  LEDGER_CODES,
  requireLiteral,
  requireNonEmptyString,
  requireSha,
  validateKeySpec,
} from "./validation-primitives.mjs";

export { assertPlainObject };

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
export { publicationKeys } from "./sync-ledger-guardrails.mjs";
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

/** Every structural rule, in the order their diagnostics are reported. */
export function validateSyncLedgerShape(errors, data, profile) {
  validateKeySpec(
    errors,
    data,
    { required: topLevelKeys, optional: ["publication"] },
    "ledger",
    LEDGER_CODES,
  );
  requireLiteral(
    errors,
    data.ledgerVersion,
    supportedLedgerVersion,
    "ledgerVersion",
    LEDGER_CODES,
  );
  validateArtifact(errors, data.artifact, profile);
  validatePublish(errors, data.publish, profile);
  validateVerification(errors, data.verification);
  validatePromotion(errors, data.promotion);
  validateExceptions(errors, data.exceptions);
  validatePublication(errors, data);
  validateLedgerGuardrails(errors, data);
}

export function requireProfile(profile, caller) {
  if (
    profile === undefined ||
    profile === null ||
    typeof profile.artifactPath !== "string"
  ) {
    throw new CannotEvaluateError(
      "PROFILE_REQUIRED",
      `${caller} requires a resolved profile; see readProfile()`,
    );
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
    LEDGER_CODES,
  );
  requireLiteral(
    errors,
    artifact.path,
    profile.artifactPath,
    "artifact.path",
    LEDGER_CODES,
  );
  requireSha(errors, artifact.revision, "artifact.revision", LEDGER_CODES);
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
    LEDGER_CODES,
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

  requireNonEmptyString(
    errors,
    publish.figmaFile,
    "publish.figmaFile",
    LEDGER_CODES,
  );

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
    LEDGER_CODES,
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
    LEDGER_CODES,
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

  validateKeySpec(
    errors,
    promotion,
    promotionKeySpec,
    "promotion",
    LEDGER_CODES,
  );

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
      LEDGER_CODES,
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
      LEDGER_CODES,
    );
    requireNonEmptyString(
      errors,
      entry.code,
      `exceptions[${index}].code`,
      LEDGER_CODES,
    );
    requireNonEmptyString(
      errors,
      entry.message,
      `exceptions[${index}].message`,
      LEDGER_CODES,
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
