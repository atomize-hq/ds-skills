import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { projectFixture } from "./fixture.mjs";
import { setupProjectInstallation } from "./setup.mjs";
import { checkProjectInstallation } from "./state.mjs";
import { runPinnedAt } from "./invoke.mjs";
import { readReceipt } from "./receipt.mjs";
const fixtures = [];
function fixture() {
  const f = projectFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0))
    fs.rmSync(f.root, { recursive: true, force: true });
});
function file(f, relative) {
  return path.join(f.project, relative);
}
function publish(f) {
  f.seal();
  fs.copyFileSync(f.recordPath, f.pin);
}
function write(f, relative, bytes) {
  const target = file(f, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}
it("materializes exact complete skills and relative support assets in both independent surfaces", async () => {
  const f = fixture();
  const report = await setupProjectInstallation(f.options);
  expect(report.skills).toEqual(["example"]);
  expect(report.installedFileCount).toBe(9);
  const receipt = readReceipt(fs.readFileSync(f.receipt));
  expect(receipt.installationVersion).toBe("2");
  expect(Object.keys(receipt.files)).toHaveLength(9);
  for (const surface of [".agents", ".claude"]) {
    for (const relative of [
      "skills/example/SKILL.md",
      "skills/example/references/guide.md",
      "schemas/example.json",
      "templates/example.json",
    ]) {
      const output = file(f, `${surface}/${relative}`);
      expect(fs.lstatSync(output).isSymbolicLink()).toBe(false);
      expect(fs.readFileSync(output)).toEqual(
        fs.readFileSync(path.join(f.home, "lib", relative)),
      );
    }
    expect(
      fs.readFileSync(
        file(f, `${surface}/skills/example/../../schemas/example.json`),
        "utf8",
      ),
    ).toContain('"object"');
  }
  const before = Object.keys(receipt.files).map(
    (p) => fs.statSync(file(f, p)).mtimeMs,
  );
  await setupProjectInstallation(f.options);
  expect(
    Object.keys(receipt.files).map((p) => fs.statSync(file(f, p)).mtimeMs),
  ).toEqual(before);
});
it("rejects unilateral skill drift before executing the pinned CLI", async () => {
  const f = fixture();
  await setupProjectInstallation(f.options);
  fs.appendFileSync(file(f, ".claude/skills/example/SKILL.md"), "changed");
  expect(checkProjectInstallation(f.options).diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: ".claude/skills/example/SKILL.md",
        code: "PROJECT_OUTPUT_SKEW",
      }),
    ]),
  );
  expect(() =>
    runPinnedAt(f.project, ["--version"], { prefix: f.prefix, capture: true }),
  ).toThrow("Missing or changed");
  expect(fs.existsSync(file(f, "executed.txt"))).toBe(false);
  await expect(setupProjectInstallation(f.options)).rejects.toThrow(
    "unowned or edited",
  );
});
it("preflights every asset before any output changes, including a late collision", async () => {
  const f = fixture();
  write(f, ".claude/templates/example.json", "user-owned");
  await expect(setupProjectInstallation(f.options)).rejects.toThrow(
    "unowned or edited",
  );
  expect(fs.existsSync(file(f, ".agents"))).toBe(false);
  expect(fs.existsSync(f.launcher)).toBe(false);
  expect(
    fs.readFileSync(file(f, ".claude/templates/example.json"), "utf8"),
  ).toBe("user-owned");
});
it("keeps unrelated skill folders, support outside its roots and user discovery symlinks", async () => {
  const f = fixture();
  write(f, ".agents/skills/user/SKILL.md", "keep");
  write(f, ".claude/user-settings.json", "keep settings");
  fs.mkdirSync(file(f, ".claude/skills"));
  fs.symlinkSync("../../.agents/skills/user", file(f, ".claude/skills/user"));
  await setupProjectInstallation(f.options);
  expect(fs.readlinkSync(file(f, ".claude/skills/user"))).toBe(
    "../../.agents/skills/user",
  );
  expect(fs.readFileSync(file(f, ".agents/skills/user/SKILL.md"), "utf8")).toBe(
    "keep",
  );
  expect(fs.readFileSync(file(f, ".claude/user-settings.json"), "utf8")).toBe(
    "keep settings",
  );
});
it.each(["file", "directory"])(
  "preserves and refuses unexpected %s inside an owned root",
  async (kind) => {
    const f = fixture();
    await setupProjectInstallation(f.options);
    const extra = file(f, ".agents/skills/example/user-added");
    if (kind === "file") fs.writeFileSync(extra, "keep");
    else fs.mkdirSync(extra);
    const before = fs.readFileSync(f.receipt);
    expect(checkProjectInstallation(f.options).ok).toBe(false);
    await expect(setupProjectInstallation(f.options)).rejects.toThrow(
      /Unowned (file|directory)/,
    );
    expect(fs.existsSync(extra)).toBe(true);
    expect(fs.readFileSync(f.receipt)).toEqual(before);
  },
);
it.each([
  ".agents",
  ".claude/skills",
  ".agents/skills/example",
  ".claude/skills/example/references",
  ".agents/schemas",
  ".claude/templates",
])(
  "refuses output parent/root symlink %s without following it",
  async (relative) => {
    const f = fixture(),
      target = path.join(f.root, "outside");
    fs.mkdirSync(target);
    const link = file(f, relative);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link);
    await expect(setupProjectInstallation(f.options)).rejects.toThrow(
      /real output parent|real managed asset directory|symbolic managed content/,
    );
    expect(fs.readdirSync(target)).toEqual([]);
    expect(fs.existsSync(f.launcher)).toBe(false);
  },
);
it("updates changed assets, adds a new skill, removes intact retired assets and preserves unrelated roots", async () => {
  const f = fixture();
  await setupProjectInstallation(f.options);
  write(f, ".agents/skills/user/SKILL.md", "keep");
  fs.rmSync(path.join(f.home, "lib/skills/example"), { recursive: true });
  fs.mkdirSync(path.join(f.home, "lib/skills/second"));
  fs.writeFileSync(
    path.join(f.home, "lib/skills/second/SKILL.md"),
    "# A different skill",
  );
  fs.writeFileSync(
    path.join(f.home, "lib/schemas/example.json"),
    '{"type":"string"}',
  );
  publish(f);
  expect(checkProjectInstallation(f.options).ok).toBe(false);
  await setupProjectInstallation(f.options);
  for (const surface of [".agents", ".claude"]) {
    expect(fs.existsSync(file(f, `${surface}/skills/example`))).toBe(false);
    expect(
      fs.readFileSync(file(f, `${surface}/skills/second/SKILL.md`), "utf8"),
    ).toContain("different skill");
    expect(
      fs.readFileSync(file(f, `${surface}/schemas/example.json`), "utf8"),
    ).toContain("string");
  }
  expect(fs.readFileSync(file(f, ".agents/skills/user/SKILL.md"), "utf8")).toBe(
    "keep",
  );
});
it("will not remove an edited retired asset", async () => {
  const f = fixture();
  await setupProjectInstallation(f.options);
  fs.appendFileSync(
    file(f, ".agents/skills/example/references/guide.md"),
    "my notes",
  );
  fs.rmSync(path.join(f.home, "lib/skills/example/references"), {
    recursive: true,
  });
  publish(f);
  await expect(setupProjectInstallation(f.options)).rejects.toThrow(
    "unowned or edited",
  );
  expect(
    fs.readFileSync(
      file(f, ".agents/skills/example/references/guide.md"),
      "utf8",
    ),
  ).toContain("my notes");
});
it("recovers a partial update using old receipt plus exact new bytes, without claiming a transaction", async () => {
  const f = fixture();
  await setupProjectInstallation(f.options);
  const old = fs.readFileSync(f.receipt);
  fs.writeFileSync(
    path.join(f.home, "lib/skills/example/SKILL.md"),
    "# Revised skill",
  );
  publish(f);
  await setupProjectInstallation(f.options);
  fs.writeFileSync(f.receipt, old);
  fs.unlinkSync(file(f, ".claude/skills/example/SKILL.md"));
  await setupProjectInstallation(f.options);
  expect(checkProjectInstallation(f.options).ok).toBe(true);
});
it("upgrades a recognized launcher-only receipt without granting ownership of arbitrary skills", async () => {
  const f = fixture();
  await setupProjectInstallation(f.options);
  const old = JSON.parse(fs.readFileSync(f.receipt));
  const v1 = {
    installationVersion: "1",
    release: old.release,
    sourceCommit: old.sourceCommit,
    pinSha256: old.pinSha256,
    launcherSha256: old.files[".ds-skills/project.mjs"].sha256,
  };
  fs.writeFileSync(f.receipt, JSON.stringify(v1));
  await setupProjectInstallation(f.options);
  expect(checkProjectInstallation(f.options).ok).toBe(true);
  fs.writeFileSync(f.receipt, JSON.stringify(v1));
  fs.appendFileSync(file(f, ".agents/skills/example/SKILL.md"), "mine");
  await expect(setupProjectInstallation(f.options)).rejects.toThrow(
    "unowned or edited",
  );
});
it("detects a skill edit between staging and commit without replacing any outputs", async () => {
  const f = fixture();
  await setupProjectInstallation(f.options);
  const receipt = fs.readFileSync(f.receipt);
  fs.writeFileSync(
    path.join(f.home, "lib/skills/example/SKILL.md"),
    "# Revised skill",
  );
  publish(f);
  const target = file(f, ".agents/skills/example/SKILL.md"),
    prior = fs.readFileSync(target),
    original = fs.writeFileSync;
  vi.spyOn(fs, "writeFileSync").mockImplementation((name, ...args) => {
    const result = original(name, ...args);
    if (String(name).includes(".setup-"))
      original(target, Buffer.concat([prior, Buffer.from("user edit")]));
    return result;
  });
  await expect(setupProjectInstallation(f.options)).rejects.toThrow(
    "unowned or edited",
  );
  expect(fs.readFileSync(f.receipt)).toEqual(receipt);
  expect(fs.readFileSync(file(f, ".claude/skills/example/SKILL.md"))).toEqual(
    prior,
  );
  expect(fs.readdirSync(path.dirname(f.receipt)).sort()).toEqual([
    "installation.json",
    "project.mjs",
  ]);
});
