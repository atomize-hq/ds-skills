import { readRegistrySource } from "./registry-source.mjs";
import { resolveProjectPath } from "../project/config.mjs";
import { CannotEvaluateError } from "../figma/profile.mjs";
export const libraryError = (m) =>
  new CannotEvaluateError("LIBRARY_EVIDENCE_INPUT", m);
export const id = (v) => typeof v === "string" && /^[a-z][a-z0-9-]*$/.test(v);
export const text = (v) =>
  typeof v === "string" && v.length > 0 && v === v.trim();
export function exact(v, keys, label) {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    throw libraryError(`Invalid ${label}`);
}
const roles = ["source", "documentation", "test", "license", "convention"];
export function readLibraryDefinition(data, root) {
  exact(data, ["definitionVersion", "libraries"], "library definition");
  if (
    data.definitionVersion !== "1" ||
    !Array.isArray(data.libraries) ||
    !data.libraries.length ||
    data.libraries.length > 30
  )
    throw libraryError("Define 1 to 30 libraries at version 1");
  const ids = new Set();
  const libraries = data.libraries.map((l) => {
    exact(
      l,
      [
        "id",
        "source",
        "components",
        "ownership",
        "capabilities",
        "relationships",
        "deviations",
        "conventions",
        "license",
      ],
      "library",
    );
    if (!id(l.id) || ids.has(l.id))
      throw libraryError("Library IDs must be unique");
    ids.add(l.id);
    if (!["dependency", "copied-source", "project-owned"].includes(l.ownership))
      throw libraryError("Explicit library ownership required");
    if (
      !Array.isArray(l.capabilities) ||
      new Set(l.capabilities).size !== l.capabilities.length ||
      l.capabilities.some((x) => !id(x))
    )
      throw libraryError("Capabilities must be unique declared identifiers");
    const source = readSource(l.source, root);
    const license = readLicense(l.license, root);
    if (
      !Array.isArray(l.components) ||
      !l.components.length ||
      l.components.length > 500
    )
      throw libraryError("Select 1 to 500 components/API items");
    const names = new Set();
    const components = l.components.map((c) => {
      exact(
        c,
        ["id", "kind", "source", "exportName", "importSpecifier"],
        "component",
      );
      if (
        !id(c.id) ||
        names.has(c.id) ||
        !["component", "type", "utility"].includes(c.kind) ||
        !text(c.exportName) ||
        !text(c.importSpecifier)
      )
        throw libraryError("Invalid or duplicate component selection");
      names.add(c.id);
      const file = resolveProjectPath(root, c.source, "component source");
      if (!source.files.some((f) => f.path === file && f.role === "source"))
        throw libraryError(
          "Component source must be explicitly selected as source evidence",
        );
      if (!/\.tsx?$/.test(file))
        throw libraryError("The selected API extractor supports TS/TSX only");
      return { ...c, source: file };
    });
    if (!Array.isArray(l.relationships))
      throw libraryError("Relationships must be explicit");
    const relations = new Set();
    for (const r of l.relationships) {
      exact(r, ["library", "kind", "description"], "relationship");
      const key = `${r.library}/${r.kind}`;
      if (
        !id(r.library) ||
        r.library === l.id ||
        !["depends-on", "composes", "alternative-to"].includes(r.kind) ||
        !text(r.description) ||
        relations.has(key)
      )
        throw libraryError("Invalid relationship");
      relations.add(key);
    }
    for (const key of ["deviations", "conventions"]) {
      if (!Array.isArray(l[key]))
        throw libraryError(`${key} must be an explicit array`);
      const seen = new Set();
      for (const note of l[key]) {
        exact(note, ["id", "text", "evidence"], key);
        if (
          !id(note.id) ||
          seen.has(note.id) ||
          !text(note.text) ||
          !Array.isArray(note.evidence) ||
          !note.evidence.length
        )
          throw libraryError("Notes need unique IDs and source evidence");
        seen.add(note.id);
        for (const ref of note.evidence) {
          exact(ref, ["file", "start", "end"], "note evidence");
          if (
            !source.files.some(
              (f) =>
                f.path === resolveProjectPath(root, ref.file, "note evidence"),
            ) ||
            !Number.isSafeInteger(ref.start) ||
            !Number.isSafeInteger(ref.end) ||
            ref.start < 1 ||
            ref.end < ref.start
          )
            throw libraryError("Invalid source note citation");
        }
      }
    }
    return { ...l, source, license, components };
  });
  for (const l of libraries)
    for (const r of l.relationships)
      if (!ids.has(r.library))
        throw libraryError(`Unselected relationship target: ${r.library}`);
  return { definitionVersion: "1", libraries };
}
function readSource(s, root) {
  if (s?.kind === "registry-snapshot-v1")
    return readRegistrySource(s, root, readSourceFiles);
  exact(
    s,
    ["kind", "version", "manifest", "package", "revision", "files"],
    "source",
  );
  if (!["local-package-v1", "local-source-v1"].includes(s.kind))
    throw libraryError("Unsupported library source adapter");
  if (!text(s.version))
    throw libraryError("Source version label must be explicit");
  let manifest = null;
  if (s.kind === "local-package-v1") {
    manifest = resolveProjectPath(root, s.manifest, "package manifest");
    exact(s.package, ["name", "version"], "expected package");
    if (
      !text(s.package.name) ||
      !text(s.package.version) ||
      s.package.version !== s.version
    )
      throw libraryError(
        "Expected package name/version must match source version",
      );
  } else if (s.manifest !== null || s.package !== null)
    throw libraryError(
      "Local-source adapter must explicitly omit package metadata",
    );
  exact(s.revision, ["mode", "commit"], "revision");
  if (
    !["committed", "working-tree", "content"].includes(s.revision.mode) ||
    !(s.revision.mode === "content"
      ? s.revision.commit === null
      : typeof s.revision.commit === "string" &&
        /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(s.revision.commit))
  )
    throw libraryError(
      "Use an exact Git commit or explicit content-only identity",
    );
  return { ...s, manifest, files: readSourceFiles(s.files, root) };
}
function readSourceFiles(entries, root) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 500)
    throw libraryError("Select 1 to 500 evidence files");
  const seen = new Set();
  const files = entries.map((f) => {
    exact(f, ["path", "role"], "source file");
    const file = resolveProjectPath(root, f.path, "source file");
    if (seen.has(file) || !roles.includes(f.role))
      throw libraryError(
        "Evidence files need unique paths and supported roles",
      );
    seen.add(file);
    return { ...f, path: file };
  });
  return files;
}
function readLicense(l, root) {
  exact(
    l,
    ["status", "spdx", "file", "attribution", "redistribution"],
    "license declaration",
  );
  if (
    !["project-private", "licensed"].includes(l.status) ||
    !text(l.attribution) ||
    !["project-only", "permitted"].includes(l.redistribution)
  )
    throw libraryError("Explicit license/attribution disposition required");
  if (l.status === "project-private") {
    if (
      l.spdx !== null ||
      l.file !== null ||
      l.redistribution !== "project-only"
    )
      throw libraryError(
        "Private evidence has no inferred public redistribution permission",
      );
    return l;
  }
  if (!text(l.spdx))
    throw libraryError(
      "Licensed evidence needs an explicit license identifier",
    );
  return { ...l, file: resolveProjectPath(root, l.file, "license evidence") };
}
