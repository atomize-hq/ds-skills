import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { runCli } from "../cli/run.js";
import { installedFixture } from "./fixture.mjs";
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const f = installedFixture();
  roots.push(f.root);
  return f;
}
async function run(f, command = "verify", extra = []) {
  let out = "",
    err = "";
  const code = await runCli({
    argv: [
      "release",
      command,
      "--record",
      f.recordPath,
      "--prefix",
      f.prefix,
      "--json",
      ...extra,
    ],
    version: "test",
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
  });
  return { code, out, err };
}
it("reports a verified release without running its fake executable", async () => {
  const f = fixture();
  const result = await run(f);
  expect(result.code).toBe(0);
  expect(result.err).toBe("");
  expect(JSON.parse(result.out)).toMatchObject({
    resultVersion: "1",
    command: "release verify",
    ok: true,
    sourceCommit: f.record.sourceCommit,
  });
});
it("installation is a no-op for already verified identical content", async () => {
  const f = fixture();
  const result = await run(f, "install");
  expect(result.code).toBe(0);
  expect(JSON.parse(result.out).acquired).toBe(false);
});
it("emits evaluated corruption as exit 1", async () => {
  const f = fixture();
  fs.appendFileSync(path.join(f.home, "lib/dist/module.js"), "changed");
  const result = await run(f);
  expect(result.code).toBe(1);
  expect(result.err).toBe("");
  expect(JSON.parse(result.out).diagnostics[0].code).toBe(
    "RELEASE_CONTENT_DIGEST",
  );
});
it("cannot evaluate a missing install and never emits an empty passing result", async () => {
  const f = fixture();
  fs.rmSync(f.home, { recursive: true });
  const result = await run(f);
  expect(result).toMatchObject({ code: 2, out: "" });
  expect(result.err).toContain("RELEASE_NOT_INSTALLED");
});
it("cannot evaluate poisoned record paths", async () => {
  const f = fixture();
  f.record.release = "../../outside";
  fs.writeFileSync(f.recordPath, JSON.stringify(f.record));
  const result = await run(f);
  expect(result).toMatchObject({ code: 2, out: "" });
  expect(result.err).toContain("RELEASE_RECORD_INVALID");
});
it.each([
  ["--force"],
  ["--prefix", ""],
  ["extra"],
  ["--mirror", "https://example.test"],
])("verify rejects unsupported/empty arguments: %j", async (args) => {
  const f = fixture();
  expect(await run(f, "verify", args)).toMatchObject({ code: 2, out: "" });
});
it("refuses a bad bootstrap before replacing a damaged existing install", async () => {
  const f = fixture();
  fs.appendFileSync(path.join(f.home, "lib/dist/module.js"), "damaged");
  // Invalid transport is refused before network access or bootstrap execution.
  const result = await run(f, "install", ["--mirror", "file:///not-a-release"]);
  expect(result).toMatchObject({ code: 2, out: "" });
  expect(
    fs.readFileSync(path.join(f.home, "lib/dist/module.js"), "utf8"),
  ).toContain("damaged");
});
