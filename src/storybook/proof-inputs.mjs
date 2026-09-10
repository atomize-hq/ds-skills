import fs from "node:fs";
import path from "node:path";
import { CannotEvaluateError } from "../figma/profile.mjs";
import { loadProject } from "../project/config.mjs";

export function captureProofInputs(project) {
  const proof = project.storybook?.proof;
  if (!proof) throw inputError("Storybook proof capability is not configured");
  const current = loadProject(project.configPath, { rootDir: project.rootDir });
  if (JSON.stringify(current) !== JSON.stringify(project))
    throw inputError("Project configuration changed; reload before evaluation");
  const files = new Map(),
    specFiles = [],
    storyFiles = [];
  const read = (file) => {
    if (files.has(file)) return;
    if (!stat(file).isFile())
      throw inputError(`Not a regular input file: ${file}`);
    files.set(file, fs.readFileSync(file, "utf8"));
  };
  function directory(dir, kind) {
    if (!stat(dir).isDirectory()) throw inputError(`Not a directory: ${dir}`);
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name),
        info = stat(file);
      if (info.isDirectory()) {
        if (kind === "story") directory(file, kind);
        continue;
      }
      if (kind === "spec" && name.endsWith(".json")) {
        read(file);
        specFiles.push(file);
      }
      if (kind === "story" && name.includes(".stories.")) {
        if (!/\.stories\.tsx?$/.test(name))
          throw inputError(
            `Unsupported story source extension for csf-ts-v1: ${file}`,
          );
        read(file);
        storyFiles.push(file);
      }
    }
  }
  try {
    for (const file of [
      project.configPath,
      project.storybook.inventory,
      project.storybook.tierPolicy,
      project.storybook.versionPolicy,
    ])
      read(file);
    directory(proof.componentSpecs, "spec");
    for (const root of proof.storyRoots) directory(root, "story");
  } catch (error) {
    if (error instanceof CannotEvaluateError) throw error;
    throw inputError(error.message);
  }
  return {
    files,
    specFiles: [...new Set(specFiles)].sort(),
    storyFiles: [...new Set(storyFiles)].sort(),
    identity: JSON.stringify([...files].sort(([a], [b]) => a.localeCompare(b))),
  };
}
function stat(file) {
  const info = fs.lstatSync(file);
  if (info.isSymbolicLink())
    throw inputError(`Symbolic links are not supported proof inputs: ${file}`);
  return info;
}
export function assertProofInputsUnchanged(project, snapshot) {
  if (captureProofInputs(project).identity !== snapshot.identity)
    throw inputError(
      "Proof inputs changed during evaluation; retry from current sources",
    );
}
export function inputError(message) {
  return new CannotEvaluateError("STORYBOOK_PROOF_INPUT", message);
}
