import { CannotEvaluateError } from "../figma/profile.mjs";
import { TokenInputError } from "./source.mjs";
import fs from "node:fs";
const supportedActions = new Set([
  "preserve",
  "alias",
  "rename-with-migration",
]);
const cssName = /^--[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function renderCompatibilityAliases(config, themeId, stagedVariables) {
  if (config === null) return [];
  const inventory = readInput(config.inventory);
  const aliasMap = readInput(config.aliases);
  const entries = inventory?.entries,
    aliases = aliasMap?.entries;
  if (
    inventory?.inventoryVersion !== "1" ||
    aliasMap?.aliasMapVersion !== "1" ||
    !Array.isArray(entries) ||
    !Array.isArray(aliases)
  )
    fail(
      "runtime compatibility artifacts require version 1 and entries arrays",
    );
  if (aliasMap.defaultThemeId !== themeId)
    fail("runtime compatibility default theme differs from the build");
  const aliasByName = new Map(aliases.map((a) => [a?.legacyVar, a]));
  const names = new Set(entries.map((e) => e?.legacyVar));
  if (
    aliasByName.size !== aliases.length ||
    names.size !== entries.length ||
    aliases.length !== entries.length
  )
    fail(
      "runtime compatibility inventory and aliases must be unique and aligned",
    );
  const lines = [];
  let previousCategory = null;
  for (const entry of entries) {
    if (!entry || !cssName.test(entry.legacyVar))
      fail("invalid runtime legacy variable name");
    const alias = aliasByName.get(entry.legacyVar);
    if (!alias) fail(`missing alias-map entry for ${entry.legacyVar}`);
    if (alias.themeId !== themeId)
      fail(`alias ${entry.legacyVar} targets another theme`);
    if (!supportedActions.has(alias.action))
      fail(`unsupported alias action ${alias.action}`);
    if (
      typeof alias.canonicalTokenId !== "string" ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(alias.canonicalTokenId)
    )
      fail("invalid canonical token ID");
    const canonical = `--${alias.canonicalTokenId.replaceAll(".", "-")}`;
    if (!stagedVariables.has(canonical))
      fail(
        `staged runtime CSS does not expose canonical variable ${canonical}`,
      );
    if (stagedVariables.has(entry.legacyVar))
      fail(`legacy alias shadows canonical variable ${entry.legacyVar}`);
    const category = entry.normalizedCategory;
    if (
      typeof category !== "string" ||
      !category.length ||
      category.includes("\0") ||
      /[\r\n]|\*\//.test(category)
    )
      fail("invalid compatibility category");
    if (category !== previousCategory) {
      lines.push("", `  /* ${config.categoryLabels[category] ?? category} */`);
      previousCategory = category;
    }
    lines.push(`  ${entry.legacyVar}: var(${canonical});`);
  }
  return lines;
}
function fail(message) {
  throw new TokenInputError("TOKEN_RUNTIME", `token build setup: ${message}`);
}

function readInput(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new CannotEvaluateError(
      "TOKEN_BUILD_INPUT",
      `Cannot read runtime compatibility ${file}: ${error.message}`,
    );
  }
}
