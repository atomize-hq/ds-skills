import { loadProject } from "../project/config.mjs";
import { sourceError } from "./inputs.mjs";
import { checkSourcePolicy } from "./policy.mjs";
import { checkSourceContract } from "./contract.mjs";
export async function runSourceCheckCommand(name, options, rest, json, io) {
  if (
    rest.length ||
    Object.keys(options).some((k) => !["config", "root", "json"].includes(k)) ||
    !options.config ||
    options.config === "true" ||
    options.root === "true"
  )
    throw sourceError(`Use ${name} --config <project.json> [--root <dir>]`);
  const project = loadProject(options.config, { rootDir: options.root });
  const result = {
    resultVersion: "1",
    command: name,
    scope: name.includes("policy")
      ? "source-text-policy"
      : "static-module-slot-contract",
    projectRoot: project.rootDir,
    ...(await (name.includes("policy")
      ? checkSourcePolicy(project)
      : checkSourceContract(project))),
  };
  if (json) io.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    io.stdout.write(`${result.ok ? "✓" : "✗"} ${name}\n`);
    for (const e of result.errors) io.stderr.write(`${e}\n`);
  }
  return result.ok ? 0 : 1;
}
