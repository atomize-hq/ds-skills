import fs from "node:fs";
import path from "node:path";
import { CannotEvaluateError } from "../figma/profile.mjs";
import { createTokenInventory, validateRecipe } from "./index.mjs";
import { discoverRecipeSources, readRecipeSource } from "./sources.mjs";

const optionNames = new Set(["recipes", "tokens", "json"]);

/** Read-only command. Token input establishes names, not build or publication validity. */
export function runRecipesValidation(options, rest, json, io) {
  if (
    rest.length > 0 ||
    Object.keys(options).some((key) => !optionNames.has(key))
  ) {
    throw new CannotEvaluateError(
      "RECIPE_ARGUMENT",
      "Unsupported arguments for recipes validate",
    );
  }
  for (const key of ["recipes", "tokens"]) {
    if (!options[key] || options[key] === "true") {
      throw new CannotEvaluateError(
        "RECIPE_ARGUMENT",
        `--${key} requires a path`,
      );
    }
  }
  const sourceDir = path.resolve(options.recipes);
  const tokenArtifactPath = path.resolve(options.tokens);
  const files = discoverRecipeSources(sourceDir);
  const tokenIds = readTokenInventory(tokenArtifactPath);
  const diagnostics = [];
  const components = [];
  for (const file of files) {
    const { data, error: parseError } = readRecipeSource(file);
    const error =
      parseError ??
      validateRecipe(data, {
        filenameStem: path.basename(file, ".recipe.json"),
        tokenIds,
      });
    if (error) diagnostics.push({ sourcePath: file, ...error });
    components.push({
      sourcePath: file,
      componentId: data?.componentId ?? null,
      valid: error === null,
    });
  }
  const report = {
    resultVersion: "1",
    command: "recipes validate",
    ok: diagnostics.length === 0,
    sourceDir,
    tokenArtifactPath,
    components,
    diagnostics,
  };
  if (json) io.stdout.write(`${JSON.stringify(report)}\n`);
  else {
    io.stdout.write(
      `${report.ok ? "✓" : "✗"} recipes validate: ${components.length} source(s) in ${sourceDir}\n`,
    );
    for (const diagnostic of diagnostics) {
      io.stderr.write(
        `${diagnostic.sourcePath}: ${diagnostic.path} [${diagnostic.rule}] ${diagnostic.message}\n`,
      );
    }
    io.stdout.write(
      "Scope: recipe shape, intrinsic consistency and token existence; not component readiness or Figma publication.\n",
    );
  }
  return report.ok ? 0 : 1;
}

function readTokenInventory(file) {
  try {
    const inventory = createTokenInventory(
      JSON.parse(fs.readFileSync(file, "utf8")),
    );
    if (inventory.size === 0)
      throw new Error("token input contains no typed tokens");
    return inventory;
  } catch (error) {
    throw new CannotEvaluateError(
      "RECIPE_TOKEN_INPUT",
      `Cannot inventory tokens from ${file}: ${error.message}`,
    );
  }
}
