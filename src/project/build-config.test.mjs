import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadProject } from "./config.mjs";
import { tokenBuildFixture } from "../tokens/project-fixture.mjs";
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const f = tokenBuildFixture();
  roots.push(f.root);
  return f;
}
it.each([
  ["unsupported compiler", (b) => (b.compiler = "arbitrary")],
  ["executable format plugin", (b) => (b.formatting.plugins = ["malicious"])],
  ["missing formatting", (b) => delete b.formatting.printWidth],
  ["unsafe comment", (b) => (b.banner = "*/ :root {color:red}")],
  [
    "unsafe selector",
    (b) => (b.runtime.themeAttribute = "data-x] { color:red }"),
  ],
  ["missing compatibility selection", (b) => delete b.runtime.compatibility],
  ["unknown theme policy", (b) => (b.runtime.identicalThemes = "ignore")],
  ["escaping output", (b) => (b.outputs.runtimeCss = "../outside.css")],
  ["duplicate output", (b) => (b.outputs.figma = b.outputs.runtimeCss)],
  ["missing output", (b) => delete b.outputs.figma],
  ["invalid lock path", (b) => (b.lockPath = "/tmp/external.lock")],
])("rejects %s", (_name, mutate) => {
  const f = fixture();
  mutate(f.config.tokens.build);
  f.write("project.json", f.config);
  expect(() => loadProject(f.configPath)).toThrow();
});
it("rejects a nonexistent child of a symlinked outside directory", () => {
  const f = fixture(),
    outside = fixture();
  fs.symlinkSync(outside.root, path.join(f.root, "external"));
  f.config.tokens.build.outputs.figma = "external/does/not/exist.json";
  f.write("project.json", f.config);
  expect(() => loadProject(f.configPath)).toThrow(/outside the project root/);
});
it("rejects a dangling symlink instead of treating it as an absent target", () => {
  const f = fixture();
  fs.symlinkSync(path.join(f.root, "absent"), path.join(f.root, "dangling"));
  f.config.tokens.build.outputs.figma = "dangling";
  f.write("project.json", f.config);
  expect(() => loadProject(f.configPath)).toThrow(/unresolved/);
});
