import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { assertWritePath } from "../tokens/write-targets.mjs";
import { inputError, assertProofInputsUnchanged } from "./proof-inputs.mjs";

export function preflightProofWrites(project) {
  const config = project.storybook,
    proof = config.proof;
  const targets = [proof.coverage, proof.lockPath, `${proof.lockPath}.guard`];
  const inputs = [
    project.configPath,
    config.inventory,
    config.tierPolicy,
    config.versionPolicy,
    proof.componentSpecs,
    ...proof.storyRoots,
  ];
  for (const [index, target] of targets.entries()) {
    if (
      inputs.some((input) => overlaps(target, input)) ||
      targets.slice(0, index).some((other) => overlaps(target, other))
    )
      throw inputError(
        `Proof write target overlaps another input/target: ${target}`,
      );
    assertWritePath(
      project.rootDir,
      target,
      index === 1 ? "directory" : "file",
    );
  }
}
function overlaps(a, b) {
  return within(a, b) || within(b, a);
}
function within(a, b) {
  const rel = path.relative(a, b);
  return (
    rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
  );
}
export function readCoverageBytes(file) {
  try {
    if (!fs.lstatSync(file).isFile())
      throw inputError(`Coverage must be a regular file: ${file}`);
    return fs.readFileSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
export function publishProofCoverage(project, snapshot, bytes) {
  const file = project.storybook.proof.coverage;
  preflightProofWrites(project);
  const previous = readCoverageBytes(file);
  if (previous?.equals(bytes)) return "unchanged";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${crypto.randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(temp, bytes, {
      flag: "wx",
      mode: previous ? fs.statSync(file).mode & 0o777 : 0o644,
    });
    assertProofInputsUnchanged(project, snapshot);
    preflightProofWrites(project);
    const actual = readCoverageBytes(file);
    if (
      (previous === null) !== (actual === null) ||
      (previous && !previous.equals(actual))
    )
      throw inputError("Coverage changed concurrently; refusing overwrite");
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return "written";
}
