import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { loadProject } from "../project/config.mjs";
import { runCli } from "../cli/run.js";
import { checkTokenManualEdits } from "./manual-guard.mjs";
import { tokenBuildFixture } from "./project-fixture.mjs";
const roots = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function git(f, ...args) {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd: f.root, stdio: "pipe", encoding: "utf8" },
  );
}
function fixture({
  repository = true,
  runtime = "ui/theme.css",
  nested = false,
} = {}) {
  const f = tokenBuildFixture();
  roots.push(f.root);
  f.config.tokens.build.outputs.runtimeCss = runtime;
  f.config.tokens.manualEditGuard = {
    policy: "git-input-dirty-v1",
    generatorInputs: ["product-pin.json"],
  };
  f.write("product-pin.json", { release: "v1.0.0", digest: "fixture" });
  f.write("project.json", f.config);
  fs.writeFileSync(path.join(f.root, runtime), "generated CSS\n");
  f.write("unrelated.json", {});
  if (nested) {
    const parent = fs.mkdtempSync(
      path.join(path.dirname(f.root), "guard-parent-"),
    );
    roots.push(parent);
    fs.renameSync(f.root, path.join(parent, "consumer"));
    f.root = path.join(parent, "consumer");
    f.configPath = path.join(f.root, "project.json");
    git({ root: parent }, "init", "--quiet");
  } else if (repository) git(f, "init", "--quiet");
  if (repository) {
    git(f, "add", ".");
    git(f, "commit", "--quiet", "-m", "fixture");
  }
  return f;
}
function change(f, file) {
  fs.appendFileSync(path.join(f.root, file), "\n");
}
function check(f) {
  return checkTokenManualEdits({ project: loadProject(f.configPath) });
}
async function run(f, extra = []) {
  let out = "",
    err = "";
  const code = await runCli({
    argv: [
      "tokens",
      "guard",
      "--root",
      f.root,
      "--config",
      "project.json",
      "--json",
      ...extra,
    ],
    version: "test",
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
  });
  return { code, out, err };
}
it.each([
  ["clean", [], true],
  ["runtime only", ["ui/theme.css"], false],
  ["source only", ["design/source/brand.tokens.json"], true],
  [
    "runtime and source",
    ["ui/theme.css", "design/source/brand.tokens.json"],
    true,
  ],
  ["runtime and pin", ["ui/theme.css", "product-pin.json"], true],
  ["runtime and config", ["ui/theme.css", "project.json"], true],
  ["runtime and theme", ["ui/theme.css", "design/modes/day.json"], true],
  [
    "unrelated dirt cannot excuse runtime",
    ["ui/theme.css", "unrelated.json"],
    false,
  ],
])("preserves the explicit input-dirty policy: %s", (_label, files, ok) => {
  const f = fixture();
  for (const file of files) change(f, file);
  const before = git(f, "status", "--porcelain=v1", "-z");
  const result = check(f);
  expect(result.ok).toBe(ok);
  expect(result.policy).toBe("git-input-dirty-v1");
  expect(git(f, "status", "--porcelain=v1", "-z")).toBe(before);
  if (!ok) expect(result.diagnostics[0].code).toBe("RUNTIME_CSS_MANUAL_EDIT");
});
it("reports staged runtime edits rather than just working-tree changes", () => {
  const f = fixture();
  change(f, "ui/theme.css");
  git(f, "add", "ui/theme.css");
  expect(check(f).ok).toBe(false);
});
it("detects a runtime file renamed away from its old path", () => {
  const f = fixture();
  git(f, "mv", "ui/theme.css", "ui/renamed.css");
  expect(check(f).state.runtimeCssDirty).toBe(true);
  expect(check(f).ok).toBe(false);
});
it.each(["ui/theme[1].css", 'ui/theme "quote".css', "ui/theme\nnewline.css"])(
  "uses literal NUL-delimited Git queries for %s",
  (runtime) => {
    const f = fixture({ runtime });
    change(f, runtime);
    expect(check(f).ok).toBe(false);
  },
);
it("supports a project below the Git root without interpreting Git output paths", () => {
  const f = fixture({ nested: true });
  change(f, "ui/theme.css");
  expect(check(f).ok).toBe(false);
});
it("does not accept ignored untracked output as clean", async () => {
  const f = fixture();
  git(f, "rm", "--cached", "ui/theme.css");
  fs.writeFileSync(path.join(f.root, ".gitignore"), "ui/theme.css\n");
  git(f, "add", ".gitignore");
  git(f, "commit", "--quiet", "-m", "ignore output");
  const result = await run(f);
  expect(result).toMatchObject({ code: 2, out: "" });
  expect(result.err).toContain("ignored and untracked");
});
it("still checks tracked output matched by a later ignore rule", () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.root, ".gitignore"), "ui/theme.css\n");
  change(f, "ui/theme.css");
  expect(check(f).ok).toBe(false);
});
it("checks ordinary untracked output as dirty", () => {
  const f = fixture();
  git(f, "rm", "--cached", "ui/theme.css");
  git(f, "commit", "--quiet", "-m", "untrack output");
  expect(check(f).state.runtimeCssDirty).toBe(true);
});
it("does not let ambient GIT_DIR redirect the chosen project", () => {
  const f = fixture();
  change(f, "ui/theme.css");
  vi.stubEnv("GIT_DIR", "/absent-repository");
  expect(check(f).ok).toBe(false);
});
it("returns cannot-evaluate rather than success outside Git", async () => {
  const f = fixture({ repository: false });
  const result = await run(f);
  expect(result).toMatchObject({ code: 2, out: "" });
  expect(result.err).toContain("TOKEN_MANUAL_GUARD_GIT");
});
it("distinguishes a completed failure from configuration/argument failure", async () => {
  const f = fixture();
  change(f, "ui/theme.css");
  const failed = await run(f);
  expect(failed.code).toBe(1);
  expect(failed.err).toBe("");
  expect(JSON.parse(failed.out)).toMatchObject({
    resultVersion: "1",
    command: "tokens guard",
    ok: false,
  });
  expect(await run(f, ["--force"])).toMatchObject({ code: 2, out: "" });
  f.config.tokens.manualEditGuard = null;
  fs.writeFileSync(f.configPath, JSON.stringify(f.config));
  const disabled = await run(f);
  expect(disabled).toMatchObject({ code: 2, out: "" });
  expect(disabled.err).toContain("NOT_CONFIGURED");
});
it.each([
  { policy: "noop", generatorInputs: ["product-pin.json"] },
  { policy: "git-input-dirty-v1", generatorInputs: ["ui"] },
  { policy: "git-input-dirty-v1", generatorInputs: [] },
  { policy: "git-input-dirty-v1", generatorInputs: ["ui/theme.css"] },
  { policy: "git-input-dirty-v1", generatorInputs: ["../outside"] },
  { policy: "git-input-dirty-v1", generatorInputs: ["."] },
  {
    policy: "git-input-dirty-v1",
    generatorInputs: ["product-pin.json", "product-pin.json"],
  },
])("rejects unsupported or self-excusing guard config: %j", (config) => {
  const f = fixture();
  f.config.tokens.manualEditGuard = config;
  fs.writeFileSync(f.configPath, JSON.stringify(f.config));
  expect(() => loadProject(f.configPath)).toThrow();
});
