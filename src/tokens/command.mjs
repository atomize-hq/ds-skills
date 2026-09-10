import { CannotEvaluateError } from "../figma/profile.mjs";
import { loadProject } from "../project/config.mjs";
import { loadBuildGraph } from "./graph.mjs";
import { TokenInputError } from "./source.mjs";
import { readThemeRegistry } from "./themes.mjs";

export function runTokenValidationCommand(options, rest, json, io) {
  const allowed = new Set(["config", "root", "json"]);
  if (
    rest.length ||
    Object.keys(options).some((key) => !allowed.has(key)) ||
    !options.config ||
    options.config === "true" ||
    options.root === "true"
  ) {
    throw new CannotEvaluateError(
      "TOKEN_ARGUMENT",
      "Use tokens validate --config <project.json> [--root <directory>]",
    );
  }
  const project = loadProject(options.config, { rootDir: options.root });
  const { themes, diagnostics } = validateTokenProject({ project });
  const report = {
    resultVersion: "1",
    command: "tokens validate",
    ok: diagnostics.length === 0,
    projectRoot: project.rootDir,
    configPath: project.configPath,
    themes,
    diagnostics,
  };
  if (json) io.stdout.write(`${JSON.stringify(report)}\n`);
  else {
    io.stdout.write(
      `${report.ok ? "✓" : "✗"} tokens validate: ${themes.length} theme(s) evaluated\n`,
    );
    for (const diagnostic of diagnostics)
      io.stderr.write(`[${diagnostic.code}] ${diagnostic.message}\n`);
  }
  return report.ok ? 0 : 1;
}

export function validateTokenProject({ project }) {
  if (project.tokens === null)
    throw new CannotEvaluateError(
      "TOKENS_NOT_CONFIGURED",
      "Token capability is explicitly not configured",
    );
  const diagnostics = [];
  const themes = [];
  try {
    const registry = readThemeRegistry(project.tokens);
    for (const theme of registry.themes) {
      const graph = loadBuildGraph({ project, themeId: theme.id });
      themes.push({
        themeId: theme.id,
        tokenCount: Object.keys(graph.tokenMap).length,
        recipeCount: Object.keys(graph.recipeMap).length,
      });
    }
  } catch (error) {
    if (!(error instanceof TokenInputError)) throw error;
    diagnostics.push({
      code: error.code,
      message: error.message,
      sourcePath: error.sourcePath,
    });
  }
  return { ok: diagnostics.length === 0, themes, diagnostics };
}
