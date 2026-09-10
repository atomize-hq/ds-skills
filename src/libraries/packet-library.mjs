import {
  registryEvidenceFiles,
  validateRegistryFile,
} from "./registry-packet.mjs";
import { libraryError, exact, id, text } from "./definition.mjs";
import { digest, lineCount } from "./capture.mjs";
import { parseContractSource } from "../storybook/csf-parser.mjs";
const safePath = (p) =>
  typeof p === "string" &&
  p.length > 0 &&
  !p.startsWith("/") &&
  !/[\\\0\r\n]/.test(p) &&
  !p.split("/").some((s) => !s || s === "." || s === "..");
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function validatePacketLibrary(l) {
  exact(
    l,
    [
      "id",
      "source",
      "manifest",
      "ownership",
      "declaredCapabilities",
      "relationships",
      "deviations",
      "conventions",
      "license",
      "components",
      "files",
    ],
    "library packet",
  );
  const registry = l.source?.kind === "registry-snapshot-v1";
  const registryFiles = registry ? registryEvidenceFiles(l.source) : null;
  if (!registry)
    exact(l.source, ["kind", "declaredVersion", "revision"], "captured source");
  if (
    !["local-package-v1", "local-source-v1", "registry-snapshot-v1"].includes(
      l.source.kind,
    ) ||
    !text(l.source.declaredVersion) ||
    !["dependency", "copied-source", "project-owned"].includes(l.ownership) ||
    !Array.isArray(l.declaredCapabilities) ||
    new Set(l.declaredCapabilities).size !== l.declaredCapabilities.length ||
    l.declaredCapabilities.some((v) => !id(v))
  )
    throw libraryError("Invalid captured library identity");
  const revision = l.source.revision;
  if (!registry) exact(revision, ["mode", "commit"], "captured revision");
  if (
    !registry &&
    (!["committed", "working-tree", "content"].includes(revision.mode) ||
      !(revision.mode === "content"
        ? revision.commit === null
        : typeof revision.commit === "string" &&
          /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(revision.commit)))
  )
    throw libraryError("Invalid captured revision");
  if (!Array.isArray(l.files) || !l.files.length || l.files.length > 502)
    throw libraryError("Invalid source evidence file count");
  const files = new Map();
  for (const f of l.files) {
    exact(
      f,
      ["path", "roles", "sha256", "bytes", "lines", "content", "revision"],
      "captured file",
    );
    if (
      !safePath(f.path) ||
      files.has(f.path) ||
      typeof f.content !== "string" ||
      f.sha256 !== digest(f.content) ||
      f.bytes !== Buffer.byteLength(f.content) ||
      f.lines !== lineCount(f.content) ||
      !Array.isArray(f.roles) ||
      !f.roles.length ||
      new Set(f.roles).size !== f.roles.length ||
      f.roles.some(
        (x) =>
          ![
            "source",
            "documentation",
            "test",
            "license",
            "convention",
            "manifest",
          ].includes(x),
      )
    )
      throw libraryError("Evidence source identity/digest mismatch");
    if (registry) {
      validateRegistryFile(f, registryFiles);
    } else if (revision.mode === "content") {
      exact(f.revision, ["kind"], "file revision");
      if (f.revision.kind !== "content-only")
        throw libraryError("Invalid content-only evidence revision");
    } else {
      exact(
        f.revision,
        ["kind", "commit", "regularFileAtCommit", "matchesCommit"],
        "file revision",
      );
      if (
        f.revision.kind !== revision.mode ||
        f.revision.commit !== revision.commit ||
        typeof f.revision.regularFileAtCommit !== "boolean" ||
        typeof f.revision.matchesCommit !== "boolean" ||
        (!f.revision.regularFileAtCommit && f.revision.matchesCommit) ||
        (revision.mode === "committed" && !f.revision.matchesCommit)
      )
        throw libraryError("File revision disagrees with library identity");
    }
    files.set(f.path, f);
  }
  if (registry || l.source.kind === "local-source-v1") {
    if (l.manifest !== null)
      throw libraryError("Local source must not fabricate package metadata");
  } else {
    exact(
      l.manifest,
      [
        "path",
        "name",
        "version",
        "private",
        "exports",
        "dependencies",
        "peerDependencies",
        "license",
      ],
      "captured manifest",
    );
    const source = files.get(l.manifest.path);
    if (!source || !source.roles.includes("manifest"))
      throw libraryError("Manifest evidence is missing");
    let m;
    try {
      m = JSON.parse(source.content);
    } catch {
      throw libraryError("Manifest evidence is invalid JSON");
    }
    if (
      !m ||
      !text(m.name) ||
      m.version !== l.source.declaredVersion ||
      !equal(l.manifest, {
        path: source.path,
        name: m.name,
        version: m.version,
        private: m.private === true,
        exports: m.exports ?? null,
        dependencies: m.dependencies ?? {},
        peerDependencies: m.peerDependencies ?? {},
        license: m.license ?? null,
      })
    )
      throw libraryError("Manifest summary does not match source evidence");
  }
  if (
    !Array.isArray(l.components) ||
    !l.components.length ||
    l.components.length > 500
  )
    throw libraryError("Invalid captured component selections");
  const components = new Set();
  for (const c of l.components) {
    exact(
      c,
      ["id", "kind", "source", "exportName", "importSpecifier", "exportKind"],
      "captured component",
    );
    const source = files.get(c.source);
    if (
      !id(c.id) ||
      components.has(c.id) ||
      !source?.roles.includes("source") ||
      !text(c.exportName) ||
      !text(c.importSpecifier) ||
      !["component", "utility", "type"].includes(c.kind) ||
      !["value", "type"].includes(c.exportKind) ||
      !/\.tsx?$/.test(c.source)
    )
      throw libraryError("Component selection lacks source evidence");
    components.add(c.id);
    const parsed = parseContractSource(source.content, c.source),
      kind = new Map(parsed.exports).get(c.exportName);
    if (
      parsed.errors.length ||
      kind !== c.exportKind ||
      (c.kind === "type" ? kind !== "type" : kind !== "value")
    )
      throw libraryError(
        "Export summary does not match captured TS/TSX declaration",
      );
  }
  exact(
    l.license,
    ["status", "spdx", "file", "attribution", "redistribution"],
    "license disposition",
  );
  if (!text(l.license.attribution))
    throw libraryError("License attribution is required");
  if (l.license.status === "project-private") {
    if (
      l.license.spdx !== null ||
      l.license.file !== null ||
      l.license.redistribution !== "project-only"
    )
      throw libraryError(
        "Private evidence cannot imply redistribution clearance",
      );
  } else if (
    l.license.status !== "licensed" ||
    !text(l.license.spdx) ||
    !["project-only", "permitted"].includes(l.license.redistribution) ||
    !files.get(l.license.file)?.roles.includes("license") ||
    !files.get(l.license.file).content.trim()
  )
    throw libraryError("Licensed evidence must include actual license text");
  for (const key of ["deviations", "conventions"]) {
    if (!Array.isArray(l[key]))
      throw libraryError("Invalid captured source notes");
    const seen = new Set();
    for (const note of l[key]) {
      exact(note, ["id", "text", "evidence"], "captured note");
      if (
        !id(note.id) ||
        seen.has(note.id) ||
        !text(note.text) ||
        !Array.isArray(note.evidence) ||
        !note.evidence.length
      )
        throw libraryError("Invalid captured source note");
      seen.add(note.id);
      for (const ref of note.evidence) {
        exact(ref, ["file", "start", "end"], "citation");
        if (
          !files.has(ref.file) ||
          !Number.isSafeInteger(ref.start) ||
          !Number.isSafeInteger(ref.end) ||
          ref.start < 1 ||
          ref.end < ref.start ||
          ref.end > files.get(ref.file).lines
        )
          throw libraryError("Captured note citation is invalid");
      }
    }
  }
  if (!Array.isArray(l.relationships))
    throw libraryError("Invalid captured relationships");
  for (const r of l.relationships) {
    exact(r, ["library", "kind", "description"], "captured relationship");
    if (
      !id(r.library) ||
      r.library === l.id ||
      !["depends-on", "composes", "alternative-to"].includes(r.kind) ||
      !text(r.description)
    )
      throw libraryError("Invalid relationship declaration");
  }
}
