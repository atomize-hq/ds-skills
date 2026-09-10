import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPinnedAt, readPinnedResultAt } from "./invoke.mjs";
import { hostError } from "./paths.mjs";
import { provisionProject } from "./provision.mjs";

// Bundled verbatim into the release. No consumer paths or release labels baked in.
const moduleFile = fileURLToPath(import.meta.url);
const boundRoot = path.dirname(path.dirname(moduleFile));
export function runPinned(args, options) {
  return runPinnedAt(boundRoot, args, { ...options, verifyProject: true });
}
export function readPinnedResult(args, expectedCommand, options) {
  return readPinnedResultAt(boundRoot, args, expectedCommand, options);
}

async function main(args) {
  if (args[0] === "--install") {
    if (args.length !== 1)
      throw hostError(
        "Use --install alone; DS_SKILLS_PREFIX and DS_SKILLS_BASE_URL select acquisition locations",
      );
    return (await provisionProject({ root: boundRoot })).status;
  }
  if (args[0] === "--check") {
    if (args.length !== 1) throw hostError("Use --check alone");
    return runPinned(["project", "check", "--root", boundRoot]).status;
  }
  if (
    args[0]?.startsWith("-") &&
    !["--help", "--version", "-h", "-V"].includes(args[0])
  )
    throw hostError(`Unknown launcher option: ${args[0]}`);
  return runPinned(args).status;
}
function isMain() {
  try {
    return (
      Boolean(process.argv[1]) &&
      fs.realpathSync(process.argv[1]) === fs.realpathSync(moduleFile)
    );
  } catch {
    return false;
  }
}
if (isMain()) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `[${error.code ?? "PROJECT_LAUNCH_FAILED"}] ${error.message}\n`,
    );
    process.exitCode = error.name === "CannotEvaluateError" ? 2 : 3;
  }
}
