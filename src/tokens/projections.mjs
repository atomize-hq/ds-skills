import { isObject } from "../recipes/checks.mjs";
import { sortDeep, flattenTokenMap } from "./graph-values.mjs";
export function createFigmaTokenDocument(graph, themeVariants = []) {
  const figmaExcludedFamilies = new Set(
    graph.project.tokens.figma.excludedFamilies,
  );
  const publishedFamilies = Object.fromEntries(
    Object.entries(graph.materializedTokens).filter(
      ([family]) => !figmaExcludedFamilies.has(family),
    ),
  );

  // Non-default themes ride along as DTCG-shaped partial trees under a
  // `$`-prefixed key, which the token walker skips. The document therefore stays
  // a valid single-theme artifact for every existing reader, while giving the
  // publish plugin what it needs to write one Figma mode per theme.
  const themeOverrides = {};
  for (const variant of themeVariants) {
    const overrides = diffTokenTrees(publishedFamilies, variant.tokens);
    if (Object.keys(overrides).length > 0) {
      themeOverrides[variant.themeId] = overrides;
    }
  }

  return sortDeep({
    $extensions: {
      [graph.project.tokens.extensionsNamespace]: {
        source: "repo",
        themeId: graph.themeId,
      },
    },
    ...(Object.keys(themeOverrides).length > 0
      ? { $themeOverrides: themeOverrides }
      : {}),
    ...publishedFamilies,
  });
}

/**
 * Returns the subtree of `candidate` whose leaf values differ from `base`, keeping
 * the DTCG leaf shape so the result flattens through the same mapping the base
 * document uses. Families absent from `base` — the ones withheld from the Figma
 * publish — are skipped rather than reintroduced by a theme.
 */
function diffTokenTrees(base, candidate) {
  const result = {};

  for (const [key, candidateNode] of Object.entries(candidate)) {
    const baseNode = isObject(base) ? base[key] : undefined;
    if (baseNode === undefined) continue;

    if (isObject(candidateNode) && "$value" in candidateNode) {
      if (
        JSON.stringify(baseNode.$value) !== JSON.stringify(candidateNode.$value)
      ) {
        result[key] = candidateNode;
      }
      continue;
    }

    if (isObject(candidateNode)) {
      const nested = diffTokenTrees(baseNode, candidateNode);
      if (Object.keys(nested).length > 0) {
        result[key] = nested;
      }
    }
  }

  return result;
}

/**
 * Flat per-theme override maps, shaped exactly like `graph.tokenMap` but holding
 * only the leaves whose value differs from the default theme.
 *
 * The Figma document has carried its themes since light landed, and the runtime
 * CSS emits a block per theme — the typed module was the one artifact still
 * flattened to the default, which quietly made every in-repo proof built on it a
 * single-theme proof. Emitting the diff rather than a full second map keeps the
 * artifact small and keeps `tokenMap` the single list of token IDs.
 */
export function createThemeOverrideMaps(graph, themeVariants = []) {
  const overrides = {};

  for (const variant of themeVariants) {
    const themed = flattenTokenMap(variant.tokens, variant.themeId);
    const changed = {};

    for (const [tokenId, entry] of Object.entries(themed)) {
      const base = graph.tokenMap[tokenId];
      if (!base || JSON.stringify(base.value) !== JSON.stringify(entry.value)) {
        changed[tokenId] = entry;
      }
    }

    if (Object.keys(changed).length > 0) {
      overrides[variant.themeId] = changed;
    }
  }

  return sortDeep(overrides);
}
