import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { curationFixture, acceptFixtureCuration } from "./fixture.mjs";
import { runCuration } from "./command.mjs";
import { readBundle } from "./bundle.mjs";
const roots = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
async function fixture(o) {
  const f = await curationFixture(o);
  roots.push(f.root);
  return f;
}
const run = (f, mode = "build") => runCuration(f.project(), mode);
const candidate = (f) =>
  fs.readFileSync(path.join(f.root, f.config.curation.candidate), "utf8");
it.each([
  {},
  { namespace: "another", folder: "owned-kit", secondKind: "local-source-v1" },
])("renders distinct source-grounded skill bundles %j", async (o) => {
  const f = await fixture(o);
  expect((await run(f, "validate")).ok).toBe(true);
  expect((await run(f)).artifactStatus).toBe("written");
  const bundle = readBundle(candidate(f));
  expect(bundle.skills).toHaveLength(2);
  expect(bundle.skills[0].name).toBe(`ds-curated-${f.draft.namespace}-widgets`);
  expect(bundle.skills[0].files["references/guidance.md"]).toContain(
    "onAction",
  );
  expect(
    JSON.parse(bundle.skills[0].files["references/evidence.json"]).citations[0]
      .sha256,
  ).toBe(f.draft.skills[0].sections[0].citations[0].sha256);
  expect((await run(f)).artifactStatus).toBe("unchanged");
  expect(f.config.curation.accepted).toBeNull();
  expect(fs.existsSync(path.join(f.root, ".agents"))).toBe(false);
});
it("requires exact reviewed bundle bytes for accepted checks and exposes refresh diffs", async () => {
  const f = await fixture();
  await run(f);
  await expect(run(f, "check")).rejects.toThrow(/Accepted bundle/);
  const before = candidate(f);
  acceptFixtureCuration(f, before);
  expect((await run(f, "check")).ok).toBe(true);
  f.draft.skills[0].sections[0].text += " Additional reviewed guidance.";
  f.write("curation.json", f.draft);
  expect((await run(f, "check")).ok).toBe(false);
  const built = await run(f);
  expect(built.diff.changed).toEqual(["ds-curated-demo-widgets"]);
  expect(
    fs.readFileSync(
      path.join(f.root, "curation-evidence/accepted.json"),
      "utf8",
    ),
  ).toBe(before);
  expect((await run(f, "diff")).diff.changed).toEqual(built.diff.changed);
});
it.each([
  "evidence-pin",
  "missing-category",
  "unknown-library",
  "missing-api",
  "source-hash",
  "citation-range",
  "api-citation",
  "example-syntax",
  "duplicate-skill",
  "path-name",
])("rejects %s curation without replacing the candidate", async (mode) => {
  const f = await fixture();
  await run(f);
  const before = candidate(f),
    s = f.draft.skills[0];
  if (mode === "evidence-pin") f.draft.evidenceSha256 = "0".repeat(64);
  if (mode === "missing-category") s.sections.pop();
  if (mode === "unknown-library") s.libraries = ["unknown"];
  if (mode === "missing-api") {
    for (const section of s.sections) section.components = [];
    s.examples[0].components = [];
  }
  if (mode === "source-hash")
    s.sections[0].citations[0].sha256 = "0".repeat(64);
  if (mode === "citation-range") s.sections[0].citations[0].end = 1000;
  if (mode === "api-citation")
    s.sections[0].components = [{ library: "widgets", id: "missing" }];
  if (mode === "example-syntax") s.examples[0].code = "export function {";
  if (mode === "duplicate-skill") f.draft.skills.push(s);
  if (mode === "path-name") s.id = "../../outside";
  f.write("curation.json", f.draft);
  const result = await run(f);
  expect(result.ok).toBe(false);
  expect(result.artifactStatus).toBe("not-written");
  expect(candidate(f)).toBe(before);
});
it("requires current library evidence, not merely plausible old source citations", async () => {
  const f = await fixture();
  await run(f);
  const before = candidate(f);
  fs.appendFileSync(
    path.join(f.root, f.definition.libraries[0].components[0].source),
    "// changed\n",
  );
  expect((await run(f)).diagnostics[0]).toMatch(/stale/);
  expect(candidate(f)).toBe(before);
});
it("refuses corrupt pins, unrelated candidates and input/output collisions", async () => {
  const f = await fixture();
  f.write(f.config.curation.candidate, "unrelated");
  await expect(run(f)).rejects.toThrow(/bundle JSON/);
  expect(candidate(f)).toBe("unrelated");
  fs.unlinkSync(path.join(f.root, f.config.curation.candidate));
  await run(f);
  acceptFixtureCuration(f, candidate(f));
  fs.appendFileSync(path.join(f.root, "curation-evidence/review.json"), " ");
  await expect(run(f, "check")).rejects.toThrow(/SHA-256/);
  f.config.curation.review = null;
  f.config.curation.candidate = "curation.json";
  f.write("project.json", f.config);
  await expect(run(f)).rejects.toThrow(/overlaps/);
});
it("refuses source edits occurring before candidate rename", async () => {
  const f = await fixture();
  await run(f);
  const before = candidate(f);
  f.draft.skills[0].description += " Updated.";
  f.write("curation.json", f.draft);
  const original = fs.writeFileSync;
  let changed = false;
  vi.spyOn(fs, "writeFileSync").mockImplementation((file, ...args) => {
    const result = original(file, ...args);
    if (!changed && String(file).endsWith(".tmp")) {
      changed = true;
      original(path.join(f.root, "curation.json"), "{");
    }
    return result;
  });
  expect((await run(f)).ok).toBe(false);
  expect(changed).toBe(true);
  expect(candidate(f)).toBe(before);
});
