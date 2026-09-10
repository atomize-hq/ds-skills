import { validatePacketLibrary } from "./packet-library.mjs";
import { digest } from "./capture.mjs";
import { libraryError, exact, id } from "./definition.mjs";
export function readEvidencePacket(bytes, expectedDigest = null) {
  if (expectedDigest !== null && digest(bytes) !== expectedDigest)
    throw libraryError(
      "Pinned evidence bytes do not match the reviewed SHA-256",
    );
  let p;
  try {
    p = JSON.parse(bytes);
  } catch {
    throw libraryError("Invalid evidence packet JSON");
  }
  exact(p, ["capturedAt", "data"], "evidence packet");
  if (
    typeof p.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(p.capturedAt)) ||
    new Date(p.capturedAt).toISOString() !== p.capturedAt
  )
    throw libraryError("Invalid capture timestamp");
  const d = p.data;
  exact(
    d,
    ["evidenceVersion", "scope", "extractor", "definitionDigest", "libraries"],
    "evidence data",
  );
  if (
    d.evidenceVersion !== "1" ||
    d.scope !== "library-source-evidence" ||
    d.extractor !== "ts-declared-exports-v1" ||
    typeof d.definitionDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(d.definitionDigest) ||
    !Array.isArray(d.libraries) ||
    !d.libraries.length ||
    d.libraries.length > 30
  )
    throw libraryError("Unsupported evidence format or scope");
  const ids = new Set();
  for (const l of d.libraries) {
    if (
      !id(l?.id) ||
      ids.has(l.id) ||
      !Array.isArray(l.files) ||
      !l.files.length ||
      !Array.isArray(l.components)
    )
      throw libraryError("Invalid library evidence");
    ids.add(l.id);
    validatePacketLibrary(l);
  }
  for (const l of d.libraries)
    for (const r of l.relationships)
      if (!ids.has(r.library))
        throw libraryError("Relationship points outside captured libraries");

  return p;
}
export function diffLibraryEvidence(before, after) {
  const a = new Map((before?.data.libraries ?? []).map((l) => [l.id, l])),
    b = new Map(after.data.libraries.map((l) => [l.id, l]));
  const changed = [];
  for (const [id, next] of b) {
    const prev = a.get(id);
    if (!prev || JSON.stringify(prev) === JSON.stringify(next)) continue;
    const oldFiles = new Map(prev.files.map((f) => [f.path, f.sha256])),
      newFiles = new Map(next.files.map((f) => [f.path, f.sha256]));
    const { files: _before, ...oldMetadata } = prev,
      { files: _after, ...newMetadata } = next;
    changed.push({
      id,
      metadataChanged:
        JSON.stringify(oldMetadata) !== JSON.stringify(newMetadata),
      version: {
        before: prev.source.declaredVersion,
        after: next.source.declaredVersion,
      },
      files: {
        added: [...newFiles.keys()].filter((f) => !oldFiles.has(f)),
        noLongerSelected: [...oldFiles.keys()].filter((f) => !newFiles.has(f)),
        changed: [...newFiles.keys()].filter(
          (f) => oldFiles.has(f) && oldFiles.get(f) !== newFiles.get(f),
        ),
      },
    });
  }
  return {
    definitionChanged:
      before?.data.definitionDigest !== after.data.definitionDigest,
    added: [...b.keys()].filter((id) => !a.has(id)),
    noLongerSelected: [...a.keys()].filter((id) => !b.has(id)),
    changed,
  };
}
