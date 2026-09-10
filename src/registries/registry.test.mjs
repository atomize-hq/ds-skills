import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { registryFixture } from "./fixture.mjs";
import { runRegistryEvidence } from "./command.mjs";
import { readRegistryPacket } from "./packet.mjs";
import { digest } from "../libraries/capture.mjs";
const fixtures = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(fixtures.splice(0).map((f) => f.close()));
});
async function fixture(o) {
  const f = await registryFixture(o);
  fixtures.push(f);
  return f;
}
const invoke = (f, mode = "capture", options = {}) =>
  runRegistryEvidence(f.project(), mode, options);
const candidate = (f) =>
  fs.readFileSync(path.join(f.root, f.config.registries.candidate), "utf8");
async function pin(f) {
  await invoke(f);
  const bytes = candidate(f);
  f.write("accepted.json", bytes);
  f.config.registries.evidence = {
    file: "accepted.json",
    sha256: digest(bytes),
  };
  f.write("project.json", f.config);
  return bytes;
}
it.each([{}, { folder: "snapshots", withIndex: false }])(
  "captures all payload bytes and full file paths from multiple configured registries %j",
  async (o) => {
    const f = await fixture(o);
    await invoke(f);
    const p = readRegistryPacket(candidate(f));
    expect(p.data.registries).toHaveLength(2);
    expect(p.data.registries[0].items[0].files.map((x) => x.path)).toEqual([
      "other/control.tsx",
      "ui/control.tsx",
    ]);
    expect(f.requests.some((x) => x.url.includes("unfetched"))).toBe(false);
    expect(
      fs.existsSync(path.join(f.root, "DO NOT EXECUTE REMOTE EVIDENCE")),
    ).toBe(false);
    expect((await invoke(f)).artifactStatus).toBe("unchanged");
  },
);
it("keeps check/diff offline and pin acceptance explicit", async () => {
  const f = await fixture();
  await invoke(f);
  expect(f.config.registries.evidence).toBeNull();
  await expect(invoke(f, "check")).rejects.toThrow(/No accepted/);
  await pin(f);
  const requests = f.requests.length;
  expect((await invoke(f, "check")).ok).toBe(true);
  expect((await invoke(f, "diff")).diff.changed).toEqual([]);
  expect(f.requests).toHaveLength(requests);
  f.routes.get("/widgets/control").body.dependencies.push("changed-upstream");
  expect((await invoke(f, "check")).ok).toBe(true); // Offline snapshot, not live freshness.
  const before = fs.readFileSync(path.join(f.root, "accepted.json"), "utf8");
  const next = await invoke(f);
  expect(next.diff.changed[0].items.changed[0].before).not.toBe(
    next.diff.changed[0].items.changed[0].after,
  );
  expect(fs.readFileSync(path.join(f.root, "accepted.json"), "utf8")).toBe(
    before,
  );
});
it("marks selection drift without inventing deletions", async () => {
  const f = await fixture();
  await pin(f);
  f.definition.registries.pop();
  f.write("registries.json", f.definition);
  expect((await invoke(f, "check")).ok).toBe(false);
  expect((await invoke(f)).diff.noLongerSelected).toEqual(["layout"]);
});
it.each([
  "404",
  "503",
  "not-indexed",
  "empty-index",
  "duplicate-index",
  "identity",
  "duplicate-path",
  "traversal",
  "missing-content",
  "invalid-json",
  "invalid-utf8",
  "redirect",
  "timeout",
  "oversized",
])(
  "refuses %s in any selected registry without replacing prior evidence",
  async (mode) => {
    const f = await fixture(),
      before = await pin(f),
      r = f.routes.get("/widgets/control");
    if (mode === "404" || mode === "503") r.status = Number(mode);
    if (mode === "not-indexed")
      f.routes.get("/widgets/index").body.items = [{ name: "other" }];
    if (mode === "empty-index") f.routes.get("/widgets/index").body.items = [];
    if (mode === "duplicate-index")
      f.routes.get("/widgets/index").body.items.push({ name: "control" });
    if (mode === "identity") r.body.name = "wrong";
    if (mode === "duplicate-path") r.body.files.push(r.body.files[0]);
    if (mode === "traversal") r.body.files[0].path = "../source.tsx";
    if (mode === "missing-content") delete r.body.files[0].content;
    if (mode === "invalid-json") r.body = "{";
    if (mode === "invalid-utf8") r.body = Buffer.from([0xff]);
    if (mode === "redirect") r.redirect = f.base + "/layout/control";
    if (mode === "timeout") r.delay = 1000;
    if (mode === "oversized") r.body = "x".repeat(2 * 1024 * 1024 + 1);
    await expect(
      invoke(f, "capture", { requestMs: mode === "timeout" ? 30 : 2000 }),
    ).rejects.toThrow();
    expect(candidate(f)).toBe(before);
    expect(fs.readFileSync(path.join(f.root, "accepted.json"), "utf8")).toBe(
      before,
    );
  },
);
it("uses observed index membership only, never follows includes or dependency URLs", async () => {
  const f = await fixture();
  f.routes.get("/widgets/index").body.include = [
    "https://unselected.invalid/private.json",
  ];
  await invoke(f);
  expect(
    f.requests.every((x) =>
      /^\/(widgets|layout)\/(index|control|license)$/.test(x.url),
    ),
  ).toBe(true);
});
it.each(["digest", "manifest-summary", "file-summary", "index-summary"])(
  "rejects forged %s in accepted snapshots",
  async (mode) => {
    const f = await fixture();
    await invoke(f);
    const p = JSON.parse(candidate(f)),
      r = p.data.registries[0];
    if (mode === "digest") r.items[0].sha256 = "0".repeat(64);
    if (mode === "manifest-summary") r.items[0].dependencies = [];
    if (mode === "file-summary") r.items[0].files[0].sha256 = "0".repeat(64);
    if (mode === "index-summary") r.index.observedNames = [];
    expect(() => readRegistryPacket(JSON.stringify(p))).toThrow();
  },
);
it("rejects unsafe URLs and source/output collisions before requesting anything", async () => {
  const f = await fixture();
  f.definition.registries[0].items[0].url = "http://example.com/private";
  f.write("registries.json", f.definition);
  await expect(invoke(f)).rejects.toThrow(/HTTPS/);
  expect(f.requests).toHaveLength(0);
  f.definition.registries[0].items[0].url = f.base + "/widgets/control";
  f.write("registries.json", f.definition);
  f.config.registries.candidate = "registries.json";
  f.write("project.json", f.config);
  await expect(invoke(f)).rejects.toThrow(/overlaps/);
  expect(f.requests).toHaveLength(0);
});
it("rejects a changed selection or accepted pin during network acquisition", async () => {
  const f = await fixture(),
    before = await pin(f);
  let changed = false;
  const fetchImpl = async (...args) => {
    if (!changed) {
      changed = true;
      f.write("accepted.json", before + " ");
    }
    return fetch(...args);
  };
  await expect(invoke(f, "capture", { fetchImpl })).rejects.toThrow(/SHA-256/);
  expect(candidate(f)).toBe(before);
});

it("refuses an existing non-snapshot candidate before any request", async () => {
  const f = await fixture();
  f.write(f.config.registries.candidate, "export const Important = true;\n");
  await expect(invoke(f)).rejects.toThrow(/preserving/);
  expect(candidate(f)).toBe("export const Important = true;\n");
  expect(f.requests).toHaveLength(0);
});
