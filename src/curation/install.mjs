import path from "node:path";
import { withDirectoryLock } from "../io/lock.mjs";
import { fileBytes, equalBytes, hostError } from "../project-host/paths.mjs";
import { preflightOutputs } from "../project-host/managed.mjs";
import { writeInstallation } from "../project-host/write.mjs";
import { curatedReceiptPath, readCuratedReceipt } from "./install-receipt.mjs";
import {
  desiredCuratedInstallation,
  assertCuratedOwnership,
  checkCuratedDesired,
} from "./install-state.mjs";

function preflight(desired) {
  const receipt = fileBytes(desired.paths.receipt),
    prior = readCuratedReceipt(receipt);
  assertCuratedOwnership(desired, prior);
  return { receipt, prior, before: preflightOutputs(desired, prior) };
}
export async function installCuratedSkills(project, prefix) {
  const desired = desiredCuratedInstallation(project, prefix);
  preflight(desired);
  return withDirectoryLock(
    path.join(desired.paths.directory, "setup.lock"),
    () => {
      const { receipt, prior, before } = preflight(desired);
      const assertInputs = () => {
        const current = desiredCuratedInstallation(project, prefix);
        if (
          current.ctx.identity !== desired.ctx.identity ||
          !equalBytes(current.receiptBytes, desired.receiptBytes)
        )
          throw hostError(
            "Curated inputs or selected release changed before installation commit",
          );
        assertCuratedOwnership(current, prior);
      };
      assertInputs();
      writeInstallation(desired, prior, before, receipt, {
        receiptRelative: curatedReceiptPath,
        assertInputs,
      });
      const result = checkCuratedDesired(desired);
      return {
        ...result,
        artifactStatus:
          equalBytes(receipt, desired.receiptBytes) &&
          Object.keys(before.files).every(
            (f) => before.files[f]?.sha256 === desired.receipt.files[f]?.sha256,
          )
            ? "unchanged"
            : "written",
      };
    },
    { label: "ds-skills curated skill installation" },
  );
}
