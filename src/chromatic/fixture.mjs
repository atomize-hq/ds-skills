import { proofFixture } from "../storybook/proof-fixture.mjs";
export const exampleSha = "a".repeat(40);
export function statusFixture({
  component = "notice",
  tier = "atomic",
  inventoryPath = "policy/inventory.json",
  checkName = "component-review",
  generatedAt = "2026-09-09T12:00:00.000Z",
} = {}) {
  const scope = {
    componentIds: [component],
    componentTiers: { [component]: tier },
    storyIds: [`${component}--default`],
  };
  const status = {
    statusVersion: "1",
    branch: { name: "feature/example" },
    revision: { gitSha: exampleSha },
    proofInventory: {
      inventoryVersion: "1",
      path: inventoryPath,
      selectedComponentIds: [...scope.componentIds],
      selectedStoryIds: [...scope.storyIds],
    },
    build: { url: "https://www.chromatic.com/build?appId=example&id=1" },
    review: {
      diffOutcome: "passed",
      mode: "informational",
      requiredForClaim: false,
      scope,
    },
    check: { name: checkName, conclusion: "success" },
    generatedAt,
  };
  const options = {
    expectedGitSha: exampleSha,
    inventoryPath,
    inventoryVersion: "1",
    checkName,
    scope: globalThis.structuredClone(scope),
    requiredForClaim: false,
    maxAgeMinutes: 60,
    maxFutureSkewSeconds: 60,
    now: "2026-09-09T12:00:00.000Z",
  };
  return { status, options };
}
export function chromaticProjectFixture(options = {}) {
  const f = proofFixture(options);
  const { status } = statusFixture({
    component: f.component,
    tier: f.spec.tier,
    generatedAt: new Date().toISOString(),
  });
  f.config.storybook.chromatic = {
    status: "review/status.json",
    lockPath: "locks/review.lock",
    checkName: "component-review",
    requiredForClaim: false,
    maxAgeMinutes: 60,
    maxFutureSkewSeconds: 60,
    restore: null,
  };
  f.write("project.json", f.config);
  f.write("review/status.json", status);
  return { ...f, status };
}
