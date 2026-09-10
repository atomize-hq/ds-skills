import { formatProofReport } from "./csf-parser.mjs";
import { CannotEvaluateError } from "../figma/profile.mjs";
import { loadProject } from "../project/config.mjs";
import { withDirectoryLock } from "../io/lock.mjs";
import {
  captureProofInputs,
  assertProofInputsUnchanged,
  inputError,
} from "./proof-inputs.mjs";
import { validateStorybookProofStructure } from "./proof-structure.mjs";
import {
  createStorybookProofCoverageReport,
  coverageDiagnostics,
} from "./proof-coverage.mjs";
import {
  preflightProofWrites,
  publishProofCoverage,
  readCoverageBytes,
} from "./proof-write.mjs";

export async function evaluateStorybookProof(project, mode) {
  if (!["validate", "check", "build"].includes(mode))
    throw inputError("Unknown proof operation");
  if (!project.storybook?.proof)
    throw inputError("Storybook proof capability is not configured");
  const evaluate = async () => {
    const snapshot = captureProofInputs(project);
    const structure = validateStorybookProofStructure(project, snapshot);
    if (!structure.ok)
      return {
        ok: false,
        diagnostics: structure.errors,
        coverage: null,
        artifactStatus: "not-written",
      };
    const coverage = createStorybookProofCoverageReport(structure);
    const bytes = Buffer.from(
      await formatProofReport(coverage, project.storybook.proof.formatting),
    );
    const diagnostics =
      mode === "validate" ? [] : coverageDiagnostics(coverage);
    let artifactStatus = "not-written";
    if (mode === "check") {
      const existing = readCoverageBytes(project.storybook.proof.coverage);
      if (!existing?.equals(bytes))
        diagnostics.push(
          "[STORYBOOK_PROOF_COVERAGE_STALE] Stored coverage differs from current source-derived report; rebuild it",
        );
    }
    if (mode === "build")
      artifactStatus = publishProofCoverage(project, snapshot, bytes);
    assertProofInputsUnchanged(project, snapshot);
    return {
      ok: diagnostics.length === 0,
      diagnostics,
      coverage,
      artifactStatus,
    };
  };
  if (mode !== "build") return evaluate();
  preflightProofWrites(project);
  return withDirectoryLock(
    project.storybook.proof.lockPath,
    () => {
      preflightProofWrites(project);
      return evaluate();
    },
    { label: "storybook proof build" },
  );
}
export async function runStorybookProofCommand(name, options, rest, json, io) {
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
      `Use ${name} --config <project.json> [--root <dir>]`,
    );
  const project = loadProject(options.config, { rootDir: options.root });
  const result = await evaluateStorybookProof(project, name.split(" ").at(-1));
  const report = {
    resultVersion: "1",
    command: name,
    projectRoot: project.rootDir,
    configPath: project.configPath,
    scope: "static-story-reference-coverage",
    ...result,
  };
  if (json) io.stdout.write(`${JSON.stringify(report)}\n`);
  else {
    io.stdout.write(
      `${result.ok ? "✓" : "✗"} ${name}: ${result.coverage?.summary.componentCount ?? 0} components; ${result.artifactStatus}\n`,
    );
    for (const diagnostic of result.diagnostics)
      io.stderr.write(`${diagnostic}\n`);
    io.stdout.write(
      "Scope: static story references and required-kind coverage, not test execution or Figma publication.\n",
    );
  }
  return result.ok ? 0 : 1;
}
