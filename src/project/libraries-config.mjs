import { exact, fail, resolveProjectPath } from "./config.mjs";
export function readLibraries(value, root, label = "libraries") {
  if (value == null) return null;
  exact(value, ["definition", "evidence", "candidate", "lockPath"], label);
  const paths = Object.fromEntries(
    ["definition", "candidate", "lockPath"].map((k) => [
      k,
      resolveProjectPath(root, value[k], `${label}.${k}`, {
        cooperativeLockDirectory: k === "lockPath",
      }),
    ]),
  );
  let evidence = null;
  if (value.evidence !== null) {
    exact(value.evidence, ["file", "sha256"], `${label}.evidence`);
    if (
      typeof value.evidence.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.evidence.sha256)
    )
      fail("Library evidence needs an exact SHA-256 pin");
    evidence = {
      file: resolveProjectPath(root, value.evidence.file, "library evidence"),
      sha256: value.evidence.sha256,
    };
  }
  return { ...paths, evidence };
}
