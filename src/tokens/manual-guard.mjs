import path from "node:path";
import { spawnSync } from "node:child_process";
import { CannotEvaluateError } from "../figma/profile.mjs";
import { loadProject } from "../project/config.mjs";

/** Preserve the input-dirty heuristic, NOT a claim that Git proves provenance. */
export function checkTokenManualEdits({ project }) {
  const tokens = project.tokens,
    policy = tokens?.manualEditGuard;
  if (!policy)
    throw new CannotEvaluateError(
      "TOKEN_MANUAL_GUARD_NOT_CONFIGURED",
      "Manual edit guard is not configured",
    );
  const runtime = tokens.build.outputs.runtimeCss;
  const generatorInputs = [project.configPath, ...policy.generatorInputs];
  const sourceInputs = [
    tokens.sourceDir,
    tokens.themes.directory,
    tokens.themes.registry,
    ...(tokens.build.runtime.compatibility
      ? [
          tokens.build.runtime.compatibility.inventory,
          tokens.build.runtime.compatibility.aliases,
        ]
      : []),
  ];
  const dirty = (file) =>
    git(project, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      relative(project, file),
    ]).stdout.length > 0;
  // An ignored untracked runtime output is invisible to status. It cannot earn
  // a clean result. Tracked files remain visible even if an ignore rule matches.
  const ignored = git(
    project,
    ["check-ignore", "--quiet", "--", relative(project, runtime)],
    [0, 1],
  );
  if (ignored.status === 0)
    throw new CannotEvaluateError(
      "TOKEN_MANUAL_GUARD_GIT",
      "Runtime output is ignored and untracked; Git cannot evaluate this guard",
    );
  const state = {
    runtimeCssDirty: dirty(runtime),
    tokenSourceDirty: sourceInputs.map(dirty).some(Boolean),
    generatorDirty: generatorInputs.map(dirty).some(Boolean),
  };
  const ok =
    !state.runtimeCssDirty || state.tokenSourceDirty || state.generatorDirty;
  return {
    ok,
    policy: policy.policy,
    state,
    diagnostics: ok
      ? []
      : [
          {
            code: "RUNTIME_CSS_MANUAL_EDIT",
            path: relative(project, runtime),
            message:
              "Runtime CSS changed without canonical sources, project configuration or product pin changes. Regenerate with ds-skills tokens build.",
          },
        ],
  };
}
function relative(project, file) {
  return path.relative(project.rootDir, file).split(path.sep).join("/");
}
function git(project, args, allowed = [0]) {
  // GIT_DIR/INDEX_FILE/WORK_TREE overrides must not redirect a project check to
  // an unrelated repository or index. Repository-local Git settings still apply.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const result = spawnSync(
    "git",
    [...(args[0] === "check-ignore" ? [] : ["--literal-pathspecs"]), ...args],
    {
      cwd: project.rootDir,
      env: { ...env, GIT_OPTIONAL_LOCKS: "0" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  if (result.error || !allowed.includes(result.status))
    throw new CannotEvaluateError(
      "TOKEN_MANUAL_GUARD_GIT",
      `Cannot evaluate project Git status: ${result.error?.message ?? result.stderr?.trim() ?? result.status}`,
    );
  return result;
}
export function runTokenManualGuardCommand(options, rest, json, io) {
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
      "Use tokens guard --config <project.json> [--root <directory>]",
    );
  const project = loadProject(options.config, { rootDir: options.root });
  const report = {
    resultVersion: "1",
    command: "tokens guard",
    projectRoot: project.rootDir,
    configPath: project.configPath,
    ...checkTokenManualEdits({ project }),
  };
  if (json) io.stdout.write(`${JSON.stringify(report)}\n`);
  else {
    io.stdout.write(
      `${report.ok ? "✓" : "✗"} tokens guard (${report.policy})\n`,
    );
    for (const diagnostic of report.diagnostics)
      io.stderr.write(`[${diagnostic.code}] ${diagnostic.message}\n`);
  }
  return report.ok ? 0 : 1;
}
