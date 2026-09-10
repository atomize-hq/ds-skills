import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { libraryFixture } from "./fixture.mjs";
import { runLibraryEvidence } from "./command.mjs";
import { readEvidencePacket } from "./packet.mjs";
import { digest } from "./capture.mjs";
const roots = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture(options) {
  const f = libraryFixture(options);
  roots.push(f.root);
  return f;
}
const invoke = (f, mode = "capture") => runLibraryEvidence(f.project(), mode);
const candidate = (f) =>
  fs.readFileSync(path.join(f.root, f.config.libraries.candidate), "utf8");
it.each([
  "manifest",
  "export",
  "revision",
  "capabilities",
  "roles",
  "relationship",
])(
  "rejects forged %s metadata even when embedded bytes still hash correctly",
  async (mode) => {
    const f = fixture();
    f.commit();
    await invoke(f);
    const p = JSON.parse(candidate(f)),
      l = p.data.libraries[0];
    if (mode === "manifest") l.manifest.version = "9.0.0";
    if (mode === "export") l.components[0].exportName = "Invented";
    if (mode === "revision") l.files[0].revision.matchesCommit = false;
    if (mode === "capabilities")
      l.declaredCapabilities.push(l.declaredCapabilities[0]);
    if (mode === "roles") l.files[0].roles.push(l.files[0].roles[0]);
    if (mode === "relationship")
      l.relationships.push({
        library: "missing",
        kind: "depends-on",
        description: "Not selected",
      });
    expect(() => readEvidencePacket(JSON.stringify(p))).toThrow();
  },
);
it("captures literal Git paths with spaces and normalizes note citations", async () => {
  const f = fixture({ folder: "source libraries" });
  f.definition.libraries[0].conventions[0].evidence[0].file =
    "./source libraries/widgets/README.md";
  f.commit();
  await invoke(f);
  const packet = readEvidencePacket(candidate(f));
  expect(packet.data.libraries[0].conventions[0].evidence[0].file).toBe(
    "source libraries/widgets/README.md",
  );
  expect(
    packet.data.libraries[0].files.every(
      (x) => x.revision.regularFileAtCommit && x.revision.matchesCommit,
    ),
  ).toBe(true);
});
it("captures actual license text, rejects empty text, and preserves the prior candidate", async () => {
  const f = fixture();
  f.definition.libraries[0].license = {
    status: "licensed",
    spdx: "LicenseRef-Test",
    file: "LICENSE.txt",
    attribution: "Test author",
    redistribution: "project-only",
  };
  f.write("libraries.json", f.definition);
  f.write("LICENSE.txt", "Test license evidence; not a grant.\n");
  await invoke(f);
  const before = candidate(f);
  expect(
    readEvidencePacket(before).data.libraries[0].files.find(
      (x) => x.path === "LICENSE.txt",
    ).roles,
  ).toEqual(["license"]);
  f.write("LICENSE.txt", " \n");
  await expect(invoke(f)).rejects.toThrow(/empty/);
  expect(candidate(f)).toBe(before);
});
it("checks a pinned packet without requiring write permission", async () => {
  const f = fixture();
  await invoke(f);
  const bytes = candidate(f);
  f.write("evidence/pinned.json", bytes);
  f.config.libraries.evidence = {
    file: "evidence/pinned.json",
    sha256: digest(bytes),
  };
  f.write("project.json", f.config);
  const original = fs.accessSync;
  vi.spyOn(fs, "accessSync").mockImplementation((file, mode) => {
    if (mode & fs.constants.W_OK) throw new Error("Read-only filesystem");
    return original(file, mode);
  });
  expect((await invoke(f, "check")).ok).toBe(true);
});
it.each(["candidate", "pinned", "source"])(
  "refuses concurrent %s changes before renaming a candidate",
  async (which) => {
    const f = fixture();
    await invoke(f);
    const before = candidate(f);
    f.write("evidence/pinned.json", before);
    f.config.libraries.evidence = {
      file: "evidence/pinned.json",
      sha256: digest(before),
    };
    f.write("project.json", f.config);
    const selected = path.join(
      f.root,
      f.definition.libraries[0].components[0].source,
    );
    fs.appendFileSync(selected, "// Proposed update\n");
    const original = fs.writeFileSync;
    let changed = false;
    vi.spyOn(fs, "writeFileSync").mockImplementation((file, ...args) => {
      const result = original(file, ...args);
      if (!changed && String(file).endsWith(".tmp")) {
        changed = true;
        const target =
          which === "candidate"
            ? path.join(f.root, f.config.libraries.candidate)
            : which === "pinned"
              ? path.join(f.root, "evidence/pinned.json")
              : selected;
        original(
          target,
          which === "source" ? "export function Control() {}\n" : before + " ",
        );
      }
      return result;
    });
    await expect(invoke(f)).rejects.toThrow();
    expect(changed).toBe(true);
    expect(candidate(f)).toBe(which === "candidate" ? before + " " : before);
    expect(
      fs
        .readdirSync(path.join(f.root, "evidence"))
        .some((x) => x.endsWith(".tmp")),
    ).toBe(false);
  },
);

it("preserves an existing non-evidence file at the candidate path", async () => {
  const f = fixture();
  f.write(f.config.libraries.candidate, "export const Important = true;\n");
  await expect(invoke(f)).rejects.toThrow(/preserving/);
  expect(candidate(f)).toBe("export const Important = true;\n");
});
