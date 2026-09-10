import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { runCli } from "../cli/run.js";
import { chromaticProjectFixture, exampleSha } from "./fixture.mjs";
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture(options) {
  const f = chromaticProjectFixture(options);
  roots.push(f.root);
  return f;
}
async function run(f, args = ["--sha", exampleSha]) {
  let out = "",
    err = "";
  const code = await runCli({
    argv: [
      "chromatic",
      "status",
      "validate",
      "--root",
      f.root,
      "--config",
      "project.json",
      "--json",
      ...args,
    ],
    version: "test",
    stdout: {
      write: (v) => {
        out += v;
      },
    },
    stderr: {
      write: (v) => {
        err += v;
      },
    },
  });
  return { code, out, err };
}
it("returns a scope-labelled result without writes", async () => {
  const f = fixture();
  const before = fs.statSync(path.join(f.root, "review/status.json")).mtimeMs;
  const r = await run(f);
  expect(r.code).toBe(0);
  expect(JSON.parse(r.out)).toMatchObject({
    resultVersion: "1",
    command: "chromatic status validate",
    scope: "review-artifact-conformance",
    ok: true,
  });
  expect(fs.statSync(path.join(f.root, "review/status.json")).mtimeMs).toBe(
    before,
  );
  expect(fs.existsSync(path.join(f.root, "locks"))).toBe(false);
});
it("binds default revision to the project Git HEAD", async () => {
  const f = fixture();
  execFileSync("git", ["init", "-q"], { cwd: f.root });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      "fixture",
    ],
    { cwd: f.root },
  );
  f.status.revision.gitSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: f.root,
    encoding: "utf8",
  }).trim();
  f.write("review/status.json", f.status);
  expect((await run(f, [])).code).toBe(0);
});
it.each([
  (f) => {
    fs.unlinkSync(path.join(f.root, "review/status.json"));
  },
  (f) => {
    f.config.storybook.chromatic = null;
  },
  (f) => {
    f.config.storybook.chromatic.maxAgeMinutes = "60junk";
  },
  (f) => {
    f.config.storybook.chromatic.status = "../outside";
  },
])("cannot evaluate bad input/config %#", async (mutate) => {
  const f = fixture();
  mutate(f);
  f.write("project.json", f.config);
  const r = await run(f);
  expect(r.code).toBe(2);
  expect(r.out).toBe("");
});
it("returns evaluated malformed JSON instead of claiming absent evidence passed", async () => {
  const f = fixture();
  f.write("review/status.json", "{");
  const r = await run(f);
  expect(r.code).toBe(1);
  expect(JSON.parse(r.out).ok).toBe(false);
});
it("rejects changed live proof scope despite internally consistent stale selections", async () => {
  const f = fixture();
  f.spec.tier = "composite";
  f.data.tierPolicy.tierOrder = ["composite"];
  f.data.tierPolicy.tiers = { composite: f.data.tierPolicy.tiers.atomic };
  f.write("policy/tiers.json", f.data.tierPolicy);
  f.write("specs/notice.json", f.spec);
  const r = await run(f);
  expect(r.code).toBe(1);
  expect(r.out).toContain("CURRENT_SCOPE");
});
it("rejects unsupported flags without a result", async () => {
  const f = fixture();
  const r = await run(f, ["--sha", exampleSha, "--ignore-age"]);
  expect(r.code).toBe(2);
  expect(r.out).toBe("");
});

it("binds a different component library scope through the actual project entrypoint", async () => {
  const f = fixture({
    component: "workspace-tree",
    tier: "composite",
    consumer: "desktop-review",
  });
  const result = await run(f);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.out).review.scope.componentTiers).toEqual({
    "workspace-tree": "composite",
  });
});
