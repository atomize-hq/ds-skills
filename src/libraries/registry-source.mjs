import path from "node:path";
import { exact, id, text, libraryError } from "./definition.mjs";
import { resolveProjectPath } from "../project/config.mjs";
import { readLibraryFile } from "./io.mjs";
import { readRegistryPacket } from "../registries/packet.mjs";
import { jsonPayload } from "../registries/payload.mjs";
import { digest, lineCount } from "./capture.mjs";
import { describeLibrary } from "./describe.mjs";
export function readRegistrySource(s, root, readFiles) {
  exact(
    s,
    ["kind", "version", "snapshot", "files"],
    "registry snapshot source",
  );
  exact(s.snapshot, ["file", "sha256", "registry"], "registry snapshot pin");
  if (
    !text(s.version) ||
    typeof s.snapshot.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(s.snapshot.sha256) ||
    !id(s.snapshot.registry)
  )
    throw libraryError(
      "Registry source requires exact snapshot hash, registry ID and version label",
    );
  return {
    ...s,
    snapshot: {
      ...s.snapshot,
      file: resolveProjectPath(root, s.snapshot.file, "registry snapshot"),
    },
    files: readFiles(s.files, root),
  };
}
export function registryFileMap(items, documents) {
  const available = new Map();
  for (const item of items)
    for (const f of jsonPayload(item.content).files)
      available.set(`items/${item.name}/${f.path}`, {
        content: f.content,
        revision: {
          kind: "registry-snapshot",
          url: item.url,
          payloadSha256: item.sha256,
        },
      });
  for (const doc of documents)
    available.set(`documents/${doc.id}`, {
      content: doc.content,
      revision: {
        kind: "registry-snapshot",
        url: doc.url,
        payloadSha256: doc.sha256,
      },
    });
  return available;
}
export function captureRegistryLibrary(l, root) {
  const s = l.source,
    raw = readLibraryFile(
      { rootDir: root },
      s.snapshot.file,
      false,
      16 * 1024 * 1024,
    ),
    p = readRegistryPacket(raw, s.snapshot.sha256),
    r = p.data.registries.find((r) => r.id === s.snapshot.registry);
  if (!r || r.declaredVersion !== s.version)
    throw libraryError(
      "Pinned registry identity/version differs from library selection",
    );
  const relative = (f) => path.relative(root, f).split(path.sep).join("/"),
    available = registryFileMap(r.items, r.documents),
    files = new Map();
  const selected = [
    ...s.files,
    ...(l.license.file ? [{ path: l.license.file, role: "license" }] : []),
  ];
  for (const f of selected) {
    const key = relative(f.path),
      entry = available.get(key);
    if (!entry)
      throw libraryError(
        `Selected source is missing from pinned registry: ${key}`,
      );
    if (files.has(f.path)) {
      if (!files.get(f.path).roles.includes(f.role))
        files.get(f.path).roles.push(f.role);
      continue;
    }
    files.set(f.path, {
      path: key,
      roles: [f.role],
      sha256: digest(entry.content),
      bytes: Buffer.byteLength(entry.content),
      lines: lineCount(entry.content),
      content: entry.content,
      revision: entry.revision,
    });
  }
  if (l.license.file && !files.get(l.license.file).content.trim())
    throw libraryError("License evidence is empty");
  const needed = [...files.values()].map((f) => f.path);
  const sourceIdentity = {
    kind: s.kind,
    declaredVersion: s.version,
    snapshot: { ...s.snapshot, file: relative(s.snapshot.file) },
    items: r.items.filter((i) =>
      needed.some((p) => p.startsWith(`items/${i.name}/`)),
    ),
    documents: r.documents.filter((d) => needed.includes(`documents/${d.id}`)),
  };
  return describeLibrary(l, files, sourceIdentity, null, root);
}
