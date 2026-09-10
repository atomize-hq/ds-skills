import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { curatedInstallFixture } from "./install-fixture.mjs";
import { installCuratedSkills } from "./install.mjs";
import {
  desiredCuratedInstallation,
  checkCuratedDesired,
} from "./install-state.mjs";
import { runCuration } from "./command.mjs";
import { acceptFixtureCuration } from "./fixture.mjs";
import { readCuratedReceipt } from "./install-receipt.mjs";
import { setupProjectInstallation } from "../project-host/setup.mjs";
const fixtures = [];
async function fixture(options) {
  const f = await curatedInstallFixture(options);
  fixtures.push(f);
  return f;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0))
    for (const root of [f.root, f.release.root])
      fs.rmSync(root, { recursive: true, force: true });
});
const install = (f) => installCuratedSkills(f.project(), f.release.prefix);
const check = (f) =>
  checkCuratedDesired(
    desiredCuratedInstallation(f.project(), f.release.prefix),
  );
const output = (f, surface = ".agents") =>
  path.join(
    f.root,
    surface,
    "skills",
    `ds-curated-${f.draft.namespace}-${f.draft.skills[0].id}`,
    "SKILL.md",
  );
async function accept(f) {
  f.write("curation.json", f.draft);
  await runCuration(f.project(), "build");
  acceptFixtureCuration(
    f,
    fs.readFileSync(path.join(f.root, f.config.curation.candidate), "utf8"),
  );
}
it("installs exact reviewed files in both surfaces, preserves unrelated skills and shared release", async () => {
  const f = await fixture();
  f.write(".agents/skills/mine/SKILL.md", "mine");
  const manifest = fs.readFileSync(
    path.join(f.release.home, "payload-manifest.json"),
  );
  expect(check(f).ok).toBe(false);
  expect(fs.existsSync(f.receipt)).toBe(false);
  const result = await install(f);
  expect(result.ok).toBe(true);
  expect(result.installedFileCount).toBe(12);
  expect(fs.readFileSync(output(f))).toEqual(
    fs.readFileSync(output(f, ".claude")),
  );
  expect(
    fs.readFileSync(path.join(f.root, ".agents/skills/mine/SKILL.md"), "utf8"),
  ).toBe("mine");
  expect(
    fs.readFileSync(path.join(f.release.home, "payload-manifest.json")),
  ).toEqual(manifest);
  const receipt = readCuratedReceipt(fs.readFileSync(f.receipt));
  expect(receipt.bundleSha256).toBe(f.config.curation.accepted.sha256);
  expect(receipt.release).toBe(f.release.record.release);
  expect(fs.readFileSync(f.receipt, "utf8")).not.toContain(f.root);
  const times = [f.receipt, output(f)].map((p) => fs.statSync(p).mtimeMs);
  expect((await install(f)).artifactStatus).toBe("unchanged");
  expect([f.receipt, output(f)].map((p) => fs.statSync(p).mtimeMs)).toEqual(
    times,
  );
});
it("isolates different consumer vocabularies even when using one shared release", async () => {
  const a = await fixture(),
    b = await fixture({
      namespace: "secondary",
      folder: "owned-kit",
      secondKind: "local-source-v1",
    });
  fs.copyFileSync(
    a.release.recordPath,
    path.join(b.root, "ds-skills.release.json"),
  );
  b.release.prefix = a.release.prefix;
  await setupProjectInstallation({ root: b.root, prefix: a.release.prefix });
  await install(a);
  await install(b);
  expect(check(a).ok && check(b).ok).toBe(true);
  expect(
    fs.existsSync(
      path.join(b.root, ".agents/skills", `ds-curated-demo-widgets`),
    ),
  ).toBe(false);
  expect(fs.readFileSync(output(b), "utf8")).toContain("secondary");
});
it.each([".agents", ".claude"])(
  "detects and refuses edited %s outputs, repairs missing outputs explicitly",
  async (surface) => {
    const f = await fixture();
    await install(f);
    const file = output(f, surface),
      before = fs.readFileSync(f.receipt);
    fs.appendFileSync(file, "user edit");
    expect(check(f).ok).toBe(false);
    await expect(install(f)).rejects.toThrow(/unowned or edited/);
    expect(fs.readFileSync(f.receipt)).toEqual(before);
    fs.unlinkSync(file);
    expect(check(f).ok).toBe(false);
    expect((await install(f)).ok).toBe(true);
  },
);
it.each(["unowned", "extra-file", "extra-directory", "symlink"])(
  "refuses %s content before any installation mutation",
  async (mode) => {
    const f = await fixture();
    const file = output(f);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (mode === "unowned") fs.writeFileSync(file, "owned by user");
    if (mode === "extra-file")
      fs.writeFileSync(path.join(path.dirname(file), "extra.md"), "mine");
    if (mode === "extra-directory")
      fs.mkdirSync(path.join(path.dirname(file), "extra"));
    if (mode === "symlink")
      fs.symlinkSync(path.join(f.root, "curation.json"), file);
    await expect(install(f)).rejects.toThrow(
      /unowned|Unowned|regular|symbolic/,
    );
    expect(fs.existsSync(f.receipt)).toBe(false);
    expect(fs.existsSync(path.join(f.root, ".ds-skills/setup.lock"))).toBe(
      false,
    );
  },
);
it("refreshes reviewed guidance and removes only obsolete, unchanged owned skills", async () => {
  const f = await fixture();
  await install(f);
  const old = output(f);
  f.draft.namespace = "updated";
  await accept(f);
  expect(check(f).ok).toBe(false);
  expect((await install(f)).ok).toBe(true);
  expect(fs.existsSync(path.dirname(old))).toBe(false);
  expect(fs.existsSync(output(f))).toBe(true);
});
it("refuses removal of edited or augmented obsolete roots", async () => {
  const f = await fixture();
  await install(f);
  const old = output(f);
  fs.appendFileSync(old, "user");
  f.draft.namespace = "updated";
  await accept(f);
  await expect(install(f)).rejects.toThrow(/edited/);
  expect(fs.readFileSync(old, "utf8")).toContain("user");
  expect(fs.existsSync(output(f))).toBe(false);
});
it("rejects stale definitions, reviews and missing acceptance without changing installed bytes", async () => {
  const f = await fixture();
  await install(f);
  const before = fs.readFileSync(f.receipt);
  f.draft.skills[0].description += " changed";
  f.write("curation.json", f.draft);
  await expect(install(f)).rejects.toThrow(/stale/);
  f.config.curation.review = null;
  f.write("project.json", f.config);
  await expect(install(f)).rejects.toThrow(/review pins/);
  expect(fs.readFileSync(f.receipt)).toEqual(before);
});
it("refuses a second configuration claiming another configuration's roots", async () => {
  const f = await fixture();
  await install(f);
  f.write("second.json", f.config);
  const { loadProject } = await import("../project/config.mjs");
  await expect(
    installCuratedSkills(
      loadProject(path.join(f.root, "second.json")),
      f.release.prefix,
    ),
  ).rejects.toThrow(/Another configuration/);
});
it("binds installed output receipt to reviewed release pin and requires current core setup", async () => {
  const f = await fixture();
  await install(f);
  const old = fs.readFileSync(f.receipt);
  fs.appendFileSync(path.join(f.root, "ds-skills.release.json"), " ");
  await expect(install(f)).rejects.toThrow(/Core project installation/);
  await setupProjectInstallation({ root: f.root, prefix: f.release.prefix });
  expect(check(f).ok).toBe(false);
  await install(f);
  expect(fs.readFileSync(f.receipt)).not.toEqual(old);
});
it("refuses forged receipt paths outside the exact curated namespace/file set", async () => {
  const f = await fixture();
  await install(f);
  const r = JSON.parse(fs.readFileSync(f.receipt));
  r.files[".agents/skills/mine/SKILL.md"] = Object.values(r.files)[0];
  fs.writeFileSync(f.receipt, JSON.stringify(r));
  expect(check(f).ok).toBe(false);
  await expect(install(f)).rejects.toThrow(
    /Invalid curated installation receipt/,
  );
});
it("refuses configured output overlap with discovery or installation receipt paths", async () => {
  const f = await fixture();
  f.config.curation.definition = ".ds-skills/draft.json";
  f.write(f.config.curation.definition, f.draft);
  f.write("project.json", f.config);
  await expect(install(f)).rejects.toThrow(/overlaps/);
  expect(fs.existsSync(f.receipt)).toBe(false);
});
it("captures curation changes after staging and before first managed rename", async () => {
  const f = await fixture();
  await install(f);
  f.draft.skills[0].description += " reviewed";
  await accept(f);
  const before = fs.readFileSync(output(f)),
    receipt = fs.readFileSync(f.receipt);
  const original = fs.writeFileSync;
  let changed = false;
  vi.spyOn(fs, "writeFileSync").mockImplementation((file, ...args) => {
    const r = original(file, ...args);
    if (
      !changed &&
      String(file).includes(".setup-") &&
      String(file).endsWith(".tmp")
    ) {
      changed = true;
      original(path.join(f.root, "curation.json"), "{");
    }
    return r;
  });
  await expect(install(f)).rejects.toThrow();
  expect(changed).toBe(true);
  expect(fs.readFileSync(output(f))).toEqual(before);
  expect(fs.readFileSync(f.receipt)).toEqual(receipt);
});
it("does not advance the receipt on a partial filesystem failure and can explicitly repair owned output", async () => {
  const f = await fixture();
  await install(f);
  f.draft.skills[0].description += " reviewed";
  await accept(f);
  const receipt = fs.readFileSync(f.receipt);
  const rename = fs.renameSync;
  let calls = 0;
  const spy = vi.spyOn(fs, "renameSync").mockImplementation((a, b) => {
    if (String(a).includes(".setup-") && ++calls === 2)
      throw new Error("injected filesystem failure");
    return rename(a, b);
  });
  await expect(install(f)).rejects.toThrow(/injected/);
  expect(fs.readFileSync(f.receipt)).toEqual(receipt);
  spy.mockRestore();
  expect(check(f).ok).toBe(false);
  expect((await install(f)).ok).toBe(true);
});
