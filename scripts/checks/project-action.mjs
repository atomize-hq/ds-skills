import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const [source, work, release] = process.argv.slice(2);
const actionSource = path.join(work, "action-source"),
  action = path.join(actionSource, ".github/actions/setup-ds-skills");
fs.mkdirSync(path.dirname(action), { recursive: true });
fs.cpSync(path.join(source, ".github/actions/setup-ds-skills"), action, {
  recursive: true,
});
fs.cpSync(path.join(source, "src"), path.join(actionSource, "src"), {
  recursive: true,
});
assert.equal(fs.existsSync(path.join(actionSource, "dist")), false);
assert.equal(fs.existsSync(path.join(actionSource, "node_modules")), false);
const projectName = "action project;$(touch SHOULD-NOT-EXECUTE)",
  project = path.join(work, projectName),
  prefix = path.join(work, "action-prefix"),
  output = path.join(work, "action-output");
fs.mkdirSync(project);
fs.copyFileSync(
  path.join(work, "release/ds-skills.release.json"),
  path.join(project, "ds-skills.release.json"),
);
const metadata = fs.readFileSync(path.join(action, "action.yml"), "utf8");
assert.match(metadata, /using: composite/);
const command = metadata.match(/^ {6}run: (.+)$/m)?.[1];
assert.equal(command, 'node "$DS_SKILLS_ACTION_PATH/setup.mjs"');
const env = {
  ...process.env,
  GITHUB_WORKSPACE: work,
  GITHUB_OUTPUT: output,
  RUNNER_TEMP: work,
  DS_SKILLS_ACTION_PATH: action,
  DS_SKILLS_ACTION_PROJECT: projectName,
  DS_SKILLS_ACTION_PREFIX: "action-prefix",
  DS_SKILLS_ACTION_MIRROR: `http://127.0.0.1:${fs.readFileSync(path.join(work, "good.port"), "utf8").trim()}`,
};
function run(expected) {
  fs.writeFileSync(output, "");
  const result = spawnSync("bash", ["-e", "-c", command], {
    cwd: actionSource,
    encoding: "utf8",
    env,
  });
  assert.equal(result.status, expected, result.stderr);
  return result;
}
run(0);
const outputs = {};
const lines = fs.readFileSync(output, "utf8").trimEnd().split("\n");
for (let i = 0; i < lines.length; i += 3) {
  const [name, delimiter] = lines[i].split("<<");
  assert.equal(lines[i + 2], delimiter);
  outputs[name] = lines[i + 1];
}
assert.equal(outputs.release, release);
assert.equal(outputs.prefix, prefix);
assert.equal(
  outputs.launcher,
  path.join(fs.realpathSync(project), ".ds-skills/project.mjs"),
);
assert.equal(
  fs.existsSync(path.join(actionSource, "SHOULD-NOT-EXECUTE")),
  false,
);
assert.equal(fs.existsSync(path.join(work, "SHOULD-NOT-EXECUTE")), false);
const launcher = outputs.launcher;
const check = spawnSync(process.execPath, [launcher, "--check"], {
  encoding: "utf8",
  env: { ...process.env, DS_SKILLS_PREFIX: prefix },
});
assert.equal(check.status, 0, check.stderr);
const skill = fs.readdirSync(path.join(project, ".claude/skills"))[0];
fs.appendFileSync(
  path.join(project, ".claude/skills", skill, "SKILL.md"),
  "\nuser edit\n",
);
assert.match(run(2).stderr, /unowned or edited/);
assert.equal(fs.readFileSync(output, "utf8"), "");
process.stdout.write(
  "  CI setup: action-source only, no build/dependencies, exact reviewed acquisition, safe env inputs, verified outputs, failure propagation\n",
);
