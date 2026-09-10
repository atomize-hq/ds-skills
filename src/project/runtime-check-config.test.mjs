import fs from "node:fs";
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
  f.config.tokens.runtimeChecks = {
    compatibilitySurface: "design/surface.json",
    imports: {
      format: "css-import-v1",
      entries: [{ file: "app/global.css", specifier: "../ui/theme.css" }],
    },
  };
  return f;
}
it.each([
  [
    "no selection",
    (c) =>
      (c.tokens.runtimeChecks = { compatibilitySurface: null, imports: null }),
  ],
  ["unknown field", (c) => (c.tokens.runtimeChecks.extra = true)],
  ["missing explicit null", (c) => delete c.tokens.runtimeChecks.imports],
  ["no build", (c) => (c.tokens.build = null)],
  [
    "outside surface",
    (c) => (c.tokens.runtimeChecks.compatibilitySurface = "../outside.json"),
  ],
  [
    "unknown import format",
    (c) => (c.tokens.runtimeChecks.imports.format = "execute"),
  ],
  ["empty imports", (c) => (c.tokens.runtimeChecks.imports.entries = [])],
  [
    "duplicate import",
    (c) =>
      c.tokens.runtimeChecks.imports.entries.push(
        c.tokens.runtimeChecks.imports.entries[0],
      ),
  ],
  [
    "wrong target",
    (c) =>
      (c.tokens.runtimeChecks.imports.entries[0].specifier = "./other.css"),
  ],
  [
    "bare package",
    (c) =>
      (c.tokens.runtimeChecks.imports.entries[0].specifier =
        "package/theme.css"),
  ],
  [
    "self import",
    (c) =>
      (c.tokens.runtimeChecks.imports.entries[0] = {
        file: "ui/theme.css",
        specifier: "./theme.css",
      }),
  ],
  [
    "escaped path",
    (c) =>
      (c.tokens.runtimeChecks.imports.entries[0].specifier =
        "../ui/th\\eme.css"),
  ],
  [
    "outside importer",
    (c) => (c.tokens.runtimeChecks.imports.entries[0].file = "../outside.css"),
  ],
  [
    "executable config",
    (c) =>
      (c.tokens.runtimeChecks.imports.entries[0].command = "cat theme.css"),
  ],
])("rejects runtime obligation configuration: %s", (_name, mutate) => {
  const f = fixture();
  mutate(f.config);
  f.write("project.json", f.config);
  expect(() => loadProject(f.configPath)).toThrow();
});
it.each([null, undefined])(
  "omitted/null runtime obligations are not implicitly enabled: %s",
  (value) => {
    const f = fixture();
    f.config.tokens.runtimeChecks = value;
    f.write("project.json", f.config);
    expect(loadProject(f.configPath).tokens.runtimeChecks).toBeNull();
  },
);
