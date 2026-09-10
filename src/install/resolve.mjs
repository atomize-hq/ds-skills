import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readReleaseRecord,
  validateReleaseRecord,
  platformKey,
  releaseError,
} from "./record.mjs";
import { verifyInstalledFiles } from "./integrity.mjs";

export function installPrefix(env = process.env, platform = process.platform) {
  const prefix =
    env.DS_SKILLS_PREFIX ||
    (platform === "win32"
      ? path.join(
          env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
          "ds-skills",
        )
      : path.join(env.HOME || os.homedir(), ".local", "share", "ds-skills"));
  return path.resolve(prefix);
}
/** Resolve bytes and identity from files. Never execute an install to decide to trust it. */
export function resolveRelease({
  recordPath,
  record,
  prefix = installPrefix(),
  platform = process.platform,
  arch = process.arch,
}) {
  const pin =
    record === undefined
      ? readReleaseRecord(recordPath)
      : validateReleaseRecord(record);
  const selected = platformKey(platform, arch);
  const home = path.join(path.resolve(prefix), pin.release);
  const executable = path.join(
    home,
    "bin",
    platform === "win32" ? "ds-skills.cmd" : "ds-skills",
  );
  const context = {
    release: pin.release,
    sourceCommit: pin.sourceCommit,
    platform: selected,
    prefix: path.resolve(prefix),
    home,
    executable,
    skillsDir: path.join(home, "lib", "skills"),
  };
  let info;
  try {
    info = fs.lstatSync(home);
  } catch (error) {
    if (error.code === "ENOENT")
      throw releaseError(
        "RELEASE_NOT_INSTALLED",
        `${pin.release} is not installed at ${home}. Install the reviewed pin explicitly; no PATH fallback is permitted.`,
      );
    throw releaseError("RELEASE_INSTALL_UNREADABLE", error.message);
  }
  if (!info.isDirectory() || info.isSymbolicLink())
    return {
      ok: false,
      ...context,
      diagnostics: [
        {
          code: "RELEASE_HOME_KIND",
          message:
            "Release home must be a real directory, not a symlink or file",
          path: home,
        },
      ],
    };
  const diagnostics = verifyInstalledFiles(home, pin, platform);
  if (!diagnostics.length) {
    for (const [file, code] of [
      ["lib/release.json", "RELEASE_IDENTITY_MISMATCH"],
      ["lib/skills/RELEASE.json", "RELEASE_SKILL_SKEW"],
    ]) {
      try {
        const identity = JSON.parse(
          fs.readFileSync(path.join(home, file), "utf8"),
        );
        if (
          identity?.release !== pin.release ||
          identity?.sourceCommit !== pin.sourceCommit
        )
          throw new Error(
            "Sealed CLI and skills identities must agree with the reviewed pin",
          );
      } catch (error) {
        diagnostics.push({ code, message: error.message, path: file });
      }
    }
  }
  return { ok: !diagnostics.length, ...context, diagnostics };
}
