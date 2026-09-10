import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { registryFixture } from "./fixture.mjs";
import { selectSnapshotLibraries } from "./library-fixture.mjs";
import { runRegistryEvidence } from "./command.mjs";
import { runLibraryEvidence } from "../libraries/command.mjs";
import { readEvidencePacket } from "../libraries/packet.mjs";
import { digest } from "../libraries/capture.mjs";
const fixtures = [];
afterEach(
  async () => await Promise.all(fixtures.splice(0).map((f) => f.close())),
);
async function fixture() {
  const f = await registryFixture();
  fixtures.push(f);
  await runRegistryEvidence(f.project(), "capture");
  const bytes = fs.readFileSync(
    path.join(f.root, f.config.registries.candidate),
    "utf8",
  );
  f.libraryDefinition = selectSnapshotLibraries(f, bytes);
  return f;
}
const run = (f, mode = "capture") => runLibraryEvidence(f.project(), mode);
const bytes = (f) =>
  fs.readFileSync(path.join(f.root, f.config.libraries.candidate), "utf8");
it("curation evidence consumes accepted registry bytes offline, with full source and attribution", async () => {
  const f = await fixture(),
    requests = f.requests.length;
  const r = await run(f);
  expect(r.libraryCount).toBe(2);
  const p = readEvidencePacket(bytes(f)),
    l = p.data.libraries[0];
  expect(l.source.kind).toBe("registry-snapshot-v1");
  expect(l.manifest).toBeNull();
  expect(l.source.items[0].dependencies).toEqual(["react@19.0.0"]);
  expect(l.files.map((x) => x.path)).toEqual([
    "documents/license",
    "items/control/other/control.tsx",
    "items/control/ui/control.tsx",
  ]);
  expect(l.files[2].revision.payloadSha256).toBe(l.source.items[0].sha256);
  expect(l.license.attribution).toBe("Fixture author");
  expect(f.requests).toHaveLength(requests);
  f.write("libraries-pinned.json", bytes(f));
  f.config.libraries.evidence = {
    file: "libraries-pinned.json",
    sha256: digest(bytes(f)),
  };
  f.write("project.json", f.config);
  expect((await run(f, "check")).ok).toBe(true);
  expect(f.requests).toHaveLength(requests);
});
it.each([
  "snapshot-pin",
  "registry-id",
  "version",
  "missing-file",
  "missing-export",
  "license",
])(
  "refuses invalid %s provenance without replacing prior library evidence",
  async (mode) => {
    const f = await fixture();
    await run(f);
    const before = bytes(f),
      l = f.libraryDefinition.libraries[0];
    if (mode === "snapshot-pin")
      fs.appendFileSync(path.join(f.root, "registry-pinned.json"), " ");
    if (mode === "registry-id") l.source.snapshot.registry = "missing";
    if (mode === "version") l.source.version = "invented-version";
    if (mode === "missing-file")
      l.source.files.push({ path: "items/control/missing.ts", role: "source" });
    if (mode === "missing-export") l.components[0].exportName = "Invented";
    if (mode === "license") l.license.file = "documents/missing-license";
    f.write("libraries.json", f.libraryDefinition);
    await expect(run(f)).rejects.toThrow();
    expect(bytes(f)).toBe(before);
  },
);
it.each(["content", "url", "dependencies"])(
  "rejects forged %s in registry-derived library packets",
  async (mode) => {
    const f = await fixture();
    await run(f);
    const p = JSON.parse(bytes(f)),
      l = p.data.libraries[0];
    if (mode === "content") {
      l.files[0].content = "forged\n";
      l.files[0].bytes = 7;
      l.files[0].sha256 = digest(l.files[0].content);
    }
    if (mode === "url") l.files[0].revision.url = f.base + "/forged";
    if (mode === "dependencies") l.source.items[0].dependencies = [];
    expect(() => readEvidencePacket(JSON.stringify(p))).toThrow();
  },
);
it("keeps both cross-capability pins protected from registry refresh", async () => {
  const f = await fixture();
  f.config.registries.candidate = "registry-pinned.json";
  f.write("project.json", f.config);
  await expect(runRegistryEvidence(f.project(), "capture")).rejects.toThrow(
    /overlaps/,
  );
});
