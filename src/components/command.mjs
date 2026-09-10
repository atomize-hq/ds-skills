import { loadProject } from "../project/config.mjs";
import { withDirectoryLock } from "../io/lock.mjs";
import { componentError, evaluateComponentPromotion } from "./policy.mjs";
import { evaluateComponentStatus } from "./evaluate.mjs";
import { assertComponentInputs } from "./inputs.mjs";
import {
  preflightComponentReport,
  readComponentReport,
  checkComponentReport,
  publishComponentReport,
} from "./report-io.mjs";
export async function runComponentOperation(project, mode, selection = {}) {
  preflightComponentReport(project, { writable: mode === "build" });
  const evaluate = async () => {
    const previous =
      mode === "build" || mode === "check"
        ? readComponentReport(project.components.report, project.rootDir)
        : null;
    const { report, snapshot } = await evaluateComponentStatus(project);
    let result = {
      ok: true,
      diagnostics: [],
      artifactStatus: "not-written",
      report,
    };
    if (mode === "check")
      result = {
        ...result,
        ...checkComponentReport(previous, report, project.components),
      };
    else if (mode === "build")
      result.artifactStatus = publishComponentReport(
        project,
        snapshot,
        report,
        previous,
      );
    else if (mode === "promote") {
      const decision = evaluateComponentPromotion(
        report,
        project.components,
        selection,
      );
      result = { ...result, ok: decision.ok, decision };
    } else if (mode !== "evaluate")
      throw componentError("Unknown component status operation");
    assertComponentInputs(project, snapshot);
    return result;
  };
  return mode === "build"
    ? withDirectoryLock(project.components.lockPath, evaluate, {
        label: "components status build",
      })
    : evaluate();
}
export async function runComponentsCommand(name, options, rest, json, io) {
  const promote = name === "components promote";
  const allowed = promote
    ? ["config", "root", "profile", "consumer", "json"]
    : ["config", "root", "json"];
  if (
    rest.length ||
    Object.keys(options).some((k) => !allowed.includes(k)) ||
    !options.config ||
    options.config === "true" ||
    options.root === "true" ||
    (promote &&
      (!options.profile ||
        !options.consumer ||
        options.profile === "true" ||
        options.consumer === "true"))
  )
    throw componentError(
      `Use ${name} --config <project.json> [--root <dir>]${promote ? " --profile <id> --consumer <id>" : ""}`,
    );
  const project = loadProject(options.config, { rootDir: options.root });
  const result = {
    resultVersion: "1",
    command: name,
    scope: "configured-component-evidence",
    projectRoot: project.rootDir,
    ...(await runComponentOperation(
      project,
      promote ? "promote" : name.split(" ").at(-1),
      options,
    )),
  };
  if (json) io.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    io.stdout.write(
      `${result.ok ? "✓" : "✗"} ${name}: ${result.decision?.outcome ?? result.artifactStatus}\n`,
    );
    for (const [id, evidence] of Object.entries(result.report.evidence))
      io.stdout.write(`${id}: ${evidence.state}\n`);
    for (const diagnostic of result.diagnostics)
      io.stderr.write(`${diagnostic}\n`);
    if (result.decision?.unmet.length)
      io.stderr.write(`Unmet evidence: ${result.decision.unmet.join(", ")}\n`);
    io.stdout.write(
      "Scope: configured evidence requirements; not proof of all component behavior or a new live Figma check.\n",
    );
  }
  return result.ok ? 0 : 1;
}
