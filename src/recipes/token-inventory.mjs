import { isObject } from "./checks.mjs";

/** Token existence only, not value, reference resolution or publication proof. */
export function createTokenInventory(document) {
  const tokens = new Set();
  visit(document, [], undefined, tokens);
  return tokens;
}

function visit(node, trail, inheritedType, tokens) {
  const location = trail.join(".") || "<root>";
  if (!isObject(node))
    throw new TypeError(`Invalid token object at ${location}`);
  const type = Object.hasOwn(node, "$type") ? node.$type : inheritedType;
  const children = Object.keys(node).filter((key) => !key.startsWith("$"));
  if (Object.hasOwn(node, "$value")) {
    if (
      trail.length === 0 ||
      typeof type !== "string" ||
      type.length === 0 ||
      children.length > 0
    ) {
      throw new TypeError(
        `Invalid token leaf at ${location}: a typed, named leaf cannot contain groups`,
      );
    }
    tokens.add(trail.join("."));
    return;
  }
  for (const key of children) visit(node[key], [...trail, key], type, tokens);
}
