import { allowedStorybookValidatorKinds } from "./inventory.mjs";
const validatorKindOrder = new Map(
  allowedStorybookValidatorKinds.map((kind, index) => [kind, index]),
);
export function validateMinimumRequiredKinds(
  errors,
  minimumRequiredKinds,
  tierLabel,
) {
  const label = `${tierLabel}.minimumRequiredKinds`;
  if (!Array.isArray(minimumRequiredKinds)) {
    errors.push(
      `[CT-9B_TIER_POLICY_INVALID_REQUIRED_KIND_LIST] ${label} must be an array`,
    );
    return null;
  }

  if (minimumRequiredKinds.length === 0) {
    errors.push(
      `[CT-9B_TIER_POLICY_EMPTY_REQUIRED_KIND_LIST] ${label} must not be empty`,
    );
    return null;
  }

  const seenKinds = new Set();

  for (const [index, entry] of minimumRequiredKinds.entries()) {
    const itemLabel = `${label}[${index}]`;
    if (!assertPlainObject(errors, entry, itemLabel)) {
      continue;
    }

    validateKeySpec(
      errors,
      entry,
      {
        required: ["kind", "purpose"],
        optional: [],
      },
      itemLabel,
    );

    const nextKindIndex = validateKindField(
      errors,
      entry.kind,
      `${itemLabel}.kind`,
    );
    if (nextKindIndex !== null) {
      if (seenKinds.has(entry.kind)) {
        errors.push(
          `[CT-9B_TIER_POLICY_DUPLICATE_REQUIRED_KIND] ${itemLabel}.kind duplicates "${entry.kind}" in ${label}`,
        );
      } else {
        seenKinds.add(entry.kind);
      }
    }

    if (
      typeof entry.purpose !== "string" ||
      entry.purpose.trim().length === 0
    ) {
      errors.push(
        `[CT-9B_TIER_POLICY_INVALID_REQUIRED_KIND_PURPOSE] ${itemLabel}.purpose must be a non-empty string`,
      );
    }
  }

  return seenKinds;
}

export function validateOptionalKinds(errors, defaultOptionalKinds, tierLabel) {
  const label = `${tierLabel}.defaultOptionalKinds`;
  if (!Array.isArray(defaultOptionalKinds)) {
    errors.push(
      `[CT-9B_TIER_POLICY_INVALID_OPTIONAL_KIND_LIST] ${label} must be an array`,
    );
    return null;
  }

  const seenKinds = new Set();

  for (const [index, kind] of defaultOptionalKinds.entries()) {
    const itemLabel = `${label}[${index}]`;
    const nextKindIndex = validateKindField(errors, kind, itemLabel);
    if (nextKindIndex === null) {
      continue;
    }

    if (seenKinds.has(kind)) {
      errors.push(
        `[CT-9B_TIER_POLICY_DUPLICATE_OPTIONAL_KIND] ${itemLabel} duplicates "${kind}" in ${label}`,
      );
      continue;
    }

    seenKinds.add(kind);
  }

  return seenKinds;
}

export function validateConsumerScope(
  errors,
  consumerScope,
  tierLabel,
  consumerIds,
) {
  const label = `${tierLabel}.consumerScope`;
  if (!Array.isArray(consumerScope)) {
    errors.push(
      `[CT-9B_TIER_POLICY_INVALID_CONSUMER_SCOPE] ${label} must be an array`,
    );
    return;
  }

  if (consumerScope.length === 0) {
    errors.push(
      `[CT-9B_TIER_POLICY_EMPTY_CONSUMER_SCOPE] ${label} must not be empty`,
    );
  }

  const seenThreads = new Set();

  for (const [index, threadId] of consumerScope.entries()) {
    const itemLabel = `${label}[${index}]`;
    if (typeof threadId !== "string" || threadId.length === 0) {
      errors.push(
        `[CT-9B_TIER_POLICY_INVALID_CONSUMER_THREAD] ${itemLabel} must be a non-empty string`,
      );
      continue;
    }

    if (!consumerIds.includes(threadId)) {
      errors.push(
        `[CT-9B_TIER_POLICY_UNKNOWN_CONSUMER_THREAD] ${itemLabel} must be one of ${consumerIds.join(", ")}`,
      );
      continue;
    }

    if (seenThreads.has(threadId)) {
      errors.push(
        `[CT-9B_TIER_POLICY_DUPLICATE_CONSUMER_THREAD] ${itemLabel} duplicates "${threadId}" in ${label}`,
      );
    }

    seenThreads.add(threadId);
  }
}

function validateKindField(errors, kind, label) {
  if (typeof kind !== "string" || kind.length === 0) {
    errors.push(
      `[CT-9B_TIER_POLICY_INVALID_KIND] ${label} must be a non-empty string`,
    );
    return null;
  }

  const nextKindIndex = validatorKindOrder.get(kind);
  if (typeof nextKindIndex !== "number") {
    errors.push(
      `[CT-9B_TIER_POLICY_UNKNOWN_KIND] ${label} must be one of ${allowedStorybookValidatorKinds.join(", ")}`,
    );
    return null;
  }

  return nextKindIndex;
}

export function assertPlainObject(errors, value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    errors.push(
      `[CT-9B_TIER_POLICY_INVALID_OBJECT] ${label} must be an object`,
    );
    return false;
  }

  return true;
}

export function validateKeySpec(errors, value, keySpec, label) {
  const requiredKeys = [...keySpec.required].sort();
  const optionalKeys = [...(keySpec.optional ?? [])].sort();
  const allowedKeys = [...requiredKeys, ...optionalKeys].sort();
  const actualKeys = Object.keys(value).sort();

  for (const key of requiredKeys) {
    if (!actualKeys.includes(key)) {
      errors.push(
        `[CT-9B_TIER_POLICY_MISSING_REQUIRED_KEY] ${label}.${key} is required`,
      );
    }
  }

  for (const key of actualKeys) {
    if (!allowedKeys.includes(key)) {
      errors.push(
        `[CT-9B_TIER_POLICY_UNEXPECTED_KEY] ${label}.${key} is not allowed`,
      );
    }
  }
}

export function requireLiteral(errors, actual, expected, label) {
  if (actual !== expected) {
    errors.push(
      `[CT-9B_TIER_POLICY_INVALID_LITERAL] ${label} must be ${expected}`,
    );
  }
}
