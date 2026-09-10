import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { assertWritePath } from "../tokens/write-targets.mjs";
import { assertChromaticContext, readStatusBytes } from "./context.mjs";
import { statusError } from "./status.mjs";
export function preflightStatusWrites(project) {
  const c = project.storybook,
    r = c.chromatic,
    p = c.proof;
  const protectedPaths = [
    project.configPath,
    c.inventory,
    c.tierPolicy,
    c.versionPolicy,
    p.componentSpecs,
    ...p.storyRoots,
    p.coverage,
    p.lockPath,
    `${p.lockPath}.guard`,
    path.join(project.rootDir, "ds-skills.release.json"),
    path.join(project.rootDir, ".ds-skills"),
  ];
  const targets = [r.status, r.lockPath, `${r.lockPath}.guard`];
  for (const [index, target] of targets.entries()) {
    if (
      protectedPaths.some((input) => overlap(input, target)) ||
      targets.slice(0, index).some((other) => overlap(target, other))
    )
      throw statusError(
        "Status write paths overlap protected proof inputs or each other",
      );
    assertWritePath(
      project.rootDir,
      target,
      index === 1 ? "directory" : "file",
    );
  }
}
function overlap(a, b) {
  return within(a, b) || within(b, a);
}
function within(a, b) {
  const rel = path.relative(a, b);
  return (
    rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
  );
}
export function commitStatusBytes(project, context, bytes, previous) {
  const file = project.storybook.chromatic.status;
  assertChromaticContext(project, context);
  preflightStatusWrites(project);
  const actual = readStatusBytes(file);
  if (
    (actual === null) !== (previous === null) ||
    (actual && !actual.equals(previous))
  )
    throw statusError(
      "Status artifact changed during restoration; refusing overwrite",
    );
  if (actual?.equals(bytes)) return "unchanged";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${crypto.randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(temp, bytes, {
      flag: "wx",
      mode: actual ? fs.statSync(file).mode & 0o777 : 0o644,
    });
    assertChromaticContext(project, context);
    preflightStatusWrites(project);
    const current = readStatusBytes(file);
    if (
      (current === null) !== (previous === null) ||
      (current && !current.equals(previous))
    )
      throw statusError("Status changed before publication");
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return "written";
}
