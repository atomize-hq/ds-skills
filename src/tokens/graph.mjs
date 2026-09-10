import path from "node:path";
import { CannotEvaluateError } from "../figma/profile.mjs";
import { createTokenInventory, validateRecipe } from "../recipes/index.mjs";
import {
  discoverRecipeSources,
  readRecipeSource,
} from "../recipes/sources.mjs";
import {
  loadCanonicalSourceTree,
  validateDeclaredReferences,
  normalizeTypes,
  TokenInputError,
} from "./source.mjs";
import {
  readThemeRegistry,
  readThemeDocument,
  resolveThemeChain,
} from "./themes.mjs";
import {
  cloneValue,
  deepMerge,
  flattenTokenMap,
  materializeTokenTree,
  sortDeep,
} from "./graph-values.mjs";
export {
  createFigmaTokenDocument,
  createThemeOverrideMaps,
} from "./projections.mjs";

export function loadBuildGraph({ project, themeId }) {
  const config = project.tokens;
  if (config === null)
    throw new CannotEvaluateError(
      "TOKENS_NOT_CONFIGURED",
      "Token capability is explicitly not configured",
    );
  const registry = readThemeRegistry(config);
  const id = themeId ?? registry.defaultThemeId;
  const chain = resolveThemeChain(registry, id);
  const source = loadCanonicalSourceTree(config);
  const documents = new Map();
  const declaredIds = createTokenInventory(source);
  for (const theme of registry.themes) {
    const document = readThemeDocument(config, theme);
    const normalized = {};
    for (const [family, value] of Object.entries(document)) {
      if (family.startsWith("$")) continue;
      if (!Object.hasOwn(source, family))
        throw new TokenInputError(
          "TOKEN_THEME_FAMILY",
          `Theme ${theme.id} names unknown token family ${family}`,
        );
      normalized[family] = normalizeTypes(value, undefined, family);
    }
    for (const tokenId of createTokenInventory(normalized))
      declaredIds.add(tokenId);
    documents.set(theme.id, normalized);
  }
  if (declaredIds.size === 0)
    throw new TokenInputError(
      "TOKEN_SOURCE_MISSING",
      "Token sources contain no typed token leaves",
      config.sourceDir,
    );
  validateDeclaredReferences(source, declaredIds, config.sourceDir);
  for (const theme of registry.themes)
    validateDeclaredReferences(
      documents.get(theme.id),
      declaredIds,
      path.join(config.themes.directory, theme.file),
    );
  const tree = cloneValue(source);
  for (const theme of chain) {
    for (const [family, value] of Object.entries(documents.get(theme.id))) {
      tree[family] = deepMerge(tree[family], value);
    }
  }
  let materializedTokens;
  try {
    materializedTokens = materializeTokenTree(tree);
  } catch (error) {
    throw new TokenInputError("TOKEN_REFERENCE", error.message);
  }
  const tokenMap = flattenTokenMap(materializedTokens, id);
  const recipeMap = {};
  const tokenIds = new Set(Object.keys(tokenMap));
  if (config.recipesDir !== null) {
    for (const file of discoverRecipeSources(config.recipesDir)) {
      const { data, error: parseError } = readRecipeSource(file);
      const componentId = path.basename(file, ".recipe.json");
      const error =
        parseError ??
        validateRecipe(data, { filenameStem: componentId, tokenIds });
      if (error)
        throw new TokenInputError(
          "TOKEN_RECIPE",
          `${error.path} [${error.rule}] ${error.message}`,
          file,
        );
      recipeMap[componentId] = sortDeep(data);
    }
  }
  return {
    project,
    themeId: id,
    themeChain: chain,
    themeRegistry: sortDeep(registry),
    materializedTokens,
    tokenMap,
    recipeMap,
  };
}
