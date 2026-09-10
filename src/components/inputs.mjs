import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { loadProject, resolveProjectPath } from "../project/config.mjs";
import { componentError } from "./policy.mjs";
export function componentInputPaths(project) {
  const s = project.storybook,
    p = s?.proof,
    c = s?.chromatic,
    f = project.tokens?.governance?.publication;
  return [
    project.configPath,
    ...(s ? [s.inventory, s.tierPolicy, s.versionPolicy] : []),
    ...(p ? [p.componentSpecs, ...p.storyRoots, p.coverage] : []),
    ...(c ? [c.status] : []),
    ...(f ? [f.ledger, f.profile, f.proof] : []),
  ];
}
export function componentHead(project) {
  try {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
    );
    const sha = execFileSync(
      "git",
      ["--no-optional-locks", "rev-parse", "--verify", "HEAD"],
      {
        cwd: project.rootDir,
        env: { ...env, GIT_TERMINAL_PROMPT: "0" },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
    if (!/^[a-f0-9]{40}$/.test(sha)) throw Error();
    return sha;
  } catch {
    throw componentError("Cannot resolve current project Git HEAD");
  }
}
export function captureComponentInputs(project) {
  const current = loadProject(project.configPath, { rootDir: project.rootDir });
  if (JSON.stringify(current) !== JSON.stringify(project))
    throw componentError(
      "Project configuration changed; reload before evaluation",
    );
  const files = new Map();
  let total = 0;
  function read(file) {
    const rel = path.relative(project.rootDir, file).split(path.sep).join("/");
    if (files.has(rel)) return;
    resolveProjectPath(project.rootDir, rel, "component evidence input");
    let info;
    try {
      info = fs.lstatSync(file);
    } catch (error) {
      if (error.code === "ENOENT") {
        files.set(rel, null);
        return;
      }
      throw error;
    }
    if (info.isDirectory()) {
      files.set(rel, { directory: true });
      for (const name of fs.readdirSync(file).sort())
        read(path.join(file, name));
      return;
    }
    if (!info.isFile())
      throw componentError(
        "Component evidence paths must contain regular files/directories, not links",
      );
    total += info.size;
    if (
      info.size > 16 * 1024 * 1024 ||
      total > 128 * 1024 * 1024 ||
      files.size > 20000
    )
      throw componentError("Component evidence input exceeds size limits");
    files.set(
      rel,
      crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
    );
  }
  try {
    for (const file of componentInputPaths(project)) read(file);
  } catch (error) {
    if (
      error.code === "COMPONENT_EVIDENCE_INPUT" ||
      error.code === "PROJECT_CONFIG"
    )
      throw error;
    throw componentError("Cannot snapshot component evidence inputs");
  }
  const revision = componentHead(project),
    identity = JSON.stringify(
      [...files].sort(([a], [b]) => a.localeCompare(b)),
    );
  return {
    revision,
    identity,
    digest: crypto.createHash("sha256").update(identity).digest("hex"),
  };
}
export function assertComponentInputs(project, snapshot) {
  const current = captureComponentInputs(project);
  if (
    current.revision !== snapshot.revision ||
    current.identity !== snapshot.identity
  )
    throw componentError(
      "Component evidence inputs or Git HEAD changed during evaluation",
    );
}
