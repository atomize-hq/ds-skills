import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { CannotEvaluateError } from "../figma/profile.mjs";
import { loadProject } from "../project/config.mjs";
import { runtimeCheckInputs } from "../project/runtime-check-config.mjs";
import { publicationInputs } from "../project/governance-config.mjs";

export function snapshotGovernanceInputs(project) {
  const current = loadProject(project.configPath, { rootDir: project.rootDir });
  if (JSON.stringify(current) !== JSON.stringify(project)) governanceChanged();
  const tokens = project.tokens;
  return fingerprintPaths(
    [
      project.configPath,
      tokens.sourceDir,
      tokens.recipesDir,
      tokens.themes.directory,
      tokens.themes.registry,
      ...(tokens.build.runtime.compatibility
        ? [
            tokens.build.runtime.compatibility.inventory,
            tokens.build.runtime.compatibility.aliases,
          ]
        : []),
      ...runtimeCheckInputs(project),
      ...(tokens.manualEditGuard?.generatorInputs ?? []),
      ...publicationInputs(project),
    ].filter(Boolean),
  );
}

/** Missing later inputs are recorded, not prematurely evaluated ahead of source validation. */
export function fingerprintPaths(paths) {
  const entries = new Map();
  function visit(file) {
    if (entries.has(file)) return;
    let info;
    try {
      info = fs.lstatSync(file);
    } catch (error) {
      if (error.code === "ENOENT") {
        entries.set(file, "missing");
        return;
      }
      throw new CannotEvaluateError(
        "TOKEN_GOVERNANCE_INPUT",
        `Cannot snapshot ${file}: ${error.message}`,
      );
    }
    if (info.isSymbolicLink())
      throw new CannotEvaluateError(
        "TOKEN_GOVERNANCE_INPUT",
        `Symbolic governance input is unsupported: ${file}`,
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
    else entries.set(file, "unsupported-kind");
  }
  try {
    for (const file of paths) visit(file);
  } catch (error) {
    if (error instanceof CannotEvaluateError) throw error;
    throw new CannotEvaluateError("TOKEN_GOVERNANCE_INPUT", error.message);
  }
  return JSON.stringify([...entries].sort(([a], [b]) => a.localeCompare(b)));
}
export function governanceChanged() {
  throw new CannotEvaluateError(
    "TOKEN_GOVERNANCE_INPUT_CHANGED",
    "Governance inputs or checked artifacts changed during evaluation. No aggregate result is valid; earlier build writes may already have occurred. Rerun from a stable project.",
  );
}
