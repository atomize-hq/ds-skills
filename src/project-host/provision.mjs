import path from "node:path";
import { validateReleaseRecord } from "../install/record.mjs";
import { resolveRelease, installPrefix } from "../install/resolve.mjs";
import { acquireRelease } from "../install/acquire.mjs";
import { projectPaths, fileBytes, equalBytes, hostError } from "./paths.mjs";
import { runPinnedAt } from "./invoke.mjs";
import { checkProjectInstallation } from "./state.mjs";

/** Explicit acquisition shared by the generated launcher and trusted CI setup.
 * Ordinary invocation never calls this function. No build/dev dependencies.
 */
export async function provisionProject({
  root,
  prefix = installPrefix(),
  baseUrl = process.env.DS_SKILLS_BASE_URL,
  capture = false,
}) {
  if (Number(process.versions.node.split(".")[0]) < 22)
    throw hostError("Project installation requires Node 22 or newer");
  const paths = projectPaths(root),
    pinBytes = fileBytes(paths.pin);
  if (!pinBytes) throw hostError(`Missing reviewed pin: ${paths.pin}`);
  let record;
  try {
    record = validateReleaseRecord(JSON.parse(pinBytes));
  } catch (error) {
    throw hostError(`Invalid reviewed pin: ${error.message}`);
  }
  let release;
  try {
    release = resolveRelease({ record, prefix });
  } catch (error) {
    if (error.code !== "RELEASE_NOT_INSTALLED") throw error;
  }
  if (!release?.ok) await acquireRelease({ record, prefix, baseUrl });
  const samePin = () => {
    if (!equalBytes(fileBytes(paths.pin), pinBytes))
      throw hostError("Reviewed pin changed during project acquisition/setup");
  };
  samePin();
  // Re-verification is inside runPinnedAt. Never trust bootstrap exit alone.
  const command = runPinnedAt(
    paths.root,
    ["project", "setup", "--root", paths.root],
    { prefix, capture, verifyProject: false },
  );
  samePin();
  if (command.status !== 0) return command;
  const check = checkProjectInstallation({ root: paths.root, prefix });
  samePin();
  if (!check.ok)
    throw hostError(
      "Selected setup exited successfully without establishing the complete project installation",
    );
  return {
    ...command,
    root: paths.root,
    release: record.release,
    sourceCommit: record.sourceCommit,
    prefix: path.resolve(prefix),
    home: path.join(path.resolve(prefix), record.release),
    launcher: paths.launcher,
  };
}
