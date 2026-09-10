import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { checkSkillPack } from "../../dist/skill-pack/check.mjs";
const [root, home] = process.argv.slice(2),
  launcher = path.join(root, ".ds-skills/project.mjs");
const digest = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const receipt = JSON.parse(
  fs.readFileSync(path.join(root, ".ds-skills/installation.json")),
);
assert.equal(receipt.installationVersion, "2");
const expected = [".ds-skills/project.mjs"];
function compare(source, destination, relative) {
  for (const item of fs.readdirSync(source, { withFileTypes: true })) {
    if (item.name === "RELEASE.json") continue;
    const from = path.join(source, item.name),
      to = path.join(destination, item.name),
      key = `${relative}/${item.name}`;
    assert.equal(fs.lstatSync(to).isSymbolicLink(), false);
    if (item.isDirectory()) compare(from, to, key);
    else {
      assert.deepEqual(fs.readFileSync(to), fs.readFileSync(from));
      assert.equal(receipt.files[key].sha256, digest(from));
      expected.push(key);
    }
  }
}
for (const surface of [".agents", ".claude"])
  for (const group of ["skills", "schemas", "templates"])
    compare(
      path.join(home, "lib", group),
      path.join(root, surface, group),
      `${surface}/${group}`,
    );
assert.deepEqual(Object.keys(receipt.files).sort(), expected.sort());
// Both installed reference layouts resolve without rewriting any skill bytes.
for (const surface of [".agents", ".claude"])
  for (const skill of fs
    .readdirSync(path.join(home, "lib/skills"))
    .filter((name) => name !== "RELEASE.json")) {
    for (const support of ["schemas", "templates"])
      assert.equal(
        fs
          .statSync(path.join(root, surface, "skills", skill, "../..", support))
          .isDirectory(),
        true,
      );
  }
for (const surface of [".agents", ".claude"]) {
  const report = checkSkillPack(path.join(root, surface));
  assert.equal(report.ok, true, report.diagnostics.join("\n"));
  assert.equal(report.skills.length, 9);
}
function run(args, status) {
  const result = spawnSync(process.execPath, [launcher, ...args], {
    cwd: path.dirname(root),
    encoding: "utf8",
  });
  assert.equal(result.status, status, result.stderr);
  return result;
}
const owned = expected.find(
  (file) => file.startsWith(".agents/skills/") && file.endsWith("/SKILL.md"),
);
const target = path.join(root, owned),
  bytes = fs.readFileSync(target),
  receiptDigest = digest(path.join(root, ".ds-skills/installation.json"));
fs.appendFileSync(target, "\nlocal edit\n");
assert.equal(run(["--check"], 2).stdout, "");
assert.match(run(["--install"], 2).stderr, /unowned or edited/);
assert.equal(
  digest(path.join(root, ".ds-skills/installation.json")),
  receiptDigest,
);
assert.match(fs.readFileSync(target, "utf8"), /local edit/);
fs.writeFileSync(target, bytes); // Deliberate fixture edit rollback, not installer repair.
fs.unlinkSync(path.join(root, owned.replace(".agents/", ".claude/")));
run(["--check"], 2);
run(["--install"], 0);
run(["--check"], 0);
const before = Object.fromEntries(
  expected.map((file) => [file, fs.statSync(path.join(root, file)).mtimeMs]),
);
run(["--install"], 0);
assert.deepEqual(
  Object.fromEntries(
    expected.map((file) => [file, fs.statSync(path.join(root, file)).mtimeMs]),
  ),
  before,
);
process.stdout.write(
  `  installed discovery: ${expected.length} sealed outputs, both surfaces, relative references, skew refusal, explicit repair\n`,
);
