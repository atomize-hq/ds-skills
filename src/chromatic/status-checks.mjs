export function validateKeys(errors, value, required, optional, label) {
  const allowedKeys = new Set([...required, ...optional]);
  const actualKeys = Object.keys(value);

  for (const key of required) {
    if (!(key in value)) {
      errors.push(
        `[CT-10B_CHROMATIC_STATUS_MISSING_REQUIRED_KEY] ${formatPath(label, key)} is required`,
      );
    }
  }

  for (const key of actualKeys) {
    if (!allowedKeys.has(key)) {
      errors.push(
        `[CT-10B_CHROMATIC_STATUS_UNEXPECTED_KEY] ${formatPath(label, key)} is not allowed`,
      );
    }
  }
}

export function requireLiteral(errors, actual, expected, label) {
  if (actual !== expected) {
    errors.push(
      `[CT-10B_CHROMATIC_STATUS_INVALID_LITERAL] ${label} must be ${expected}`,
    );
  }
}

export function requireNonEmptyString(errors, actual, label) {
  if (
    typeof actual !== "string" ||
    actual.trim() !== actual ||
    actual.length === 0
  ) {
    errors.push(
      `[CT-10B_CHROMATIC_STATUS_INVALID_STRING] ${label} must be a non-empty string`,
    );
  }
}

export function requireUniqueStringArray(errors, actual, label) {
  if (!Array.isArray(actual) || actual.length === 0) {
    errors.push(
      `[CT-10B_CHROMATIC_STATUS_INVALID_STRING_ARRAY] ${label} must be a non-empty string array`,
    );
    return null;
  }

  const invalidItem = actual.some(
    (item) =>
      typeof item !== "string" || item.trim() !== item || item.length === 0,
  );
  if (invalidItem) {
    errors.push(
      `[CT-10B_CHROMATIC_STATUS_INVALID_STRING_ARRAY] ${label} must be a non-empty string array`,
    );
    return null;
  }

  if (new Set(actual).size !== actual.length) {
    errors.push(
      `[CT-10B_CHROMATIC_STATUS_INVALID_STRING_ARRAY] ${label} must not contain duplicate values`,
    );
  }

  return [...actual];
}

export function requireEnum(errors, actual, allowedValues, label) {
  if (typeof actual !== "string" || !allowedValues.includes(actual)) {
    errors.push(
      `[CT-10B_CHROMATIC_STATUS_INVALID_ENUM] ${label} must be ${allowedValues.join(", ")}`,
    );
  }
}

function formatPath(label, key) {
  return label ? `${label}.${key}` : key;
}

export function arraysEqual(left, right) {
  if (
    !Array.isArray(left) ||
    !Array.isArray(right) ||
    left.length !== right.length
  ) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
