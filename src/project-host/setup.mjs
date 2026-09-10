import path from "node:path";
import { withDirectoryLock } from "../io/lock.mjs";
import { desiredInstallation, checkProjectInstallation } from "./state.mjs";
import { fileBytes, equalBytes, hostError } from "./paths.mjs";
import { readReceipt } from "./receipt.mjs";
import { preflightOutputs } from "./managed.mjs";
import { writeInstallation } from "./write.mjs";

function preflight(desired) {
  const receipt = fileBytes(desired.paths.receipt),
    prior = readReceipt(receipt);
  return { receipt, prior, before: preflightOutputs(desired, prior) };
}
/** Cooperative lock, full preflight, per-file atomic replacement, receipt last. */
export async function setupProjectInstallation({ root, prefix }) {
  const desired = desiredInstallation(root, prefix);
  preflight(desired); // Refuse ownership conflicts before even creating a lock.
  return withDirectoryLock(
    path.join(desired.paths.directory, "setup.lock"),
    async () => {
      const { receipt, prior, before } = preflight(desired);
      const current = desiredInstallation(root, prefix);
      if (
        current.paths.root !== desired.paths.root ||
        !equalBytes(current.receiptBytes, desired.receiptBytes)
      )
        throw hostError("Selected release or pin changed during setup");
      writeInstallation(desired, prior, before, receipt);
      return checkProjectInstallation({ root, prefix });
    },
    { label: "ds-skills project setup" },
  );
}
