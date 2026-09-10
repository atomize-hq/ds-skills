import fs from "node:fs";
import path from "node:path";
import { isObject } from "../recipes/checks.mjs";

export class TokenInputError extends Error {
  constructor(code, message, sourcePath = null) {
    super(message);
    this.name = "TokenInputError";
    this.code = code;
    this.sourcePath = sourcePath;
  }
}
export function readTokenJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new TokenInputError(
      "TOKEN_SOURCE_READ",
      `Cannot read token input ${file}: ${error.message}`,
      file,
    );
  }
}
export function loadCanonicalSourceTree(config) {
  const tree = new Map();
  function visit(directory) {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      throw new TokenInputError(
        "TOKEN_SOURCE_READ",
        `Cannot read token directory ${directory}: ${error.message}`,
        directory,
      );
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (file === config.themes.directory) continue;
      if (entry.isSymbolicLink())
        throw new TokenInputError(
          "TOKEN_SOURCE_LINK",
          `Token sources cannot be symlinks: ${file}`,
          file,
        );
      if (entry.isDirectory()) {
        visit(file);
        continue;
      }
      if (!entry.name.endsWith(".tokens.json")) continue;
      const family = entry.name.slice(0, -".tokens.json".length);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(family))
        throw new TokenInputError(
          "TOKEN_FAMILY",
          `Invalid token family ${family}`,
          file,
        );
      if (tree.has(family))
        throw new TokenInputError(
          "TOKEN_FAMILY",
          `duplicate token family ${family}`,
          file,
        );
      tree.set(family, normalizeTypes(readTokenJson(file), undefined, family));
    }
  }
  visit(config.sourceDir);
  if (tree.size === 0)
    throw new TokenInputError(
      "TOKEN_SOURCE_MISSING",
      "No token family files found",
      config.sourceDir,
    );
  return Object.fromEntries(tree);
}

export function normalizeTypes(node, inherited, location = "<root>") {
  if (!isObject(node))
    throw new TokenInputError(
      "TOKEN_SOURCE_SHAPE",
      `Invalid token object at ${location}`,
    );
  const type = Object.hasOwn(node, "$type") ? node.$type : inherited;
  if (
    Object.hasOwn(node, "$type") &&
    (typeof type !== "string" || !type.length)
  )
    throw new TokenInputError(
      "TOKEN_SOURCE_SHAPE",
      `Invalid token type at ${location}`,
    );
  if (Object.hasOwn(node, "$value")) {
    if (
      typeof type !== "string" ||
      !type.length ||
      Object.keys(node).some((key) => !key.startsWith("$"))
    )
      throw new TokenInputError(
        "TOKEN_SOURCE_SHAPE",
        `Invalid typed token leaf at ${location}`,
      );
    return { ...node, $type: type };
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      key.startsWith("$")
        ? value
        : normalizeTypes(value, type, `${location}.${key}`),
    ]),
  );
}

/** Source references remain obligations even when a later theme overrides a value. */
export function validateDeclaredReferences(document, tokenIds, sourcePath) {
  function values(value, location) {
    if (typeof value === "string") {
      const match = /^\{([^}]+)\}$/.exec(value);
      if (match && !tokenIds.has(match[1]))
        throw new TokenInputError(
          "TOKEN_REFERENCE",
          `Token ${match[1]} is not defined (referenced at ${location})`,
          sourcePath,
        );
    } else if (Array.isArray(value))
      value.forEach((entry, index) => values(entry, `${location}[${index}]`));
    else if (isObject(value))
      for (const [key, entry] of Object.entries(value))
        values(entry, `${location}.${key}`);
  }
  function walk(node, location) {
    if (Object.hasOwn(node, "$value")) {
      values(node.$value, location);
      return;
    }
    for (const [key, entry] of Object.entries(node))
      if (!key.startsWith("$")) walk(entry, `${location}.${key}`);
  }
  walk(document, "$");
}
