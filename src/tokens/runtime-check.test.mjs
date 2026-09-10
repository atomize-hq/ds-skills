import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadProject } from "../project/config.mjs";
import { runCli } from "../cli/run.js";
import { buildTokenArtifacts } from "./build.mjs";
import { tokenBuildFixture } from "./project-fixture.mjs";
import { checkTokenRuntime } from "./runtime-check.mjs";
import {
  declaredRuntimeProperties,
  readCssImports,
} from "./css-obligations.mjs";
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const f = tokenBuildFixture();
  roots.push(f.root);
  f.config.tokens.runtimeChecks = {
    compatibilitySurface: "design/runtime-surface.json",
    imports: {
      format: "css-import-v1",
      entries: [{ file: "app/global.css", specifier: "../ui/theme.css" }],
    },
  };
  f.surface = {
    surfaceVersion: "1",
    runtimeCssPath: "ui/theme.css",
    requiredCustomProperties: ["--brand-ink", "--private-gap"],
  };
  f.write("design/runtime-surface.json", f.surface);
  f.write("project.json", f.config);
  fs.mkdirSync(path.join(f.root, "app"));
  fs.writeFileSync(
    path.join(f.root, "app/global.css"),
    '@import "../ui/theme.css";\n',
  );
  fs.writeFileSync(
    path.join(f.root, "ui/theme.css"),
    ":root {\n  --brand-ink: #102030;\n  --private-gap: 8px;\n}\n",
  );
  return f;
}
function check(f) {
  return checkTokenRuntime({ project: loadProject(f.configPath) });
}
async function run(f, extra = []) {
  let out = "",
    err = "";
  const code = await runCli({
    argv: [
      "tokens",
      "runtime",
      "check",
      "--config",
      "project.json",
      "--root",
      f.root,
      "--json",
      ...extra,
    ],
    version: "test",
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
  });
  return { code, out, err };
}
it("checks consumer-defined variables and the actual stable import without writing", async () => {
  const f = fixture();
  const files = [
    "project.json",
    "app/global.css",
    "ui/theme.css",
    "design/runtime-surface.json",
  ];
  const snapshot = () =>
    files.map((file) => [
      fs.readFileSync(path.join(f.root, file)),
      fs.statSync(path.join(f.root, file)).mtimeMs,
    ]);
  const before = snapshot();
  expect(check(f)).toMatchObject({
    ok: true,
    obligations: [
      { kind: "custom-property", property: "--brand-ink", present: true },
      { kind: "custom-property", property: "--private-gap", present: true },
      { kind: "css-import", path: "app/global.css", present: true },
    ],
    diagnostics: [],
  });
  const result = await run(f);
  expect(result.code).toBe(0);
  expect(result.err).toBe("");
  expect(JSON.parse(result.out)).toMatchObject({
    resultVersion: "1",
    command: "tokens runtime check",
    ok: true,
  });
  expect(snapshot()).toEqual(before);
  expect(fs.existsSync(path.join(f.root, ".cache"))).toBe(false);
});
it("does not claim build freshness from presence checks", async () => {
  const f = fixture();
  fs.appendFileSync(
    path.join(f.root, "ui/theme.css"),
    "/* stale but obligation-conformant */\n",
  );
  expect(check(f).ok).toBe(true);
});
it("reports exactly the missing property and import as evaluated failure", async () => {
  const f = fixture();
  fs.writeFileSync(
    path.join(f.root, "ui/theme.css"),
    ":root {\n  --brand-ink: red;\n}\n",
  );
  fs.writeFileSync(
    path.join(f.root, "app/global.css"),
    '/* @import "../ui/theme.css"; */\n',
  );
  const result = await run(f);
  expect(result.code).toBe(1);
  expect(result.err).toBe("");
  expect(JSON.parse(result.out).diagnostics).toEqual([
    expect.objectContaining({
      code: "RUNTIME_CSS_COMPATIBILITY_MISSING",
      property: "--private-gap",
      path: "ui/theme.css",
    }),
    expect.objectContaining({
      code: "RUNTIME_CSS_IMPORT_MISSING",
      path: "app/global.css",
    }),
  ]);
});
it.each(["ui/theme.css", "app/global.css", "design/runtime-surface.json"])(
  "cannot evaluate a selected missing file: %s",
  async (file) => {
    const f = fixture();
    fs.unlinkSync(path.join(f.root, file));
    const result = await run(f);
    expect(result.code).toBe(2);
    expect(result.out).toBe("");
    expect(result.err).toContain("TOKEN_RUNTIME_INPUT");
  },
);
it("cannot evaluate a directory in place of a required file", async () => {
  const f = fixture();
  fs.unlinkSync(path.join(f.root, "ui/theme.css"));
  fs.mkdirSync(path.join(f.root, "ui/theme.css"));
  expect(await run(f)).toMatchObject({ code: 2, out: "" });
});
it.each([
  "unknown",
  "version",
  "empty",
  "duplicate",
  "invalid",
  "wrong-binding",
  "malformed",
])("rejects invalid surface data: %s", async (which) => {
  const f = fixture();
  if (which === "unknown") f.surface.extra = true;
  if (which === "version") f.surface.surfaceVersion = "2";
  if (which === "empty") f.surface.requiredCustomProperties = [];
  if (which === "duplicate")
    f.surface.requiredCustomProperties.push("--brand-ink");
  if (which === "invalid") f.surface.requiredCustomProperties = ["color"];
  if (which === "wrong-binding") f.surface.runtimeCssPath = "other.css";
  f.write("design/runtime-surface.json", f.surface);
  if (which === "malformed")
    fs.writeFileSync(path.join(f.root, "design/runtime-surface.json"), "{");
  const result = await run(f);
  expect(result.code).toBe(2);
  expect(result.out).toBe("");
  expect(result.err).toContain("PROJECT_CONFIG");
});
it.each(["--force", "extra"])(
  "rejects unsupported command arguments: %s",
  async (flag) => {
    const f = fixture();
    expect(await run(f, [flag])).toMatchObject({ code: 2, out: "" });
  },
);
it("does not count commented/string content or references as declarations", () => {
  expect([
    ...declaredRuntimeProperties(
      ':root {\n/*\n --fake: red;\n*/\n --real: var(--reference);\n --string: "\\\n --inside-string: red;";\n}\n--outside: 1;\n',
    ),
  ]).toEqual(["--real", "--string"]);
});
it("accepts single/double quoted imports and comments but not nested, conditional or quoted text", () => {
  const css =
    '/* @import "fake"; */\n@import /* allowed */ "one";\n@import \'two\';\n@import url("three");\n@import "four" screen;\n@media screen {\n@import "five";\n}\na { content: "@import \'six\';"; }';
  expect(readCssImports(css)).toEqual(["one", "two"]);
});
it.each(["compatibilitySurface", "imports"])(
  "evaluates only the explicitly selected obligation: %s",
  (which) => {
    const f = fixture();
    f.config.tokens.runtimeChecks[which] = null;
    f.write("project.json", f.config);
    const result = check(f);
    expect(result.ok).toBe(true);
    expect(result.obligations).toHaveLength(which === "imports" ? 2 : 1);
  },
);
it.each(["design/runtime-surface.json", "app/global.css"])(
  "build cannot overwrite runtime check input: %s",
  async (file) => {
    const f = fixture();
    f.config.tokens.build.outputs.figma = file;
    f.write("project.json", f.config);
    const before = fs.readFileSync(path.join(f.root, file));
    await expect(
      buildTokenArtifacts({ project: loadProject(f.configPath) }),
    ).rejects.toThrow(/protected input/);
    expect(fs.readFileSync(path.join(f.root, file))).toEqual(before);
    expect(fs.existsSync(path.join(f.root, ".cache"))).toBe(false);
  },
);
