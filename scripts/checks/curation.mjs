import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  curationFixture,
  acceptFixtureCuration,
} from "../../dist/curation/fixture.mjs";
const [consumer, prefix, flavour] = process.argv.slice(2),
  f = await curationFixture(
    flavour === "beta"
      ? {
          namespace: "secondary",
          folder: "owned-kit",
          secondKind: "local-source-v1",
        }
      : {},
  );
function run(args, launcher = path.join(f.root, ".ds-skills/project.mjs")) {
  const r = spawnSync(process.execPath, [launcher, ...args], {
    cwd: path.parse(f.root).root,
    env: { ...process.env, DS_SKILLS_PREFIX: prefix },
    encoding: "utf8",
    timeout: 60000,
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
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(
    fs.existsSync(
      path.join(f.root, ".agents/skills/curate-component-libraries/SKILL.md"),
    ),
    true,
  );
  const invoke = (mode) =>
    run(["curation", ...mode.split(" "), "--config", "project.json", "--json"]);
  assert.equal(invoke("validate").code, 0);
  assert.equal(invoke("check").code, 2);
  r = invoke("build");
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(
    JSON.parse(r.out).validationScope,
    "structure-and-pinned-provenance",
  );
  const bytes = fs.readFileSync(
      path.join(f.root, f.config.curation.candidate),
      "utf8",
    ),
    bundle = JSON.parse(bytes);
  assert.equal(bundle.skills.length, 2);
  assert.equal(bundle.namespace, f.draft.namespace);
  assert.equal(
    fs.existsSync(path.join(f.root, ".agents/skills", bundle.skills[0].name)),
    false,
  );
  acceptFixtureCuration(f, bytes);
  assert.equal(invoke("check").code, 0);
  assert.equal(invoke("diff").code, 0);
  assert.equal(invoke("installed check").code, 1);
  r = invoke("install");
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(JSON.parse(r.out).installedFileCount, 12);
  assert.equal(invoke("installed check").code, 0);
  const receipt = fs.readFileSync(
      path.join(f.root, ".ds-skills/curation.json"),
    ),
    skillPath = path.join(
      f.root,
      ".agents/skills",
      bundle.skills[0].name,
      "SKILL.md",
    ),
    skillBytes = fs.readFileSync(skillPath);
  for (const skill of bundle.skills)
    for (const surface of [".agents", ".claude"])
      for (const [relative, content] of Object.entries(skill.files))
        assert.equal(
          fs.readFileSync(
            path.join(f.root, surface, "skills", skill.name, relative),
            "utf8",
          ),
          content,
        );
  fs.appendFileSync(skillPath, "user edit");
  assert.equal(invoke("installed check").code, 1);
  assert.equal(invoke("install").code, 2);
  assert.equal(
    fs
      .readFileSync(path.join(f.root, ".ds-skills/curation.json"))
      .equals(receipt),
    true,
  );
  fs.writeFileSync(skillPath, skillBytes);
  assert.equal(invoke("installed check").code, 0);
  fs.unlinkSync(skillPath);
  assert.equal(invoke("installed check").code, 1);
  assert.equal(invoke("install").code, 0);
  assert.equal(invoke("installed check").code, 0);

  f.draft.skills[0].sections[0].text += " Explicit reviewed change.";
  f.write("curation.json", f.draft);
  assert.equal(invoke("check").code, 1);
  assert.equal(invoke("installed check").code, 1);
  assert.equal(invoke("install").code, 1);
  assert.equal(fs.readFileSync(skillPath).equals(skillBytes), true);
  assert.equal(
    fs
      .readFileSync(path.join(f.root, ".ds-skills/curation.json"))
      .equals(receipt),
    true,
  );
  r = invoke("build");
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(JSON.parse(r.out).diff.changed.length, 1);
  assert.equal(
    fs.readFileSync(
      path.join(f.root, "curation-evidence/accepted.json"),
      "utf8",
    ),
    bytes,
  );
  const updated = fs.readFileSync(
    path.join(f.root, f.config.curation.candidate),
    "utf8",
  );
  acceptFixtureCuration(f, updated);
  assert.equal(invoke("install").code, 0);
  assert.equal(invoke("installed check").code, 0);
  const reviewPath = path.join(f.root, f.config.curation.review.file),
    reviewBytes = fs.readFileSync(reviewPath);
  fs.appendFileSync(reviewPath, " ");
  assert.equal(invoke("install").code, 2);
  assert.equal(invoke("installed check").code, 2);
  fs.writeFileSync(reviewPath, reviewBytes);
  assert.equal(invoke("installed check").code, 0);
  assert.equal(fs.existsSync(path.join(f.root, "node_modules")), false);
  f.draft.skills[0].examples[0].code = "function {";
  f.write("curation.json", f.draft);
  assert.equal(invoke("build").code, 1);
  assert.equal(
    fs.readFileSync(path.join(f.root, f.config.curation.candidate), "utf8"),
    updated,
  );
  process.stdout.write(
    `curation: ${flavour} installed authoring workflow, reviewed custom discovery output, explicit refresh and skew/ownership 0/1/2 passed\n`,
  );
} finally {
  fs.rmSync(f.root, { recursive: true, force: true });
}
