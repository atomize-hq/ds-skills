import { registryError, safeSourcePath } from "./definition.mjs";
import { digest } from "../libraries/capture.mjs";
export function jsonPayload(raw) {
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
    throw registryError("Invalid JSON response");
  }
  if (!p || typeof p !== "object" || Array.isArray(p))
    throw registryError("Expected a JSON object");
  return p;
}
export function indexNames(raw) {
  const p = jsonPayload(raw);
  if (!Array.isArray(p.items) || !p.items.length || p.items.length > 10000)
    throw registryError("Index has no supported explicit item list");
  const seen = new Set();
  for (const item of p.items) {
    if (typeof item?.name !== "string" || !item.name || seen.has(item.name))
      throw registryError("Index has missing/duplicate names");
    seen.add(item.name);
  }
  return [...seen].sort();
}
export function itemSummary(raw, name) {
  const p = jsonPayload(raw);
  if (
    p.name !== name ||
    !Array.isArray(p.files) ||
    !p.files.length ||
    p.files.length > 500
  )
    throw registryError(
      "Item identity/files differ from the explicit selection",
    );
  const seen = new Set();
  const files = p.files
    .map((f) => {
      if (
        !safeSourcePath(f?.path) ||
        seen.has(f.path) ||
        typeof f.content !== "string"
      )
        throw registryError(
          "Files need unique relative full paths and embedded text content",
        );
      seen.add(f.path);
      return {
        path: f.path,
        sha256: digest(f.content),
        bytes: Buffer.byteLength(f.content),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  const arrays = {};
  for (const key of [
    "dependencies",
    "devDependencies",
    "registryDependencies",
  ]) {
    const values = p[key] ?? [];
    if (
      !Array.isArray(values) ||
      values.some((v) => typeof v !== "string" || !v) ||
      new Set(values).size !== values.length
    )
      throw registryError(`Invalid ${key}`);
    arrays[key] = values;
  }
  return { files, ...arrays };
}
