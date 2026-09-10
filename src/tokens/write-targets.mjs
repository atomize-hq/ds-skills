import { publicationInputs } from "../project/governance-config.mjs";
import { runtimeCheckInputs } from "../project/runtime-check-config.mjs";
import fs from "node:fs";
import path from "node:path";
import { CannotEvaluateError } from "../figma/profile.mjs";

/** Validate the entire write set before any lock, directory, or artifact write. */
export function preflightTokenWrites(project) {
  const build = project.tokens?.build;
  if (!build)
    throw new CannotEvaluateError(
      "TOKEN_BUILD_NOT_CONFIGURED",
      "Token build capability is not configured",
    );
  const outputs = Object.entries(build.outputs).map(([id, file]) => ({
    id,
    file,
  }));
  const targets = [
    ...outputs,
    { id: "lock", file: build.lockPath },
    { id: "lock-guard", file: `${build.lockPath}.guard` },
  ];
  const inputs = [
    project.configPath,
    ...runtimeCheckInputs(project),
    ...publicationInputs(project),
    ...(project.tokens.manualEditGuard?.generatorInputs ?? []),
    project.tokens.sourceDir,
    project.tokens.recipesDir,
    project.tokens.themes.directory,
    project.tokens.themes.registry,
    ...(build.runtime.compatibility
      ? [
          build.runtime.compatibility.inventory,
          build.runtime.compatibility.aliases,
        ]
      : []),
  ].filter(Boolean);
  for (let i = 0; i < targets.length; i++) {
    const current = targets[i];
    if (inputs.some((input) => overlaps(current.file, input)))
      fail(`Write target ${current.file} overlaps a protected input`);
    for (const previous of targets.slice(0, i))
      if (overlaps(current.file, previous.file))
        fail(`Write targets overlap: ${current.file} and ${previous.file}`);
    assertWritePath(
      project.rootDir,
      current.file,
      current.id === "lock" ? "directory" : "file",
      {
        cooperativeLockTarget:
          current.id === "lock" || current.id === "lock-guard",
      },
    );
  }
  return outputs;
}
function overlaps(a, b) {
  return within(a, b) || within(b, a);
}
function within(root, file) {
  const rel = path.relative(root, file);
  return (
    rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
  );
}
export function assertWritePath(root, target, kind = "file", options = {}) {
  if (!within(root, target) || path.resolve(root) === path.resolve(target))
    fail(`Write path escapes or replaces project root: ${target}`);
  const segments = path.relative(root, target).split(path.sep);
  let current = root,
    last = root;
  for (let i = 0; i < segments.length; i++) {
    current = path.join(current, segments[i]);
    let info;
    try {
      info = fs.lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") break;
      throw writeError(current, error);
    }
    if (info.isSymbolicLink())
      fail(`Refusing symbolic link in write path: ${current}`);
    const final = i === segments.length - 1;
    if ((!final || kind === "directory") && !info.isDirectory())
      fail(`Write parent/lock is not a directory: ${current}`);
    if (final && kind === "file" && !info.isFile())
      fail(`Write target is not a regular file: ${current}`);
    try {
      fs.accessSync(
        current,
        final && kind === "file" ? fs.constants.W_OK : fs.constants.X_OK,
      );
    } catch (error) {
      // A cooperating builder may release this exact lock/guard leaf after lstat.
      // Ancestors and ordinary artifacts are not transient; never relax them.
      if (options.cooperativeLockTarget && final && error.code === "ENOENT")
        break;
      throw writeError(current, error);
    }
    if (info.isDirectory()) last = current;
  }
  try {
    fs.accessSync(last, fs.constants.W_OK | fs.constants.X_OK);
  } catch (error) {
    if (
      !options.cooperativeLockTarget ||
      kind !== "directory" ||
      last !== target ||
      error.code !== "ENOENT"
    )
      throw writeError(last, error);
    // The selected lock directory vanished after its first access check.
    // Its stable parent must still be writable/searchable before acquisition.
    const parent = path.dirname(target);
    try {
      fs.accessSync(parent, fs.constants.W_OK | fs.constants.X_OK);
    } catch (parentError) {
      throw writeError(parent, parentError);
    }
  }
}
export function writeError(file, error) {
  return new CannotEvaluateError(
    "TOKEN_ARTIFACT_WRITE",
    `Cannot write ${file}: ${error.message}`,
  );
}
function fail(message) {
  throw new CannotEvaluateError("TOKEN_ARTIFACT_WRITE", message);
}
