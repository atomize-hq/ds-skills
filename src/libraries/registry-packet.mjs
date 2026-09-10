import { exact, id, text, libraryError } from "./definition.mjs";
import { registryUrl, safeSourcePath } from "../registries/definition.mjs";
import { itemSummary } from "../registries/payload.mjs";
import { registryFileMap } from "./registry-source.mjs";
import { digest } from "./capture.mjs";
export function registryEvidenceFiles(s) {
  exact(
    s,
    ["kind", "declaredVersion", "snapshot", "items", "documents"],
    "registry source identity",
  );
  exact(
    s.snapshot,
    ["file", "sha256", "registry"],
    "registry snapshot reference",
  );
  if (
    !text(s.declaredVersion) ||
    !safeSourcePath(s.snapshot.file) ||
    !id(s.snapshot.registry) ||
    typeof s.snapshot.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(s.snapshot.sha256)
  )
    throw libraryError("Invalid registry source snapshot reference");
  for (const [key, identity] of [
    ["items", "name"],
    ["documents", "id"],
  ]) {
    if (!Array.isArray(s[key]) || s[key].length > 500)
      throw libraryError("Invalid registry source records");
    const seen = new Set();
    for (const r of s[key]) {
      exact(
        r,
        key === "items"
          ? [
              "name",
              "url",
              "sha256",
              "content",
              "files",
              "dependencies",
              "devDependencies",
              "registryDependencies",
            ]
          : ["id", "url", "sha256", "content"],
        "registry provenance record",
      );
      if (
        !id(r[identity]) ||
        seen.has(r[identity]) ||
        registryUrl(r.url) !== r.url ||
        typeof r.content !== "string" ||
        digest(r.content) !== r.sha256
      )
        throw libraryError("Registry provenance digest/identity mismatch");
      seen.add(r[identity]);
      if (key === "items") {
        const { name, url, sha256, content, ...summary } = r;
        if (
          JSON.stringify(summary) !== JSON.stringify(itemSummary(content, name))
        )
          throw libraryError("Registry summary differs from source payload");
      }
    }
  }
  return registryFileMap(s.items, s.documents);
}
export function validateRegistryFile(f, available) {
  const source = available.get(f.path);
  if (
    !source ||
    source.content !== f.content ||
    JSON.stringify(source.revision) !== JSON.stringify(f.revision)
  )
    throw libraryError(
      "Selected registry file/provenance differs from captured payload",
    );
}
