import { diag, formatPath, isObject } from "./checks.mjs";

/** Validate relationships inside a shape-valid recipe, without a second declaration. */
export function validateRecipeConsistency(recipe) {
  const axes = new Map();
  for (const [index, axis] of recipe.variantAxes.entries()) {
    if (axes.has(axis.name)) {
      return diag(
        `$.variantAxes[${index}].name`,
        "duplicate-axis",
        `duplicate axis "${axis.name}"`,
      );
    }
    axes.set(axis.name, axis.values);
  }

  for (const [name, value] of Object.entries(recipe.defaults.variants)) {
    const values = axes.get(name);
    const target = `$.defaults.variants${formatPath(name)}`;
    if (!values)
      return diag(
        target,
        "default-axis",
        `unknown default variant axis "${name}"`,
      );
    if (!values.includes(value)) {
      return diag(
        target,
        "default-value",
        `unknown default value "${value}" for axis "${name}"`,
      );
    }
  }
  for (const name of axes.keys()) {
    if (!Object.hasOwn(recipe.defaults.variants, name)) {
      return diag(
        "$.defaults.variants",
        "default-axis",
        `missing default for axis "${name}"`,
      );
    }
  }

  const states = new Set(Object.keys(recipe.states));
  if (!states.has(recipe.defaults.state)) {
    return diag(
      "$.defaults.state",
      "default-state",
      `unknown default state "${recipe.defaults.state}"`,
    );
  }
  const slots = new Set(Object.keys(recipe.slots));
  for (const [state, overrides] of Object.entries(recipe.states)) {
    const target = `$.states${formatPath(state)}`;
    if (!isObject(overrides)) {
      return diag(
        target,
        "state-slots",
        "state overrides must be an object keyed by slot name",
      );
    }
    for (const slot of Object.keys(overrides)) {
      if (!slots.has(slot)) {
        return diag(
          `${target}${formatPath(slot)}`,
          "state-slot",
          `unknown slot "${slot}" for state "${state}"`,
        );
      }
    }
  }
  return validateStateFallbacks(recipe.fallbacks.stateFallbacks, states);
}

function validateStateFallbacks(fallbacks, states) {
  for (const [state, target] of Object.entries(fallbacks)) {
    const jsonPath = `$.fallbacks.stateFallbacks${formatPath(state)}`;
    if (!states.has(state))
      return diag(
        jsonPath,
        "fallback-state",
        `unknown fallback state "${state}"`,
      );
    if (!states.has(target))
      return diag(
        jsonPath,
        "fallback-target",
        `unknown fallback target "${target}"`,
      );
  }
  // Every chain must terminate. A cycle otherwise passes name validation but can
  // never produce a fallback, including the one-state self-reference case.
  for (const start of Object.keys(fallbacks)) {
    const seen = new Set();
    let cursor = start;
    while (Object.hasOwn(fallbacks, cursor)) {
      if (seen.has(cursor)) {
        return diag(
          `$.fallbacks.stateFallbacks${formatPath(start)}`,
          "fallback-cycle",
          `fallback cycle from state "${start}"`,
        );
      }
      seen.add(cursor);
      cursor = fallbacks[cursor];
    }
  }
  return null;
}

export function validateTokenLeaves(node, jsonPath, tokenInventory, rules) {
  if (typeof node === "string") {
    if (!rules.tokenReference.test(node)) {
      return diag(
        jsonPath,
        "token-reference",
        "inline scalar values are not allowed; expected token reference",
      );
    }

    const tokenId = node.slice(1, -1);
    return tokenInventory.has(tokenId)
      ? null
      : diag(jsonPath, "token-inventory", `unknown token reference "${node}"`);
  }

  for (const [key, child] of Object.entries(node)) {
    const error = validateTokenLeaves(
      child,
      `${jsonPath}${formatPath(key)}`,
      tokenInventory,
      rules,
    );
    if (error) return error;
  }

  return null;
}
