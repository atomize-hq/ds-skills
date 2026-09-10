import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CannotEvaluateError } from "../figma/profile.mjs";
import { loadProject } from "../project/config.mjs";

/** Detect configuration/source drift while a build waits or renders. */
export function snapshotTokenInputs(project) {
  const current = loadProject(project.configPath, { rootDir: project.rootDir });
  if (JSON.stringify(current) !== JSON.stringify(project)) changed();
  const config = project.tokens;
  const paths = [
    project.configPath,
    config.sourceDir,
    config.recipesDir,
    config.themes.directory,
    config.themes.registry,
    ...(config.build.runtime.compatibility
      ? [
          config.build.runtime.compatibility.inventory,
          config.build.runtime.compatibility.aliases,
        ]
      : []),
  ].filter(Boolean);
  const entries = new Map();
  function visit(file) {
    if (entries.has(file)) return;
    let info;
    try {
      info = fs.lstatSync(file);
    } catch (error) {
      throw new CannotEvaluateError(
        "TOKEN_BUILD_INPUT",
        `Cannot snapshot ${file}: ${error.message}`,
      );
    }
    if (info.isSymbolicLink())
      throw new CannotEvaluateError(
        "TOKEN_BUILD_INPUT",
        `Cannot snapshot symbolic input link ${file}`,
      );
    if (info.isDirectory()) {
      entries.set(file, "directory");
      for (const name of fs.readdirSync(file).sort())
        visit(path.join(file, name));
    } else if (info.isFile())
      entries.set(
        file,
        crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
      );
    else
      throw new CannotEvaluateError(
        "TOKEN_BUILD_INPUT",
        `Unsupported input file kind: ${file}`,
      );
  }
  for (const file of paths) visit(file);
  return JSON.stringify([...entries].sort(([a], [b]) => a.localeCompare(b)));
}
export function assertTokenInputsUnchanged(project, snapshot) {
  if (snapshotTokenInputs(project) !== snapshot) changed();
}
function changed() {
  throw new CannotEvaluateError(
    "TOKEN_BUILD_INPUT_CHANGED",
    "Token build inputs changed; no pending artifacts were published. Reload the project and rerun the build.",
  );
}
