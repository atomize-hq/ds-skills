import { componentError, evaluateComponentPolicies } from "./policy.mjs";
import { captureComponentInputs, assertComponentInputs } from "./inputs.mjs";
import { collectComponentEvidence } from "./evidence.mjs";
export async function evaluateComponentStatus(
  project,
  { now = new Date() } = {},
) {
  if (!project.components)
    throw componentError("Component evidence policy is not configured");
  const clock = new Date(now);
  if (!Number.isFinite(clock.getTime()))
    throw componentError("Invalid component evaluation clock");
  const snapshot = captureComponentInputs(project);
  const evidence = await collectComponentEvidence(project, snapshot.revision);
  const report = {
    statusVersion: "3",
    scope: "configured-component-evidence",
    generatedAt: clock.toISOString(),
    revision: snapshot.revision,
    inputDigest: snapshot.digest,
    evidence,
    policies: evaluateComponentPolicies(project.components, evidence),
  };
  assertComponentInputs(project, snapshot);
  return { report, snapshot };
}
