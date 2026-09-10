import path from "node:path";
import { parseContractSource } from "../storybook/csf-parser.mjs";
import { libraryError } from "./definition.mjs";
export function describeLibrary(
  l,
  files,
  sourceIdentity,
  manifest,
  projectRoot,
) {
  const relative = (file) =>
    path.relative(projectRoot, file).split(path.sep).join("/");
  const components = l.components.map((c) => {
    const source = files.get(c.source),
      parsed = parseContractSource(source.content, c.source);
    if (parsed.errors.length)
      throw libraryError(`Unsupported source syntax: ${source.path}`);
    const exported = new Map(parsed.exports).get(c.exportName);
    if (!exported)
      throw libraryError(
        `Selected export not directly declared: ${c.exportName} in ${source.path}`,
      );
    if (c.kind === "type" ? exported !== "type" : exported !== "value")
      throw libraryError(`Selected export kind disagrees with source: ${c.id}`);
    return { ...c, source: relative(c.source), exportKind: exported };
  });
  for (const key of ["deviations", "conventions"])
    for (const note of l[key])
      for (const ref of note.evidence) {
        const file = [...files.values()].find(
          (f) => f.path === relative(path.resolve(projectRoot, ref.file)),
        );
        if (!file || ref.end > file.lines)
          throw libraryError(
            "Note citation does not resolve into captured evidence",
          );
      }
  return {
    id: l.id,
    source: sourceIdentity,
    manifest,
    ownership: l.ownership,
    declaredCapabilities: l.capabilities,
    relationships: l.relationships,
    ...Object.fromEntries(
      ["deviations", "conventions"].map((key) => [
        key,
        l[key].map((note) => ({
          ...note,
          evidence: note.evidence.map((ref) => ({
            ...ref,
            file: relative(path.resolve(projectRoot, ref.file)),
          })),
        })),
      ]),
    ),
    license: {
      ...l.license,
      file: l.license.file ? relative(l.license.file) : null,
    },
    components,
    files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
}
