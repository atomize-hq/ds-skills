import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { foundationProjectFixture } from "../../dist/foundations/project-fixture.mjs";
const [consumer, prefix, flavour] = process.argv.slice(2);
const f = foundationProjectFixture(
  flavour === "beta" ? { root: "workspace", modes: ["paper", "terminal"] } : {},
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
  const invoke = (mode) =>
    run(["foundations", mode, "--config", "project.json", "--json"]);
  r = invoke("check");
  assert.equal(r.code, 1, r.err + r.out);
  r = invoke("build");
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(JSON.parse(r.out).scope, "foundation-script-generation");
  assert.equal(invoke("check").code, 0);
  const script = fs.readFileSync(
    path.join(f.root, f.projectConfig.foundations.output),
    "utf8",
  );
  for (const v of f.variables)
    for (const [mode, value] of Object.entries(v.valuesByMode))
      if (typeof value === "number") v.valuesByMode[mode] = Math.fround(value);
  const result = await vm.runInNewContext(
    `(async (figma) => {${script}\n})(figma)`,
    { figma: f.figma },
    { timeout: 10000 },
  );
  assert.equal(result.ok, true);
  assert.equal(result.counts.specimens, 16 * f.model.modes.length);
  assert.equal(f.unrelated.removed, false);
  f.write("model.json", "{");
  r = invoke("build");
  assert.equal(r.code, 1, r.err + r.out);
  assert.equal(
    fs.readFileSync(
      path.join(f.root, f.projectConfig.foundations.output),
      "utf8",
    ),
    script,
  );
  fs.unlinkSync(path.join(f.root, "tokens.json"));
  r = invoke("check");
  assert.equal(r.code, 2, r.err + r.out);
  assert.equal(r.out, "");
  process.stdout.write(
    `foundations: ${flavour} installed script build/check 0/1/2 and self-contained mocked Figma execution passed\n`,
  );
} finally {
  fs.rmSync(f.root, { recursive: true, force: true });
}
