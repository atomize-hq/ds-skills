import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import {
  executeChromaticProvider,
  providerEnvironment,
} from "./provider-process.mjs";
const roots = [];
afterEach(() => {
  for (const r of roots.splice(0))
    fs.rmSync(r, { recursive: true, force: true });
});
function fixture(script) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "provider-test-"));
  roots.push(root);
  const file = path.join(root, "worker.mjs");
  fs.writeFileSync(file, script);
  return {
    input: {
      rootDir: root,
      env: {
        PATH: process.env.PATH,
        SECRET: "hidden",
        NODE_OPTIONS: "--bad-option",
        CHROMATIC_SHA: "wrong",
      },
      gitSha: "a".repeat(40),
      branchName: "example",
      repository: "example/repo",
      timeoutSeconds: 1,
      options: {},
    },
    worker: pathToFileURL(file),
  };
}
it("strips ambient provider/Git/Node overrides and unrelated secrets", () => {
  const env = providerEnvironment(
    {
      PATH: "/tools",
      HOME: "/home",
      NODE_OPTIONS: "evil",
      GIT_DIR: "wrong",
      GITHUB_SHA: "wrong",
      CHROMATIC_PROJECT_TOKEN: "secret",
      OTHER: "secret",
    },
    { gitSha: "a".repeat(40), branchName: "feature", repository: "a/b" },
  );
  expect(env).toEqual({
    PATH: "/tools",
    HOME: "/home",
    CI: "true",
    CHROMATIC_SHA: "a".repeat(40),
    CHROMATIC_BRANCH: "feature",
    CHROMATIC_SLUG: "a/b",
  });
});
it("uses IPC and the selected cwd without forwarding raw stdout", async () => {
  const f = fixture(
    `process.once('message',()=>{process.stdout.write('private text');process.send({kind:'result',result:{code:0,cwd:process.cwd(),ambient:process.env.SECRET}},()=>process.exit(0));});`,
  );
  expect(await executeChromaticProvider(f.input, { worker: f.worker })).toEqual(
    { code: 0, cwd: fs.realpathSync(f.input.rootDir) },
  );
});
it.each([
  ["timeout", `process.once('message',()=>setInterval(()=>{},1000));`],
  ["no result", `process.once('message',()=>process.exit(0));`],
  [
    "unavailable",
    `process.once('message',()=>process.send({kind:'unavailable'}));`,
  ],
  [
    "too much output",
    `process.once('message',()=>{process.stdout.write('x'.repeat(2*1024*1024));setInterval(()=>{},1000);});`,
  ],
  ["nonzero exit", `process.once('message',()=>process.exit(3));`],
])("classifies %s as inability to evaluate", async (_, script) => {
  const f = fixture(script);
  await expect(
    executeChromaticProvider(f.input, { worker: f.worker }),
  ).rejects.toMatchObject({ code: "CHROMATIC_INPUT" });
});
