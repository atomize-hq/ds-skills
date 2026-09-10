import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectFixture } from "./fixture.mjs";
import { setupProjectInstallation } from "./setup.mjs";
import { checkProjectInstallation } from "./state.mjs";
import { digestOf } from "../install/integrity.mjs";

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
describe("owned project launcher setup", () => {
  it("copies the exact sealed bundle, portable receipt and no unrelated files", async () => {
    const f = fixture();
    fs.mkdirSync(path.join(f.project, ".agents/skills/mine"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(f.project, ".agents/skills/mine/SKILL.md"),
      "untouched",
    );
    expect((await setupProjectInstallation(f.options)).ok).toBe(true);
    expect(fs.readFileSync(f.launcher)).toEqual(
      fs.readFileSync(path.join(f.home, "lib/dist/project-host/launcher.mjs")),
    );
    const receipt = JSON.parse(fs.readFileSync(f.receipt));
    expect(receipt.pinSha256).toBe(digestOf(fs.readFileSync(f.pin)));
    expect(receipt.files[".ds-skills/project.mjs"].sha256).toBe(
      digestOf(fs.readFileSync(f.launcher)),
    );
    expect(fs.readFileSync(f.receipt, "utf8")).not.toContain(f.root);
    expect(fs.readdirSync(path.dirname(f.launcher)).sort()).toEqual([
      "installation.json",
      "project.mjs",
    ]);
    expect(
      fs.readFileSync(
        path.join(f.project, ".agents/skills/mine/SKILL.md"),
        "utf8",
      ),
    ).toBe("untouched");
    const times = [f.launcher, f.receipt].map((p) => fs.statSync(p).mtimeMs);
    await setupProjectInstallation(f.options);
    expect([f.launcher, f.receipt].map((p) => fs.statSync(p).mtimeMs)).toEqual(
      times,
    );
    expect(checkProjectInstallation(f.options).ok).toBe(true);
  });
  it("check is read-only when not yet installed", () => {
    const f = fixture();
    expect(checkProjectInstallation(f.options).diagnostics).toHaveLength(10);
    expect(fs.existsSync(path.dirname(f.launcher))).toBe(false);
  });
  it("refuses an unowned launcher without creating a receipt or lock", async () => {
    const f = fixture();
    fs.mkdirSync(path.dirname(f.launcher));
    fs.writeFileSync(f.launcher, "mine");
    await expect(setupProjectInstallation(f.options)).rejects.toThrow(
      "unowned or edited",
    );
    expect(fs.readdirSync(path.dirname(f.launcher))).toEqual(["project.mjs"]);
    expect(fs.readFileSync(f.launcher, "utf8")).toBe("mine");
  });
  it("adopts exact desired bytes without rewriting them", async () => {
    const f = fixture();
    fs.mkdirSync(path.dirname(f.launcher));
    fs.copyFileSync(
      path.join(f.home, "lib/dist/project-host/launcher.mjs"),
      f.launcher,
    );
    const time = fs.statSync(f.launcher).mtimeMs;
    await setupProjectInstallation(f.options);
    expect(fs.statSync(f.launcher).mtimeMs).toBe(time);
  });
  it("rejects edits to an owned launcher but allows explicit repair of a deleted output", async () => {
    const f = fixture();
    await setupProjectInstallation(f.options);
    fs.appendFileSync(f.launcher, "// user edit");
    expect(checkProjectInstallation(f.options).ok).toBe(false);
    await expect(setupProjectInstallation(f.options)).rejects.toThrow(
      "unowned or edited",
    );
    fs.unlinkSync(f.launcher);
    await setupProjectInstallation(f.options);
    expect(checkProjectInstallation(f.options).ok).toBe(true);
  });
  it.each(["not-json", "{}", '{"installationVersion":"99"}'])(
    "rejects malformed or unknown receipt %s",
    async (bytes) => {
      const f = fixture();
      await setupProjectInstallation(f.options);
      fs.writeFileSync(f.receipt, bytes);
      await expect(setupProjectInstallation(f.options)).rejects.toThrow(
        "Invalid installation receipt",
      );
      expect(fs.readFileSync(f.receipt, "utf8")).toBe(bytes);
    },
  );
  it("refreshes pin metadata without modifying identical launcher bytes", async () => {
    const f = fixture();
    await setupProjectInstallation(f.options);
    const time = fs.statSync(f.launcher).mtimeMs;
    fs.appendFileSync(f.pin, "\n");
    expect(checkProjectInstallation(f.options).ok).toBe(false);
    await setupProjectInstallation(f.options);
    expect(fs.statSync(f.launcher).mtimeMs).toBe(time);
  });
  it("replaces previously owned bytes for a newly reviewed bundle and can complete a partial receipt update", async () => {
    const f = fixture();
    await setupProjectInstallation(f.options);
    const oldReceipt = fs.readFileSync(f.receipt);
    fs.appendFileSync(
      path.join(f.home, "lib/dist/project-host/launcher.mjs"),
      "\n// next bundle\n",
    );
    f.seal();
    fs.copyFileSync(f.recordPath, f.pin);
    await setupProjectInstallation(f.options);
    expect(fs.readFileSync(f.launcher, "utf8")).toContain("next bundle");
    fs.writeFileSync(f.receipt, oldReceipt);
    await setupProjectInstallation(f.options);
    expect(checkProjectInstallation(f.options).ok).toBe(true);
  });
  it.each(["directory", "launcher", "receipt", "pin"])(
    "rejects a symlink at %s without modifying its target",
    async (kind) => {
      const f = fixture();
      const target = path.join(f.root, "user-target");
      if (kind === "directory") {
        fs.mkdirSync(target);
        fs.symlinkSync(target, path.dirname(f.launcher));
      } else {
        fs.writeFileSync(target, "protected");
        fs.mkdirSync(path.dirname(f.launcher));
        const file = f[kind];
        if (kind === "pin") fs.unlinkSync(file);
        fs.symlinkSync(target, file);
      }
      await expect(setupProjectInstallation(f.options)).rejects.toThrow(
        /regular file|real project installation/,
      );
      if (kind === "directory") expect(fs.readdirSync(target)).toEqual([]);
      else expect(fs.readFileSync(target, "utf8")).toBe("protected");
    },
  );
  it("does not write when the selected release is corrupt or absent", async () => {
    const f = fixture();
    fs.appendFileSync(path.join(f.home, "lib/bin/ds-skills.mjs"), "// changed");
    await expect(setupProjectInstallation(f.options)).rejects.toThrow(
      "failed verification",
    );
    expect(fs.existsSync(path.dirname(f.launcher))).toBe(false);
    await expect(
      setupProjectInstallation({
        ...f.options,
        prefix: path.join(f.root, "missing"),
      }),
    ).rejects.toThrow("not installed");
  });
  it("rechecks inputs before committing staged outputs", async () => {
    const f = fixture();
    const write = fs.writeFileSync;
    vi.spyOn(fs, "writeFileSync").mockImplementation((file, ...args) => {
      const result = write(file, ...args);
      if (String(file).includes(".setup-"))
        write(f.pin, fs.readFileSync(f.pin, "utf8") + "\n");
      return result;
    });
    await expect(setupProjectInstallation(f.options)).rejects.toThrow(
      "changed before setup commit",
    );
    expect(fs.readdirSync(path.dirname(f.launcher))).toEqual([]);
  });
  it("serializes concurrent setup and leaves no staging or lock files", async () => {
    const f = fixture();
    await Promise.all([
      setupProjectInstallation(f.options),
      setupProjectInstallation(f.options),
    ]);
    expect(checkProjectInstallation(f.options).ok).toBe(true);
    expect(fs.readdirSync(path.dirname(f.launcher)).sort()).toEqual([
      "installation.json",
      "project.mjs",
    ]);
  });
});
