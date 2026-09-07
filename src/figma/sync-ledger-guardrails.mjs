/**
 * The ledger's CROSS-FIELD rules: the ones that read more than one section and
 * ask whether the record contradicts itself. Split from the per-field shape
 * checks when the package adopted the 300-code-line guard, along the seam that
 * was already there — a per-field rule can be read on its own, and these cannot.
 */
import {
  assertPlainObject,
  LEDGER_CODES,
  requireNonEmptyString,
  validateKeySpec,
} from "./validation-primitives.mjs";

const digestPattern = /^[a-f0-9]{64}$/;
const publishValidLevels = new Set(["D-publish-valid", "E-promotion-complete"]);

/** Conditionally required, per the boundary contract §4.3. */
export const publicationKeys = ["proof", "sha256"];

/**
 * Presence, absence and shape only. Whether the named proof exists, matches its
 * digest and agrees with this ledger is the binding check's question, because
 * answering it needs a second file — see publication-binding.mjs.
 */
export function validatePublication(errors, ledger) {
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
    LEDGER_CODES,
  );
  requireNonEmptyString(
    errors,
    publication.proof,
    "publication.proof",
    LEDGER_CODES,
  );

  if (
    typeof publication.sha256 !== "string" ||
    !digestPattern.test(publication.sha256)
  ) {
    errors.push(
      "[CT-8B_INVALID_PUBLICATION_DIGEST] publication.sha256 must be a 64-character lowercase sha256 digest",
    );
  }
}

export function validateLedgerGuardrails(errors, ledger) {
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

export function getOpenBlockingExceptions(exceptions) {
  if (!Array.isArray(exceptions)) {
    return [];
  }

  return exceptions.filter(
    (entry) => entry.blocking === true && entry.status === "open",
  );
}
