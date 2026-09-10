import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { sourceReader } from "../source-checks/inputs.mjs";
import { assertWritePath } from "../tokens/write-targets.mjs";
import { libraryError } from "./definition.mjs";
export function readLibraryFile(
  project,
  file,
  missing = false,
  maxFileBytes = 2 * 1024 * 1024,
) {
  return sourceReader(project.rootDir, { maxFileBytes }).read(file, missing);
}
const inside = (a, b) => {
  const r = path.relative(a, b);
  return r !== ".." && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r);
};
const overlap = (a, b) => inside(a, b) || inside(b, a);
export function preflightLibraryWrites(
  project,
  sourceFiles,
  writable,
  capability = "libraries",
) {
  const c = project[capability];
  if (!c) throw libraryError("Library evidence capability is not configured");
  const protectedPaths = [
    ...sourceFiles,
    ...[
      ".git",
      ".agents",
      ".claude",
      ".ds-skills",
      "ds-skills.release.json",
    ].map((p) => path.join(project.rootDir, p)),
  ];
  function collect(v, key = "") {
    if (key === "rootDir" || key === capability) return;
    if (typeof v === "string" && path.isAbsolute(v)) {
      protectedPaths.push(v);
      if (key === "lockPath") protectedPaths.push(`${v}.guard`);
    } else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) collect(x, k);
  }
  collect(project);
  protectedPaths.push(c.definition);
  if (c.evidence) protectedPaths.push(c.evidence.file);
  const targets = [c.candidate, c.lockPath, `${c.lockPath}.guard`];
  for (const [i, target] of targets.entries()) {
    if (
      protectedPaths.some((p) => overlap(p, target)) ||
      targets.slice(0, i).some((p) => overlap(p, target))
    )
      throw libraryError(
        "Candidate/lock overlaps pinned evidence, source or protected output",
      );
    if (writable)
      assertWritePath(project.rootDir, target, i === 1 ? "directory" : "file");
  }
}
export function writeLibraryCandidate(
  project,
  previous,
  bytes,
  assertInputs,
  { capability = "libraries", maxBytes = 2 * 1024 * 1024 } = {},
) {
  if (Buffer.byteLength(bytes) > maxBytes)
    throw libraryError(
      `Evidence packet exceeds ${maxBytes} bytes; narrow selected evidence`,
    );
  const target = project[capability].candidate;
  const assert = () => {
    assertInputs();
    if (readLibraryFile(project, target, true, maxBytes) !== previous)
      throw libraryError("Candidate changed; refusing overwrite");
  };
  assert();
  if (previous === bytes) return "unchanged";
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${crypto.randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(temp, bytes, {
      flag: "wx",
      mode: previous === null ? 0o600 : fs.statSync(target).mode & 0o777,
    });
    assert();
    fs.renameSync(temp, target);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return "written";
}
