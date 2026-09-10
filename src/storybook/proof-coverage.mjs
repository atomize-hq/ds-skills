/** This is static reference coverage, never a browser-execution or publication attestation. */
export function createStorybookProofCoverageReport(structure) {
  if (!structure.ok || structure.componentFacts === null)
    throw new Error("Cannot build coverage from invalid proof metadata");
  const components = structure.componentFacts.map((fact) => {
    const missingKinds = fact.requiredKinds.filter(
      (kind) => !fact.implementedKinds.includes(kind),
    );
    return {
      ...fact,
      status: missingKinds.length ? "missing-required-kinds" : "ready",
      missingKinds,
    };
  });
  const readyCount = components.filter(
    (component) => component.status === "ready",
  ).length;
  return {
    proofCoverageVersion: "2",
    scope: "static-story-reference-coverage",
    summary: {
      componentCount: components.length,
      readyCount,
      failingCount: components.length - readyCount,
    },
    components,
  };
}
export function coverageDiagnostics(report) {
  return report.components
    .filter((component) => component.missingKinds.length)
    .map(
      (component) =>
        `[CT-9B_PROOF_GATE_MISSING_REQUIRED_KIND] ${component.componentId}: ${component.missingKinds.join(", ")}`,
    );
}
