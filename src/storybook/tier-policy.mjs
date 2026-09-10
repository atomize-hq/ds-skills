import { allowedStorybookValidatorKinds } from "./inventory.mjs";
import {
  validateMinimumRequiredKinds,
  validateOptionalKinds,
  validateConsumerScope,
  assertPlainObject,
  validateKeySpec,
  requireLiteral,
} from "./tier-checks.mjs";
const validatorKindSet = new Set(allowedStorybookValidatorKinds);

/** Version 2 makes tier names/order and consumer scopes policy data, not product constants. */
export function validateComponentTierPolicy(data) {
  const errors = [];
  if (!assertPlainObject(errors, data, "componentTierPolicy")) return errors;
  validateKeySpec(
    errors,
    data,
    { required: ["policyVersion", "consumerIds", "tierOrder", "tiers"] },
    "componentTierPolicy",
  );
  requireLiteral(
    errors,
    data.policyVersion,
    "2",
    "componentTierPolicy.policyVersion",
  );
  const tiers = validateNames(errors, data.tierOrder, "tierOrder");
  const consumers = validateNames(errors, data.consumerIds, "consumerIds");
  if (tiers && consumers)
    validateTiers(errors, data.tiers, data.tierOrder, data.consumerIds);
  return errors;
}

function validateNames(errors, names, label) {
  if (
    !Array.isArray(names) ||
    names.length === 0 ||
    names.some((name) => typeof name !== "string" || !name.trim())
  ) {
    errors.push(
      `[STORYBOOK_POLICY_NAMES] ${label} must be a non-empty array of non-blank strings`,
    );
    return false;
  }
  if (new Set(names).size !== names.length) {
    errors.push(
      `[STORYBOOK_POLICY_DUPLICATE_NAME] ${label} must not contain duplicate names`,
    );
    return false;
  }
  return true;
}

function validateTiers(errors, tiers, tierOrder, consumerIds) {
  const label = "componentTierPolicy.tiers";
  if (!assertPlainObject(errors, tiers, label)) {
    return;
  }

  const actualKeys = Object.keys(tiers).sort();
  const expectedKeys = [...tierOrder].sort();

  for (const tier of expectedKeys) {
    if (!actualKeys.includes(tier)) {
      errors.push(
        `[CT-9B_TIER_POLICY_MISSING_REQUIRED_TIER] ${label}.${tier} is required`,
      );
    }
  }

  for (const tier of actualKeys) {
    if (!tierOrder.includes(tier)) {
      errors.push(
        `[CT-9B_TIER_POLICY_UNKNOWN_TIER] ${label}.${tier} must be one of ${tierOrder.join(", ")}`,
      );
      continue;
    }

    validateTier(errors, tiers[tier], tier, consumerIds);
  }
}

function validateTier(errors, tierEntry, tier, consumerIds) {
  const label = `componentTierPolicy.tiers.${tier}`;
  if (!assertPlainObject(errors, tierEntry, label)) {
    return;
  }

  validateKeySpec(
    errors,
    tierEntry,
    {
      required: [
        "consumerScope",
        "defaultOptionalKinds",
        "minimumRequiredKinds",
      ],
      optional: [],
    },
    label,
  );

  const requiredKinds = validateMinimumRequiredKinds(
    errors,
    tierEntry.minimumRequiredKinds,
    label,
  );
  const optionalKinds = validateOptionalKinds(
    errors,
    tierEntry.defaultOptionalKinds,
    label,
  );
  validateConsumerScope(errors, tierEntry.consumerScope, label, consumerIds);

  if (requiredKinds === null || optionalKinds === null) {
    return;
  }

  for (const kind of requiredKinds) {
    if (optionalKinds.has(kind)) {
      errors.push(
        `[CT-9B_TIER_POLICY_OVERLAPPING_KIND] ${label} must not list "${kind}" as both required and optional`,
      );
    }
  }

  const union = new Set([...requiredKinds, ...optionalKinds]);
  for (const kind of allowedStorybookValidatorKinds) {
    if (!union.has(kind)) {
      errors.push(
        `[CT-9B_TIER_POLICY_UNCATEGORIZED_KIND] ${label} must explicitly classify "${kind}" as required or optional`,
      );
    }
  }

  if (union.size !== validatorKindSet.size) {
    errors.push(
      `[CT-9B_TIER_POLICY_INVALID_KIND_COVERAGE] ${label} must classify each known validator kind exactly once`,
    );
  }
}
