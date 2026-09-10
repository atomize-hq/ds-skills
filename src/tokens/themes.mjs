import { resolveProjectPath } from "../project/config.mjs";
import { isObject } from "../recipes/checks.mjs";
import { readTokenJson, TokenInputError } from "./source.mjs";

const identifier = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function readThemeRegistry(config) {
  const registry = readTokenJson(config.themes.registry);
  if (
    !isObject(registry) ||
    registry.registryVersion !== "1" ||
    !Array.isArray(registry.themes) ||
    registry.themes.length === 0 ||
    registry.unknownThemeIdBehavior !== "error"
  )
    fail("Invalid theme registry");
  const themes = new Map();
  for (const theme of registry.themes) {
    if (
      !isObject(theme) ||
      typeof theme.id !== "string" ||
      !identifier.test(theme.id) ||
      typeof theme.required !== "boolean" ||
      !(theme.extends === null || typeof theme.extends === "string")
    )
      fail("Invalid theme entry");
    if (themes.has(theme.id)) fail(`duplicate theme ${theme.id}`);
    resolveProjectPath(config.themes.directory, theme.file, "theme.file");
    themes.set(theme.id, theme);
  }
  for (const field of ["defaultThemeId", "terminalFallbackThemeId"])
    if (!themes.has(registry[field])) fail(`Unknown ${field}`);
  for (const theme of themes.values()) resolveThemeChain(registry, theme.id);
  for (const field of ["defaultThemeId", "terminalFallbackThemeId"]) {
    if (!themes.get(registry[field]).required)
      fail(`${field} must name a required theme`);
  }
  return registry;
}
export function resolveThemeChain(registry, id) {
  const themes = new Map(registry.themes.map((theme) => [theme.id, theme]));
  const chain = [];
  const seen = new Set();
  let current = id;
  while (current !== null) {
    if (seen.has(current)) fail(`Theme inheritance cycle at ${current}`);
    seen.add(current);
    const theme = themes.get(current);
    if (!theme) fail(`Unknown parent or requested theme ${current}`);
    chain.unshift(theme);
    current = theme.extends;
  }
  return chain;
}
export function readThemeDocument(config, theme) {
  const file = resolveProjectPath(
    config.themes.directory,
    theme.file,
    "theme.file",
  );
  const document = readTokenJson(file);
  if (
    !isObject(document) ||
    document.$extensions?.[config.extensionsNamespace]?.themeId !== theme.id
  )
    fail(
      `Theme ${theme.id} must declare matching themeId under ${config.extensionsNamespace}`,
    );
  return document;
}
function fail(message) {
  throw new TokenInputError("TOKEN_THEME", message);
}
