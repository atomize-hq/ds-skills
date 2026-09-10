import { object, digestPattern } from "../install/record.mjs";
import { hostError, launcherPath } from "./paths.mjs";
import { validateOutputPaths } from "./assets.mjs";

export function readReceipt(bytes) {
  if (bytes === null) return null;
  try {
    const value = JSON.parse(bytes),
      version = value?.installationVersion;
    const keys = [
      "installationVersion",
      "release",
      "sourceCommit",
      "pinSha256",
      version === "1" ? "launcherSha256" : "files",
    ];
    if (
      !object(value) ||
      !["1", "2"].includes(version) ||
      Object.keys(value).length !== keys.length ||
      Object.keys(value).some((key) => !keys.includes(key)) ||
      typeof value.release !== "string" ||
      !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/.test(value.release) ||
      typeof value.sourceCommit !== "string" ||
      !/^[a-f0-9]{40}$/.test(value.sourceCommit) ||
      typeof value.pinSha256 !== "string" ||
      !digestPattern.test(value.pinSha256)
    )
      throw new Error("Unrecognized installation receipt");
    // The unpublished launcher-only receipt grants ownership of exactly one file.
    if (version === "1") {
      if (
        typeof value.launcherSha256 !== "string" ||
        !digestPattern.test(value.launcherSha256)
      )
        throw new Error("Invalid launcher digest");
      return {
        ...value,
        files: {
          [launcherPath]: { sha256: value.launcherSha256, executable: false },
        },
      };
    }
    if (!object(value.files) || !Object.hasOwn(value.files, launcherPath))
      throw new Error("Missing owned-file manifest");
    validateOutputPaths(Object.keys(value.files));
    for (const [file, entry] of Object.entries(value.files)) {
      if (
        !object(entry) ||
        Object.keys(entry).length !== 2 ||
        typeof entry.sha256 !== "string" ||
        !digestPattern.test(entry.sha256) ||
        typeof entry.executable !== "boolean"
      )
        throw new Error(`Invalid file digest/mode: ${file}`);
    }
    return value;
  } catch (error) {
    throw hostError(`Invalid installation receipt: ${error.message}`);
  }
}
