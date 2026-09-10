import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { componentProjectFixture } from "../../src/components/fixture.mjs";
const [consumer, prefix, flavour] = process.argv.slice(2);
const f = await componentProjectFixture(
  flavour === "beta"
    ? {
        component: "workspace-tree",
        tier: "composite",
        consumer: "desktop-review",
      }
    : {},
);
function run(args, launcher = path.join(f.root, ".ds-skills/project.mjs")) {
  const r = spawnSync(process.execPath, [launcher, ...args], {
    cwd: path.parse(f.root).root,
    env: { ...process.env, DS_SKILLS_PREFIX: prefix },
    encoding: "utf8",
  });
  if (r.error) throw r.error;
  return { code: r.status, out: r.stdout, err: r.stderr };
}
try {
  const pin = JSON.parse(
    fs.readFileSync(path.join(consumer, "ds-skills.release.json")),
  );
  fs.copyFileSync(
    path.join(consumer, "ds-skills.release.json"),
    path.join(f.root, "ds-skills.release.json"),
  );
  const setup = run(
    ["project", "setup", "--root", f.root, "--prefix", prefix],
    path.join(prefix, pin.release, "lib/bin/ds-skills.mjs"),
  );
  assert.equal(setup.code, 0, setup.err);
  const invoke = (args) => run([...args, "--config", "project.json", "--json"]);
  let r = invoke(["components", "status", "evaluate"]);
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(
    JSON.parse(r.out).report.policies.advancement.outcome,
    "satisfied",
  );
  assert.equal(invoke(["components", "status", "build"]).code, 0);
  assert.equal(invoke(["components", "status", "check"]).code, 0);
  const promote = () =>
    invoke([
      "components",
      "promote",
      "--profile",
      "advancement",
      "--consumer",
      "ci",
    ]);
  assert.equal(promote().code, 0);
  const reportPath = path.join(f.root, f.config.components.report);
  fs.chmodSync(reportPath, 0o444);
  try {
    assert.equal(invoke(["components", "status", "check"]).code, 0);
    assert.equal(promote().code, 0);
  } finally {
    fs.chmodSync(reportPath, 0o644);
  }

  f.status.review.diffOutcome = "changed";
  f.status.check.conclusion = "neutral";
  f.write("review/status.json", f.status);
  r = promote();
  assert.equal(r.code, 1, r.err + r.out);
  assert.equal(JSON.parse(r.out).decision.requirementsSatisfied, false);
  assert.equal(invoke(["components", "status", "check"]).code, 1);
  assert.equal(invoke(["components", "status", "build"]).code, 0);
  assert.equal(invoke(["components", "status", "check"]).code, 0);
  r = invoke([
    "components",
    "promote",
    "--profile",
    "advancement",
    "--consumer",
    "unknown",
  ]);
  assert.equal(r.code, 2);
  assert.equal(r.out, "");
  assert.match(r.err, /explicitly configured/);
  process.stdout.write(
    `components: ${flavour} installed current evidence, report integrity, explicit policy and 0/1/2 gates passed\n`,
  );
} finally {
  fs.rmSync(f.root, { recursive: true, force: true });
}
