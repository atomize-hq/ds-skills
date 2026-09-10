import { TokenInputError } from "./source.mjs";
import { CannotEvaluateError } from "../figma/profile.mjs";
import { compileCss, formatTypedModule } from "./compiler.mjs";
import { loadBuildGraph } from "./graph.mjs";
import {
  createFigmaTokenDocument,
  createThemeOverrideMaps,
} from "./projections.mjs";
import { buildPublishedRuntimeCss } from "./runtime-css.mjs";

/** Full deterministic rendering with no artifact writes, cwd change, or ambient config. */
export async function renderTokenArtifacts({ project }) {
  const build = project.tokens?.build;
  if (!build)
    throw new CannotEvaluateError(
      "TOKEN_BUILD_NOT_CONFIGURED",
      "Token build capability is not configured",
    );
  const graph = loadBuildGraph({ project });
  const variants = [];
  for (const theme of graph.themeRegistry.themes) {
    if (theme.id === graph.themeId) continue;
    const themeGraph = loadBuildGraph({ project, themeId: theme.id });
    variants.push({
      themeId: theme.id,
      tokens: themeGraph.materializedTokens,
      stagedCss: await compile(themeGraph.materializedTokens),
    });
  }
  const stagedCss = await compile(graph.materializedTokens);
  const runtimeCss = buildPublishedRuntimeCss({
    stagedCss,
    themeId: graph.themeId,
    themeOverrides: variants,
    banner: build.banner,
    runtime: build.runtime,
  });
  const typedSource = [
    `// ${build.banner}`,
    "",
    `export const themeRegistry = ${serializeJson(graph.themeRegistry).trimEnd()} as const;`,
    "",
    `export const tokenMap = ${serializeJson(graph.tokenMap).trimEnd()} as const;`,
    "",
    `export const themeOverrides = ${serializeJson(createThemeOverrideMaps(graph, variants)).trimEnd()} as const;`,
    "",
    `export const recipeMap = ${serializeJson(graph.recipeMap).trimEnd()} as const;`,
    "",
    "export type ThemeId = (typeof themeRegistry.themes)[number]['id'];",
    "export type TokenId = keyof typeof tokenMap;",
    "export type RecipeComponentId = keyof typeof recipeMap;",
    "",
  ].join("\n");
  return {
    graph,
    contents: {
      stagedCss,
      runtimeCss,
      typescript: await formatTypedModule(typedSource, build.formatting),
      figma: serializeJson(createFigmaTokenDocument(graph, variants)),
    },
  };
}
function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function compile(tokens) {
  try {
    return await compileCss(tokens);
  } catch (error) {
    throw new TokenInputError("TOKEN_COMPILE", error.message);
  }
}
