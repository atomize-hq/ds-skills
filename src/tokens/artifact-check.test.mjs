import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { runCli } from "../cli/run.js";
import { loadProject } from "../project/config.mjs";
import { renderTokenArtifacts } from "./render.mjs";
import { tokenBuildFixture } from "./project-fixture.mjs";
const roots = [];
afterEach(() => {
  for (const r of roots.splice(0))
    fs.rmSync(r, { recursive: true, force: true });
});
async function fixture() {
  const f = tokenBuildFixture();
  roots.push(f.root);
  const project = loadProject(f.configPath);
  const { contents } = await renderTokenArtifacts({ project });
  for (const [id, bytes] of Object.entries(contents)) {
    const file = project.tokens.build.outputs[id];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
  return { ...f, project };
}
async function run(f, args = []) {
  let out = "",
    err = "";
  const code = await runCli({
    argv: [
      "tokens",
      "artifacts",
      "check",
      "--config",
      f.configPath,
      "--json",
      ...args,
    ],
    version: "test",
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
  });
  return { code, out, err };
}
it("evaluates all four artifacts and writes no lock or outputs", async () => {
  const f = await fixture();
  const before = Object.values(f.project.tokens.build.outputs).map(
    (p) => fs.statSync(p).mtimeMs,
  );
  const r = await run(f);
  expect(r.code).toBe(0);
  expect(r.err).toBe("");
  expect(JSON.parse(r.out)).toMatchObject({
    resultVersion: "1",
    command: "tokens artifacts check",
    ok: true,
  });
  expect(JSON.parse(r.out).artifacts).toHaveLength(4);
  expect(
    Object.values(f.project.tokens.build.outputs).map(
      (p) => fs.statSync(p).mtimeMs,
    ),
  ).toEqual(before);
  expect(fs.existsSync(f.project.tokens.build.lockPath)).toBe(false);
});
it.each(["stagedCss", "runtimeCss", "typescript", "figma"])(
  "detects stale %s without repairing it",
  async (id) => {
    const f = await fixture();
    const file = f.project.tokens.build.outputs[id];
    fs.appendFileSync(file, "// changed\n");
    const before = fs.readFileSync(file);
    const r = await run(f);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "GENERATED_ARTIFACT_STALE",
        artifactId: id,
      }),
    );
    expect(fs.readFileSync(file)).toEqual(before);
  },
);
it("reports a missing artifact as invalid, not an empty pass", async () => {
  const f = await fixture();
  fs.rmSync(f.project.tokens.build.outputs.figma);
  const r = await run(f);
  expect(r.code).toBe(1);
  expect(JSON.parse(r.out).diagnostics[0].code).toBe(
    "GENERATED_ARTIFACT_MISSING",
  );
});
it("reports wrong output file type as cannot-evaluate with no stdout", async () => {
  const f = await fixture();
  fs.rmSync(f.project.tokens.build.outputs.figma);
  fs.mkdirSync(f.project.tokens.build.outputs.figma);
  const r = await run(f);
  expect(r.code).toBe(2);
  expect(r.out).toBe("");
  expect(r.err).toContain("TOKEN_ARTIFACT_INPUT");
});
it("cannot evaluate an unconfigured build", async () => {
  const f = await fixture();
  delete f.config.tokens.build;
  f.write("project.json", f.config);
  const r = await run(f);
  expect(r.code).toBe(2);
  expect(r.out).toBe("");
  expect(r.err).toContain("TOKEN_BUILD_NOT_CONFIGURED");
});
it("rejects unsupported flags instead of ignoring them", async () => {
  const f = await fixture();
  const r = await run(f, ["--repair"]);
  expect(r.code).toBe(2);
  expect(r.out).toBe("");
  expect(r.err).toContain("TOKEN_ARGUMENT");
});
it("returns evaluated invalid for unbuildable token source", async () => {
  const f = await fixture();
  f.write("design/source/brand.tokens.json", {
    ink: { $type: "color", $value: "{missing.id}" },
  });
  const r = await run(f);
  expect(r.code).toBe(1);
  expect(JSON.parse(r.out).diagnostics[0].code).toBe("TOKEN_REFERENCE");
});
