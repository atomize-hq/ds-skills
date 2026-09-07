import crypto from "node:crypto";
import path from "node:path";

import { CannotEvaluateError } from "./profile.mjs";
import { readPublishProof, validatePublishProof } from "./publish-proof.mjs";

/**
 * The proof-ledger relationship, per the boundary contract §4. Two questions,
 * kept apart on purpose:
 *
 *   agreement   - the six shared facts hold, for the exact proof the binding
 *                 names. Never satisfied by copying one record onto the other.
 *   sufficiency - that publication supports what the ledger claims *now*.
 *
 * Neither ever "repairs" a record. A stale proof is a real signal that a
 * publication has not happened yet, and rewriting the attestation to match the
 * ledger would destroy the only evidence that it hasn't.
 */

const publishValidLevels = new Set(["D-publish-valid", "E-promotion-complete"]);

export function digestOf(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/**
 * @param {object} args
 * @param {any} args.ledger a ledger that has already passed validateSyncLedger
 * @param {string} args.ledgerPath used to resolve `publication.proof`
 * @param {object} args.profile resolved profile
 * @param {(target: string) => {bytes: Buffer, data: any}} [args.readProof]
 * @returns {{errors: string[], proofPath: string | null}}
 */
export function checkPublicationBinding({
  ledger,
  ledgerPath,
  profile,
  readProof = readPublishProof,
}) {
  const errors = [];
  const publication = ledger.publication;

  // Absence is validateSyncLedger's question; it has already answered it.
  if (publication === undefined) return { errors, proofPath: null };

  const proofPath = path.resolve(
    path.dirname(path.resolve(ledgerPath)),
    publication.proof,
  );

  let bytes;
  let proof;
  try {
    ({ bytes, data: proof } = readProof(proofPath));
  } catch (error) {
    if (error instanceof CannotEvaluateError) {
      // A named binding that resolves to nothing is nonconformance, not an
      // inability to evaluate: the ledger asserted the file exists.
      errors.push(
        `[CT-8B_PUBLICATION_PROOF_UNRESOLVED] publication.proof does not resolve to a readable publish proof: ${publication.proof}`,
      );
      return { errors, proofPath };
    }
    throw error;
  }

  const actual = digestOf(bytes);
  if (actual !== publication.sha256) {
    // Deliberately not resolved by recomputing: the digest is what makes the
    // binding an identity rather than a location.
    errors.push(
      `[CT-8B_PUBLICATION_DIGEST_MISMATCH] publication.sha256 does not match the bytes of ${publication.proof} (expected ${publication.sha256}, found ${actual})`,
    );
    return { errors, proofPath };
  }

  const proofErrors = validatePublishProof(proof, profile);
  if (proofErrors.length > 0) {
    errors.push(
      `[CT-8B_PUBLICATION_PROOF_INVALID] the bound publish proof is not valid: ${proofErrors.length} error(s), first: ${proofErrors[0]}`,
    );
    return { errors, proofPath };
  }

  errors.push(...checkAgreement(ledger, proof, profile));
  if (errors.length > 0) return { errors, proofPath };

  errors.push(...checkSufficiency(ledger, proof));
  return { errors, proofPath };
}

/** The six facts of §4's table, in table order. */
function checkAgreement(ledger, proof, profile) {
  const errors = [];

  // §4 row 1 also requires both to equal the profile's declared artifact path.
  // That comparison is not repeated here: each validator already made it,
  // against the same profile key, before this ran. Re-checking it would be a
  // second representation of one rule — the duplication §4.5 exists to close.
  if (proof.artifact.path !== ledger.artifact.path) {
    errors.push(
      `[CT-8B_PUBLICATION_ARTIFACT_PATH_MISMATCH] proof artifact.path (${proof.artifact.path}) does not match ledger artifact.path (${ledger.artifact.path})`,
    );
  }

  // Binds the ledger's *verification* claim to the attested publication.
  // artifact.revision is what the tokens are now; lastVerifiedRevision is what
  // was verified, and the proof attests to a publication.
  if (proof.artifact.gitSha !== ledger.verification.lastVerifiedRevision) {
    errors.push(
      `[CT-8B_PUBLICATION_ARTIFACT_REVISION_MISMATCH] proof artifact.gitSha (${proof.artifact.gitSha}) does not match ledger verification.lastVerifiedRevision (${ledger.verification.lastVerifiedRevision})`,
    );
  }

  if (proof.mode !== ledger.publish.mode) {
    errors.push(
      `[CT-8B_PUBLICATION_MODE_MISMATCH] proof mode (${proof.mode}) does not match ledger publish.mode (${ledger.publish.mode})`,
    );
  }

  // Unlike the artifact path, only the *proof* pins its destination to the
  // profile. The ledger's publish.figmaFile is a free string, so this comparison
  // is the one that ties the ledger to the declared destination at all.
  if (proof.destination.figmaFile !== ledger.publish.figmaFile) {
    errors.push(
      `[CT-8B_PUBLICATION_DESTINATION_MISMATCH] proof destination.figmaFile (${proof.destination.figmaFile}) does not match ledger publish.figmaFile (${ledger.publish.figmaFile}); the profile declares ${profile.destinationFigmaFile}`,
    );
  }

  // not-run is unreachable here: validateSyncLedger forbids a publication then.
  if (
    proof.materialization.status !== ledger.verification.materializationStatus
  ) {
    errors.push(
      `[CT-8B_PUBLICATION_MATERIALIZATION_MISMATCH] proof materialization.status (${proof.materialization.status}) does not match ledger verification.materializationStatus (${ledger.verification.materializationStatus})`,
    );
  }

  if (proof.carrier.used !== ledger.publish.tokensStudioCarrier) {
    errors.push(
      `[CT-8B_PUBLICATION_CARRIER_MISMATCH] proof carrier.used (${proof.carrier.used}) does not match ledger publish.tokensStudioCarrier (${ledger.publish.tokensStudioCarrier})`,
    );
  }

  return errors;
}

/**
 * Runs only once agreement holds, so a mismatched proof can never be reported
 * as an unsupported claim, and an unsupported claim can never be mistaken for
 * an invalid proof (§4.2).
 *
 * Honest limit, recorded rather than hidden: with facts 1-6 all enforced this
 * is *subsumed* by the ledger's own CT-8B_PUBLISH_VALID_REQUIRES_CURRENT_REVISION
 * guardrail, which compares the ledger's two revision fields. Both fire on the
 * same underlying state. It is kept because it reports that state from the
 * publication's side with its own code, which is what a caller needs in order
 * to know that re-attesting is not the fix.
 */
function checkSufficiency(ledger, proof) {
  if (!publishValidLevels.has(ledger.promotion.highestEarnedLevel)) return [];
  if (proof.artifact.gitSha === ledger.artifact.revision) return [];

  return [
    `[CT-8B_PUBLICATION_DOES_NOT_SUPPORT_CLAIM] the bound publication attests revision ${proof.artifact.gitSha}, which does not support promotion.highestEarnedLevel ${ledger.promotion.highestEarnedLevel} at artifact.revision ${ledger.artifact.revision}`,
  ];
}
