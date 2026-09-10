import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { libraryFixture } from "../../dist/libraries/fixture.mjs";
const [consumer, prefix, flavour] = process.argv.slice(2);
const f = libraryFixture(
  flavour === "beta"
    ? { folder: "source catalog", secondKind: "local-source-v1" }
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
  // Alpha requires immutable Git evidence; beta explicitly uses current content.
  if (flavour === "alpha") f.commit();
  const invoke = (mode) =>
    run(["libraries", "evidence", mode, "--config", "project.json", "--json"]);
  r = invoke("check");
  assert.equal(r.code, 2, r.err + r.out);
  r = invoke("capture");
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(JSON.parse(r.out).scope, "library-source-evidence");
  assert.equal(JSON.parse(r.out).libraryCount, 2);
  assert.equal(JSON.parse(invoke("capture").out).artifactStatus, "unchanged");
  const readCandidate = () =>
    fs.readFileSync(path.join(f.root, f.config.libraries.candidate), "utf8");
  const bytes = readCandidate();
  const data = JSON.parse(bytes).data;
  assert.equal(
    data.libraries[1].source.kind,
    flavour === "beta" ? "local-source-v1" : "local-package-v1",
  );
  if (flavour === "alpha")
    assert.equal(
      data.libraries[0].files.every((file) => file.revision.matchesCommit),
      true,
    );
  assert.equal(f.config.libraries.evidence, null);
  // Test-only explicit acceptance; capture itself does not accept or rewrite a pin.
  f.write("evidence/pinned.json", bytes);
  f.config.libraries.evidence = {
    file: "evidence/pinned.json",
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
  f.write("project.json", f.config);
  assert.equal(invoke("check").code, 0);
  assert.deepEqual(JSON.parse(invoke("diff").out).diff.changed, []);
  f.definition.libraries[1].capabilities.push("reviewed-declaration-change");
  f.write("libraries.json", f.definition);
  assert.equal(invoke("check").code, 1);
  r = invoke("capture");
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(JSON.parse(r.out).diff.changed[0].metadataChanged, true);
  assert.equal(
    fs.readFileSync(path.join(f.root, "evidence/pinned.json"), "utf8"),
    bytes,
  );
  const updated = readCandidate();
  fs.unlinkSync(
    path.join(f.root, f.definition.libraries[0].components[0].source),
  );
  r = invoke("capture");
  assert.equal(r.code, 2, r.err + r.out);
  assert.equal(readCandidate(), updated);
  assert.equal(
    fs.existsSync(path.join(f.root, "DO NOT EXECUTE EVIDENCE")),
    false,
  );
  process.stdout.write(
    `libraries: ${flavour} installed multiple-source capture/check/diff 0/1/2, pin preservation, no source execution passed\n`,
  );
} finally {
  fs.rmSync(f.root, { recursive: true, force: true });
}
