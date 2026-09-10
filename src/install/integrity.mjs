import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { digestPattern, object } from "./record.mjs";
export const digestOf = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");

/** Nonexecuting, full installed-tree verification anchored to the reviewed pin. */
export function verifyInstalledFiles(
  home,
  record,
  platform = process.platform,
) {
  const diagnostics = [];
  const bad = (code, message, file) =>
    diagnostics.push({ code, message, path: file });
  const manifestName = record.payloadManifest.asset;
  const manifestPath = path.join(home, manifestName);
  let manifest;
  try {
    requireRegular(manifestPath);
    const bytes = fs.readFileSync(manifestPath);
    if (digestOf(bytes) !== record.payloadManifest.sha256) {
      bad(
        "RELEASE_MANIFEST_DIGEST",
        "Installed manifest differs from the reviewed digest",
        manifestName,
      );
      return diagnostics;
    }
    manifest = JSON.parse(bytes);
    validateManifest(manifest, record);
  } catch (error) {
    bad("RELEASE_MANIFEST_INVALID", error.message, manifestName);
    return diagnostics;
  }
  const expectedDirs = new Set([""]);
  for (const file of Object.keys(manifest.files)) {
    let parent = path.posix.dirname(file);
    while (parent !== ".") {
      expectedDirs.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  const seen = new Set();
  function visit(directory, relative = "") {
    for (const name of fs.readdirSync(directory).sort()) {
      const rel = relative ? `${relative}/${name}` : name;
      const target = path.join(directory, name);
      const info = fs.lstatSync(target);
      if (info.isSymbolicLink()) {
        bad(
          "RELEASE_CONTENT_LINK",
          "Installed payload must not contain symbolic links",
          rel,
        );
        continue;
      }
      if (info.isDirectory()) {
        if (!expectedDirs.has(rel))
          bad(
            "RELEASE_CONTENT_EXTRA",
            "Unlisted directory in installed payload",
            rel,
          );
        else visit(target, rel);
        continue;
      }
      if (rel === manifestName) continue;
      const expected = manifest.files[rel];
      if (!expected) {
        bad("RELEASE_CONTENT_EXTRA", "Unlisted installed file", rel);
        continue;
      }
      seen.add(rel);
      if (!info.isFile()) {
        bad(
          "RELEASE_CONTENT_KIND",
          "Installed entry is not a regular file",
          rel,
        );
        continue;
      }
      if (digestOf(fs.readFileSync(target)) !== expected.sha256)
        bad(
          "RELEASE_CONTENT_DIGEST",
          "Installed bytes differ from the sealed manifest",
          rel,
        );
      if (platform !== "win32" && expected.executable && !(info.mode & 0o111))
        bad(
          "RELEASE_EXECUTABLE_MODE",
          "Required launcher has no executable mode",
          rel,
        );
    }
  }
  try {
    visit(home);
  } catch (error) {
    bad("RELEASE_CONTENT_UNREADABLE", error.message, home);
  }
  for (const file of Object.keys(manifest.files))
    if (!seen.has(file))
      bad(
        "RELEASE_CONTENT_MISSING",
        "Required installed file is missing",
        file,
      );
  return diagnostics;
}
function validateManifest(value, record) {
  if (
    !object(value) ||
    value.manifestVersion !== "1" ||
    value.release !== record.release ||
    value.sourceCommit !== record.sourceCommit ||
    !object(value.files) ||
    !Object.keys(value.files).length
  )
    throw new Error("Invalid installed manifest shape or release identity");
  for (const [file, spec] of Object.entries(value.files)) {
    if (
      !safePath(file) ||
      file === record.payloadManifest.asset ||
      !object(spec) ||
      typeof spec.sha256 !== "string" ||
      !digestPattern.test(spec.sha256) ||
      typeof spec.executable !== "boolean"
    )
      throw new Error(`Invalid installed manifest file entry: ${file}`);
  }
  for (const file of [
    "bin/ds-skills",
    "bin/ds-skills.cmd",
    "lib/bin/ds-skills.mjs",
    "lib/release.json",
    "lib/skills/RELEASE.json",
    "lib/package.json",
  ])
    if (!Object.hasOwn(value.files, file))
      throw new Error(`Manifest omits required entry ${file}`);
}
function safePath(value) {
  return (
    value.length > 0 &&
    !value.includes("\\") &&
    !value.includes(":") &&
    !value.startsWith("/") &&
    value.split("/").every((s) => s && s !== "." && s !== "..") &&
    [...value].every((s) => s.charCodeAt(0) >= 32)
  );
}
function requireRegular(file) {
  if (!fs.lstatSync(file).isFile())
    throw new Error("Installed manifest is missing or not a regular file");
}
