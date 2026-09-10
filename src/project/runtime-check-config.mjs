import path from "node:path";
import { exact, fail, resolveProjectPath } from "./config.mjs";

/** Explicit consumer compatibility obligations, independent of Figma state. */
export function readRuntimeChecks(value, root, build) {
  if (value == null) return null;
  exact(value, ["compatibilitySurface", "imports"], "tokens.runtimeChecks");
  if (!build) fail("tokens.runtimeChecks requires tokens.build");
  for (const key of ["compatibilitySurface", "imports"])
    if (!Object.hasOwn(value, key))
      fail(`tokens.runtimeChecks.${key} must be configured or null`);
  const compatibilitySurface =
    value.compatibilitySurface === null
      ? null
      : resolveProjectPath(
          root,
          value.compatibilitySurface,
          "runtimeChecks.compatibilitySurface",
        );
  let imports = null;
  if (value.imports !== null) {
    exact(value.imports, ["format", "entries"], "runtimeChecks.imports");
    if (value.imports.format !== "css-import-v1")
      fail("Unsupported runtimeChecks.imports.format");
    if (!Array.isArray(value.imports.entries) || !value.imports.entries.length)
      fail("runtimeChecks.imports.entries must be nonempty");
    const entries = value.imports.entries.map((entry) => {
      exact(entry, ["file", "specifier"], "runtime import");
      const file = resolveProjectPath(root, entry.file, "runtime import file");
      if (
        typeof entry.specifier !== "string" ||
        !/^\.\.?\//.test(entry.specifier) ||
        /["'\\?#]/.test(entry.specifier) ||
        [...entry.specifier].some((char) => char.charCodeAt(0) < 32)
      )
        fail("runtime import specifier must be an unescaped relative CSS path");
      if (
        path.resolve(path.dirname(file), entry.specifier) !==
        build.outputs.runtimeCss
      )
        fail(
          "runtime import specifier must resolve to the configured runtime CSS output",
        );
      if (file === build.outputs.runtimeCss)
        fail("Runtime CSS cannot import itself");
      return { file, specifier: entry.specifier };
    });
    if (new Set(entries.map((entry) => entry.file)).size !== entries.length)
      fail("Runtime import files must be unique");
    imports = { format: value.imports.format, entries };
  }
  if (!compatibilitySurface && !imports)
    fail("runtimeChecks must select at least one obligation");
  return { compatibilitySurface, imports };
}

export function runtimeCheckInputs(project) {
  const checks = project.tokens?.runtimeChecks;
  return [
    checks?.compatibilitySurface,
    ...(checks?.imports?.entries.map((e) => e.file) ?? []),
  ].filter(Boolean);
}
