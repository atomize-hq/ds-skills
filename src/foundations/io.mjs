import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { sourceReader } from "../source-checks/inputs.mjs";
import { loadProject } from "../project/config.mjs";
import { assertWritePath } from "../tokens/write-targets.mjs";
import { CannotEvaluateError } from "../figma/profile.mjs";
export const ioError = (message) =>
  new CannotEvaluateError("FOUNDATIONS_IO", message);
const inside = (a, b) => {
  const r = path.relative(a, b);
  return r !== ".." && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r);
};
const overlap = (a, b) => inside(a, b) || inside(b, a);
export function preflightFoundationPaths(project, writable) {
  const c = project.foundations;
  if (!c) throw ioError("Foundations capability is not configured");
  const protectedPaths = [
    project.configPath,
    c.artifact,
    c.model,
    c.presentation,
    ...[
      ".git",
      ".agents",
      ".claude",
      ".ds-skills",
      "ds-skills.release.json",
    ].map((p) => path.join(project.rootDir, p)),
  ];
  function collect(value, key = "") {
    if (key === "rootDir" || key === "foundations") return;
    if (typeof value === "string" && path.isAbsolute(value)) {
      protectedPaths.push(value);
      if (key === "lockPath") protectedPaths.push(`${value}.guard`);
    } else if (value && typeof value === "object")
      for (const [k, v] of Object.entries(value)) collect(v, k);
  }
  collect(project);
  const targets = [c.output, c.lockPath, `${c.lockPath}.guard`];
  for (const [i, target] of targets.entries()) {
    if (
      protectedPaths.some((p) => overlap(p, target)) ||
      targets.slice(0, i).some((p) => overlap(p, target))
    )
      throw ioError(
        "Foundations output/lock overlaps an input, protected path or another write target",
      );
    if (writable)
      assertWritePath(project.rootDir, target, i === 1 ? "directory" : "file");
  }
}
export function captureFoundationInputs(project) {
  if (
    JSON.stringify(
      loadProject(project.configPath, { rootDir: project.rootDir }),
    ) !== JSON.stringify(project)
  )
    throw ioError("Project config changed");
  const reader = sourceReader(project.rootDir);
  reader.read(project.configPath);
  const content = Object.fromEntries(
    ["artifact", "model", "presentation"].map((k) => [
      k,
      reader.read(project.foundations[k]),
    ]),
  );
  return { content, identity: reader.identity() };
}
export function readFoundationOutput(project) {
  return sourceReader(project.rootDir).read(project.foundations.output, true);
}
export function writeFoundationOutput(project, snapshot, previous, script) {
  if (Buffer.byteLength(script) > 2 * 1024 * 1024)
    throw ioError("Generated script exceeds 2 MiB");
  const assert = () => {
    preflightFoundationPaths(project, true);
    if (
      captureFoundationInputs(project).identity !== snapshot.identity ||
      readFoundationOutput(project) !== previous
    )
      throw ioError("Foundations inputs/output changed; refusing overwrite");
  };
  assert();
  if (previous === script) return "unchanged";
  const target = project.foundations.output;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${crypto.randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(temp, script, {
      flag: "wx",
      mode: previous === null ? 0o644 : fs.statSync(target).mode & 0o777,
    });
    assert();
    fs.renameSync(temp, target);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return "written";
}
