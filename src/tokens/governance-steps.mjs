import path from "node:path";
import { readProfile } from "../figma/profile.mjs";
import { ledgerValidate, ledgerParity, proofValidate } from "../cli/rail.js";
import { verifyMapping } from "../figma/verify.js";
import { validateTokenProject } from "./command.mjs";
import { checkTokenManualEdits } from "./manual-guard.mjs";
import { buildTokenArtifacts } from "./build.mjs";
import { checkTokenRuntime } from "./runtime-check.mjs";
import { checkTokenArtifacts } from "./artifact-check.mjs";

/** Product-owned execution, never arbitrary consumer package scripts or plugins. */
export async function executeGovernanceStep(id, project) {
  switch (id) {
    case "tokens validate":
      return validateTokenProject({ project });
    case "tokens guard":
      return checkTokenManualEdits({ project });
    case "tokens build":
      return {
        ok: true,
        artifacts: (await buildTokenArtifacts({ project })).artifacts,
      };
    case "tokens runtime check":
      return checkTokenRuntime({ project });
    case "tokens artifacts check":
      return checkTokenArtifacts({ project });
    default:
      return executePublication(id, project);
  }
}
function executePublication(id, project) {
  const publication = project.tokens.governance.publication;
  const { config, baseline, ledger, profile, proof } = publication;
  if (id === "figma verify")
    return verifyMapping({
      rootDir: project.rootDir,
      configPath: config,
      expectPath: baseline,
      artifactPath: project.tokens.build.outputs.figma,
    });
  if (id === "ledger validate") {
    const result = ledgerValidate({ ledger, profile });
    if (!result.ok)
      return { ok: false, ledger: result, diagnostics: result.diagnostics };
    const { profile: resolved } = readProfile(profile);
    const diagnostics = [...result.diagnostics];
    if (
      path.resolve(project.rootDir, resolved.artifactPath) !==
      project.tokens.build.outputs.figma
    )
      diagnostics.push({
        code: "GOVERNANCE_PUBLICATION_ARTIFACT_MISMATCH",
        message:
          "Publication profile describes a different artifact than this token build",
      });
    if (result.proofPath !== null && path.resolve(result.proofPath) !== proof)
      diagnostics.push({
        code: "GOVERNANCE_PUBLICATION_PROOF_MISMATCH",
        message: "Ledger binds a different proof than governance selected",
      });
    return {
      ledger: result,
      ok: diagnostics.length === result.diagnostics.length,
      diagnostics,
    };
  }
  if (id === "ledger parity") return ledgerParity({ ledger, profile });
  if (id === "proof validate") return proofValidate({ proof, profile });
  throw new Error(`Unknown product governance step: ${id}`);
}
