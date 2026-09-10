import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { loadProject } from "../project/config.mjs";
import { buildTokenArtifacts } from "./build.mjs";
import { checkTokenArtifacts } from "./artifact-check.mjs";
import { tokenBuildFixture } from "./project-fixture.mjs";
const roots = [];
afterEach(() => {
  for (const r of roots.splice(0))
    fs.rmSync(r, { recursive: true, force: true });
});
function fixture() {
  const f = tokenBuildFixture();
  roots.push(f.root);
  return f;
}
it("writes all configured outputs, then leaves unchanged bytes and mtimes alone", async () => {
  const f = fixture(),
    project = loadProject(f.configPath);
  const first = await buildTokenArtifacts({ project });
  expect(first.artifacts).toHaveLength(4);
  expect(first.artifacts.every((a) => a.status === "written")).toBe(true);
  const before = Object.values(project.tokens.build.outputs).map(
    (p) => fs.statSync(p).mtimeMs,
  );
  const second = await buildTokenArtifacts({ project });
  expect(second.artifacts.every((a) => a.status === "unchanged")).toBe(true);
  expect(
    Object.values(project.tokens.build.outputs).map(
      (p) => fs.statSync(p).mtimeMs,
    ),
  ).toEqual(before);
  expect((await checkTokenArtifacts({ project })).ok).toBe(true);
  expect(fs.existsSync(project.tokens.build.lockPath)).toBe(false);
  expect(fs.existsSync(`${project.tokens.build.lockPath}.guard`)).toBe(false);
});
it("does not write outputs when a non-default theme is invalid", async () => {
  const f = fixture();
  f.write("design/modes/day.json", {
    $extensions: { "dev.example.design": { themeId: "daylight" } },
    brand: { ink: { $type: "color", $value: "{missing.token}" } },
  });
  await expect(
    buildTokenArtifacts({ project: loadProject(f.configPath) }),
  ).rejects.toThrow(/missing.token/);
  expect(fs.existsSync(path.join(f.root, "build"))).toBe(false);
});
it("does not write earlier outputs if a later destination is invalid", async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.root, "build/figma.json"), { recursive: true });
  await expect(
    buildTokenArtifacts({ project: loadProject(f.configPath) }),
  ).rejects.toThrow(/regular file/);
  expect(fs.existsSync(path.join(f.root, "build/source.css"))).toBe(false);
});
it("refuses an output path resolving through a file", async () => {
  const f = fixture();
  const project = loadProject(f.configPath);
  fs.writeFileSync(path.join(f.root, "build"), "not a directory");
  await expect(buildTokenArtifacts({ project })).rejects.toThrow();
  expect(fs.readFileSync(path.join(f.root, "build"), "utf8")).toBe(
    "not a directory",
  );
});
it.each(["source", "recipe", "config", "theme", "lock"])(
  "refuses %s/output overlap",
  async (which) => {
    const f = fixture();
    const b = f.config.tokens.build;
    b.outputs.figma = {
      source: "design/source/brand.tokens.json",
      recipe: "ui/recipes/notice.recipe.json",
      config: "project.json",
      theme: "design/modes/day.json",
      lock: b.lockPath,
    }[which];
    f.write("project.json", f.config);
    const before = fs.readFileSync(f.configPath);
    await expect(
      buildTokenArtifacts({ project: loadProject(f.configPath) }),
    ).rejects.toThrow(/overlap|input/i);
    expect(fs.readFileSync(f.configPath)).toEqual(before);
  },
);
it("rejects a symlink within the consumer as an output ancestor", async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.root, "actual"));
  fs.symlinkSync("actual", path.join(f.root, "build"));
  await expect(
    buildTokenArtifacts({ project: loadProject(f.configPath) }),
  ).rejects.toThrow(/symlink|symbolic/i);
  expect(fs.readdirSync(path.join(f.root, "actual"))).toEqual([]);
});
it("rejects a target replaced with a symlink after project loading", async () => {
  const f = fixture(),
    project = loadProject(f.configPath);
  fs.mkdirSync(path.join(f.root, "build"));
  fs.writeFileSync(path.join(f.root, "protected.txt"), "keep");
  fs.symlinkSync("../protected.txt", project.tokens.build.outputs.figma);
  await expect(buildTokenArtifacts({ project })).rejects.toThrow(
    /symlink|symbolic/i,
  );
  expect(fs.readFileSync(path.join(f.root, "protected.txt"), "utf8")).toBe(
    "keep",
  );
});
it("refuses nested output destinations instead of creating a partial build", async () => {
  const f = fixture();
  f.config.tokens.build.outputs.figma =
    f.config.tokens.build.outputs.stagedCss + "/child.json";
  f.write("project.json", f.config);
  await expect(
    buildTokenArtifacts({ project: loadProject(f.configPath) }),
  ).rejects.toThrow(/overlap/);
  expect(fs.existsSync(path.join(f.root, "build"))).toBe(false);
});
it("refuses a read-only output even when its parent is writable", async () => {
  const f = fixture();
  const project = loadProject(f.configPath);
  fs.mkdirSync(path.join(f.root, "build"));
  fs.writeFileSync(project.tokens.build.outputs.figma, "keep", { mode: 0o444 });
  try {
    await expect(buildTokenArtifacts({ project })).rejects.toThrow(/writ/i);
    expect(fs.readFileSync(project.tokens.build.outputs.figma, "utf8")).toBe(
      "keep",
    );
  } finally {
    fs.chmodSync(project.tokens.build.outputs.figma, 0o644);
  }
});

it("aborts when canonical input changes during rendering", async () => {
  const f = fixture(),
    project = loadProject(f.configPath),
    source = path.join(f.root, "design/source/brand.tokens.json");
  const original = fs.readFileSync;
  let reads = 0;
  const spy = vi
    .spyOn(fs, "readFileSync")
    .mockImplementation((file, ...rest) => {
      const bytes = original(file, ...rest);
      if (file === source && ++reads === 2) fs.appendFileSync(source, "\n");
      return bytes;
    });
  try {
    await expect(buildTokenArtifacts({ project })).rejects.toThrow(
      /inputs changed/,
    );
    expect(fs.existsSync(path.join(f.root, "build"))).toBe(false);
  } finally {
    spy.mockRestore();
  }
});
it("does not build with configuration that changed after loading", async () => {
  const f = fixture(),
    project = loadProject(f.configPath);
  f.config.tokens.build.banner = "Changed";
  f.write("project.json", f.config);
  await expect(buildTokenArtifacts({ project })).rejects.toThrow(
    /inputs changed/,
  );
  expect(fs.existsSync(path.join(f.root, "build"))).toBe(false);
});

it("cleans staged files without publishing any when staging fails", async () => {
  const f = fixture(),
    project = loadProject(f.configPath),
    original = fs.writeFileSync;
  const spy = vi
    .spyOn(fs, "writeFileSync")
    .mockImplementation((file, ...rest) => {
      if (typeof file === "string" && file.includes(".theme.css.ds-"))
        throw Object.assign(new Error("injected staging failure"), {
          code: "EIO",
        });
      return original(file, ...rest);
    });
  try {
    await expect(buildTokenArtifacts({ project })).rejects.toThrow(
      /staging failure/,
    );
  } finally {
    spy.mockRestore();
  }
  for (const file of Object.values(project.tokens.build.outputs))
    expect(fs.existsSync(file)).toBe(false);
  expect(fs.readdirSync(path.join(f.root, "build"))).toEqual([]);
  expect(fs.existsSync(project.tokens.build.lockPath)).toBe(false);
});
it("reports a partial rename failure and an explicit retry repairs it", async () => {
  const f = fixture(),
    project = loadProject(f.configPath),
    original = fs.renameSync;
  const spy = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (to === project.tokens.build.outputs.runtimeCss)
      throw Object.assign(new Error("injected rename failure"), {
        code: "EIO",
      });
    return original(from, to);
  });
  try {
    await expect(buildTokenArtifacts({ project })).rejects.toThrow(
      /rename failure/,
    );
  } finally {
    spy.mockRestore();
  }
  expect(fs.existsSync(project.tokens.build.outputs.stagedCss)).toBe(true);
  expect(fs.existsSync(project.tokens.build.outputs.runtimeCss)).toBe(false);
  expect(fs.readdirSync(path.join(f.root, "build"))).toEqual(["source.css"]);
  expect(fs.existsSync(project.tokens.build.lockPath)).toBe(false);
  await buildTokenArtifacts({ project });
  expect((await checkTokenArtifacts({ project })).ok).toBe(true);
});
it("preserves restrictive permissions when replacing an existing artifact", async () => {
  const f = fixture(),
    project = loadProject(f.configPath);
  await buildTokenArtifacts({ project });
  const file = project.tokens.build.outputs.runtimeCss;
  fs.chmodSync(file, 0o600);
  fs.appendFileSync(file, "/* stale */");
  await buildTokenArtifacts({ project });
  expect(fs.statSync(file).mode & 0o777).toBe(0o600);
});
