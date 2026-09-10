import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { assertWritePath } from "../tokens/write-targets.mjs";
import { componentInputPaths, assertComponentInputs } from "./inputs.mjs";
import { componentError } from "./policy.mjs";
const inside = (a, b) => {
  const r = path.relative(a, b);
  return r !== ".." && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r);
};
const overlap = (a, b) => inside(a, b) || inside(b, a);
export function preflightComponentReport(project, { writable = true } = {}) {
  const c = project.components;
  if (!c) throw componentError("Component evidence policy is not configured");
  const protectedPaths = [
    ...componentInputPaths(project),
    ...[
      ".git",
      ".ds-skills",
      ".agents",
      ".claude",
      "ds-skills.release.json",
    ].map((p) => path.join(project.rootDir, p)),
  ];
  const tokens = project.tokens;
  if (tokens)
    protectedPaths.push(
      tokens.sourceDir,
      tokens.themes.registry,
      tokens.themes.directory,
      ...(tokens.recipesDir ? [tokens.recipesDir] : []),
      ...Object.values(tokens.build?.outputs ?? {}),
      ...Object.values(tokens.governance?.publication ?? {}),
    );
  for (const lock of [
    project.storybook?.proof?.lockPath,
    project.storybook?.chromatic?.lockPath,
    project.tokens?.build?.lockPath,
  ])
    if (lock) protectedPaths.push(lock, `${lock}.guard`);
  const targets = [c.report, c.lockPath, `${c.lockPath}.guard`];
  for (const [i, target] of targets.entries()) {
    if (
      protectedPaths.some((p) => overlap(p, target)) ||
      targets.slice(0, i).some((p) => overlap(p, target))
    )
      throw componentError(
        "Component report/lock overlaps protected inputs or another write target",
      );
    if (writable)
      assertWritePath(project.rootDir, target, i === 1 ? "directory" : "file");
  }
}
export function readComponentReport(file, root = path.dirname(file)) {
  let current = root;
  for (const segment of path.relative(root, file).split(path.sep)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink())
        throw componentError(
          "Component report read path contains a symbolic link",
        );
    } catch (error) {
      if (error.code === "ENOENT") return null;
      if (error.code === "COMPONENT_EVIDENCE_INPUT") throw error;
      throw componentError("Cannot inspect component report read path");
    }
  }
  try {
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.size > 4 * 1024 * 1024)
      throw componentError("Component report must be a bounded regular file");
    return fs.readFileSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error.code === "COMPONENT_EVIDENCE_INPUT") throw error;
    throw componentError("Cannot read component status report");
  }
}
export function checkComponentReport(
  bytes,
  expected,
  config,
  { now = new Date() } = {},
) {
  if (bytes === null)
    return {
      ok: false,
      diagnostics: [
        "[COMPONENT_REPORT_MISSING] Build a current component status report",
      ],
    };
  let data;
  try {
    data = JSON.parse(bytes.toString("utf8"));
  } catch {
    return {
      ok: false,
      diagnostics: ["[COMPONENT_REPORT_JSON] Invalid report JSON"],
    };
  }
  const diagnostics = [];
  const { generatedAt: ignored, ...current } = expected;
  void ignored;
  if (!data || typeof data !== "object" || Array.isArray(data))
    return {
      ok: false,
      diagnostics: ["[COMPONENT_REPORT_SHAPE] Expected a status object"],
    };
  const { generatedAt, ...stored } = data;
  const timestamp =
    typeof generatedAt === "string" ? Date.parse(generatedAt) : NaN;
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== generatedAt ||
    timestamp > new Date(now).getTime() + 60000 ||
    new Date(now).getTime() - timestamp > config.maxAgeMinutes * 60000
  )
    diagnostics.push(
      "[COMPONENT_REPORT_TIME] Report timestamp is invalid, future or stale",
    );
  if (JSON.stringify(stored) !== JSON.stringify(current))
    diagnostics.push(
      "[COMPONENT_REPORT_STALE] Stored report does not equal current source-derived evidence and policy",
    );
  return { ok: diagnostics.length === 0, diagnostics };
}
export function publishComponentReport(project, snapshot, report, previous) {
  const target = project.components.report,
    bytes = Buffer.from(JSON.stringify(report, null, 2) + "\n");
  if (bytes.length > 4 * 1024 * 1024)
    throw componentError("Generated component report exceeds size limit");
  const assert = () => {
    preflightComponentReport(project);
    assertComponentInputs(project, snapshot);
    const actual = readComponentReport(target);
    if (
      (actual === null) !== (previous === null) ||
      (actual && !actual.equals(previous))
    )
      throw componentError(
        "Component report changed during evaluation; refusing overwrite",
      );
  };
  assert();
  if (checkComponentReport(previous, report, project.components).ok)
    return "unchanged";
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${crypto.randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(temp, bytes, {
      flag: "wx",
      mode: previous ? fs.statSync(target).mode & 0o777 : 0o644,
    });
    assert();
    fs.renameSync(temp, target);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return "written";
}
