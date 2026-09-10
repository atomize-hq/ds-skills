import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  desiredInstallation,
  checkDesiredInstallation,
  hostError,
} from "./state.mjs";

function target(root, prefix, verifyProject) {
  const desired = desiredInstallation(root, prefix);
  if (verifyProject) {
    const check = checkDesiredInstallation(desired);
    if (!check.ok)
      throw hostError(
        check.diagnostics.map((d) => `${d.path}: ${d.message}`).join("\n"),
      );
  }
  return desired;
}
export function runPinnedAt(
  root,
  args,
  { prefix, verifyProject = true, capture = false } = {},
) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string"))
    throw hostError("CLI arguments must be strings");
  const desired = target(root, prefix, verifyProject);
  const child = spawnSync(
    process.execPath,
    [path.join(desired.release.home, "lib/bin/ds-skills.mjs"), ...args],
    {
      cwd: desired.paths.root,
      env: { ...process.env, DS_SKILLS_PREFIX: desired.release.prefix },
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (child.error || child.signal || child.status === null)
    throw hostError(
      `Pinned command did not complete: ${child.error?.message ?? child.signal ?? "no status"}`,
    );
  return {
    status: child.status,
    stdout: child.stdout ?? "",
    stderr: child.stderr ?? "",
  };
}
export function readPinnedResultAt(root, args, expectedCommand, options = {}) {
  if (
    typeof expectedCommand !== "string" ||
    !/^[a-z]+(?: [a-z]+)*$/.test(expectedCommand) ||
    !Array.isArray(args) ||
    !expectedCommand.split(" ").every((part, index) => args[index] === part)
  )
    throw hostError(
      "Machine caller must specify the exact requested command identity",
    );
  const child = runPinnedAt(
    root,
    args.includes("--json") ? args : [...args, "--json"],
    { ...options, verifyProject: true, capture: true },
  );
  if (child.status !== 0 && child.status !== 1)
    throw hostError(
      `Pinned command could not evaluate (exit ${child.status}): ${child.stderr.trim()}`,
    );
  let result;
  try {
    result = JSON.parse(child.stdout);
  } catch {
    throw hostError("Pinned command did not return a single JSON result");
  }
  if (
    !result ||
    Array.isArray(result) ||
    result.resultVersion !== "1" ||
    result.command !== expectedCommand ||
    typeof result.ok !== "boolean" ||
    result.ok !== (child.status === 0)
  )
    throw hostError(
      "Pinned command result version, identity or conformance disagrees with its exit status",
    );
  return { evaluated: true, status: child.status, result };
}
