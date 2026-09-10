export function diag(pathValue, rule, message) {
  return { path: pathValue, rule, message };
}

export function isObject(value) {
  return (
    Boolean(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

export function formatPath(key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `.${key}`
    : `[${JSON.stringify(key)}]`;
}

export function expectValue(ok, pathValue, rule, message) {
  return ok ? null : diag(pathValue, rule, message);
}

export function expectObject(value, jsonPath, message) {
  return expectValue(isObject(value), jsonPath, "type", message);
}

export function expectIdentifier(value, rules, jsonPath, message) {
  return expectValue(
    typeof value === "string" && rules.identifier.test(value),
    jsonPath,
    "pattern",
    message,
  );
}

export function expectRequired(value, required, jsonPath) {
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      return diag(jsonPath, "required", `missing required property "${key}"`);
    }
  }
  return null;
}

export function expectNoExtras(value, allowed, jsonPath, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      return diag(
        `${jsonPath}${formatPath(key)}`,
        "additional-property",
        `unknown ${label} property "${key}"`,
      );
    }
  }
  return null;
}
