import fs from "node:fs";
import path from "node:path";
import { fileBytes, hostError, info } from "./paths.mjs";
import { digestOf } from "../install/integrity.mjs";

export const surfaces = [".agents", ".claude"];
const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
export function safeSegments(relative) {
  return (
    typeof relative === "string" &&
    relative
      .split("/")
      .every(
        (part) =>
          /^[a-zA-Z0-9_.-]+$/.test(part) &&
          part !== "." &&
          part !== ".." &&
          !part.endsWith(".") &&
          !reserved.test(part),
      )
  );
}
export function managedRoot(relative) {
  if (relative === ".ds-skills/project.mjs") return null;
  const [surface, group, name, ...rest] = relative.split("/");
  if (!safeSegments(relative) || !surfaces.includes(surface))
    throw hostError(`Invalid managed output path: ${relative}`);
  if (
    group === "skills" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) &&
    rest.length
  )
    return `${surface}/skills/${name}`;
  if (["schemas", "templates"].includes(group) && name)
    return `${surface}/${group}`;
  throw hostError(
    `Output is outside managed skill or support roots: ${relative}`,
  );
}
export function parentDirectories(files) {
  const directories = new Set();
  for (const relative of files) {
    let parent = path.posix.dirname(relative);
    while (parent !== ".") {
      directories.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  return directories;
}
export function confinedPath(root, relative) {
  if (!safeSegments(relative))
    throw hostError(`Unsafe installation path: ${relative}`);
  const parts = relative.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const file = path.join(root, ...parts.slice(0, i)),
      stat = info(file);
    if (stat && !fs.readdirSync(path.dirname(file)).includes(parts[i - 1]))
      throw hostError(`Case-aliased output path: ${file}`);
    if (
      i < parts.length &&
      stat &&
      (!stat.isDirectory() || stat.isSymbolicLink())
    )
      throw hostError(`Expected a real output parent: ${file}`);
  }
  return path.join(root, ...parts);
}
function readTree(root, manifest, group) {
  const entries = {};
  function visit(directory, relative = "") {
    const stat = info(directory);
    if (!stat?.isDirectory() || stat.isSymbolicLink())
      throw hostError(
        `Missing or non-directory release asset group: ${directory}`,
      );
    for (const name of fs.readdirSync(directory).sort()) {
      const key = relative ? `${relative}/${name}` : name,
        file = path.join(directory, name);
      if (!safeSegments(key))
        throw hostError(`Unsupported release asset name: ${key}`);
      const child = info(file);
      if (child?.isDirectory() && !child.isSymbolicLink()) visit(file, key);
      else {
        const bytes = fileBytes(file),
          spec = manifest.files[`lib/${group}/${key}`];
        if (!bytes || !spec || digestOf(bytes) !== spec.sha256)
          throw hostError(
            `Release asset changed after verification: ${group}/${key}`,
          );
        entries[key] = { bytes, executable: spec.executable };
      }
    }
  }
  visit(root);
  if (!Object.keys(entries).length)
    throw hostError(`Release asset group is empty: ${root}`);
  return entries;
}
/** Preserve the package layout so ../../schemas and ../../templates still resolve.
 * Copies are verified generated outputs, never a second skill-authoring source.
 */
export function releaseSkillAssets(home, manifestDigest) {
  const bytes = fileBytes(path.join(home, "payload-manifest.json"));
  if (!bytes || digestOf(bytes) !== manifestDigest)
    throw hostError("Release manifest changed after verification");
  const manifest = JSON.parse(bytes);
  const root = path.join(home, "lib"),
    skills = path.join(root, "skills"),
    groups = {};
  const names = [];
  for (const name of fs.readdirSync(skills).sort()) {
    if (name === "RELEASE.json") continue;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || reserved.test(name))
      throw hostError(`Unsupported skill directory: ${name}`);
    const tree = readTree(path.join(skills, name), manifest, `skills/${name}`);
    if (!tree["SKILL.md"]?.bytes.length)
      throw hostError(`Skill ${name} needs a nonempty SKILL.md`);
    groups[`skills/${name}`] = tree;
    names.push(name);
  }
  if (!names.length)
    throw hostError("The selected release has no discoverable skills");
  for (const group of ["schemas", "templates"])
    groups[group] = readTree(path.join(root, group), manifest, group);
  const files = new Map(),
    folded = new Set();
  for (const surface of surfaces)
    for (const [group, entries] of Object.entries(groups))
      for (const [name, asset] of Object.entries(entries)) {
        const key = `${surface}/${group}/${name}`;
        if (folded.has(key.toLowerCase()))
          throw hostError(`Case-colliding release asset: ${key}`);
        folded.add(key.toLowerCase());
        files.set(key, asset);
      }
  validateOutputPaths([...files.keys()]);
  return { names, files };
}

export function validateOutputPaths(files) {
  const folded = new Set();
  for (const file of files) {
    managedRoot(file);
    if (folded.has(file.toLowerCase()))
      throw hostError(`Case-colliding output path: ${file}`);
    folded.add(file.toLowerCase());
  }
  for (const directory of parentDirectories(files))
    if (folded.has(directory.toLowerCase()))
      throw hostError(`File/directory collision: ${directory}`);
}
