import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import { sourceReader } from "../source-checks/inputs.mjs";
import { describeLibrary } from "./describe.mjs";
import { captureRegistryLibrary } from "./registry-source.mjs";
import { readLibraryDefinition, libraryError } from "./definition.mjs";
import { revisionReader } from "./git.mjs";
export const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
export const lineCount = (s) =>
  s.length ? s.split("\n").length - (s.endsWith("\n") ? 1 : 0) : 0;
export function captureLibraryEvidence(projectRoot, definitionFile) {
  const reader = sourceReader(projectRoot),
    raw = reader.read(definitionFile);
  let definition;
  try {
    definition = readLibraryDefinition(JSON.parse(raw), projectRoot);
  } catch (error) {
    if (error.code) throw error;
    throw libraryError("Invalid library definition JSON");
  }
  const relative = (f) =>
    path.relative(projectRoot, f).split(path.sep).join("/");
  const extraFiles = new Set();
  const libraries = definition.libraries.map((l) => {
    if (l.source.kind === "registry-snapshot-v1") {
      extraFiles.add(l.source.snapshot.file);
      return captureRegistryLibrary(l, projectRoot);
    }
    const files = new Map(),
      revision = revisionReader(projectRoot, l.source.revision);
    function read(file, role) {
      if (
        !/\.(?:tsx?|jsx?|mjs|json|mdx?|txt|css)$/i.test(file) &&
        !/^LICENSE(?:[-.].*)?$/i.test(path.basename(file))
      )
        throw libraryError(
          "Unsupported evidence file type; do not capture credential/config stores",
        );
      const text = reader.read(file);
      if (!fs.readFileSync(file).equals(Buffer.from(text)))
        throw libraryError("Evidence must be stable valid UTF-8 text");
      if (files.has(file)) {
        if (!files.get(file).roles.includes(role))
          files.get(file).roles.push(role);
        return files.get(file);
      }
      const record = {
        path: relative(file),
        roles: [role],
        sha256: digest(text),
        bytes: Buffer.byteLength(text),
        lines: lineCount(text),
        content: text,
        revision: revision(file, text),
      };
      files.set(file, record);
      return record;
    }
    for (const f of l.source.files) read(f.path, f.role);
    if (l.license.file && !read(l.license.file, "license").content.trim())
      throw libraryError("License evidence is empty");
    let manifest = null;
    if (l.source.manifest) {
      const f = read(l.source.manifest, "manifest");
      let parsed;
      try {
        parsed = JSON.parse(f.content);
      } catch {
        throw libraryError("Invalid package manifest JSON");
      }
      if (
        !parsed ||
        parsed.name !== l.source.package.name ||
        parsed.version !== l.source.package.version
      )
        throw libraryError(
          "Actual package identity/version differs from the declared source",
        );
      manifest = {
        path: f.path,
        name: parsed.name,
        version: parsed.version,
        private: parsed.private === true,
        exports: parsed.exports ?? null,
        dependencies: parsed.dependencies ?? {},
        peerDependencies: parsed.peerDependencies ?? {},
        license: parsed.license ?? null,
      };
    }
    return describeLibrary(
      l,
      files,
      {
        kind: l.source.kind,
        declaredVersion: l.source.version,
        revision: l.source.revision,
      },
      manifest,
      projectRoot,
    );
  });
  const data = {
    evidenceVersion: "1",
    scope: "library-source-evidence",
    extractor: "ts-declared-exports-v1",
    definitionDigest: digest(raw),
    libraries,
  };
  return {
    data,
    inputIdentity: reader.identity(),
    files: [...reader.files.keys(), ...extraFiles],
  };
}
