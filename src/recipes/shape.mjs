import {
  expectIdentifier,
  expectNoExtras,
  expectObject,
  expectRequired,
  expectValue,
  formatPath,
  isObject,
} from "./checks.mjs";

export function createRules(schema) {
  return {
    requiredRoot: new Set(schema.required ?? []),
    rootProps: new Set(Object.keys(schema.properties ?? {})),
    identifier: new RegExp(schema.$defs.identifier.pattern),
    tokenReference: new RegExp(schema.$defs.tokenReference.pattern),
    variantRequired: new Set(schema.$defs.variantAxis.required ?? []),
    defaultsRequired: new Set(schema.$defs.defaults.required ?? []),
    fallbacksRequired: new Set(schema.$defs.fallbacks.required ?? []),
  };
}

export function validateRecipeShape(recipe, fileStem, rules) {
  return (
    expectObject(recipe, "$", "root must be an object") ??
    expectRequired(recipe, rules.requiredRoot, "$") ??
    expectNoExtras(recipe, rules.rootProps, "$", "top-level") ??
    expectValue(
      recipe.recipeVersion === "1",
      "$.recipeVersion",
      "const",
      'recipeVersion must be "1"',
    ) ??
    expectIdentifier(
      recipe.componentId,
      rules,
      "$.componentId",
      "componentId must be lowercase kebab-case",
    ) ??
    expectValue(
      recipe.componentId === fileStem,
      "$.componentId",
      "filename-alignment",
      `componentId must match filename stem "${fileStem}"`,
    ) ??
    validateVariantAxes(recipe.variantAxes, rules) ??
    validateDefaults(recipe.defaults, rules) ??
    validateReferenceMap(recipe.slots, "$.slots", rules) ??
    validateReferenceMap(recipe.states, "$.states", rules) ??
    validateFallbacks(recipe.fallbacks, rules)
  );
}

function validateVariantAxes(axes, rules) {
  const rootError = expectValue(
    Array.isArray(axes) && axes.length > 0,
    "$.variantAxes",
    "type",
    "variantAxes must be a non-empty array",
  );
  if (rootError) return rootError;

  for (const [index, axis] of axes.entries()) {
    const axisPath = `$.variantAxes[${index}]`;
    const error =
      expectObject(axis, axisPath, "variant axis must be an object") ??
      expectRequired(axis, rules.variantRequired, axisPath) ??
      expectNoExtras(axis, rules.variantRequired, axisPath, "variant axis") ??
      expectIdentifier(
        axis.name,
        rules,
        `${axisPath}.name`,
        "axis name must be lowercase kebab-case",
      ) ??
      expectValue(
        Array.isArray(axis.values) && axis.values.length > 0,
        `${axisPath}.values`,
        "type",
        "axis values must be a non-empty array",
      ) ??
      expectValue(
        new Set(axis.values).size === axis.values.length,
        `${axisPath}.values`,
        "unique-items",
        "axis values must be unique",
      );
    if (error) return error;

    for (const value of axis.values) {
      const valueError = expectIdentifier(
        value,
        rules,
        `${axisPath}.values`,
        "axis values must be lowercase kebab-case",
      );
      if (valueError) return valueError;
    }
  }

  return null;
}

function validateDefaults(defaults, rules) {
  const error =
    expectObject(defaults, "$.defaults", "defaults must be an object") ??
    expectRequired(defaults, rules.defaultsRequired, "$.defaults") ??
    expectNoExtras(
      defaults,
      rules.defaultsRequired,
      "$.defaults",
      "defaults",
    ) ??
    expectValue(
      isObject(defaults.variants) && Object.keys(defaults.variants).length > 0,
      "$.defaults.variants",
      "type",
      "defaults.variants must be a non-empty object",
    ) ??
    expectIdentifier(
      defaults.state,
      rules,
      "$.defaults.state",
      "defaults.state must be lowercase kebab-case",
    );
  if (error) return error;

  for (const [key, value] of Object.entries(defaults.variants)) {
    const variantError =
      expectIdentifier(
        key,
        rules,
        `$.defaults.variants${formatPath(key)}`,
        "defaults.variants keys must be lowercase kebab-case",
      ) ??
      expectIdentifier(
        value,
        rules,
        `$.defaults.variants${formatPath(key)}`,
        "defaults.variants values must be lowercase kebab-case",
      );
    if (variantError) return variantError;
  }

  return null;
}

function validateReferenceMap(value, jsonPath, rules) {
  return (
    expectObject(value, jsonPath, `${jsonPath.slice(2)} must be an object`) ??
    expectValue(
      Object.keys(value).length > 0,
      jsonPath,
      "min-properties",
      `${jsonPath.slice(2)} must not be empty`,
    ) ??
    validateReferenceTree(value, jsonPath, rules)
  );
}

function validateReferenceTree(value, jsonPath, rules) {
  if (typeof value === "string") {
    return expectValue(
      rules.tokenReference.test(value),
      jsonPath,
      "token-reference",
      "inline scalar values are not allowed; expected token reference",
    );
  }

  const error =
    expectObject(
      value,
      jsonPath,
      "reference nodes must be an object or token reference",
    ) ??
    expectValue(
      Object.keys(value).length > 0,
      jsonPath,
      "min-properties",
      "reference objects must not be empty",
    );
  if (error) return error;

  for (const [key, child] of Object.entries(value)) {
    const keyPath = `${jsonPath}${formatPath(key)}`;
    const childError =
      expectIdentifier(
        key,
        rules,
        keyPath,
        "reference-tree keys must be lowercase kebab-case",
      ) ?? validateReferenceTree(child, keyPath, rules);
    if (childError) return childError;
  }

  return null;
}

function validateFallbacks(fallbacks, rules) {
  const error =
    expectObject(fallbacks, "$.fallbacks", "fallbacks must be an object") ??
    expectRequired(fallbacks, rules.fallbacksRequired, "$.fallbacks") ??
    expectNoExtras(
      fallbacks,
      rules.fallbacksRequired,
      "$.fallbacks",
      "fallbacks",
    ) ??
    expectValue(
      fallbacks.missingVariantBehavior === "use-defaults",
      "$.fallbacks.missingVariantBehavior",
      "enum",
      'missingVariantBehavior must be "use-defaults"',
    ) ??
    expectValue(
      isObject(fallbacks.stateFallbacks),
      "$.fallbacks.stateFallbacks",
      "type",
      "stateFallbacks must be an object",
    );
  if (error) return error;

  for (const [key, value] of Object.entries(fallbacks.stateFallbacks)) {
    const fallbackError =
      expectIdentifier(
        key,
        rules,
        `$.fallbacks.stateFallbacks${formatPath(key)}`,
        "stateFallback keys must be lowercase kebab-case",
      ) ??
      expectIdentifier(
        value,
        rules,
        `$.fallbacks.stateFallbacks${formatPath(key)}`,
        "stateFallback values must be lowercase kebab-case",
      );
    if (fallbackError) return fallbackError;
  }

  return null;
}
