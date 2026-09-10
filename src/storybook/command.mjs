import fs from "node:fs";
import { CannotEvaluateError } from "../figma/profile.mjs";
import { loadProject } from "../project/config.mjs";
import { validateStoryInventory } from "./inventory.mjs";
import { validateComponentTierPolicy } from "./tier-policy.mjs";
import { validateStorybookVersionPolicy } from "./version-policy.mjs";

const validators = {
  inventory: validateStoryInventory,
  tierPolicy: validateComponentTierPolicy,
  versionPolicy: validateStorybookVersionPolicy,
};
export function validateStorybookPolicyProject(project) {
  if (!project.storybook)
    throw new CannotEvaluateError(
      "STORYBOOK_NOT_CONFIGURED",
      "Storybook capability is not configured",
    );
  const diagnostics = [];
  const inputs = [];
  for (const [kind, validate] of Object.entries(validators)) {
    const sourcePath = project.storybook[kind];
    let text;
    try {
      if (!fs.lstatSync(sourcePath).isFile())
        throw new Error("expected a regular file");
      text = fs.readFileSync(sourcePath, "utf8");
    } catch (error) {
      throw new CannotEvaluateError(
        "STORYBOOK_INPUT",
        `Cannot read ${sourcePath}: ${error.message}`,
      );
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      diagnostics.push({
        sourcePath,
        kind,
        message: `[STORYBOOK_JSON] ${error.message}`,
      });
      inputs.push({ kind, sourcePath, valid: false });
      continue;
    }
    const errors = validate(data);
    diagnostics.push(
      ...errors.map((message) => ({ sourcePath, kind, message })),
    );
    inputs.push({ kind, sourcePath, valid: errors.length === 0 });
  }
  return { ok: diagnostics.length === 0, inputs, diagnostics };
}

export function runStorybookPolicyCommand(options, rest, json, io) {
  if (
    rest.length ||
    Object.keys(options).some(
      (key) => !["config", "root", "json"].includes(key),
    ) ||
    !options.config ||
    options.config === "true" ||
    options.root === "true"
  )
    throw new CannotEvaluateError(
      "STORYBOOK_ARGUMENT",
      "Use storybook policy validate --config <project.json> [--root <directory>]",
    );
  const project = loadProject(options.config, { rootDir: options.root });
  const result = validateStorybookPolicyProject(project);
  const report = {
    resultVersion: "1",
    command: "storybook policy validate",
    projectRoot: project.rootDir,
    configPath: project.configPath,
    scope: "structural-policy-only",
    ...result,
  };
  if (json) io.stdout.write(`${JSON.stringify(report)}\n`);
  else {
    io.stdout.write(
      `${result.ok ? "✓" : "✗"} storybook policy validate: ${result.inputs.length} policy inputs\n`,
    );
    for (const diagnostic of result.diagnostics)
      io.stderr.write(`${diagnostic.sourcePath}: ${diagnostic.message}\n`);
    io.stdout.write(
      "Scope: structural policy conformance; not installed dependency conformance, story execution, component readiness or Figma publication.\n",
    );
  }
  return report.ok ? 0 : 1;
}
