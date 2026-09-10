import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CannotEvaluateError } from "../figma/profile.mjs";
import { resolveProjectPath } from "../project/config.mjs";
export const sourceError = (message) =>
  new CannotEvaluateError("SOURCE_CHECK_INPUT", message);
export function sourceReader(
  root,
  { maxFileBytes = 2 * 1024 * 1024, maxTotalBytes = 16 * 1024 * 1024 } = {},
) {
  const files = new Map();
  let total = 0,
    entries = 0;
  function stat(file, missing = false) {
    resolveProjectPath(root, path.relative(root, file), "source check input");
    let current = root,
      info;
    for (const part of path.relative(root, file).split(path.sep)) {
      current = path.join(current, part);
      try {
        info = fs.lstatSync(current);
      } catch (error) {
        if (missing && error.code === "ENOENT") return null;
        throw sourceError("Cannot inspect configured source input");
      }
      if (info.isSymbolicLink())
        throw sourceError("Source check inputs cannot traverse symbolic links");
    }
    return info;
  }
  function read(file, missing = false) {
    if (files.has(file)) return files.get(file);
    const info = stat(file, missing);
    if (info === null) {
      files.set(file, null);
      return null;
    }
    if (!info.isFile())
      throw sourceError("Source check expects a regular file");
    total += info.size;
    if (
      info.size > maxFileBytes ||
      total > maxTotalBytes ||
      files.size >= 10000
    )
      throw sourceError("Source check inputs exceed supported limits");
    try {
      const text = fs.readFileSync(file, "utf8");
      files.set(file, text);
      return text;
    } catch {
      throw sourceError("Cannot read source input");
    }
  }
  function list(dir, extensions, recursive, depth = 0) {
    if (depth > 64)
      throw sourceError("Source directory nesting exceeds supported limits");
    if (!stat(dir)?.isDirectory())
      throw sourceError("Source scope must be an existing directory");
    const selected = [];
    let names;
    try {
      names = fs.readdirSync(dir).sort();
    } catch {
      throw sourceError("Cannot read configured source directory");
    }
    entries += names.length;
    if (entries > 20000)
      throw sourceError("Source directory entries exceed supported limits");
    for (const name of names) {
      const file = path.join(dir, name),
        info = stat(file);
      if (info.isDirectory()) {
        if (recursive)
          selected.push(...list(file, extensions, true, depth + 1));
        continue;
      }
      if (!info.isFile())
        throw sourceError("Source scope contains a non-regular entry");
      if (
        extensions.some((e) => name.endsWith(e)) &&
        !/\.(stories|test|spec)\.[^.]+$/.test(name)
      ) {
        read(file);
        selected.push(file);
      }
    }
    return selected;
  }
  return {
    files,
    read,
    list,
    identity: () =>
      crypto
        .createHash("sha256")
        .update(
          JSON.stringify(
            [...files]
              .map(([f, s]) => [
                path.relative(root, f).split(path.sep).join("/"),
                s,
              ])
              .sort(([a], [b]) => a.localeCompare(b)),
          ),
        )
        .digest("hex"),
  };
}
