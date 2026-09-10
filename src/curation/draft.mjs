import { libraryError, exact, id, text } from "../libraries/definition.mjs";
import { parseContractSource } from "../storybook/csf-parser.mjs";
export const categories = [
  "api",
  "composition",
  "accessibility",
  "installation",
  "compatibility",
  "ownership",
  "conventions",
  "verification",
  "limitations",
];
export function invalid(message) {
  const e = libraryError(message);
  e.code = "CURATION_CONTENT_INVALID";
  return e;
}
const fail = (m) => {
  throw invalid(m);
};
function shape(v, keys, label) {
  try {
    exact(v, keys, label);
  } catch {
    fail(`Invalid ${label}`);
  }
}
function list(v, min, max, label) {
  if (!Array.isArray(v) || v.length < min || v.length > max)
    fail(`Invalid ${label} count`);
}
function prose(v, max, label) {
  if (!text(v) || v.length > max || /[\0\r]/.test(v)) fail(`Invalid ${label}`);
}
export function readCurationDraft(bytes, evidence, evidenceHash) {
  let d;
  try {
    d = JSON.parse(bytes);
  } catch {
    fail("Curation definition is not JSON");
  }
  shape(
    d,
    ["curationVersion", "namespace", "evidenceSha256", "skills"],
    "curation definition",
  );
  if (
    d.curationVersion !== "1" ||
    !id(d.namespace) ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(d.namespace) ||
    d.namespace.length > 20 ||
    d.evidenceSha256 !== evidenceHash
  )
    fail("Curation namespace/version or evidence pin mismatch");
  list(d.skills, 1, 40, "skills");
  const libraries = new Map(evidence.data.libraries.map((l) => [l.id, l])),
    coverage = new Map([...libraries].map(([id]) => [id, new Set()])),
    apis = new Set(),
    names = new Set();
  function citations(refs, selected) {
    list(refs, 1, 40, "citations");
    const seen = new Set();
    for (const r of refs) {
      shape(r, ["library", "file", "sha256", "start", "end"], "citation");
      const source = libraries
          .get(r.library)
          ?.files.find((f) => f.path === r.file),
        key = JSON.stringify(r);
      if (
        !selected.includes(r.library) ||
        !source ||
        r.sha256 !== source.sha256 ||
        !Number.isSafeInteger(r.start) ||
        !Number.isSafeInteger(r.end) ||
        r.start < 1 ||
        r.end < r.start ||
        r.end > source.lines ||
        seen.has(key)
      )
        fail(
          "Citation must resolve into the selected pinned source and exact line range",
        );
      seen.add(key);
    }
  }
  function components(refs, selected, refsSource) {
    list(refs, 0, 500, "API references");
    const seen = new Set();
    for (const r of refs) {
      shape(r, ["library", "id"], "API reference");
      const c = libraries.get(r.library)?.components.find((c) => c.id === r.id),
        key = `${r.library}/${r.id}`;
      if (
        !selected.includes(r.library) ||
        !c ||
        seen.has(key) ||
        !refsSource.some(
          (ref) => ref.library === r.library && ref.file === c.source,
        )
      )
        fail(
          "API references require their selected declaration source citation",
        );
      seen.add(key);
      apis.add(key);
    }
  }
  for (const s of d.skills) {
    shape(
      s,
      ["id", "description", "libraries", "sections", "examples"],
      "curated skill",
    );
    if (
      !id(s.id) ||
      !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(s.id) ||
      s.id.length > 29 ||
      names.has(s.id)
    )
      fail("Unique skill IDs of at most 29 characters required");
    names.add(s.id);
    prose(s.description, 500, "skill description");
    if (s.description.includes("\n")) fail("Description must be one line");
    list(s.libraries, 1, 30, "skill libraries");
    if (
      new Set(s.libraries).size !== s.libraries.length ||
      s.libraries.some((id) => !libraries.has(id))
    )
      fail("Skill libraries must be unique selected evidence libraries");
    list(s.sections, 1, 80, "guidance sections");
    const sectionIds = new Set();
    for (const section of s.sections) {
      shape(
        section,
        ["id", "title", "category", "text", "citations", "components"],
        "guidance section",
      );
      if (
        !id(section.id) ||
        sectionIds.has(section.id) ||
        !categories.includes(section.category)
      )
        fail("Invalid/duplicate guidance section");
      sectionIds.add(section.id);
      prose(section.title, 120, "section title");
      if (section.title.includes("\n")) fail("Section title must be one line");
      prose(section.text, 10000, "guidance text");
      citations(section.citations, s.libraries);
      components(section.components, s.libraries, section.citations);
      for (const ref of section.citations)
        coverage.get(ref.library).add(section.category);
    }
    list(s.examples, 1, 20, "worked examples");
    const examples = new Set();
    for (const example of s.examples) {
      shape(
        example,
        ["id", "title", "language", "code", "citations", "components"],
        "example",
      );
      if (
        !id(example.id) ||
        examples.has(example.id) ||
        !["ts", "tsx"].includes(example.language)
      )
        fail("Invalid/duplicate example or unsupported language");
      examples.add(example.id);
      prose(example.title, 120, "example title");
      prose(example.code, 20000, "example code");
      citations(example.citations, s.libraries);
      components(example.components, s.libraries, example.citations);
      if (
        !example.components.length ||
        parseContractSource(example.code, `example.${example.language}`).errors
          .length
      )
        fail(
          "Example needs selected APIs and syntactically valid TS/TSX; this is not execution/typecheck proof",
        );
    }
  }
  for (const [id, l] of libraries) {
    for (const category of categories)
      if (!coverage.get(id).has(category))
        fail(`Library ${id} lacks cited ${category} guidance`);
    for (const c of l.components)
      if (!apis.has(`${id}/${c.id}`))
        fail(`Selected API ${id}/${c.id} has no curated coverage`);
  }
  return d;
}
