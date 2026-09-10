import { CannotEvaluateError } from "../figma/profile.mjs";
import { loadProject } from "../project/config.mjs";
import { TokenInputError } from "./source.mjs";
import { buildTokenArtifacts } from "./build.mjs";

export async function runTokenBuildCommand(options, rest, json, io) {
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
      "Use tokens build --config <project.json> [--root <directory>]",
    );
  const project = loadProject(options.config, { rootDir: options.root });
  let artifacts = [],
    diagnostics = [];
  try {
    ({ artifacts } = await buildTokenArtifacts({ project }));
  } catch (error) {
    if (error instanceof TokenInputError)
      diagnostics = [
        {
          code: error.code,
          message: error.message,
          sourcePath: error.sourcePath,
        },
      ];
    else if (typeof error.code === "string" && /^E[A-Z]+$/.test(error.code))
      throw new CannotEvaluateError("TOKEN_ARTIFACT_WRITE", error.message);
    else throw error;
  }
  const report = {
    resultVersion: "1",
    command: "tokens build",
    projectRoot: project.rootDir,
    configPath: project.configPath,
    ok: !diagnostics.length,
    artifacts,
    diagnostics,
  };
  if (json) io.stdout.write(`${JSON.stringify(report)}\n`);
  else {
    io.stdout.write(
      `${report.ok ? "✓" : "✗"} tokens build: ${artifacts.map((a) => `${a.id}=${a.status}`).join(", ")}\n`,
    );
    for (const diagnostic of diagnostics)
      io.stderr.write(`[${diagnostic.code}] ${diagnostic.message}\n`);
  }
  return report.ok ? 0 : 1;
}
