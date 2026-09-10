import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  fileBytes,
  equalBytes,
  hostError,
  info,
  projectPaths,
} from "./paths.mjs";
import { confinedPath, managedRoot, parentDirectories } from "./assets.mjs";
import { preflightOutputs, matches } from "./managed.mjs";

/** Files stage before commit; receipt is last. No recursive arbitrary deletion. */
export function writeInstallation(
  desired,
  prior,
  before,
  receiptBefore,
  {
    receiptRelative = ".ds-skills/installation.json",
    assertInputs = () => {},
  } = {},
) {
  if (
    ![".ds-skills/installation.json", ".ds-skills/curation.json"].includes(
      receiptRelative,
    ) ||
    desired.paths.receipt !== confinedPath(desired.paths.root, receiptRelative)
  )
    throw hostError("Invalid managed receipt target");
  const pending = [],
    removed = [];
  try {
    for (const [relative, asset] of desired.files) {
      if (matches(before.files[relative], desired.receipt.files[relative]))
        continue;
      const temp = path.join(
        desired.paths.directory,
        `.setup-${crypto.randomUUID()}.tmp`,
      );
      fs.writeFileSync(temp, asset.bytes, {
        flag: "wx",
        mode: asset.executable ? 0o755 : 0o644,
      });
      pending.push({ relative, temp });
    }
    if (!equalBytes(receiptBefore, desired.receiptBytes)) {
      const temp = path.join(
        desired.paths.directory,
        `.setup-${crypto.randomUUID()}.tmp`,
      );
      fs.writeFileSync(temp, desired.receiptBytes, { flag: "wx", mode: 0o644 });
      pending.push({ relative: receiptRelative, temp });
    }
    for (const relative of Object.keys(prior?.files ?? {}))
      if (!desired.files.has(relative) && before.files[relative] !== null)
        removed.push(relative);
    assertInputs();
    if (
      projectPaths(desired.paths.root).root !== desired.paths.root ||
      !equalBytes(fileBytes(desired.paths.pin), desired.pinBytes) ||
      !equalBytes(fileBytes(desired.paths.receipt), receiptBefore) ||
      JSON.stringify(preflightOutputs(desired, prior)) !==
        JSON.stringify(before)
    )
      throw hostError("Project inputs or outputs changed before setup commit");
    // Receipt is held back until every owned output update/removal has completed.
    const receipt = pending.filter((item) => item.relative === receiptRelative);
    for (const { relative, temp } of pending.filter(
      (item) => item.relative !== receiptRelative,
    )) {
      const file = confinedPath(desired.paths.root, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      confinedPath(desired.paths.root, relative);
      fs.renameSync(temp, file);
    }
    for (const relative of removed)
      fs.unlinkSync(confinedPath(desired.paths.root, relative));
    pruneOwnedDirectories(
      desired.paths.root,
      Object.keys(prior?.files ?? {}),
      Object.keys(desired.receipt.files),
    );
    for (const { relative, temp } of receipt)
      fs.renameSync(temp, confinedPath(desired.paths.root, relative));
  } finally {
    for (const { temp } of pending)
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
function pruneOwnedDirectories(root, previous, expected) {
  const wanted = parentDirectories(expected),
    old = parentDirectories(previous);
  const roots = [...new Set(previous.map(managedRoot).filter(Boolean))];
  for (const dir of [...old].sort((a, b) => b.length - a.length)) {
    if (
      wanted.has(dir) ||
      !roots.some((r) => dir === r || dir.startsWith(`${r}/`))
    )
      continue;
    const file = confinedPath(root, dir),
      stat = info(file);
    if (
      stat?.isDirectory() &&
      !stat.isSymbolicLink() &&
      fs.readdirSync(file).length === 0
    )
      fs.rmdirSync(file);
  }
}
