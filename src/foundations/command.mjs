import fs from "node:fs";
import path from "node:path";
import { loadProject } from "../project/config.mjs";
import { withDirectoryLock } from "../io/lock.mjs";
import { buildFoundationModel } from "./model.mjs";
import { assembleFoundationScript } from "./script.mjs";
import {
  ioError,
  preflightFoundationPaths,
  captureFoundationInputs,
  readFoundationOutput,
  writeFoundationOutput,
} from "./io.mjs";
export async function runFoundationOperation(project, mode, { renderer } = {}) {
  if (!["build", "check"].includes(mode))
    throw ioError("Unknown Foundations operation");
  preflightFoundationPaths(project, mode === "build");
  if (renderer === undefined) {
    try {
      renderer = fs.readFileSync(
        new URL("./renderer.js", import.meta.url),
        "utf8",
      );
    } catch {
      throw ioError(
        "Prebuilt Foundations renderer missing; reinstall the verified product",
      );
    }
  }
  const evaluate = () => {
    const snapshot = captureFoundationInputs(project),
      previous = readFoundationOutput(project);
    let model, script;
    try {
      model = buildFoundationModel(
        JSON.parse(snapshot.content.artifact),
        JSON.parse(snapshot.content.model),
      );
      script = assembleFoundationScript(
        model,
        JSON.parse(snapshot.content.presentation),
        renderer,
      );
    } catch (error) {
      if (
        !(error instanceof SyntaxError) &&
        !/^(FOUNDATIONS_INPUT|FOUNDATIONS_RENDER):/.test(error.message ?? "")
      )
        throw error;
      return {
        ok: false,
        artifactStatus: "not-written",
        diagnostics: [String(error.message ?? error)],
      };
    }
    if (Buffer.byteLength(script) > 2 * 1024 * 1024)
      throw ioError("Generated script exceeds 2 MiB");
    if (captureFoundationInputs(project).identity !== snapshot.identity)
      throw ioError("Foundations inputs changed during evaluation");
    const artifactStatus =
      mode === "build"
        ? writeFoundationOutput(project, snapshot, previous, script)
        : "not-written";
    const ok = mode === "build" || previous === script;
    return {
      ok,
      artifactStatus,
      diagnostics: ok ? [] : ["Foundations script is missing or stale"],
      inputDigest: snapshot.identity,
      modelDigest: model.inputDigest,
      output: path.relative(project.rootDir, project.foundations.output),
      tokenCount: model.tokenCount,
      sectionCount: model.sections.length,
    };
  };
  return mode === "build"
    ? withDirectoryLock(project.foundations.lockPath, evaluate, {
        label: "foundations build",
      })
    : evaluate();
}
export async function runFoundationsCommand(name, options, rest, json, io) {
  if (
    rest.length ||
    Object.keys(options).some((k) => !["config", "root", "json"].includes(k)) ||
    !options.config ||
    options.config === "true" ||
    options.root === "true"
  )
    throw ioError(`Use ${name} --config <project.json> [--root <dir>]`);
  const project = loadProject(options.config, { rootDir: options.root });
  const result = {
    resultVersion: "1",
    command: name,
    scope: "foundation-script-generation",
    projectRoot: project.rootDir,
    ...(await runFoundationOperation(project, name.split(" ").at(-1))),
  };
  if (json) io.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    io.stdout.write(
      `${result.ok ? "✓" : "✗"} ${name}: ${result.artifactStatus}\n`,
    );
    for (const d of result.diagnostics) io.stderr.write(`${d}\n`);
    io.stdout.write(
      "Generated script only; not executed in Figma and not publication proof.\n",
    );
  }
  return result.ok ? 0 : 1;
}
