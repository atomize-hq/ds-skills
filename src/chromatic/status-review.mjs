import {
  validateKeys,
  requireUniqueStringArray,
  requireEnum,
  arraysEqual,
  isPlainObject,
} from "./status-checks.mjs";
const diffOutcomeValues = ["passed", "changed", "failed", "deferred"];
const reviewModeValues = ["informational", "claim-required"];
export function validateReview(errors, review) {
  if (!isPlainObject(review)) {
    errors.push(
      "[CT-10B_CHROMATIC_STATUS_INVALID_REVIEW] review must be an object",
    );
    return null;
  }

  validateKeys(
    errors,
    review,
    ["mode", "requiredForClaim", "scope", "diffOutcome"],
    [],
    "review",
  );
  requireEnum(errors, review.mode, reviewModeValues, "review.mode");
  requireEnum(
    errors,
    review.diffOutcome,
    diffOutcomeValues,
    "review.diffOutcome",
  );

  if (typeof review.requiredForClaim !== "boolean") {
    errors.push(
      "[CT-10B_CHROMATIC_STATUS_INVALID_BOOLEAN] review.requiredForClaim must be a boolean",
    );
  } else if (
    review.mode === "informational" &&
    review.requiredForClaim !== false
  ) {
    errors.push(
      "[CT-10B_CHROMATIC_STATUS_REQUIRED_FOR_CLAIM_MISMATCH] review.requiredForClaim must be false when review.mode is informational",
    );
  } else if (
    review.mode === "claim-required" &&
    review.requiredForClaim !== true
  ) {
    errors.push(
      "[CT-10B_CHROMATIC_STATUS_REQUIRED_FOR_CLAIM_MISMATCH] review.requiredForClaim must be true when review.mode is claim-required",
    );
  }

  const scope = validateReviewScope(errors, review.scope);

  return {
    diffOutcome: review.diffOutcome,
    scope,
  };
}

export function validateReviewScope(errors, scope) {
  if (!isPlainObject(scope)) {
    errors.push(
      "[CT-10B_CHROMATIC_STATUS_INVALID_REVIEW_SCOPE] review.scope must be an object",
    );
    return null;
  }

  validateKeys(
    errors,
    scope,
    ["componentIds", "storyIds", "componentTiers"],
    [],
    "review.scope",
  );
  const componentIds = requireUniqueStringArray(
    errors,
    scope.componentIds,
    "review.scope.componentIds",
  );
  const storyIds = requireUniqueStringArray(
    errors,
    scope.storyIds,
    "review.scope.storyIds",
  );

  if (!isPlainObject(scope.componentTiers)) {
    errors.push(
      "[CT-10B_CHROMATIC_STATUS_INVALID_COMPONENT_TIERS] review.scope.componentTiers must be an object",
    );
    return {
      componentIds,
      componentTiers: null,
      storyIds,
    };
  }

  const componentTierEntries = Object.entries(scope.componentTiers);
  if (componentTierEntries.length === 0) {
    errors.push(
      "[CT-10B_CHROMATIC_STATUS_INVALID_COMPONENT_TIERS] review.scope.componentTiers must not be empty",
    );
  }

  for (const [componentId, tier] of componentTierEntries) {
    if (componentId.length === 0) {
      errors.push(
        "[CT-10B_CHROMATIC_STATUS_INVALID_COMPONENT_TIERS] review.scope.componentTiers keys must be non-empty component IDs",
      );
    }

    if (typeof tier !== "string" || tier.trim() !== tier || tier.length === 0) {
      errors.push(
        `[CT-10B_CHROMATIC_STATUS_INVALID_STRING] review.scope.componentTiers.${componentId} must be a non-empty string`,
      );
    }
  }

  return {
    componentIds,
    componentTiers: scope.componentTiers,
    storyIds,
  };
}

export function validateScopeAlignment(errors, values) {
  const proofInventory = values.proofInventory;
  const reviewScope = values.review?.scope;

  if (!proofInventory || !reviewScope) {
    return;
  }

  if (
    !arraysEqual(proofInventory.selectedComponentIds, reviewScope.componentIds)
  ) {
    errors.push(
      "[CT-10B_CHROMATIC_STATUS_SCOPE_MISMATCH] review.scope.componentIds must match proofInventory.selectedComponentIds exactly",
    );
  }

  if (!arraysEqual(proofInventory.selectedStoryIds, reviewScope.storyIds)) {
    errors.push(
      "[CT-10B_CHROMATIC_STATUS_SCOPE_MISMATCH] review.scope.storyIds must match proofInventory.selectedStoryIds exactly",
    );
  }

  if (reviewScope.componentTiers && Array.isArray(reviewScope.componentIds)) {
    const expectedComponentIds = [...reviewScope.componentIds].sort();
    const actualComponentIds = Object.keys(reviewScope.componentTiers).sort();
    if (!arraysEqual(expectedComponentIds, actualComponentIds)) {
      errors.push(
        "[CT-10B_CHROMATIC_STATUS_SCOPE_MISMATCH] review.scope.componentTiers keys must match review.scope.componentIds exactly",
      );
    }
  }
}
