import fs from "node:fs";
import { createRules, validateRecipeShape } from "./shape.mjs";
import {
  validateRecipeConsistency,
  validateTokenLeaves,
} from "./consistency.mjs";

export { createTokenInventory } from "./token-inventory.mjs";

const rules = createRules(
  JSON.parse(
    fs.readFileSync(
      new URL("../../schemas/component-recipe.schema.json", import.meta.url),
      "utf8",
    ),
  ),
);

/** Pure evaluation over source data and a token inventory; no project globals. */
export function validateRecipe(recipe, { filenameStem, tokenIds }) {
  if (typeof filenameStem !== "string" || !(tokenIds instanceof Set)) {
    throw new TypeError(
      "Recipe validation requires filenameStem and a tokenIds Set",
    );
  }
  return (
    validateRecipeShape(recipe, filenameStem, rules) ??
    validateRecipeConsistency(recipe) ??
    validateTokenLeaves(recipe.slots, "$.slots", tokenIds, rules) ??
    validateTokenLeaves(recipe.states, "$.states", tokenIds, rules)
  );
}
