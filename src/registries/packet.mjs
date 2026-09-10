import { exact, id, text } from "../libraries/definition.mjs";
import { digest } from "../libraries/capture.mjs";
import {
  registryError,
  registryUrl,
  readRegistryDefinition,
} from "./definition.mjs";
import { jsonPayload, indexNames, itemSummary } from "./payload.mjs";
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function rawRecord(r, keys) {
  exact(r, [...keys, "url", "sha256", "content"], "registry response");
  if (
    registryUrl(r.url) !== r.url ||
    typeof r.content !== "string" ||
    Buffer.byteLength(r.content) > 2 * 1024 * 1024 ||
    digest(r.content) !== r.sha256
  )
    throw registryError("Response content/digest/URL mismatch");
}
export function readRegistryPacket(bytes, expected = null) {
  if (expected !== null && digest(bytes) !== expected)
    throw registryError("Snapshot SHA-256 differs from reviewed pin");
  const p = jsonPayload(bytes);
  exact(p, ["capturedAt", "data"], "registry snapshot");
  if (
    typeof p.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(p.capturedAt)) ||
    new Date(p.capturedAt).toISOString() !== p.capturedAt
  )
    throw registryError("Invalid capture timestamp");
  const d = p.data;
  exact(
    d,
    ["snapshotVersion", "scope", "definitionDigest", "registries"],
    "registry data",
  );
  if (
    d.snapshotVersion !== "1" ||
    d.scope !== "registry-source-snapshot" ||
    typeof d.definitionDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(d.definitionDigest) ||
    !Array.isArray(d.registries) ||
    !d.registries.length ||
    d.registries.length > 30
  )
    throw registryError("Unsupported registry snapshot");
  const ids = new Set();
  for (const r of d.registries) {
    exact(
      r,
      ["id", "declaredVersion", "index", "items", "documents"],
      "captured registry",
    );
    if (!id(r.id) || ids.has(r.id) || !text(r.declaredVersion))
      throw registryError("Invalid registry identity");
    ids.add(r.id);
    if (r.index !== null) {
      rawRecord(r.index, ["observedNames"]);
      if (!equal(indexNames(r.index.content), r.index.observedNames))
        throw registryError("Index summary differs from captured bytes");
    }
    for (const [key, identity, max] of [
      ["items", "name", 500],
      ["documents", "id", 100],
    ]) {
      if (
        !Array.isArray(r[key]) ||
        r[key].length > max ||
        (key === "items" && !r[key].length)
      )
        throw registryError("Invalid captured selection count");
      const seen = new Set();
      for (const e of r[key]) {
        rawRecord(
          e,
          key === "items"
            ? [
                "name",
                "files",
                "dependencies",
                "devDependencies",
                "registryDependencies",
              ]
            : ["id"],
        );
        if (!id(e[identity]) || seen.has(e[identity]))
          throw registryError("Invalid captured item/document identity");
        seen.add(e[identity]);
        if (key === "items") {
          const { name, url, sha256, content, ...summary } = e;
          if (!equal(summary, itemSummary(content, name)))
            throw registryError("Item summary differs from captured payload");
          if (r.index && !r.index.observedNames.includes(name))
            throw registryError("Selected item not observed in captured index");
        }
      }
    }
  }
  return p;
}
export function snapshotMatchesDefinition(packet, bytes) {
  const d = readRegistryDefinition(jsonPayload(bytes));
  return (
    digest(bytes) === packet.data.definitionDigest &&
    equal(
      d.registries,
      packet.data.registries.map((r) => ({
        id: r.id,
        version: r.declaredVersion,
        index: r.index?.url ?? null,
        items: r.items.map((e) => ({ name: e.name, url: e.url })),
        documents: r.documents.map((e) => ({ id: e.id, url: e.url })),
      })),
    )
  );
}
export function diffRegistrySnapshots(before, after) {
  const old = new Map((before?.data.registries ?? []).map((r) => [r.id, r])),
    next = new Map(after.data.registries.map((r) => [r.id, r]));
  const changed = [];
  for (const [id, r] of next) {
    const p = old.get(id);
    if (!p || equal(p, r)) continue;
    function changes(key, identity) {
      const a = new Map(p[key].map((x) => [x[identity], x])),
        b = new Map(r[key].map((x) => [x[identity], x]));
      return {
        added: [...b.keys()].filter((k) => !a.has(k)),
        noLongerSelected: [...a.keys()].filter((k) => !b.has(k)),
        changed: [...b.keys()]
          .filter((k) => a.has(k) && !equal(a.get(k), b.get(k)))
          .map((k) => ({
            id: k,
            before: a.get(k).sha256,
            after: b.get(k).sha256,
            urlChanged: a.get(k).url !== b.get(k).url,
          })),
      };
    }
    changed.push({
      id,
      version: { before: p.declaredVersion, after: r.declaredVersion },
      indexChanged: !equal(p.index, r.index),
      items: changes("items", "name"),
      documents: changes("documents", "id"),
    });
  }
  return {
    definitionChanged:
      before?.data.definitionDigest !== after.data.definitionDigest,
    added: [...next.keys()].filter((id) => !old.has(id)),
    noLongerSelected: [...old.keys()].filter((id) => !next.has(id)),
    changed,
  };
}
