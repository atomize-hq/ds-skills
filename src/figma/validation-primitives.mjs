/**
 * The structural primitives both record validators use. They were separate
 * copies in sync-ledger.mjs and publish-proof.mjs, differing only in the
 * diagnostic prefix — two implementations of one rule, with nothing checking
 * they agreed. The prefix is a parameter now, so every existing diagnostic
 * string is produced verbatim by one implementation.
 */

/** CT-8B for the ledger, CT-7B_PUBLISH_PROOF for the proof. */
export const LEDGER_CODES = "CT-8B";
export const PROOF_CODES = "CT-7B_PUBLISH_PROOF";

const shaPattern = /^[a-f0-9]{40}$/;

/**
 * A missing prefix would emit `[undefined_INVALID_LITERAL]` — a diagnostic code
 * no consumer will ever match, from a check that otherwise looks like it ran.
 * Refuse it instead.
 */
function codePrefix(codes) {
  if (codes !== LEDGER_CODES && codes !== PROOF_CODES) {
    throw new Error(
      `validation primitives need a diagnostic prefix; received ${String(codes)}`,
    );
  }
  return codes;
}

export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertPlainObject(errors, value, message) {
  if (!isPlainObject(value)) {
    errors.push(message);
    return false;
  }
  return true;
}

export function validateKeySpec(errors, value, keySpec, label, codes) {
  codePrefix(codes);
  const requiredKeys = [...keySpec.required].sort();
  const optionalKeys = [...(keySpec.optional ?? [])].sort();
  const allowedKeys = [...requiredKeys, ...optionalKeys].sort();
  const actualKeys = Object.keys(value).sort();

  for (const key of requiredKeys) {
    if (!actualKeys.includes(key)) {
      errors.push(
        `[${codes}_MISSING_REQUIRED_KEY] ${label}.${key} is required`,
      );
    }
  }

  for (const key of actualKeys) {
    if (!allowedKeys.includes(key)) {
      errors.push(`[${codes}_UNEXPECTED_KEY] ${label}.${key} is not allowed`);
    }
  }
}

export function requireLiteral(errors, actual, expected, label, codes) {
  codePrefix(codes);
  if (actual !== expected) {
    errors.push(`[${codes}_INVALID_LITERAL] ${label} must be ${expected}`);
  }
}

export function requireNonEmptyString(errors, value, label, codes) {
  codePrefix(codes);
  if (typeof value !== "string" || value.length === 0) {
    errors.push(
      `[${codes}_INVALID_STRING] ${label} must be a non-empty string`,
    );
  }
}

export function requireSha(errors, value, label, codes) {
  codePrefix(codes);
  if (typeof value !== "string" || !shaPattern.test(value)) {
    errors.push(
      `[${codes}_INVALID_SHA] ${label} must be a 40-character lowercase git SHA`,
    );
  }
}
