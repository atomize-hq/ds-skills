import fs from "node:fs";
import path from "node:path";
import { digestOf } from "../install/integrity.mjs";
import { validateReleaseRecord } from "../install/record.mjs";
import { resolveRelease } from "../install/resolve.mjs";
import {
  projectPaths,
  fileBytes,
  hostError,
  launcherPath,
  equalBytes,
} from "./paths.mjs";
import { releaseSkillAssets } from "./assets.mjs";
import { readReceipt } from "./receipt.mjs";
import { outputDiagnostics } from "./managed.mjs";
export {
  projectPaths,
  fileBytes,
  hostError,
  launcherPath,
  receiptPath,
  pinPath,
  equalBytes,
  info,
} from "./paths.mjs";
export { readReceipt } from "./receipt.mjs";

export function desiredInstallation(root, prefix) {
  const paths = projectPaths(root),
    pinBytes = fileBytes(paths.pin);
  if (!pinBytes) throw hostError(`Missing reviewed pin: ${paths.pin}`);
  let record;
  try {
    record = validateReleaseRecord(JSON.parse(pinBytes));
  } catch (error) {
    throw hostError(`Invalid reviewed pin: ${error.message}`);
  }
  const release = resolveRelease({ record, prefix });
  if (!release.ok)
    throw hostError(
      `Selected release failed verification: ${release.diagnostics.map((d) => d.code).join(", ")}`,
    );
  const relative = path.relative(fs.realpathSync(release.home), paths.root);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  )
    throw hostError(
      "A project cannot be installed inside its selected immutable release",
    );
  const launcher = fileBytes(
    path.join(release.home, "lib/dist/project-host/launcher.mjs"),
  );
  if (!launcher)
    throw hostError("Selected release does not contain a project launcher");
  const assets = releaseSkillAssets(
      release.home,
      record.payloadManifest.sha256,
    ),
    files = assets.files;
  files.set(launcherPath, { bytes: launcher, executable: false });
  const receipt = {
    installationVersion: "2",
    release: record.release,
    sourceCommit: record.sourceCommit,
    pinSha256: digestOf(pinBytes),
    files: Object.fromEntries(
      [...files.keys()].sort().map((file) => [
        file,
        {
          sha256: digestOf(files.get(file).bytes),
          executable: files.get(file).executable,
        },
      ]),
    ),
  };
  return {
    paths,
    record,
    release,
    pinBytes,
    launcher,
    files,
    skills: assets.names,
    receipt,
    receiptBytes: Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`),
  };
}
export function checkProjectInstallation({ root, prefix }) {
  return checkDesiredInstallation(desiredInstallation(root, prefix));
}
export function checkDesiredInstallation(desired) {
  const diagnostics = [];
  let prior;
  try {
    const bytes = fileBytes(desired.paths.receipt);
    prior = readReceipt(bytes);
    if (!equalBytes(bytes, desired.receiptBytes))
      diagnostics.push({
        code: "PROJECT_RECEIPT_SKEW",
        path: desired.paths.receipt,
        message:
          "Missing or changed installed output receipt; run explicit project setup",
      });
  } catch (error) {
    diagnostics.push({
      code: "PROJECT_RECEIPT_INVALID",
      path: desired.paths.receipt,
      message: error.message,
    });
  }
  diagnostics.push(...outputDiagnostics(desired, prior));
  if (!equalBytes(fileBytes(desired.paths.pin), desired.pinBytes))
    diagnostics.push({
      code: "PROJECT_PIN_CHANGED",
      path: desired.paths.pin,
      message: "Reviewed pin changed during project verification",
    });
  return {
    ok: diagnostics.length === 0,
    root: desired.paths.root,
    release: desired.record.release,
    sourceCommit: desired.record.sourceCommit,
    skills: desired.skills,
    installedFileCount: desired.files.size,
    diagnostics,
  };
}
