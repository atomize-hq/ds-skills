import { CannotEvaluateError } from "../figma/profile.mjs";
import { loadProject } from "../project/config.mjs";
import { TokenInputError } from "./source.mjs";
import { executeGovernanceStep } from "./governance-steps.mjs";
import {
  snapshotGovernanceInputs,
  fingerprintPaths,
  governanceChanged,
} from "./governance-snapshot.mjs";

/** The fixed pipeline stops at the first nonconformant or unevaluable step. */
export async function governTokenProject({ project }) {
  const governance = project.tokens?.governance;
  if (!governance)
    throw new CannotEvaluateError(
      "TOKEN_GOVERNANCE_NOT_CONFIGURED",
      "Token governance is not configured",
    );
  const capabilities = {
    manualEditGuard: project.tokens.manualEditGuard !== null,
    runtimeChecks: project.tokens.runtimeChecks !== null,
    publication: governance.publication !== null,
  };
  const plan = [
    "tokens validate",
    ...(capabilities.manualEditGuard ? ["tokens guard"] : []),
    "tokens build",
    ...(capabilities.runtimeChecks ? ["tokens runtime check"] : []),
    "tokens artifacts check",
    ...(capabilities.publication
      ? ["figma verify", "ledger validate", "ledger parity", "proof validate"]
      : []),
  ];
  const before = snapshotGovernanceInputs(project);
  const outputs = Object.values(project.tokens.build.outputs);
  let built = null;
  const steps = [];
  const assertStable = () => {
    if (
      snapshotGovernanceInputs(project) !== before ||
      (built !== null && fingerprintPaths(outputs) !== built)
    )
      governanceChanged();
  };
  for (const id of plan) {
    assertStable();
    let result;
    try {
      result = await executeGovernanceStep(id, project);
    } catch (error) {
      if (error instanceof TokenInputError)
        result = {
          ok: false,
          diagnostics: [
            {
              code: error.code,
              message: error.message,
              sourcePath: error.sourcePath,
            },
          ],
        };
      else {
        if (error instanceof Error) error.message = `${id}: ${error.message}`;
        throw error;
      }
    }
    if (id === "tokens build" && result.ok) built = fingerprintPaths(outputs);
    assertStable();
    steps.push({ id, result });
    if (!result.ok) return { ok: false, capabilities, steps, failedStep: id };
  }
  return { ok: true, capabilities, steps, failedStep: null };
}

export async function runTokenGovernanceCommand(options, rest, json, io) {
  const allowed = new Set(["config", "root", "json"]);
  if (
    rest.length ||
    Object.keys(options).some((key) => !allowed.has(key)) ||
    !options.config ||
    options.config === "true" ||
    options.root === "true"
  )
    throw new CannotEvaluateError(
      "TOKEN_ARGUMENT",
      "Use tokens govern --config <project.json> [--root <directory>]",
    );
  const project = loadProject(options.config, { rootDir: options.root });
  const report = {
    resultVersion: "1",
    command: "tokens govern",
    projectRoot: project.rootDir,
    configPath: project.configPath,
    scope:
      "Local token checks and selected publication attestations; not observed remote synchronization or component readiness",
    ...(await governTokenProject({ project })),
  };
  if (json) io.stdout.write(`${JSON.stringify(report)}\n`);
  else {
    for (const step of report.steps) {
      io.stdout.write(`${step.result.ok ? "✓" : "✗"} ${step.id}\n`);
      for (const diagnostic of step.result.diagnostics ?? [])
        (step.result.ok ? io.stdout : io.stderr).write(
          `[${diagnostic.code}] ${diagnostic.message}\n`,
        );
      for (const error of step.result.errors ?? [])
        io.stderr.write(`${error}\n`);
    }
    io.stdout.write(`[GOVERNANCE_SCOPE] ${report.scope}\n`);
  }
  return report.ok ? 0 : 1;
}
