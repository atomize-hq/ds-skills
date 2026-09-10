import fs from "node:fs";
import path from "node:path";
import { CannotEvaluateError } from "../figma/profile.mjs";
import { loadProject } from "../project/config.mjs";
import { TokenInputError } from "./source.mjs";
import { renderTokenArtifacts } from "./render.mjs";

/** Render in memory and compare exact bytes; never repairs artifacts or writes locks. */
export async function checkTokenArtifacts({ project }) {
  const { contents } = await renderTokenArtifacts({ project });
  const artifacts = [],
    diagnostics = [];
  for (const [id, expected] of Object.entries(contents)) {
    const file = project.tokens.build.outputs[id];
    let actual = null;
    try {
      if (!fs.statSync(file).isFile())
        throw new Error("artifact path is not a regular file");
      actual = fs.readFileSync(file);
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new CannotEvaluateError(
          "TOKEN_ARTIFACT_INPUT",
          `Cannot read ${file}: ${error.message}`,
        );
    }
    const state =
      actual === null
        ? "missing"
        : actual.equals(Buffer.from(expected))
          ? "current"
          : "stale";
    const relative = path
      .relative(project.rootDir, file)
      .split(path.sep)
      .join("/");
    artifacts.push({ id, path: relative, state });
    if (state !== "current")
      diagnostics.push({
        code:
          state === "missing"
            ? "GENERATED_ARTIFACT_MISSING"
            : "GENERATED_ARTIFACT_STALE",
        artifactId: id,
        path: relative,
        message:
          state === "missing"
            ? "required artifact is missing"
            : "artifact differs from regenerated output",
      });
  }
  return { ok: !diagnostics.length, artifacts, diagnostics };
}
export async function runTokenArtifactCheckCommand(options, rest, json, io) {
  const allowed = new Set(["config", "root", "json"]);
  if (
    rest.length ||
    Object.keys(options).some((k) => !allowed.has(k)) ||
    !options.config ||
    options.config === "true" ||
    options.root === "true"
  )
    throw new CannotEvaluateError(
      "TOKEN_ARGUMENT",
      "Use tokens artifacts check --config <project.json> [--root <directory>]",
    );
  const project = loadProject(options.config, { rootDir: options.root });
  let result;
  try {
    result = await checkTokenArtifacts({ project });
  } catch (error) {
    if (!(error instanceof TokenInputError)) throw error;
    result = {
      ok: false,
      artifacts: [],
      diagnostics: [
        {
          code: error.code,
          message: error.message,
          sourcePath: error.sourcePath,
        },
      ],
    };
  }
  const report = {
    resultVersion: "1",
    command: "tokens artifacts check",
    projectRoot: project.rootDir,
    configPath: project.configPath,
    ...result,
  };
  if (json) io.stdout.write(`${JSON.stringify(report)}\n`);
  else {
    io.stdout.write(
      `${report.ok ? "✓" : "✗"} tokens artifacts check: ${report.artifacts.length} artifact(s) evaluated\n`,
    );
    for (const diagnostic of report.diagnostics)
      io.stderr.write(`[${diagnostic.code}] ${diagnostic.message}\n`);
  }
  return report.ok ? 0 : 1;
}
