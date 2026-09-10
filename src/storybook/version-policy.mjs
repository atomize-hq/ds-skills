import fs from "node:fs";
import { validate } from "../validate/schema.mjs";
const schema = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../schemas/storybook-version-policy.schema.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

/** Structural policy validation only; dependency/import conformance is a separate check. */
export function validateStorybookVersionPolicy(data) {
  const errors = validate(data, schema, {
    root: schema,
    profile: {},
    path: "",
  });
  if (errors.length)
    return errors.map((message) => `[STORYBOOK_VERSION_SCHEMA] ${message}`);
  if (!data || typeof data !== "object" || Array.isArray(data))
    return ["[STORYBOOK_VERSION_OBJECT] version policy must be an object"];
  for (const key of ["policyVersion", "framework"])
    if (typeof data[key] !== "string" || !data[key].trim())
      errors.push(
        `[STORYBOOK_VERSION_FIELD] ${key} must be a non-empty string`,
      );
  if (
    typeof data.storybookVersion !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(data.storybookVersion)
  )
    errors.push(
      "[STORYBOOK_VERSION_PIN] storybookVersion must be an exact stable version",
    );
  if (
    !Array.isArray(data.requiredAddons) ||
    data.requiredAddons.length === 0 ||
    data.requiredAddons.some(
      (value) => typeof value !== "string" || !value.trim(),
    ) ||
    new Set(data.requiredAddons).size !== data.requiredAddons.length
  )
    errors.push(
      "[STORYBOOK_VERSION_ADDONS] requiredAddons must contain unique non-empty strings",
    );
  if (
    !data.requiredImports ||
    typeof data.requiredImports !== "object" ||
    Array.isArray(data.requiredImports)
  )
    errors.push(
      "[STORYBOOK_VERSION_IMPORTS] requiredImports must be an object",
    );
  else
    for (const key of ["test", "previewApi", "actions"])
      if (
        typeof data.requiredImports[key] !== "string" ||
        !data.requiredImports[key].trim()
      )
        errors.push(
          `[STORYBOOK_VERSION_IMPORT] requiredImports.${key} must be a non-empty string`,
        );
  return errors;
}
