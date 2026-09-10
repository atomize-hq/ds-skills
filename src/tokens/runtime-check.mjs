import fs from "node:fs";
import path from "node:path";
import { CannotEvaluateError } from "../figma/profile.mjs";
import {
  exact,
  fail,
  loadProject,
  resolveProjectPath,
} from "../project/config.mjs";
import {
  declaredRuntimeProperties,
  readCssImports,
} from "./css-obligations.mjs";

/** Presence/import obligations only: no build freshness or publication claim. */
export function checkTokenRuntime({ project }) {
  const checks = project.tokens?.runtimeChecks;
  if (!checks)
    throw new CannotEvaluateError(
      "TOKEN_RUNTIME_CHECKS_NOT_CONFIGURED",
      "Runtime compatibility checks are not configured",
    );
  const runtimeCss = project.tokens.build.outputs.runtimeCss;
  const css = readRequired(runtimeCss);
  const obligations = [],
    diagnostics = [];
  if (checks.compatibilitySurface) {
    const surface = readSurface(
      project,
      checks.compatibilitySurface,
      runtimeCss,
    );
    const names = declaredRuntimeProperties(css);
    for (const property of surface.requiredCustomProperties) {
      const present = names.has(property);
      obligations.push({ kind: "custom-property", property, present });
      if (!present)
        diagnostics.push({
          code: "RUNTIME_CSS_COMPATIBILITY_MISSING",
          path: relative(project, runtimeCss),
          property,
          message: `Runtime CSS is missing required custom property ${property}`,
        });
    }
  }
  for (const entry of checks.imports?.entries ?? []) {
    const present = readCssImports(readRequired(entry.file)).includes(
      entry.specifier,
    );
    const file = relative(project, entry.file);
    obligations.push({
      kind: "css-import",
      path: file,
      specifier: entry.specifier,
      present,
    });
    if (!present)
      diagnostics.push({
        code: "RUNTIME_CSS_IMPORT_MISSING",
        path: file,
        message: `Required top-level CSS import is missing: ${entry.specifier}`,
      });
  }
  return { ok: !diagnostics.length, obligations, diagnostics };
}

function readSurface(project, file, runtimeCss) {
  let value;
  try {
    value = JSON.parse(readRequired(file));
  } catch (error) {
    if (error instanceof CannotEvaluateError) throw error;
    fail(
      `Cannot parse runtime compatibility surface ${file}: ${error.message}`,
    );
  }
  exact(
    value,
    ["surfaceVersion", "runtimeCssPath", "requiredCustomProperties"],
    "runtime compatibility surface",
  );
  if (value.surfaceVersion !== "1")
    fail('runtime compatibility surfaceVersion must be "1"');
  if (
    resolveProjectPath(
      project.rootDir,
      value.runtimeCssPath,
      "surface.runtimeCssPath",
    ) !== runtimeCss
  )
    fail(
      "Runtime compatibility surface must bind to the configured runtime CSS output",
    );
  const names = value.requiredCustomProperties;
  if (
    !Array.isArray(names) ||
    !names.length ||
    names.some((n) => typeof n !== "string" || !/^--[a-z0-9-]+$/.test(n)) ||
    new Set(names).size !== names.length
  )
    fail(
      "requiredCustomProperties must be a nonempty unique generated CSS property array",
    );
  return value;
}
function readRequired(file) {
  try {
    if (!fs.statSync(file).isFile()) throw new Error("not a regular file");
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new CannotEvaluateError(
      "TOKEN_RUNTIME_INPUT",
      `Cannot read ${file}: ${error.message}`,
    );
  }
}
function relative(project, file) {
  return path.relative(project.rootDir, file).split(path.sep).join("/");
}

export function runTokenRuntimeCheckCommand(options, rest, json, io) {
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
      "Use tokens runtime check --config <project.json> [--root <directory>]",
    );
  const project = loadProject(options.config, { rootDir: options.root });
  const report = {
    resultVersion: "1",
    command: "tokens runtime check",
    projectRoot: project.rootDir,
    configPath: project.configPath,
    ...checkTokenRuntime({ project }),
  };
  if (json) io.stdout.write(`${JSON.stringify(report)}\n`);
  else {
    io.stdout.write(
      `${report.ok ? "✓" : "✗"} tokens runtime check: ${report.obligations.length} obligation(s) evaluated\n`,
    );
    for (const diagnostic of report.diagnostics)
      io.stderr.write(`[${diagnostic.code}] ${diagnostic.message}\n`);
  }
  return report.ok ? 0 : 1;
}
