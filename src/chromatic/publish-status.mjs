import { statusError } from "./status.mjs";
export function publicationStatus(
  context,
  { branchName, mode, providerResult, generatedAt = new Date().toISOString() },
) {
  const p = providerResult;
  if (!Number.isSafeInteger(p?.code) || p.code < 0 || p.code > 255)
    throw statusError("Provider returned no valid exit code");
  for (const key of [
    "changeCount",
    "errorCount",
    "interactionTestFailuresCount",
  ])
    if (p[key] !== undefined && (!Number.isSafeInteger(p[key]) || p[key] < 0))
      throw statusError(`Provider returned invalid ${key}`);
  if (p.code === 0 && mode === "review" && p.changeCount === undefined)
    throw statusError("Provider returned no completed review change count");
  const failed =
    p.code !== 0 ||
    (p.errorCount ?? 0) > 0 ||
    (p.interactionTestFailuresCount ?? 0) > 0;
  const outcome = failed
    ? "failed"
    : mode === "deferred"
      ? "deferred"
      : p.changeCount > 0
        ? "changed"
        : "passed";
  const o = context.options;
  return {
    statusVersion: "1",
    branch: { name: branchName },
    revision: { gitSha: o.expectedGitSha },
    proofInventory: {
      path: o.inventoryPath,
      inventoryVersion: o.inventoryVersion,
      selectedComponentIds: [...o.scope.componentIds],
      selectedStoryIds: [...o.scope.storyIds],
    },
    build: { url: p.buildUrl },
    review: {
      diffOutcome: outcome,
      mode: o.requiredForClaim ? "claim-required" : "informational",
      requiredForClaim: o.requiredForClaim,
      scope: globalThis.structuredClone(o.scope),
    },
    check: {
      name: o.checkName,
      conclusion: {
        passed: "success",
        changed: "neutral",
        failed: "failure",
        deferred: "skipped",
      }[outcome],
    },
    generatedAt,
  };
}
