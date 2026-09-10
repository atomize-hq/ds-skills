import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sourceChecksFixture } from "../../src/source-checks/fixture.mjs";
const [consumer, prefix, flavour] = process.argv.slice(2);
const f = sourceChecksFixture(
  flavour === "beta"
    ? {
        provider: "packages/widgets/src",
        consumer: "features/editor",
        prefix: "@workspace/widgets",
        component: "surface",
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
  let r = run(
    ["project", "setup", "--root", f.root, "--prefix", prefix],
    path.join(prefix, pin.release, "lib/bin/ds-skills.mjs"),
  );
  assert.equal(r.code, 0, r.err);
  const invoke = (kind) =>
    run(["sources", kind, "check", "--config", "project.json", "--json"]);
  for (const kind of ["policy", "contract"]) {
    r = invoke(kind);
    assert.equal(r.code, 0, r.err + r.out);
    assert.equal(JSON.parse(r.out).ok, true);
  }
  f.write(
    `${f.provider}/${f.component}.tsx`,
    "export const Other=()=> <button/>;",
  );
  for (const kind of ["policy", "contract"]) {
    r = invoke(kind);
    assert.equal(r.code, 1, r.err + r.out);
    assert.equal(JSON.parse(r.out).ok, false);
  }
  f.write(
    `${f.consumer}/panel.tsx`,
    `import * as Base from '${f.prefix}/${f.component}';`,
  );
  r = invoke("contract");
  assert.equal(r.code, 2, r.err + r.out);
  assert.equal(r.out, "");
  f.policy.invariants[0].require = ["(a+)+$"];
  f.policy.contracts = [];
  f.write("policy.json", f.policy);
  f.write(`${f.provider}/${f.component}.tsx`, "a".repeat(30000) + "!");
  f.config.sourceChecks.policy.timeoutMs = 100;
  f.write("project.json", f.config);
  r = invoke("policy");
  assert.equal(r.code, 2, r.err + r.out);
  assert.equal(r.out, "");
  assert.match(r.err, /timed out/);
  process.stdout.write(
    `sources: ${flavour} installed policy worker and static contract 0/1/2 gates passed\n`,
  );
} finally {
  fs.rmSync(f.root, { recursive: true, force: true });
}
