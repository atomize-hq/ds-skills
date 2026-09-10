import { readCuration } from "./curation-config.mjs";
import { readLibraries } from "./libraries-config.mjs";
import { readFoundations } from "./foundations-config.mjs";
import { readSourceChecks } from "./source-checks-config.mjs";
import { readComponents } from "./components-config.mjs";
import { readStorybook } from "./storybook-config.mjs";
import { readGovernance } from "./governance-config.mjs";
import { readManualGuard } from "./manual-guard-config.mjs";
import { readRuntimeChecks } from "./runtime-check-config.mjs";
import { readBuild } from "./build-config.mjs";
import fs from "node:fs";
import path from "node:path";
import { CannotEvaluateError } from "../figma/profile.mjs";
import { isObject } from "../recipes/checks.mjs";

/** One project data contract; product identity/pinning is deliberately separate. */
export function loadProject(configPath, options = {}) {
  if (typeof configPath !== "string" || !configPath.length)
    fail("A project config path is required");
  const target = path.resolve(options.rootDir ?? ".", configPath);
  const rootDir = path.resolve(options.rootDir ?? path.dirname(target));
  let data;
  try {
    data = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (error) {
    fail(`Cannot read project config ${target}: ${error.message}`);
  }
  exact(
    data,
    [
      "projectVersion",
      "tokens",
      "storybook",
      "components",
      "sourceChecks",
      "foundations",
      "libraries",
      "registries",
      "curation",
    ],
    "project",
  );
  if (data.projectVersion !== "1") fail('projectVersion must be "1"');
  if (!Object.hasOwn(data, "tokens"))
    fail("tokens must be configured or explicitly null");
  return {
    rootDir,
    configPath: target,
    storybook: readStorybook(data.storybook, rootDir),
    components: readComponents(data.components, rootDir),
    sourceChecks: readSourceChecks(data.sourceChecks, rootDir),
    foundations: readFoundations(data.foundations, rootDir),
    curation: readCuration(data.curation, rootDir),
    libraries: readLibraries(data.libraries, rootDir),
    registries: readLibraries(data.registries, rootDir, "registries"),
    tokens: data.tokens === null ? null : readTokens(data.tokens, rootDir),
  };
}

function readTokens(tokens, root) {
  exact(
    tokens,
    [
      "format",
      "sourceDir",
      "recipesDir",
      "extensionsNamespace",
      "themes",
      "figma",
      "build",
      "runtimeChecks",
      "manualEditGuard",
      "governance",
    ],
    "tokens",
  );
  if (tokens.format !== "family-files-v1")
    fail("tokens.format must be family-files-v1");
  if (
    typeof tokens.extensionsNamespace !== "string" ||
    !tokens.extensionsNamespace.length
  )
    fail("tokens.extensionsNamespace must be a non-empty string");
  exact(tokens.themes, ["registry", "directory"], "tokens.themes");
  exact(tokens.figma, ["excludedFamilies"], "tokens.figma");
  const excluded = tokens.figma.excludedFamilies;
  if (
    !Array.isArray(excluded) ||
    excluded.some(
      (value) =>
        typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value),
    ) ||
    new Set(excluded).size !== excluded.length
  )
    fail("tokens.figma.excludedFamilies must be a unique identifier array");
  const build = readBuild(tokens.build, root);
  return {
    ...tokens,
    build,
    governance: readGovernance(tokens.governance, root, tokens, build),
    runtimeChecks: readRuntimeChecks(tokens.runtimeChecks, root, build),
    manualEditGuard: readManualGuard(tokens.manualEditGuard, root, build),
    sourceDir: resolveProjectPath(root, tokens.sourceDir, "tokens.sourceDir"),
    recipesDir:
      tokens.recipesDir === null
        ? null
        : resolveProjectPath(root, tokens.recipesDir, "tokens.recipesDir"),
    themes: {
      registry: resolveProjectPath(
        root,
        tokens.themes.registry,
        "tokens.themes.registry",
      ),
      directory: resolveProjectPath(
        root,
        tokens.themes.directory,
        "tokens.themes.directory",
      ),
    },
  };
}

/** Project-relative paths cannot escape their declared root, including symlinks. */
export function resolveProjectPath(root, value, label, options = {}) {
  if (typeof value !== "string" || !value.length || path.isAbsolute(value))
    fail(`${label} must be a non-empty project-relative path`);
  const target = path.resolve(root, value);
  if (!within(root, target)) fail(`${label} escapes the project root`);
  let ancestor = target;
  let info;
  while (true) {
    try {
      info = fs.lstatSync(ancestor);
      break;
    } catch (error) {
      if (error.code !== "ENOENT")
        fail(`${label} cannot resolve path: ${error.message}`);
      const parent = path.dirname(ancestor);
      if (parent === ancestor) fail(`${label} has no existing ancestor`);
      ancestor = parent;
    }
  }
  let real;
  try {
    real = fs.realpathSync(ancestor);
  } catch (error) {
    // Only a configured cooperative lock directory can disappear after lstat.
    // Do not weaken ordinary paths, symlinks, ancestors, or other errors.
    if (
      !options.cooperativeLockDirectory ||
      ancestor !== target ||
      !info.isDirectory() ||
      error.code !== "ENOENT" ||
      !isAbsent(target)
    )
      fail(`${label} has an unresolved filesystem link`);
    const parent = path.dirname(target);
    try {
      if (!fs.statSync(parent).isDirectory())
        throw new Error("Not a directory", { cause: error });
      real = fs.realpathSync(parent);
    } catch {
      fail(`${label} has an unresolved filesystem link`);
    }
  }
  if (!within(fs.realpathSync(root), real))
    fail(`${label} resolves outside the project root`);
  return target;
}

function isAbsent(target) {
  try {
    fs.lstatSync(target);
    return false;
  } catch (error) {
    return error.code === "ENOENT";
  }
}

function within(root, target) {
  const relative = path.relative(root, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
export function exact(value, keys, label) {
  if (!isObject(value)) fail(`${label} must be an object`);
  for (const key of Object.keys(value))
    if (!keys.includes(key)) fail(`Unknown ${label} field: ${key}`);
}
export function fail(message) {
  throw new CannotEvaluateError("PROJECT_CONFIG", message);
}
