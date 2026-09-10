import fs from "node:fs";
import path from "node:path";
import { releaseError } from "../install/record.mjs";

export const launcherPath = ".ds-skills/project.mjs";
export const receiptPath = ".ds-skills/installation.json";
export const pinPath = "ds-skills.release.json";
export function hostError(message) {
  return releaseError("PROJECT_INSTALLATION", message);
}
export function info(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
export function fileBytes(file) {
  const stat = info(file);
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink())
    throw hostError(`Expected a regular file: ${file}`);
  return fs.readFileSync(file);
}
export function projectPaths(root) {
  let resolved;
  try {
    resolved = fs.realpathSync(root);
  } catch (error) {
    throw hostError(`Cannot resolve project root: ${error.message}`);
  }
  if (!fs.statSync(resolved).isDirectory())
    throw hostError("Project root must be a directory");
  const directory = path.join(resolved, ".ds-skills");
  const stat = info(directory);
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
    throw hostError(
      `Expected a real project installation directory: ${directory}`,
    );
  return {
    root: resolved,
    directory,
    pin: path.join(resolved, pinPath),
    launcher: path.join(resolved, launcherPath),
    receipt: path.join(resolved, receiptPath),
  };
}
export function equalBytes(left, right) {
  return left === null || right === null ? left === right : left.equals(right);
}
