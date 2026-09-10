import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { libraryFixture } from "./fixture.mjs";
import { captureLibraryEvidence, digest } from "./capture.mjs";
import { runLibraryEvidence } from "./command.mjs";
import { readEvidencePacket } from "./packet.mjs";
const roots = [];
afterEach(() => {
  for (const r of roots.splice(0))
    fs.rmSync(r, { recursive: true, force: true });
});
function fixture(o) {
  const f = libraryFixture(o);
  roots.push(f.root);
  return f;
}
const capture = (f) =>
  captureLibraryEvidence(f.root, path.join(f.root, "libraries.json"));
const run = async (f, mode) => await runLibraryEvidence(f.project(), mode);
async function pin(f) {
  await run(f, "capture");
  const bytes = fs.readFileSync(
    path.join(f.root, f.config.libraries.candidate),
    "utf8",
  );
  f.write("evidence/pinned.json", bytes);
  f.config.libraries.evidence = {
    file: "evidence/pinned.json",
    sha256: digest(bytes),
  };
  f.write("project.json", f.config);
  return bytes;
}
it.each([{}, { folder: "source-catalog", secondKind: "local-source-v1" }])(
  "captures multiple explicitly configured source kinds %j",
  (o) => {
    const f = fixture(o),
      result = capture(f);
    expect(result.data.libraries).toHaveLength(2);
    expect(result.data.scope).toBe("library-source-evidence");
    expect(result.data.libraries[0].manifest).toMatchObject({
      name: "@example/widgets",
      version: "1.2.3",
    });
    expect(result.data.libraries[0].components[0].exportKind).toBe("value");
    expect(
      result.data.libraries[0].files.some((x) =>
        x.content.includes("DO NOT EXECUTE EVIDENCE"),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(f.root, "DO NOT EXECUTE EVIDENCE"))).toBe(
      false,
    );
  },
);
it("pins committed file bytes, not assume-unchanged status flags", () => {
  const f = fixture();
  f.commit();
  expect(
    capture(f).data.libraries[0].files.every((x) => x.revision.matchesCommit),
  ).toBe(true);
  const file = f.definition.libraries[0].components[0].source;
  f.git(["update-index", "--assume-unchanged", file]);
  fs.appendFileSync(path.join(f.root, file), "// Local change\n");
  expect(() => capture(f)).toThrow(/does not match/);
  f.definition.libraries[0].source.revision.mode = "working-tree";
  f.write("libraries.json", f.definition);
  expect(
    capture(f).data.libraries[0].files.find((x) => x.path === file).revision
      .matchesCommit,
  ).toBe(false);
});
it("does not invalidate immutable source evidence for unrelated later commits", () => {
  const f = fixture();
  f.commit();
  const before = capture(f).data;
  f.write("unrelated.txt", "unrelated");
  f.git(["add", "unrelated.txt"]);
  f.git(["commit", "-qm", "Unrelated change"]);
  expect(capture(f).data).toEqual(before);
});
it("keeps capture separate from accepting a reviewed pin", async () => {
  const f = fixture();
  expect((await run(f, "capture")).artifactStatus).toBe("written");
  expect(f.config.libraries.evidence).toBeNull();
  expect((await run(f, "capture")).artifactStatus).toBe("unchanged");
  await expect(run(f, "check")).rejects.toThrow(/No reviewed/);
  await pin(f);
  expect((await run(f, "check")).ok).toBe(true);
  const delta = await run(f, "diff");
  expect(delta.diff.changed).toEqual([]);
});
it("reports a reviewable change without overwriting accepted evidence", async () => {
  const f = fixture(),
    before = await pin(f);
  fs.appendFileSync(
    path.join(f.root, f.definition.libraries[0].components[0].source),
    "// updated source\n",
  );
  expect((await run(f, "check")).ok).toBe(false);
  const r = await run(f, "capture");
  expect(r.diff.changed[0].files.changed).toEqual([
    "packages/widgets/index.tsx",
  ]);
  expect(
    fs.readFileSync(path.join(f.root, "evidence/pinned.json"), "utf8"),
  ).toBe(before);
});
it("labels selection changes rather than inventing source removals", async () => {
  const f = fixture();
  await pin(f);
  f.definition.libraries.pop();
  f.write("libraries.json", f.definition);
  const r = await run(f, "capture");
  expect(r.diff.noLongerSelected).toEqual(["layout"]);
  fs.unlinkSync(
    path.join(f.root, f.definition.libraries[0].components[0].source),
  );
  const before = fs.readFileSync(
    path.join(f.root, f.config.libraries.candidate),
    "utf8",
  );
  await expect(run(f, "capture")).rejects.toThrow();
  expect(
    fs.readFileSync(path.join(f.root, f.config.libraries.candidate), "utf8"),
  ).toBe(before);
});
it.each([
  "package version",
  "export missing",
  "export kind",
  "citation range",
  "private redistribution",
  "license missing",
  "unsupported source",
  "unsupported component source",
  "relationship missing",
  "symlink",
  "non-UTF8",
])("refuses %s without fabricating evidence", (mode) => {
  const f = fixture(),
    l = f.definition.libraries[0];
  if (mode === "package version") l.source.package.version = "9.9.9";
  if (mode === "export missing") l.components[0].exportName = "Missing";
  if (mode === "export kind") l.components[0].kind = "type";
  if (mode === "citation range") l.conventions[0].evidence[0].end = 100;
  if (mode === "private redistribution") l.license.redistribution = "permitted";
  if (mode === "license missing")
    l.license = {
      status: "licensed",
      spdx: "MIT",
      file: "LICENSE",
      attribution: "Declared author",
      redistribution: "permitted",
    };
  if (mode === "unsupported source") l.source.kind = "universal-url";
  if (mode === "unsupported component source")
    l.components[0].source = l.source.files[1].path;
  if (mode === "relationship missing")
    l.relationships = [
      { library: "absent", kind: "depends-on", description: "Unknown source" },
    ];
  if (mode === "symlink") {
    fs.unlinkSync(path.join(f.root, l.components[0].source));
    fs.symlinkSync("/etc/hosts", path.join(f.root, l.components[0].source));
  }
  if (mode === "non-UTF8")
    fs.writeFileSync(
      path.join(f.root, l.components[0].source),
      Buffer.from([0xff]),
    );
  f.write("libraries.json", f.definition);
  expect(() => capture(f)).toThrow();
});
it("rejects pinned/candidate integrity failures and protected output paths", async () => {
  const f = fixture();
  await pin(f);
  fs.appendFileSync(path.join(f.root, "evidence/pinned.json"), " ");
  await expect(run(f, "check")).rejects.toThrow(/SHA-256/);
  f.config.libraries.evidence = null;
  f.config.libraries.candidate = f.definition.libraries[0].components[0].source;
  f.write("project.json", f.config);
  await expect(run(f, "capture")).rejects.toThrow(/overlaps/);
});
it("validates embedded source digests instead of trusting a plausible packet", async () => {
  const f = fixture();
  await run(f, "capture");
  const p = JSON.parse(
    fs.readFileSync(path.join(f.root, f.config.libraries.candidate)),
  );
  p.data.libraries[0].files[0].content = "tamper";
  expect(() => readEvidencePacket(JSON.stringify(p))).toThrow(/digest/);
});
