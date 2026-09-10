import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { loadProject, resolveProjectPath } from "./config.mjs";
import { tokenBuildFixture } from "../tokens/project-fixture.mjs";
const roots = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const f = tokenBuildFixture();
  roots.push(f.root);
  const lock = path.join(f.root, f.config.tokens.build.lockPath);
  fs.mkdirSync(lock, { recursive: true });
  return { ...f, lock };
}
function atRealpath(target, mutate) {
  const original = fs.realpathSync;
  let changed = false;
  vi.spyOn(fs, "realpathSync").mockImplementation((file, ...args) => {
    if (file === target && !changed) {
      changed = true;
      mutate();
    }
    return original(file, ...args);
  });
}
it("loads token config when only its cooperative lock leaf disappears", () => {
  const f = fixture();
  atRealpath(f.lock, () => fs.rmdirSync(f.lock));
  expect(loadProject(f.configPath).tokens.build.lockPath).toBe(f.lock);
  expect(fs.existsSync(f.lock)).toBe(false);
});
it("refuses parent disappearance even when the lock leaf also vanishes", () => {
  const f = fixture();
  atRealpath(f.lock, () =>
    fs.rmSync(path.dirname(f.lock), { recursive: true }),
  );
  expect(() => loadProject(f.configPath)).toThrow(/unresolved filesystem link/);
});
it.each(["EACCES", "ENOTDIR", "ELOOP"])(
  "preserves %s resolution failures",
  (code) => {
    const f = fixture();
    atRealpath(f.lock, () => {
      throw Object.assign(new Error(code), { code });
    });
    expect(() => loadProject(f.configPath)).toThrow(
      /unresolved filesystem link/,
    );
  },
);
it("does not treat an ordinary output disappearance as cooperative", () => {
  const f = fixture();
  const output = path.join(f.root, f.config.tokens.build.outputs.stagedCss);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, "output");
  atRealpath(output, () => fs.unlinkSync(output));
  expect(() => loadProject(f.configPath)).toThrow(/unresolved filesystem link/);
});
it("keeps default resolver behavior strict even with a lock-looking label", () => {
  const f = fixture();
  atRealpath(f.lock, () => fs.rmdirSync(f.lock));
  expect(() =>
    resolveProjectPath(
      f.root,
      f.config.tokens.build.lockPath,
      "tokens.build.lockPath",
    ),
  ).toThrow(/unresolved filesystem link/);
});
it.each(["dangling", "external", "disappearing"])(
  "refuses a %s lock symlink",
  (kind) => {
    const f = fixture(),
      outside = fixture();
    fs.rmdirSync(f.lock);
    fs.symlinkSync(
      kind === "external" ? outside.root : path.join(f.root, "missing"),
      f.lock,
    );
    if (kind === "disappearing")
      atRealpath(f.lock, () => fs.unlinkSync(f.lock));
    expect(() => loadProject(f.configPath)).toThrow(
      /unresolved filesystem link|outside the project root/,
    );
  },
);
it("revalidates parent containment after a cooperative leaf disappears", () => {
  const f = fixture(),
    outside = fixture();
  const parent = path.dirname(f.lock);
  atRealpath(f.lock, () => {
    fs.rmSync(parent, { recursive: true });
    fs.symlinkSync(outside.root, parent);
  });
  expect(() => loadProject(f.configPath)).toThrow(/outside the project root/);
});
it("refuses a lock recreated as a dangling symlink after ENOENT", () => {
  const f = fixture();
  const realpath = fs.realpathSync;
  vi.spyOn(fs, "realpathSync").mockImplementation((file, ...args) => {
    if (file === f.lock) {
      fs.rmdirSync(f.lock);
      fs.symlinkSync(path.join(f.root, "missing"), f.lock);
      throw Object.assign(new Error("gone"), { code: "ENOENT" });
    }
    return realpath(file, ...args);
  });
  expect(() => loadProject(f.configPath)).toThrow(/unresolved filesystem link/);
});
it("refuses an inaccessible parent during fallback validation", () => {
  const f = fixture();
  const realpath = fs.realpathSync;
  let removed = false;
  vi.spyOn(fs, "realpathSync").mockImplementation((file, ...args) => {
    if (file === f.lock) {
      fs.rmdirSync(f.lock);
      removed = true;
    }
    if (removed && file === path.dirname(f.lock))
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    return realpath(file, ...args);
  });
  expect(() => loadProject(f.configPath)).toThrow(/unresolved filesystem link/);
});

it.each(["directory", "file"])("refuses a leaf recreated as %s", (kind) => {
  const f = fixture();
  const original = fs.realpathSync;
  vi.spyOn(fs, "realpathSync").mockImplementation((file, ...args) => {
    if (file === f.lock) {
      fs.rmdirSync(f.lock);
      if (kind === "directory") fs.mkdirSync(f.lock);
      else fs.writeFileSync(f.lock, "replacement");
      throw Object.assign(new Error("gone"), { code: "ENOENT" });
    }
    return original(file, ...args);
  });
  expect(() => loadProject(f.configPath)).toThrow(/unresolved filesystem link/);
});
it("rejects an already-external parent even when its leaf vanishes", () => {
  const f = fixture(),
    outside = fixture();
  const parent = path.dirname(f.lock);
  fs.rmSync(parent, { recursive: true });
  fs.symlinkSync(outside.root, parent);
  fs.mkdirSync(f.lock);
  atRealpath(f.lock, () => fs.rmdirSync(f.lock));
  expect(() => loadProject(f.configPath)).toThrow(/outside the project root/);
});
