import { isObject } from "../recipes/checks.mjs";
const referencePattern = /^\{([^}]+)\}$/;
export function sortDeep(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortDeep(entry));
  }

  if (!isObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortDeep(entry)]),
  );
}

export function materializeTokenTree(tokenTree) {
  const cache = new Map();
  const currentPath = [];

  return sortDeep(
    walkMaterializedTree(
      tokenTree,
      (tokenId, leaf) => ({
        $type: leaf.$type,
        $value: resolveTokenValue(tokenId, tokenTree, cache),
      }),
      currentPath,
    ),
  );
}

function walkMaterializedTree(node, visitLeaf, trail) {
  if (!isObject(node)) {
    return node;
  }

  if ("$value" in node && "$type" in node) {
    return visitLeaf(trail.join("."), node);
  }

  const next = {};
  for (const [key, value] of Object.entries(node)) {
    next[key] = key.startsWith("$")
      ? cloneValue(value)
      : walkMaterializedTree(value, visitLeaf, [...trail, key]);
  }
  return next;
}

function resolveTokenValue(tokenId, tokenTree, cache, stack = []) {
  if (cache.has(tokenId)) {
    return cache.get(tokenId);
  }
  if (stack.includes(tokenId)) {
    throw new Error(
      `token build setup: circular token reference detected for "${tokenId}"`,
    );
  }

  const token = getTokenLeaf(tokenTree, tokenId);
  const resolved = resolveValueNode(token.$value, tokenTree, cache, [
    ...stack,
    tokenId,
  ]);
  cache.set(tokenId, resolved);
  return resolved;
}

function resolveValueNode(value, tokenTree, cache, stack) {
  if (typeof value === "string") {
    const match = referencePattern.exec(value);
    return match ? resolveTokenValue(match[1], tokenTree, cache, stack) : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      resolveValueNode(entry, tokenTree, cache, stack),
    );
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        resolveValueNode(entry, tokenTree, cache, stack),
      ]),
    );
  }
  return value;
}

function getTokenLeaf(tokenTree, tokenId) {
  const node = tokenId
    .split(".")
    .reduce((current, segment) => current?.[segment], tokenTree);
  if (!isObject(node) || !("$value" in node) || !("$type" in node)) {
    throw new Error(
      `token build setup: token "${tokenId}" is not defined in the materialized graph`,
    );
  }
  return node;
}

export function flattenTokenMap(tokenTree, themeId) {
  const entries = [];
  collectTokenEntries(tokenTree, [], entries, themeId);
  entries.sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

function collectTokenEntries(node, trail, entries, themeId) {
  if (!isObject(node)) {
    return;
  }
  if ("$value" in node && "$type" in node) {
    entries.push([
      trail.join("."),
      {
        themeId,
        type: node.$type,
        value: cloneValue(node.$value),
      },
    ]);
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (!key.startsWith("$")) {
      collectTokenEntries(value, [...trail, key], entries, themeId);
    }
  }
}

export function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry));
  }
  if (!isObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]),
  );
}

export function deepMerge(base, override) {
  if (!isObject(base) || !isObject(override)) {
    return cloneValue(override);
  }

  if (
    ("$value" in base && "$type" in base) ||
    ("$value" in override && "$type" in override)
  ) {
    return cloneValue(override);
  }

  const merged = cloneValue(base);
  for (const [key, value] of Object.entries(override)) {
    if (!(key in merged)) {
      merged[key] = cloneValue(value);
      continue;
    }
    merged[key] = deepMerge(merged[key], value);
  }
  return merged;
}
