import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { loadProject } from "../project/config.mjs";
import { tokenBuildFixture } from "./project-fixture.mjs";
import { preflightTokenWrites, assertWritePath } from "./write-targets.mjs";
import { checkTokenArtifacts } from "./artifact-check.mjs";
const roots = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const f = tokenBuildFixture();
  roots.push(f.root);
  const project = loadProject(f.configPath);
  fs.mkdirSync(path.dirname(project.tokens.build.lockPath), {
    recursive: true,
  });
  return { ...f, project, lock: project.tokens.build.lockPath };
}
function disappear(target, occurrence, directory = false) {
  const original = fs.accessSync;
  let count = 0;
  vi.spyOn(fs, "accessSync").mockImplementation((file, ...args) => {
    if (file === target && ++count === occurrence)
      fs.rmSync(target, { recursive: directory });
    return original(file, ...args);
  });
  return () => count;
}
it.each([
  ["guard", 1],
  ["directory", 1],
  ["directory", 2],
])("accepts cooperative %s disappearance at access %i", (kind, occurrence) => {
  const { project, lock } = fixture();
  const target = kind === "guard" ? `${lock}.guard` : lock;
  if (kind === "guard") fs.writeFileSync(target, "owner");
  else fs.mkdirSync(target);
  const count = disappear(target, occurrence, kind === "directory");
  expect(() => preflightTokenWrites(project)).not.toThrow();
  expect(count()).toBe(occurrence);
  expect(fs.existsSync(target)).toBe(false);
});
it("does not tolerate an ordinary output disappearing after lstat", () => {
  const { root } = fixture();
  const target = path.join(root, "output.json");
  fs.writeFileSync(target, "keep");
  disappear(target, 1);
  expect(() => assertWritePath(root, target)).toThrow(/ENOENT/);
});
it("does not tolerate an ancestor disappearing for a cooperative target", () => {
  const { root, lock } = fixture();
  disappear(path.dirname(lock), 1, true);
  expect(() =>
    assertWritePath(root, lock, "directory", {
      cooperativeLockTarget: true,
    }),
  ).toThrow(/ENOENT/);
});
it("rejects an inaccessible parent after the lock disappears at final access", () => {
  const { root, lock } = fixture();
  fs.mkdirSync(lock);
  const original = fs.accessSync;
  let count = 0;
  let removed = false;
  vi.spyOn(fs, "accessSync").mockImplementation((file, ...args) => {
    if (file === lock && ++count === 2) {
      fs.rmdirSync(lock);
      removed = true;
    }
    if (removed && file === path.dirname(lock))
      throw Object.assign(new Error("parent EACCES"), { code: "EACCES" });
    return original(file, ...args);
  });
  expect(() =>
    assertWritePath(root, lock, "directory", {
      cooperativeLockTarget: true,
    }),
  ).toThrow(/parent EACCES/);
});
it.each(["lock", "guard"])("preserves %s permission failures", (kind) => {
  const { project, lock } = fixture();
  const target = kind === "guard" ? `${lock}.guard` : lock;
  if (kind === "guard") fs.writeFileSync(target, "owner");
  else fs.mkdirSync(target);
  const original = fs.accessSync;
  vi.spyOn(fs, "accessSync").mockImplementation((file, ...args) => {
    if (file === target)
      throw Object.assign(new Error("target EACCES"), { code: "EACCES" });
    return original(file, ...args);
  });
  expect(() => preflightTokenWrites(project)).toThrow(/target EACCES/);
});
it.each(["lock", "guard"])("rejects a %s symlink", (kind) => {
  const { project, root, lock } = fixture();
  fs.symlinkSync(root, kind === "guard" ? `${lock}.guard` : lock);
  expect(() => preflightTokenWrites(project)).toThrow(/symbolic/);
});
it.each(["lock", "guard"])("rejects wrong-kind %s targets", (kind) => {
  const { project, lock } = fixture();
  if (kind === "guard") fs.mkdirSync(`${lock}.guard`);
  else fs.writeFileSync(lock, "not a directory");
  expect(() => preflightTokenWrites(project)).toThrow(/directory|regular file/);
});
it.each(["output", "input"])(
  "preserves guard/%s overlap protection",
  (kind) => {
    const { project, lock } = fixture();
    if (kind === "output") project.tokens.build.outputs.figma = `${lock}.guard`;
    else project.tokens.sourceDir = `${lock}.guard`;
    expect(() => preflightTokenWrites(project)).toThrow(
      /overlap|protected input/,
    );
  },
);
it("serializes independent CLI builders with correct artifacts and no residual locks", async () => {
  const { project, root, configPath, lock } = fixture();
  const cli = path.resolve("bin/ds-skills.mjs");
  const invoke = promisify(execFile);
  const results = await Promise.all(
    Array.from({ length: 3 }, async () => {
      const { stdout } = await invoke(
        process.execPath,
        [cli, "tokens", "build", "--config", configPath, "--json"],
        { cwd: root },
      );
      return JSON.parse(stdout);
    }),
  );
  expect(results.every((r) => r.ok)).toBe(true);
  expect((await checkTokenArtifacts({ project })).ok).toBe(true);
  expect(fs.existsSync(lock)).toBe(false);
  expect(fs.existsSync(`${lock}.guard`)).toBe(false);
}, 30000);
