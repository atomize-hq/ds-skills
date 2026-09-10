import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { projectFixture } from "./fixture.mjs";
import { setupProjectInstallation } from "./setup.mjs";
import { checkProjectInstallation } from "./state.mjs";
import { validateOutputPaths, releaseSkillAssets } from "./assets.mjs";
const fixtures = [];
function fixture() {
  const f = projectFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  for (const f of fixtures.splice(0))
    fs.rmSync(f.root, { recursive: true, force: true });
});
function publish(f) {
  f.seal();
  fs.copyFileSync(f.recordPath, f.pin);
}
it("keeps project installations isolated without mutating their shared release", async () => {
  const f = fixture();
  const second = path.join(f.root, "another-project");
  fs.mkdirSync(second);
  fs.copyFileSync(f.pin, path.join(second, "ds-skills.release.json"));
  const options = { root: second, prefix: f.prefix };
  await setupProjectInstallation(f.options);
  await setupProjectInstallation(options);
  fs.appendFileSync(
    path.join(f.project, ".agents/skills/example/SKILL.md"),
    "local change",
  );
  expect(checkProjectInstallation(f.options).ok).toBe(false);
  expect(checkProjectInstallation(options).ok).toBe(true);
  expect(
    fs.readFileSync(path.join(f.home, "lib/skills/example/SKILL.md"), "utf8"),
  ).not.toContain("local change");
});
it.skipIf(process.platform === "win32")(
  "preserves executable helpers without running them and detects mode edits",
  async () => {
    const f = fixture(),
      source = path.join(f.home, "lib/skills/example/run.sh");
    fs.writeFileSync(source, '#!/bin/sh\ntouch "should-not-execute"\n', {
      mode: 0o755,
    });
    publish(f);
    await setupProjectInstallation(f.options);
    for (const surface of [".agents", ".claude"])
      expect(
        fs.statSync(path.join(f.project, surface, "skills/example/run.sh"))
          .mode & 0o111,
      ).not.toBe(0);
    expect(fs.existsSync(path.join(f.project, "should-not-execute"))).toBe(
      false,
    );
    fs.chmodSync(path.join(f.project, ".agents/skills/example/run.sh"), 0o644);
    expect(checkProjectInstallation(f.options).ok).toBe(false);
    await expect(setupProjectInstallation(f.options)).rejects.toThrow(
      "unowned or edited",
    );
  },
);
it.each([
  "missing-skill-entry",
  "empty-skill-entry",
  "missing-support",
  "unexpected-root-file",
  "unsafe-skill-name",
])("refuses an invalid sealed asset layout: %s", async (kind) => {
  const f = fixture();
  if (kind === "missing-skill-entry")
    fs.unlinkSync(path.join(f.home, "lib/skills/example/SKILL.md"));
  if (kind === "empty-skill-entry")
    fs.writeFileSync(path.join(f.home, "lib/skills/example/SKILL.md"), "");
  if (kind === "missing-support")
    fs.rmSync(path.join(f.home, "lib/templates"), { recursive: true });
  if (kind === "unexpected-root-file")
    fs.writeFileSync(
      path.join(f.home, "lib/skills/not-a-skill.md"),
      "unclassified",
    );
  if (kind === "unsafe-skill-name")
    fs.renameSync(
      path.join(f.home, "lib/skills/example"),
      path.join(f.home, "lib/skills/CON"),
    );
  publish(f);
  await expect(setupProjectInstallation(f.options)).rejects.toThrow(
    /SKILL.md|asset group|Unsupported skill directory/,
  );
  expect(fs.existsSync(f.launcher)).toBe(false);
});
it("rejects file/directory case aliases before writing on every platform", () => {
  expect(() =>
    validateOutputPaths([
      ".agents/skills/example/Guide",
      ".agents/skills/example/guide/page.md",
    ]),
  ).toThrow("File/directory collision");
  expect(() =>
    validateOutputPaths([
      ".agents/skills/example/a.md",
      ".agents/skills/example/A.md",
    ]),
  ).toThrow("Case-colliding");
});
it("does not adopt a case-aliased directory on a case-insensitive filesystem", async () => {
  const f = fixture(),
    dir = path.join(f.project, ".AGENTS");
  fs.mkdirSync(dir);
  if (!fs.existsSync(path.join(f.project, ".agents"))) return;
  await expect(setupProjectInstallation(f.options)).rejects.toThrow(
    "Case-aliased",
  );
  expect(fs.readdirSync(dir)).toEqual([]);
});

it.skipIf(process.platform === "win32")(
  "derives copied executable requirements from the sealed manifest, not incidental source modes",
  async () => {
    const f = fixture();
    fs.chmodSync(path.join(f.home, "lib/skills/example/SKILL.md"), 0o755);
    await setupProjectInstallation(f.options);
    const receipt = JSON.parse(fs.readFileSync(f.receipt));
    expect(receipt.files[".agents/skills/example/SKILL.md"].executable).toBe(
      false,
    );
    expect(
      fs.statSync(path.join(f.project, ".agents/skills/example/SKILL.md"))
        .mode & 0o111,
    ).toBe(0);
  },
);
it("rejects manifest or asset bytes changed between resolution and materialization", () => {
  const f = fixture();
  const digest = f.record.payloadManifest.sha256;
  fs.appendFileSync(
    path.join(f.home, "lib/skills/example/SKILL.md"),
    "changed",
  );
  expect(() => releaseSkillAssets(f.home, digest)).toThrow(
    "asset changed after verification",
  );
  fs.appendFileSync(path.join(f.home, "payload-manifest.json"), "\n");
  expect(() => releaseSkillAssets(f.home, digest)).toThrow(
    "manifest changed after verification",
  );
});
