import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderFixture } from "./render-fixture.mjs";
import { loadProject } from "../project/config.mjs";
export function foundationProjectFixture(options = {}) {
  const f = renderFixture(options),
    root = fs.mkdtempSync(path.join(os.tmpdir(), "foundation-project-"));
  const write = (name, value) => {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };
  const projectConfig = {
    projectVersion: "1",
    tokens: null,
    foundations: {
      artifact: "tokens.json",
      model: "model.json",
      presentation: "presentation.json",
      output: "generated/foundations.run.js",
      lockPath: ".locks/foundations",
    },
  };
  write("project.json", projectConfig);
  write("tokens.json", f.artifact);
  write("model.json", f.modelConfig);
  write("presentation.json", f.p);
  return {
    ...f,
    root,
    write,
    projectConfig,
    project: () => loadProject(path.join(root, "project.json")),
  };
}
