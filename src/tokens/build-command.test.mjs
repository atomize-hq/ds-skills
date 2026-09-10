import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { runCli } from "../cli/run.js";
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
async function run(f, extra = []) {
  let out = "",
    err = "";
  const code = await runCli({
    argv: [
      "tokens",
      "build",
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
it("builds from explicit project context and reports versioned artifact statuses", async () => {
  const f = fixture();
  const r = await run(f);
  expect(r.code).toBe(0);
  expect(r.err).toBe("");
  expect(JSON.parse(r.out)).toMatchObject({
    resultVersion: "1",
    command: "tokens build",
    ok: true,
  });
  expect(JSON.parse(r.out).artifacts).toHaveLength(4);
  const second = await run(f);
  expect(
    JSON.parse(second.out).artifacts.every((a) => a.status === "unchanged"),
  ).toBe(true);
});
it("returns evaluated invalid for broken source references", async () => {
  const f = fixture();
  f.write("design/source/brand.tokens.json", {
    ink: { $type: "color", $value: "{missing.id}" },
  });
  const r = await run(f);
  expect(r.code).toBe(1);
  expect(JSON.parse(r.out).diagnostics[0].code).toBe("TOKEN_REFERENCE");
  expect(fs.existsSync(path.join(f.root, "build"))).toBe(false);
});
it("returns cannot-evaluate with no stdout for an unwritable output shape", async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.root, "build/figma.json"), { recursive: true });
  const r = await run(f);
  expect(r.code).toBe(2);
  expect(r.out).toBe("");
  expect(r.err).toContain("TOKEN_ARTIFACT_WRITE");
});
it("fails closed when the build is not configured", async () => {
  const f = fixture();
  delete f.config.tokens.build;
  f.write("project.json", f.config);
  const r = await run(f);
  expect(r.code).toBe(2);
  expect(r.out).toBe("");
  expect(r.err).toContain("TOKEN_BUILD_NOT_CONFIGURED");
});
it("does not ignore an unsupported dangerous flag", async () => {
  const f = fixture();
  const r = await run(f, ["--force"]);
  expect(r.code).toBe(2);
  expect(r.out).toBe("");
  expect(r.err).toContain("TOKEN_ARGUMENT");
  expect(fs.existsSync(path.join(f.root, "build"))).toBe(false);
});
