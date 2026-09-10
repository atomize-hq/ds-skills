import { exact, fail, resolveProjectPath } from "./config.mjs";
export function readCuration(value, root) {
  if (value == null) return null;
  exact(
    value,
    ["definition", "candidate", "accepted", "review", "lockPath"],
    "curation",
  );
  const paths = Object.fromEntries(
    ["definition", "candidate", "lockPath"].map((k) => [
      k,
      resolveProjectPath(root, value[k], `curation.${k}`),
    ]),
  );
  for (const key of ["accepted", "review"]) {
    const v = value[key];
    if (v === null) {
      paths[key] = null;
      continue;
    }
    exact(v, ["file", "sha256"], `curation.${key}`);
    if (typeof v.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(v.sha256))
      fail(`curation.${key} requires exact SHA-256`);
    paths[key] = {
      file: resolveProjectPath(root, v.file, `curation.${key}`),
      sha256: v.sha256,
    };
  }
  return paths;
}
