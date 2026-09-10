import fs from "node:fs";
import path from "node:path";
import { CannotEvaluateError } from "../figma/profile.mjs";
import { evaluateStorybookProof } from "../storybook/proof-command.mjs";
import { validateChromaticStatusProject } from "../chromatic/command.mjs";
import { executeGovernanceStep } from "../tokens/governance-steps.mjs";
export const evidenceScopes = {
  "story-coverage": "static-story-reference-coverage",
  "visual-review": "revision-bound-visual-review",
  "figma-publication": "publication-ledger-conformance",
};
function evidence(id, state, diagnostics = [], facts = {}) {
  return { scope: evidenceScopes[id], state, diagnostics, facts };
}
export async function collectComponentEvidence(project, revision) {
  const results = {};
  for (const id of Object.keys(evidenceScopes)) {
    try {
      results[id] = await evaluateOne(project, revision, id);
    } catch (error) {
      if (!(error instanceof CannotEvaluateError)) throw error;
      results[id] = evidence(id, "unavailable", [
        `[${error.code}] ${error.message}`,
      ]);
    }
  }
  return results;
}
async function evaluateOne(project, revision, id) {
  if (id === "story-coverage") {
    if (!project.storybook?.proof) return evidence(id, "not-configured");
    const result = await evaluateStorybookProof(project, "check");
    return evidence(
      id,
      result.ok ? "satisfied" : "unsatisfied",
      result.diagnostics,
      {
        coverageVersion: result.coverage?.proofCoverageVersion ?? null,
        summary: result.coverage?.summary ?? null,
      },
    );
  }
  if (id === "visual-review") {
    if (!project.storybook?.chromatic) return evidence(id, "not-configured");
    const result = validateChromaticStatusProject(project, {
      gitSha: revision,
    });
    if (!result.ok) return evidence(id, "invalid", result.errors);
    const outcome = result.review.diffOutcome;
    return evidence(id, outcome === "passed" ? "satisfied" : outcome, [], {
      diffOutcome: outcome,
      requiredForClaim: result.review.requiredForClaim,
      mode: result.review.mode,
      scope: result.review.scope,
    });
  }
  const publication = project.tokens?.governance?.publication;
  if (!publication) return evidence(id, "not-configured");
  // The generic ledger reader supports relative proof binding; project aggregation must
  // reject a different path BEFORE that reader opens it, not after the external read.
  let ledger;
  try {
    ledger = JSON.parse(fs.readFileSync(publication.ledger, "utf8"));
  } catch {
    throw new CannotEvaluateError(
      "COMPONENT_LEDGER_UNREADABLE",
      "Cannot read configured publication ledger",
    );
  }
  if (
    ledger?.publication?.proof !== undefined &&
    (typeof ledger.publication.proof !== "string" ||
      path.resolve(
        path.dirname(publication.ledger),
        ledger.publication.proof,
      ) !== publication.proof)
  )
    return evidence(id, "invalid", [
      "[COMPONENT_PUBLICATION_BINDING] Ledger names a proof other than the configured publication proof",
    ]);
  const result = await executeGovernanceStep("ledger validate", project),
    rail = result.ledger?.rail;
  if (!result.ok || !rail)
    return evidence(
      id,
      "invalid",
      (result.diagnostics ?? []).map((d) => `[${d.code}] ${d.message}`),
    );
  const state = rail.freshness === "stale" ? "stale" : rail.outcome;
  return evidence(id, state, rail.reasonCodes, {
    ledgerState: result.ledger.state,
    sourceVersionOrRevision: rail.sourceVersionOrRevision,
    promotable: result.ledger.promotable,
  });
}
