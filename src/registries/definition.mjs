import { exact, id, text, libraryError } from "../libraries/definition.mjs";
export const registryError = (m) => libraryError(`Registry evidence: ${m}`);
export function registryUrl(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw registryError("Invalid explicit URL");
  }
  if (
    typeof value !== "string" ||
    u.username ||
    u.password ||
    u.hash ||
    u.search ||
    !(
      u.protocol === "https:" ||
      (u.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))
    )
  )
    throw registryError(
      "Use HTTPS URLs without credentials/query/fragment; HTTP is loopback-only",
    );
  return u.href;
}
export const safeSourcePath = (v) =>
  typeof v === "string" &&
  v.length > 0 &&
  !/^[A-Za-z]:|^[/\\]|[\\\0\r\n]/.test(v) &&
  !v.split("/").some((p) => !p || p === "." || p === "..");
export function readRegistryDefinition(value) {
  exact(value, ["registryVersion", "registries"], "registry selection");
  if (
    value.registryVersion !== "1" ||
    !Array.isArray(value.registries) ||
    !value.registries.length ||
    value.registries.length > 30
  )
    throw registryError("Select 1 to 30 registries");
  const ids = new Set();
  return {
    registryVersion: "1",
    registries: value.registries.map((r) => {
      exact(r, ["id", "version", "index", "items", "documents"], "registry");
      if (!id(r.id) || ids.has(r.id) || !text(r.version))
        throw registryError(
          "Unique registry ID and explicit version label required",
        );
      ids.add(r.id);
      const items = readEntries(r.items, "name", 500),
        documents = readEntries(r.documents, "id", 100, true);
      return {
        id: r.id,
        version: r.version,
        index: r.index === null ? null : registryUrl(r.index),
        items,
        documents,
      };
    }),
  };
}
function readEntries(entries, key, max, empty = false) {
  if (
    !Array.isArray(entries) ||
    (!empty && !entries.length) ||
    entries.length > max
  )
    throw registryError(`Invalid ${key} selections`);
  const seen = new Set();
  return entries.map((e) => {
    exact(e, [key, "url"], "registry entry");
    if (!id(e[key]) || seen.has(e[key]))
      throw registryError(`Unique ${key} required`);
    seen.add(e[key]);
    return { [key]: e[key], url: registryUrl(e.url) };
  });
}
