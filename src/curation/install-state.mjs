import fs from "node:fs";
import path from "node:path";
import {
  desiredInstallation,
  checkDesiredInstallation,
} from "../project-host/state.mjs";
import { fileBytes, equalBytes, hostError } from "../project-host/paths.mjs";
import { confinedPath, managedRoot } from "../project-host/assets.mjs";
import { outputDiagnostics } from "../project-host/managed.mjs";
import { digest } from "../libraries/capture.mjs";
import { curationContext, assertCurationInputs } from "./context.mjs";
import { invalid } from "./draft.mjs";
import { readBundle, readReview } from "./bundle.mjs";
import { curatedReceiptPath, readCuratedReceipt } from "./install-receipt.mjs";

export function desiredCuratedInstallation(project, prefix) {
  const ctx = curationContext(project),
    c = project.curation;
  assertCurationInputs(ctx, false);
  if (!c.accepted || !c.review)
    throw hostError(
      "Accepted curation and explicit review pins required before installation",
    );
  const bundle = readBundle(ctx.acceptedBytes, c.accepted.sha256);
  readReview(ctx.reviewBytes, c.review.sha256, c.accepted.sha256);
  if (ctx.bytes !== ctx.acceptedBytes)
    throw invalid(
      "Accepted curation is stale; review and pin a fresh bundle before installing",
    );
  const core = desiredInstallation(project.rootDir, prefix),
    check = checkDesiredInstallation(core);
  if (!check.ok)
    throw hostError(
      `Core project installation must be current: ${check.diagnostics.map((d) => d.code).join(", ")}`,
    );
  const files = new Map();
  for (const s of bundle.skills)
    for (const surface of [".agents", ".claude"])
      for (const [relative, bytes] of Object.entries(s.files))
        files.set(`${surface}/skills/${s.name}/${relative}`, {
          bytes: Buffer.from(bytes),
          executable: false,
        });
  const configBytes = fileBytes(project.configPath),
    receipt = {
      curatedInstallationVersion: "1",
      release: core.record.release,
      sourceCommit: core.record.sourceCommit,
      pinSha256: core.receipt.pinSha256,
      config: path
        .relative(project.rootDir, project.configPath)
        .split(path.sep)
        .join("/"),
      configSha256: digest(configBytes),
      bundleSha256: c.accepted.sha256,
      reviewSha256: c.review.sha256,
      evidenceSha256: project.libraries.evidence.sha256,
      namespace: bundle.namespace,
      skills: bundle.skills.map((s) => s.name).sort(),
      files: Object.fromEntries(
        [...files.keys()]
          .sort()
          .map((f) => [
            f,
            { sha256: digest(files.get(f).bytes), executable: false },
          ]),
      ),
    },
    receiptBytes = Buffer.from(JSON.stringify(receipt, null, 2) + "\n");
  readCuratedReceipt(receiptBytes);
  return {
    ctx,
    core,
    files,
    receipt,
    receiptBytes,
    pinBytes: core.pinBytes,
    paths: {
      ...core.paths,
      receipt: confinedPath(core.paths.root, curatedReceiptPath),
    },
  };
}
export function assertCuratedOwnership(desired, prior) {
  const { ctx, core } = desired,
    p = ctx.project,
    roots = [
      ...new Set(
        [...desired.files.keys(), ...Object.keys(prior?.files ?? {})].map(
          managedRoot,
        ),
      ),
    ];
  if (prior && prior.config !== desired.receipt.config)
    throw hostError(
      "Another configuration owns this project's curated installation; update the existing configuration explicitly",
    );
  const overlap = (a, b) =>
    a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
  const protectedPaths = [p.configPath, ...ctx.sourceFiles];
  function collect(v, key = "") {
    if (key === "rootDir") return;
    if (typeof v === "string" && path.isAbsolute(v)) protectedPaths.push(v);
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) collect(x, k);
  }
  collect(p);
  const targets = [
    ...roots.map((r) => path.join(p.rootDir, r)),
    path.join(p.rootDir, ".ds-skills"),
  ];
  if (protectedPaths.some((f) => targets.some((t) => overlap(f, t))))
    throw hostError(
      "Curated installation overlaps configured inputs or outputs",
    );
  const coreRoots = [...core.files.keys()].map(managedRoot).filter(Boolean);
  if (roots.some((r) => coreRoots.includes(r)))
    throw hostError("Curated skill collides with a core release skill");
}
export function checkCuratedDesired(desired) {
  const diagnostics = [];
  let prior = null;
  try {
    const bytes = fileBytes(desired.paths.receipt);
    prior = readCuratedReceipt(bytes);
    if (!equalBytes(bytes, desired.receiptBytes))
      diagnostics.push({
        code: "CURATION_RECEIPT_SKEW",
        message:
          "Run explicit curation install for current reviewed inputs/release",
      });
    assertCuratedOwnership(desired, prior);
  } catch (error) {
    diagnostics.push({
      code: "CURATION_RECEIPT_INVALID",
      message: error.message,
    });
  }
  diagnostics.push(...outputDiagnostics(desired, prior));
  assertCurationInputs(desired.ctx, false);
  return {
    ok: !diagnostics.length,
    artifactStatus: "not-written",
    diagnostics,
    release: desired.receipt.release,
    sourceCommit: desired.receipt.sourceCommit,
    bundleSha256: desired.receipt.bundleSha256,
    skillNames: desired.receipt.skills,
    installedFileCount: desired.files.size,
    validationScope: "reviewed-bundle-and-installed-output-integrity",
  };
}
export function assertCuratedExecutingRelease(desired, moduleFile) {
  let matches = false;
  try {
    matches =
      fs.realpathSync(moduleFile) ===
      fs.realpathSync(
        path.join(
          desired.core.release.home,
          "lib/dist/curation/install-state.mjs",
        ),
      );
  } catch {
    /* An older/missing installed module is inability, not an unexpected failure. */
  }
  if (!matches)
    throw hostError(
      "Use this project's verified pinned launcher for curated installation commands",
    );
}
