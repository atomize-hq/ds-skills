import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { storybookPolicyFixture } from "../../src/storybook/fixture.mjs";

const [root, prefix, flavour] = process.argv.slice(2);
const different = flavour === "beta";
const fixture = storybookPolicyFixture(
  different
    ? {
        tier: "composite",
        consumer: "desktop-review",
        component: "workspace-tree",
      }
    : {},
);
const dir = different ? "packages/ui/review" : "proof-data";
const config = {
  projectVersion: "1",
  tokens: null,
  storybook: { format: "csf-policy-v1" },
};
const write = (file, data) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(data));
};
for (const [kind, data] of Object.entries(fixture)) {
  config.storybook[kind] = `${dir}/${kind}.json`;
  write(config.storybook[kind], data);
}
write("policy-project.json", config);
const invoke = () =>
  spawnSync(
    process.execPath,
    [
      path.join(root, ".ds-skills/project.mjs"),
      "storybook",
      "policy",
      "validate",
      "--config",
      "policy-project.json",
      "--json",
    ],
    {
      cwd: path.parse(root).root,
      encoding: "utf8",
      env: { ...process.env, DS_SKILLS_PREFIX: prefix },
    },
  );
let result = invoke();
assert.equal(result.status, 0, result.stderr);
assert.equal(JSON.parse(result.stdout).command, "storybook policy validate");
assert.equal(JSON.parse(result.stdout).scope, "structural-policy-only");
assert.equal(
  fs.realpathSync(JSON.parse(result.stdout).projectRoot),
  fs.realpathSync(root),
);
const original = fs.readFileSync(path.join(root, config.storybook.tierPolicy));
fixture.tierPolicy.tiers[fixture.tierPolicy.tierOrder[0]].defaultOptionalKinds =
  [];
write(config.storybook.tierPolicy, fixture.tierPolicy);
result = invoke();
assert.equal(result.status, 1, result.stderr);
assert.equal(JSON.parse(result.stdout).ok, false);
assert.match(result.stdout, /UNCATEGORIZED_KIND/);
fs.unlinkSync(path.join(root, config.storybook.tierPolicy));
result = invoke();
assert.equal(result.status, 2, result.stderr);
assert.equal(result.stdout, "");
fs.writeFileSync(path.join(root, config.storybook.tierPolicy), original);
assert.equal(invoke().status, 0);
process.stdout.write(
  `storybook policy: ${flavour} installed launcher 0/1/2 contract passed\n`,
);

// The source fixture authors a separate consumer; the actual execution remains installed.
const { proofFixture } = await import("../../src/storybook/proof-fixture.mjs");
const proof = proofFixture(
  different
    ? {
        component: "workspace-tree",
        tier: "composite",
        consumer: "desktop-review",
      }
    : {},
);
try {
  fs.copyFileSync(
    path.join(root, "ds-skills.release.json"),
    path.join(proof.root, "ds-skills.release.json"),
  );
  const pin = JSON.parse(
    fs.readFileSync(path.join(root, "ds-skills.release.json")),
  );
  const cli = path.join(prefix, pin.release, "lib/bin/ds-skills.mjs");
  const setup = spawnSync(
    process.execPath,
    [cli, "project", "setup", "--root", proof.root, "--prefix", prefix],
    { encoding: "utf8" },
  );
  assert.equal(setup.status, 0, setup.stderr);
  const run = (mode) =>
    spawnSync(
      process.execPath,
      [
        path.join(proof.root, ".ds-skills/project.mjs"),
        "storybook",
        "proof",
        mode,
        "--config",
        "project.json",
        "--json",
      ],
      {
        cwd: path.parse(root).root,
        encoding: "utf8",
        env: { ...process.env, DS_SKILLS_PREFIX: prefix },
      },
    );
  assert.equal(run("validate").status, 0);
  assert.equal(run("check").status, 1);
  result = run("build");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).coverage.proofCoverageVersion, "2");
  assert.equal(run("check").status, 0);
  proof.spec.requiredStoryKinds.push("docs");
  proof.write(`specs/${proof.component}.json`, proof.spec);
  result = run("build");
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(
    JSON.parse(result.stdout).coverage.components[0].missingKinds,
    ["docs"],
  );
  assert.equal(run("check").status, 1);
  fs.unlinkSync(path.join(proof.root, proof.config.storybook.inventory));
  result = run("check");
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  process.stdout.write(
    `storybook proof: ${flavour} installed static validation/build/check contracts passed\n`,
  );
} finally {
  fs.rmSync(proof.root, { recursive: true, force: true });
}
