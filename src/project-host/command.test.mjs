import fs from "node:fs";
import { afterEach, expect, it } from "vitest";
import { runCli } from "../cli/run.js";
import { projectFixture } from "./fixture.mjs";
const roots = [];
function fixture() {
  const f = projectFixture();
  roots.push(f.root);
  return f;
}
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
async function run(argv) {
  let out = "",
    err = "";
  const code = await runCli({
    argv,
    version: "test",
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
  });
  return { code, out, err };
}
it("returns missing output nonconformance, explicit setup, and clean read-only check", async () => {
  const f = fixture(),
    flags = ["--root", f.project, "--prefix", f.prefix, "--json"];
  const missing = await run(["project", "check", ...flags]);
  expect(missing.code).toBe(1);
  expect(JSON.parse(missing.out)).toMatchObject({
    resultVersion: "1",
    command: "project check",
    ok: false,
  });
  const setup = await run(["project", "setup", ...flags]);
  expect(setup.code, setup.err).toBe(0);
  expect(JSON.parse(setup.out)).toMatchObject({
    command: "project setup",
    ok: true,
  });
  const check = await run(["project", "check", ...flags]);
  expect(check.code).toBe(0);
});
it.each([
  [],
  ["--root"],
  ["--root", ""],
  ["--root", "missing"],
  ["--root", "x", "--unexpected"],
])("rejects invalid arguments %j without stdout", async (first, ...rest) => {
  const result = await run([
    "project",
    "setup",
    ...(first === undefined ? [] : [first, ...rest]),
    "--json",
  ]);
  expect(result.code, result.err).toBe(2);
  expect(result.out).toBe("");
});
it("cannot evaluate a missing release or malformed reviewed pin without emitting a result", async () => {
  const f = fixture();
  for (const mutate of [
    () => fs.rmSync(f.home, { recursive: true }),
    () => fs.writeFileSync(f.pin, "bad"),
  ]) {
    mutate();
    const result = await run([
      "project",
      "check",
      "--root",
      f.project,
      "--prefix",
      f.prefix,
      "--json",
    ]);
    expect(result.code).toBe(2);
    expect(result.out).toBe("");
  }
});
