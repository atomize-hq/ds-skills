import fs from "node:fs";
import path from "node:path";
import { installedFixture } from "../install/fixture.mjs";

export function projectFixture() {
  const fixture = installedFixture({
    extraFiles: {
      "lib/schemas/example.json": '{"type":"object"}\n',
      "lib/templates/example.json": "{}\n",
      "lib/skills/example/references/guide.md":
        "Use the real configured source.\n",
      "lib/dist/project-host/launcher.mjs": fs.readFileSync(
        new URL("../../dist/project-host/launcher.mjs", import.meta.url),
      ),
      "lib/bin/ds-skills.mjs": `import fs from 'node:fs';
fs.writeFileSync('executed.txt', 'executed');
const mode = process.env.HOST_TEST_MODE || 'ok';
const result = {resultVersion:'1',command:'tokens validate',ok:mode !== 'fail',cwd:process.cwd(),args:process.argv.slice(2)};
if(mode==='version') result.resultVersion='2';
if(mode==='identity') result.command='proof validate';
if(mode==='contradiction') result.ok=false;
process.stdout.write(mode === 'not-json' ? 'bad' : JSON.stringify(mode === 'array' ? [result] : result));
process.exitCode = mode === 'exit3' ? 3 : mode === 'exit2' ? 2 : mode === 'fail' ? 1 : 0;
`,
    },
  });
  const project = path.join(fixture.root, "a project with spaces");
  fs.mkdirSync(project);
  const pin = path.join(project, "ds-skills.release.json");
  fs.copyFileSync(fixture.recordPath, pin);
  const launcher = path.join(project, ".ds-skills/project.mjs"),
    receipt = path.join(project, ".ds-skills/installation.json");
  return {
    ...fixture,
    project,
    pin,
    launcher,
    receipt,
    options: { root: project, prefix: fixture.prefix },
  };
}
