import fs from "node:fs";
import { digestOf } from "../install/integrity.mjs";
import { fileBytes, info, hostError } from "./paths.mjs";
import { confinedPath, managedRoot, parentDirectories } from "./assets.mjs";

export function readOutput(root, relative) {
  const file = confinedPath(root, relative),
    bytes = fileBytes(file);
  if (bytes === null) return null;
  return {
    sha256: digestOf(bytes),
    executable:
      process.platform === "win32" ? false : Boolean(info(file).mode & 0o111),
  };
}
export function matches(actual, expected) {
  return actual === null || expected === null
    ? actual === expected
    : actual.sha256 === expected.sha256 &&
        (process.platform === "win32" ||
          actual.executable === expected.executable);
}
/** Inspect only roots claimed by this installation; unrelated skills are untouched. */
export function inspectRoots(root, files) {
  const keys = new Set(files),
    directories = parentDirectories(files),
    seenDirectories = [];
  const roots = [...new Set(files.map(managedRoot).filter(Boolean))].sort();
  function visit(relative) {
    const file = confinedPath(root, relative),
      stat = info(file);
    if (!stat) return;
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw hostError(`Expected a real managed asset directory: ${file}`);
    seenDirectories.push(relative);
    for (const name of fs.readdirSync(file).sort()) {
      const key = `${relative}/${name}`,
        child = confinedPath(root, key),
        entry = info(child);
      if (entry?.isSymbolicLink())
        throw hostError(`Refusing symbolic managed content: ${child}`);
      if (entry?.isDirectory()) {
        if (!directories.has(key))
          throw hostError(
            `Unowned directory inside managed asset root: ${child}`,
          );
        visit(key);
      } else if (!keys.has(key))
        throw hostError(`Unowned file inside managed asset root: ${child}`);
    }
  }
  for (const relative of roots) visit(relative);
  return seenDirectories.sort();
}
export function preflightOutputs(desired, prior) {
  const expected = desired.receipt.files,
    previous = prior?.files ?? {};
  const files = [
    ...new Set([...Object.keys(expected), ...Object.keys(previous)]),
  ].sort();
  const directories = inspectRoots(desired.paths.root, files),
    snapshot = {};
  for (const relative of files) {
    const actual = readOutput(desired.paths.root, relative);
    snapshot[relative] = actual;
    if (
      actual === null ||
      (Object.hasOwn(expected, relative) && matches(actual, expected[relative]))
    )
      continue;
    if (
      !Object.hasOwn(previous, relative) ||
      !matches(actual, previous[relative])
    )
      throw hostError(
        `Refusing to overwrite or remove unowned or edited installed output: ${relative}`,
      );
  }
  return { files: snapshot, directories };
}
export function outputDiagnostics(desired, prior) {
  const diagnostics = [];
  for (const [relative, expected] of Object.entries(desired.receipt.files)) {
    try {
      if (!matches(readOutput(desired.paths.root, relative), expected))
        diagnostics.push({
          code: "PROJECT_OUTPUT_SKEW",
          path: relative,
          message:
            "Missing or changed installed output; run explicit project setup",
        });
    } catch (error) {
      diagnostics.push({
        code: "PROJECT_OUTPUT_KIND",
        path: relative,
        message: error.message,
      });
    }
  }
  const all = [
    ...new Set([
      ...Object.keys(desired.receipt.files),
      ...Object.keys(prior?.files ?? {}),
    ]),
  ];
  try {
    inspectRoots(desired.paths.root, all);
  } catch (error) {
    diagnostics.push({
      code: "PROJECT_UNOWNED_CONTENT",
      path: desired.paths.root,
      message: error.message,
    });
  }
  for (const relative of Object.keys(prior?.files ?? {})) {
    if (Object.hasOwn(desired.receipt.files, relative)) continue;
    try {
      if (readOutput(desired.paths.root, relative))
        diagnostics.push({
          code: "PROJECT_STALE_OUTPUT",
          path: relative,
          message:
            "Previously owned output is no longer selected; explicit setup is required",
        });
    } catch (error) {
      diagnostics.push({
        code: "PROJECT_STALE_OUTPUT",
        path: relative,
        message: error.message,
      });
    }
  }
  return diagnostics;
}
