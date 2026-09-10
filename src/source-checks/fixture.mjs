import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadProject } from "../project/config.mjs";
export function sourceChecksFixture({
  provider = "primitives",
  consumer = "composition",
  prefix = "@example/primitives",
  component = "button",
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-checks-"));
  const write = (file, value) => {
    const p = path.join(root, file);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(
      p,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };
  const config = {
    projectVersion: "1",
    tokens: null,
    sourceChecks: {
      policy: {
        file: "policy.json",
        extensions: [".tsx"],
        recursive: false,
        timeoutMs: 2000,
      },
      contract: {
        adapter: "ts-named-imports-slots-v1",
        providers: [
          {
            id: "base",
            root: provider,
            modulePrefix: prefix,
            entrypoint: null,
          },
        ],
        consumers: [consumer],
        recursive: false,
        slots: { mode: "filename-prefix", owners: {} },
      },
    },
  };
  const policy = {
    policyVersion: "1",
    invariants: [
      {
        id: "focus",
        directory: provider,
        require: ["focus-ring"],
        reason: "Preserve the local focus treatment",
      },
    ],
    deviations: [],
    contracts: [
      {
        id: "public-export",
        file: `${provider}/${component}.tsx`,
        require: ["export"],
        reason: "Public API must remain available",
      },
    ],
  };
  write("project.json", config);
  write("policy.json", policy);
  write(
    `${provider}/${component}.tsx`,
    `export const Control = () => <button className="focus-ring" data-slot="${component}"/>;`,
  );
  write(
    `${consumer}/panel.tsx`,
    `import {Control as Button} from '${prefix}/${component}'; export const Panel=()=> <div className="[&_[data-slot=${component}]]:rounded"><Button/></div>;`,
  );
  return {
    root,
    config,
    policy,
    write,
    provider,
    consumer,
    prefix,
    component,
    project: () => loadProject(path.join(root, "project.json")),
  };
}
