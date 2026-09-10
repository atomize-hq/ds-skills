import fs from "node:fs";
import { CannotEvaluateError } from "../figma/profile.mjs";

export const releasePlatforms = [
  "macos_arm64",
  "macos_x86_64",
  "linux_x86_64",
  "linux_aarch64",
  "windows_x86_64",
];
export const digestPattern = /^[a-f0-9]{64}$/;
export function releaseError(code, message) {
  return new CannotEvaluateError(code, message);
}

/** A v2 reviewed pin seals the installed file manifest, not only version labels. */
export function readReleaseRecord(file) {
  let record;
  try {
    record = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw releaseError(
      "RELEASE_RECORD_INPUT",
      `Cannot read release record ${file}: ${error.message}`,
    );
  }
  return validateReleaseRecord(record);
}
export function validateReleaseRecord(record) {
  const fail = (message) => {
    throw releaseError("RELEASE_RECORD_INVALID", message);
  };
  if (!object(record) || record.recordVersion !== "2")
    fail(
      "A version-2 release record with sealed payload manifest is required; upgrade the reviewed pin, do not bypass integrity",
    );
  if (
    typeof record.repository !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(
      record.repository,
    )
  )
    fail("Invalid release repository");
  if (
    typeof record.release !== "string" ||
    !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/.test(record.release)
  )
    fail("Invalid release identifier");
  if (
    typeof record.sourceCommit !== "string" ||
    !/^[a-f0-9]{40}$/.test(record.sourceCommit)
  )
    fail("Release sourceCommit must be a full Git SHA");
  const asset = (value, name) => {
    if (
      !object(value) ||
      value.asset !== name ||
      typeof value.sha256 !== "string" ||
      !digestPattern.test(value.sha256)
    )
      fail(`Invalid ${name} digest record`);
  };
  asset(record.bootstrap, "install.sh");
  asset(record.bootstrapPowershell, "install.ps1");
  asset(record.checksums, "SHA256SUMS");
  asset(record.payloadManifest, "payload-manifest.json");
  if (
    !object(record.assets) ||
    Object.keys(record.assets).some((key) => !releasePlatforms.includes(key))
  )
    fail("Invalid release platform assets");
  for (const platform of releasePlatforms)
    asset(
      record.assets[platform],
      `ds-skills-${record.release}-${platform}.${platform.startsWith("windows") ? "zip" : "tar.gz"}`,
    );
  return record;
}
export function platformKey(platform = process.platform, arch = process.arch) {
  const value = {
    "darwin/arm64": "macos_arm64",
    "darwin/x64": "macos_x86_64",
    "linux/x64": "linux_x86_64",
    "linux/arm64": "linux_aarch64",
    "win32/x64": "windows_x86_64",
  }[`${platform}/${arch}`];
  if (!value)
    throw releaseError(
      "RELEASE_PLATFORM_UNSUPPORTED",
      `No tested release for ${platform}/${arch}. Supported: ${releasePlatforms.join(", ")}`,
    );
  return value;
}
export function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
