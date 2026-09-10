import fs from "node:fs";
import { CannotEvaluateError } from "../figma/profile.mjs";
export function lockError(message) {
  return new CannotEvaluateError("DIRECTORY_LOCK", message);
}
export function stat(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
export function readOwner(file) {
  const info = stat(file);
  if (!info) return null;
  if (info.isSymbolicLink() || !info.isFile())
    throw lockError(`Lock metadata is not a regular file: ${file}`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError || error.code === "ENOENT") return null;
    throw error;
  }
}
export function validOwner(record) {
  return (
    record &&
    typeof record.ownerId === "string" &&
    record.ownerId.length > 0 &&
    Number.isInteger(record.pid) &&
    record.pid > 0
  );
}
export function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}
export function positiveOption(value, fallback, label) {
  const n = value ?? fallback;
  if (!Number.isFinite(n) || n <= 0)
    throw lockError(`${label} must be positive`);
  return n;
}
