import { CannotEvaluateError } from "../figma/profile.mjs";
import {
  validateKeys,
  requireLiteral,
  arraysEqual,
  isPlainObject,
} from "./status-checks.mjs";
import {
  validateBranch,
  validateRevision,
  validateProofInventory,
  validateBuild,
  validateCheck,
  validateGeneratedAt,
} from "./status-identity.mjs";
import { validateReview, validateScopeAlignment } from "./status-review.mjs";
export function evaluateChromaticStatus(status, options) {
  if (
    !options ||
    typeof options.expectedGitSha !== "string" ||
    !/^[a-f0-9]{40}$/.test(options.expectedGitSha) ||
    ![options.inventoryPath, options.inventoryVersion, options.checkName].every(
      nonempty,
    ) ||
    !validScope(options.scope) ||
    typeof options.requiredForClaim !== "boolean" ||
    !Number.isSafeInteger(options.maxAgeMinutes) ||
    options.maxAgeMinutes < 0 ||
    !Number.isSafeInteger(options.maxFutureSkewSeconds) ||
    options.maxFutureSkewSeconds < 0
  )
    throw statusError(
      "Explicit revision, inventory, check, scope and freshness policy are required",
    );
  const now = options.now === undefined ? new Date() : new Date(options.now);
  if (!Number.isFinite(now.getTime()))
    throw statusError("Invalid evaluation clock");
  const errors = [];
  if (!isPlainObject(status))
    return {
      ok: false,
      errors: [
        "[CT-10B_CHROMATIC_STATUS_INVALID_ROOT] status payload must be a JSON object",
      ],
    };
  validateKeys(
    errors,
    status,
    [
      "statusVersion",
      "branch",
      "revision",
      "proofInventory",
      "build",
      "review",
      "check",
      "generatedAt",
    ],
    [],
    "",
  );
  requireLiteral(errors, status.statusVersion, "1", "statusVersion");
  validateBranch(errors, status.branch);
  validateRevision(errors, status.revision, options.expectedGitSha);
  const proofInventory = validateProofInventory(
    errors,
    status.proofInventory,
    options,
  );
  const review = validateReview(errors, status.review);
  validateBuild(errors, status.build);
  validateCheck(errors, status.check, review?.diffOutcome, options);
  validateGeneratedAt(errors, status.generatedAt, { ...options, now });
  validateScopeAlignment(errors, { proofInventory, review });
  if (status.review?.requiredForClaim !== options.requiredForClaim)
    errors.push(
      "[CHROMATIC_POLICY_MODE] requiredForClaim must match project policy",
    );
  if (
    !arraysEqual(
      proofInventory?.selectedComponentIds,
      options.scope.componentIds,
    ) ||
    !arraysEqual(proofInventory?.selectedStoryIds, options.scope.storyIds) ||
    !equalMap(review?.scope?.componentTiers, options.scope.componentTiers)
  )
    errors.push(
      "[CHROMATIC_CURRENT_SCOPE] status scope does not match current validated component/story inputs",
    );
  return { ok: errors.length === 0, errors };
}
function equalMap(a, b) {
  return (
    isPlainObject(a) &&
    isPlainObject(b) &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(b).every(
      ([key, value]) => Object.hasOwn(a, key) && a[key] === value,
    )
  );
}
export function statusError(message) {
  return new CannotEvaluateError("CHROMATIC_INPUT", message);
}

function nonempty(value) {
  return (
    typeof value === "string" && value.length > 0 && value.trim() === value
  );
}
function validScope(scope) {
  if (!isPlainObject(scope) || !isPlainObject(scope.componentTiers))
    return false;
  for (const key of ["componentIds", "storyIds"])
    if (
      !Array.isArray(scope[key]) ||
      !scope[key].length ||
      !scope[key].every(nonempty) ||
      new Set(scope[key]).size !== scope[key].length
    )
      return false;
  return (
    Object.keys(scope.componentTiers).length === scope.componentIds.length &&
    scope.componentIds.every(
      (key) =>
        Object.hasOwn(scope.componentTiers, key) &&
        nonempty(scope.componentTiers[key]),
    )
  );
}
