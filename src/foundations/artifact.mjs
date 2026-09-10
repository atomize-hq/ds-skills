import { flattenTokenDocument as flatten } from "../token-mapping.js";
import { foundationError } from "./values.mjs";
const flattenTokenDocument = (document) => {
  try {
    return flatten(document);
  } catch (error) {
    throw foundationError(error.message);
  }
};
export function foundationTokens(document, config) {
  const types = new Map(),
    raw = new Map();
  function visit(node, trail = [], out = raw, recordTypes = true, depth = 0) {
    if (depth > 64 || !node || typeof node !== "object" || Array.isArray(node))
      throw foundationError("Invalid or excessively nested token tree");
    if (Object.hasOwn(node, "$value")) {
      if (!trail.length || !Object.hasOwn(node, "$type"))
        throw foundationError("Token leaf needs a path and type");
      const id = trail.join(".");
      if (out.has(id)) throw foundationError("Duplicate token identity");
      out.set(id, node.$value);
      if (recordTypes) types.set(id, node.$type);
      else if (types.get(id) !== node.$type)
        throw foundationError(`Override changes type or adds token: ${id}`);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith("$")) continue;
      if (!key.length || key.includes(".") || key.includes("/"))
        throw foundationError("Token segments cannot contain path separators");
      visit(value, [...trail, key], out, recordTypes, depth + 1);
    }
  }
  visit(document);
  if (!raw.size || raw.size > 10000)
    throw foundationError("Artifact must have 1 to 10000 tokens");
  if (
    config.extensionsNamespace !== null &&
    document.$extensions?.[config.extensionsNamespace]?.themeId !==
      config.defaultTheme
  )
    throw foundationError(
      "Configured default theme disagrees with artifact metadata",
    );
  const overrides = document.$themeOverrides ?? {};
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides))
    throw foundationError("Invalid theme overrides");
  const expected = new Set([config.defaultTheme, ...Object.keys(overrides)]);
  if (
    Object.hasOwn(overrides, config.defaultTheme) ||
    expected.size !== config.modes.length ||
    config.modes.some((m) => !expected.has(m.id))
  )
    throw foundationError(
      "Configured modes must equal the artifact default and override modes",
    );
  const names = new Set();
  const base = flattenTokenDocument(document);
  for (const t of base) {
    if (names.has(t.name))
      throw foundationError("Ambiguous normalized Figma variable name");
    names.add(t.name);
  }
  const rows = new Map(
    base.map((t) => [
      t.path.join("."),
      {
        id: t.path.join("."),
        variable: t.name,
        type: types.get(t.path.join(".")),
        values: Object.create(null),
        figmaValues: Object.create(null),
      },
    ]),
  );
  for (const mode of config.modes) {
    const changed = new Map();
    if (mode.id !== config.defaultTheme)
      visit(overrides[mode.id], [], changed, false);
    const normalized = new Map(
      mode.id === config.defaultTheme
        ? []
        : flattenTokenDocument(overrides[mode.id]).map((t) => [
            t.path.join("."),
            t.value,
          ]),
    );
    for (const t of base) {
      const id = t.path.join("."),
        row = rows.get(id);
      row.values[mode.id] = changed.has(id) ? changed.get(id) : raw.get(id);
      row.figmaValues[mode.id] = normalized.has(id)
        ? normalized.get(id)
        : t.value;
      const val = row.figmaValues[mode.id];
      if (typeof val === "number" && !Number.isFinite(val))
        throw foundationError(`Nonfinite token value: ${id}`);
    }
  }
  return rows;
}
