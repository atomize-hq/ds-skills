import fs from "node:fs";
import { afterEach, expect, it } from "vitest";
import { runCli } from "../cli/run.js";
import { tokenProjectFixture } from "./project-fixture.mjs";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const f = tokenProjectFixture();
  roots.push(f.root);
  return f;
}
async function run(args: string[]) {
  let out = "",
    err = "";
  const code = await runCli({
    argv: ["tokens", "validate", ...args],
    version: "test",
    stdout: {
      write: (s) => {
        out += s;
      },
    },
    stderr: {
      write: (s) => {
        err += s;
      },
    },
  });
  return { code, out, err };
}
it("validates every configured theme and returns a versioned report", async () => {
  const f = fixture();
  const r = await run(["--config", f.configPath, "--json"]);
  expect(r.code).toBe(0);
  expect(r.err).toBe("");
  expect(JSON.parse(r.out)).toMatchObject({
    resultVersion: "1",
    ok: true,
    themes: [
      { themeId: "midnight", tokenCount: 3, recipeCount: 1 },
      { themeId: "daylight", tokenCount: 3, recipeCount: 1 },
    ],
  });
});
it("rejects a bad non-default theme even when the default is valid", async () => {
  const f = fixture();
  f.write("design/modes/day.json", {
    $extensions: { "dev.example.design": { themeId: "wrong" } },
  });
  const r = await run(["--config", f.configPath, "--json"]);
  expect(r.code).toBe(1);
  expect(JSON.parse(r.out).diagnostics[0].code).toBe("TOKEN_THEME");
});
it("does not silently enable absent capabilities", async () => {
  const f = fixture();
  f.write("project.json", { projectVersion: "1", tokens: null });
  const r = await run(["--config", f.configPath, "--json"]);
  expect(r.code).toBe(2);
  expect(r.out).toBe("");
  expect(r.err).toContain("TOKENS_NOT_CONFIGURED");
});
it("fails closed for unknown flags with otherwise valid config", async () => {
  const f = fixture();
  const r = await run([
    "--config",
    f.configPath,
    "--ignore-invalid",
    "yes",
    "--json",
  ]);
  expect(r.code).toBe(2);
  expect(r.out).toBe("");
  expect(r.err).toContain("TOKEN_ARGUMENT");
});
