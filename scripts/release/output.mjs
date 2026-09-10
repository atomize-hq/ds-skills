import fs from "node:fs";
import path from "node:path";

/** Never recursively delete a caller-selected directory to stage a candidate. */
export function prepareReleaseOutput(outDir, packageRoot) {
  const inside = (parent, child) => {
    const rel = path.relative(parent, child);
    return (
      rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
    );
  };
  const realOutput = canonical(outDir),
    realProduct = fs.realpathSync(packageRoot);
  if (
    inside(realOutput, realProduct) ||
    (inside(realProduct, realOutput) &&
      !inside(path.join(realProduct, "release"), realOutput)) ||
    inside(outDir, packageRoot) ||
    (inside(packageRoot, outDir) &&
      !inside(path.join(packageRoot, "release"), outDir))
  )
    throw new Error(
      "Release output cannot replace or overlap product source; use the generated release directory or an external staging directory",
    );
  let info;
  try {
    info = fs.lstatSync(outDir);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!info) {
    fs.mkdirSync(outDir, { recursive: true });
    return;
  }
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Release output must be a real directory");
  const files = fs.readdirSync(outDir);
  const fixed = new Set([
    "install.sh",
    "install.ps1",
    "SHA256SUMS",
    "ds-skills.release.json",
    "payload-manifest.json",
  ]);
  for (const file of files) {
    const archive =
      /^ds-skills-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-(?:macos_arm64|macos_x86_64|linux_x86_64|linux_aarch64|windows_x86_64)\.(?:tar\.gz|zip)$/.test(
        file,
      );
    if (
      (!fixed.has(file) && !archive) ||
      !fs.lstatSync(path.join(outDir, file)).isFile()
    )
      throw new Error(
        `Release output contains non-generated data: ${file}; nothing was removed`,
      );
  }
  for (const file of files) fs.unlinkSync(path.join(outDir, file));
}

function canonical(target) {
  let ancestor = path.resolve(target);
  const suffix = [];
  while (!fs.existsSync(ancestor)) {
    suffix.unshift(path.basename(ancestor));
    const parent = path.dirname(ancestor);
    if (parent === ancestor)
      throw new Error("Release output has no existing filesystem ancestor");
    ancestor = parent;
  }
  return path.join(fs.realpathSync(ancestor), ...suffix);
}
