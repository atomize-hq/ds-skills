import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  captureProofInputs,
  assertProofInputsUnchanged,
} from "../storybook/proof-inputs.mjs";
import { validateStorybookProofStructure } from "../storybook/proof-structure.mjs";
import { statusError } from "./status.mjs";
export function prepareChromaticContext(project, gitSha) {
  if (!project.storybook?.chromatic)
    throw statusError("Chromatic capability is not configured");
  const expectedGitSha = gitSha ?? readHead(project.rootDir);
  if (!/^[a-f0-9]{40}$/.test(expectedGitSha))
    throw statusError("Expected revision must be a full lowercase Git SHA");
  const snapshot = captureProofInputs(project);
  const structure = validateStorybookProofStructure(project, snapshot);
  if (!structure.ok) return { ok: false, errors: structure.errors };
  const inventory = JSON.parse(snapshot.files.get(project.storybook.inventory));
  const components = inventory.components;
  const scope = {
    componentIds: components.map((c) => c.componentId),
    storyIds: [
      ...new Set(
        components.flatMap((c) => c.implementedStoryRefs.map((r) => r.storyId)),
      ),
    ],
    componentTiers: Object.fromEntries(
      structure.componentFacts.map((c) => [c.componentId, c.tier]),
    ),
  };
  if (!scope.componentIds.length || !scope.storyIds.length)
    return {
      ok: false,
      errors: [
        "[CHROMATIC_EMPTY_SCOPE] Review requires a nonempty current component/story scope",
      ],
    };
  return {
    ok: true,
    snapshot,
    headBound: gitSha === undefined,
    options: {
      ...project.storybook.chromatic,
      expectedGitSha,
      scope,
      inventoryVersion: inventory.inventoryVersion,
      inventoryPath: path
        .relative(project.rootDir, project.storybook.inventory)
        .split(path.sep)
        .join("/"),
    },
  };
}
export function assertChromaticContext(project, context) {
  assertProofInputsUnchanged(project, context.snapshot);
  if (
    context.headBound &&
    readHead(project.rootDir) !== context.options.expectedGitSha
  )
    throw statusError("Git HEAD changed during review status evaluation");
}
function readHead(root) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  try {
    return execFileSync(
      "git",
      ["--no-optional-locks", "rev-parse", "--verify", "HEAD"],
      {
        cwd: root,
        env: { ...env, GIT_TERMINAL_PROMPT: "0" },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
  } catch {
    throw statusError(
      "Cannot resolve project Git HEAD; pass --sha for an explicitly selected revision",
    );
  }
}
export function readStatusBytes(file) {
  try {
    const info = fs.lstatSync(file);
    if (info.size > 1024 * 1024)
      throw statusError("Status artifact exceeds the 1 MiB size limit");
    if (!info.isFile()) throw statusError("Status must be a regular file");
    return fs.readFileSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw statusError("Cannot read the status artifact");
  }
}
export function parseStatusBytes(bytes) {
  if (bytes === null) throw statusError("Status artifact is missing");
  if (bytes.length > 1024 * 1024)
    throw statusError("Status artifact exceeds the 1 MiB size limit");
  try {
    return { data: JSON.parse(bytes.toString("utf8")), errors: [] };
  } catch {
    return {
      data: null,
      errors: ["[CHROMATIC_STATUS_JSON] Status is not valid JSON"],
    };
  }
}
