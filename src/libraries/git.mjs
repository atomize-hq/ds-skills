import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { libraryError } from "./definition.mjs";
const env = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
  );
function git(root, args) {
  return execFileSync(
    "git",
    ["--no-pager", "-c", "core.fsmonitor=false", "-C", root, ...args],
    {
      env: env(),
      maxBuffer: 3 * 1024 * 1024,
      timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}
export function revisionReader(root, revision) {
  if (revision.mode === "content") return () => ({ kind: "content-only" });
  let gitRoot;
  try {
    gitRoot = git(root, ["rev-parse", "--show-toplevel"])
      .toString("utf8")
      .trim();
    const commit = git(root, [
      "rev-parse",
      "--verify",
      `${revision.commit}^{commit}`,
    ])
      .toString("utf8")
      .trim();
    if (commit !== revision.commit) throw new Error("Commit mismatch");
  } catch {
    throw libraryError("Exact configured Git commit is unavailable");
  }
  return (file, content) => {
    const relative = path
      .relative(fs.realpathSync(gitRoot), fs.realpathSync(file))
      .split(path.sep)
      .join("/");
    if (
      relative === ".." ||
      relative.startsWith("../") ||
      path.isAbsolute(relative)
    )
      throw libraryError(
        "Evidence source is outside the selected Git repository",
      );
    let entry, bytes;
    try {
      entry = git(gitRoot, [
        "ls-tree",
        "-z",
        revision.commit,
        "--",
        `:(literal)${relative}`,
      ]).toString("utf8");
      if (entry)
        bytes = git(gitRoot, [
          "cat-file",
          "blob",
          `${revision.commit}:${relative}`,
        ]);
    } catch {
      throw libraryError("Cannot inspect committed source evidence");
    }
    const regular = /^100(?:644|755) blob [a-f0-9]+\t/.test(entry);
    const matches = regular && bytes.equals(Buffer.from(content));
    if (revision.mode === "committed" && !matches)
      throw libraryError(
        `Selected file does not match the configured commit: ${relative}`,
      );
    return {
      kind: revision.mode,
      commit: revision.commit,
      regularFileAtCommit: regular,
      matchesCommit: matches,
    };
  };
}
