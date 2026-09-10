import fs from "node:fs";
import path from "node:path";
import { CannotEvaluateError } from "../figma/profile.mjs";

/** Shared source discovery for validation and downstream recipe projections. */
export function discoverRecipeSources(directory) {
  const root = path.resolve(directory);
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    throw new CannotEvaluateError(
      "RECIPE_SOURCE_ROOT",
      `Cannot read recipe directory ${root}: ${error.message}`,
    );
  }
  return entries
    .filter((entry) => entry.name.endsWith(".recipe.json"))
    .map((entry) => {
      if (!entry.isFile()) {
        throw new CannotEvaluateError(
          "RECIPE_SOURCE_ENTRY",
          `Recipe source must be a regular file, not a directory or symlink: ${path.join(root, entry.name)}`,
        );
      }
      return path.join(root, entry.name);
    })
    .sort();
}

export function readRecipeSource(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new CannotEvaluateError(
      "RECIPE_SOURCE_READ",
      `Cannot read recipe source ${file}: ${error.message}`,
    );
  }
  try {
    return { data: JSON.parse(text), error: null };
  } catch (error) {
    return {
      data: null,
      error: { path: "$", rule: "json-parse", message: error.message },
    };
  }
}
