import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import {
  chromaticProjectFixture,
  exampleSha,
} from "../../src/chromatic/fixture.mjs";
import { statusHttpFixture } from "./chromatic-http-fixture.mjs";
const [consumer, prefix, flavour] = process.argv.slice(2);
const f = chromaticProjectFixture(
  flavour === "beta"
    ? {
        component: "workspace-tree",
        tier: "composite",
        consumer: "desktop-review",
      }
    : {},
);
if (flavour === "beta") {
  f.config.storybook.chromatic.status = "nested/review/receipt.json";
  f.config.storybook.chromatic.checkName = "desktop-check";
  f.status.check.name = "desktop-check";
  f.write("project.json", f.config);
  f.write(f.config.storybook.chromatic.status, f.status);
}
const service = await statusHttpFixture(f);
function run(args, launcher = path.join(f.root, ".ds-skills/project.mjs")) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [launcher, ...args], {
      cwd: path.parse(f.root).root,
      env: {
        ...process.env,
        DS_SKILLS_PREFIX: prefix,
        DS_TEST_GH_TOKEN: "fixture-token",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    child.stdout.on("data", (data) => {
      out += data;
    });
    child.stderr.on("data", (data) => {
      err += data;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, out, err }));
  });
}
try {
  const pin = JSON.parse(
    fs.readFileSync(path.join(consumer, "ds-skills.release.json")),
  );
  fs.copyFileSync(
    path.join(consumer, "ds-skills.release.json"),
    path.join(f.root, "ds-skills.release.json"),
  );
  const setup = await run(
    ["project", "setup", "--root", f.root, "--prefix", prefix],
    path.join(prefix, pin.release, "lib/bin/ds-skills.mjs"),
  );
  assert.equal(setup.status, 0, setup.err);
  const invoke = (mode) =>
    run([
      "chromatic",
      "status",
      mode,
      "--config",
      "project.json",
      "--sha",
      exampleSha,
      "--json",
    ]);
  const checked = await invoke("validate");
  assert.equal(checked.status, 0, checked.err + checked.out);
  const target = path.join(f.root, f.config.storybook.chromatic.status);
  fs.unlinkSync(target);
  let result = await invoke("restore");
  assert.equal(result.status, 0, result.err);
  assert.equal(JSON.parse(result.out).scope, "review-artifact-conformance");
  assert.equal((await invoke("validate")).status, 0);
  const before = fs.readFileSync(target);
  service.state.status.generatedAt = "2020-01-01T00:00:00Z";
  result = await invoke("restore");
  assert.equal(result.status, 1, result.err);
  assert.deepEqual(fs.readFileSync(target), before);
  service.state.artifact = { digest: `sha256:${"0".repeat(64)}` };
  result = await invoke("restore");
  assert.equal(result.status, 2);
  assert.equal(result.out, "");
  assert.deepEqual(fs.readFileSync(target), before);
  assert(
    service.state.requests
      .filter((r) => r.path === "/download")
      .every((r) => r.authorization === undefined),
  );
  f.config.storybook.chromatic.publish = {
    provider: "chromatic-node-v15",
    buildDir: "static-review",
    tokenEnv: "DS_MISSING_REVIEW_TOKEN",
    repository: "example/review",
    timeoutSeconds: 30,
    mode: "review",
  };
  f.write("project.json", f.config);
  const refused = await run([
    "chromatic",
    "review",
    "publish",
    "--config",
    "project.json",
    "--branch",
    "fixture",
    "--json",
  ]);
  assert.equal(refused.status, 2, refused.out + refused.err);
  assert.equal(refused.out, "");
  assert.match(refused.err, /DS_MISSING_REVIEW_TOKEN/);
  const providerProbe = await run(
    ["--probe"],
    path.join(prefix, pin.release, "lib/dist/chromatic/provider-worker.mjs"),
  );
  assert.equal(providerProbe.status, 0, providerProbe.err);
  assert.equal(providerProbe.out.trim(), "function");
  f.write("package.json", {
    name: "review-runtime-probe",
    version: "0.0.0",
    private: true,
  });
  f.write("empty-provider.json", {});
  const { executeChromaticProvider } = await import(
    pathToFileURL(
      path.join(prefix, pin.release, "lib/dist/chromatic/provider-process.mjs"),
    ).href
  );
  const invalidOptions = await executeChromaticProvider({
    rootDir: f.root,
    env: { PATH: process.env.PATH },
    gitSha: exampleSha,
    branchName: "probe",
    repository: "example/probe",
    timeoutSeconds: 15,
    options: {
      configFile: path.join(f.root, "empty-provider.json"),
      logLevel: "silent",
      diagnosticsFile: path.join(f.root, "probe-diagnostics.json"),
    },
  });
  assert.equal(
    invalidOptions.code,
    254,
    "Actual bundled provider must reject missing credentials before network tasks",
  );

  process.stdout.write(
    `chromatic status: ${flavour} installed validation and bounded HTTP restoration 0/1/2, publication refusal and bundled provider invalid-options execution passed\n`,
  );
} finally {
  await service.close();
  fs.rmSync(f.root, { recursive: true, force: true });
}
