import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { statusError } from "./status.mjs";
export function capturePublicationBuild(buildDir, storyIds) {
  const files = [];
  let size = 0;
  function scan(dir) {
    if (!fs.lstatSync(dir).isDirectory())
      throw statusError("Prebuilt Storybook must be a real directory");
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name),
        info = fs.lstatSync(file);
      if (info.isDirectory()) {
        scan(file);
        continue;
      }
      if (!info.isFile())
        throw statusError("Prebuilt Storybook contains a non-regular file");
      size += info.size;
      if (
        files.length >= 20000 ||
        size > 512 * 1024 * 1024 ||
        info.size > 100 * 1024 * 1024
      )
        throw statusError("Prebuilt Storybook exceeds supported size limits");
      files.push([
        path.relative(buildDir, file).split(path.sep).join("/"),
        crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
      ]);
    }
  }
  try {
    scan(buildDir);
    for (const name of ["index.html", "iframe.html", "index.json"])
      if (!files.some(([f]) => f === name))
        throw statusError("Prebuilt Storybook lacks required HTML/index files");
    const index = JSON.parse(
      fs.readFileSync(path.join(buildDir, "index.json"), "utf8"),
    );
    if (
      index.v !== 5 ||
      !index.entries ||
      !storyIds.every(
        (id) =>
          Object.hasOwn(index.entries, id) &&
          index.entries[id]?.id === id &&
          index.entries[id]?.type === "story",
      )
    )
      throw statusError(
        "Prebuilt Storybook index v5 does not contain the current review scope",
      );
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(files))
      .digest("hex");
  } catch (error) {
    if (error.code === "CHROMATIC_INPUT") throw error;
    throw statusError("Cannot inspect the configured prebuilt Storybook");
  }
}
export function assertPublicationBuild(buildDir, storyIds, digest) {
  if (capturePublicationBuild(buildDir, storyIds) !== digest)
    throw statusError(
      "Prebuilt Storybook changed during publication; remote side effect may already exist",
    );
}
