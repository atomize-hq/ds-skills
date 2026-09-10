import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadProject } from "./config.mjs";
import { tokenProjectFixture } from "../tokens/project-fixture.mjs";
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const f = tokenProjectFixture();
  roots.push(f.root);
  return f;
}
it("resolves project data from the config's directory, not the package", () => {
  const f = fixture();
  const project = loadProject(f.configPath);
  expect(project.rootDir).toBe(f.root);
  expect(project.tokens.sourceDir).toBe(path.join(f.root, "design/source"));
});
it("allows an explicit consumer root with a nested config file", () => {
  const f = fixture();
  f.write("configuration/project.json", f.config);
  expect(
    loadProject("configuration/project.json", { rootDir: f.root }).tokens
      .sourceDir,
  ).toBe(path.join(f.root, "design/source"));
});
it("represents deliberately unconfigured tokens distinctly", () => {
  const f = fixture();
  f.write("project.json", { projectVersion: "1", tokens: null });
  expect(loadProject(f.configPath).tokens).toBeNull();
});
it.each([
  [
    "unknown root key",
    (f) => {
      f.config.typo = true;
    },
  ],
  [
    "missing capability",
    (f) => {
      delete f.config.tokens;
    },
  ],
  [
    "unknown format",
    (f) => {
      f.config.tokens.format = "anything";
    },
  ],
  [
    "unknown token option",
    (f) => {
      f.config.tokens.bypass = true;
    },
  ],
  [
    "escaping source",
    (f) => {
      f.config.tokens.sourceDir = "../outside";
    },
  ],
  [
    "absolute source",
    (f) => {
      f.config.tokens.sourceDir = f.root;
    },
  ],
  [
    "omitted recipes option",
    (f) => {
      delete f.config.tokens.recipesDir;
    },
  ],
  [
    "invalid namespace",
    (f) => {
      f.config.tokens.extensionsNamespace = "";
    },
  ],
  [
    "duplicate exclusion",
    (f) => {
      f.config.tokens.figma.excludedFamilies = ["private", "private"];
    },
  ],
])("refuses %s", (_name, mutate) => {
  const f = fixture();
  mutate(f);
  f.write("project.json", f.config);
  expect(() => loadProject(f.configPath)).toThrow();
});
it("refuses a source symlink escaping the declared root", () => {
  const f = fixture(),
    outside = fixture();
  fs.symlinkSync(outside.root, path.join(f.root, "external"));
  f.config.tokens.sourceDir = "external";
  f.write("project.json", f.config);
  expect(() => loadProject(f.configPath)).toThrow(/outside the project root/);
});
