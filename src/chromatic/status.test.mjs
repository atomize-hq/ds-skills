import { expect, it } from "vitest";
import { evaluateChromaticStatus } from "./status.mjs";
import { statusFixture } from "./fixture.mjs";
it.each([
  {},
  {
    component: "workspace-tree",
    tier: "composite",
    inventoryPath: "packages/ui/review.json",
    checkName: "desktop-visual-review",
  },
])(
  "accepts configured identities rather than built-in consumer names %j",
  (input) => {
    const f = statusFixture(input);
    expect(evaluateChromaticStatus(f.status, f.options)).toEqual({
      ok: true,
      errors: [],
    });
  },
);
it.each([
  ["passed", "success"],
  ["changed", "neutral"],
  ["failed", "failure"],
  ["deferred", "skipped"],
])("valid %s evidence is conformance, not approval", (outcome, conclusion) => {
  const f = statusFixture();
  f.status.review.diffOutcome = outcome;
  f.status.check.conclusion = conclusion;
  expect(evaluateChromaticStatus(f.status, f.options).ok).toBe(true);
});
it.each([
  [
    "version",
    (s) => {
      s.statusVersion = "2";
    },
    "INVALID_LITERAL",
  ],
  [
    "unknown field",
    (s) => {
      s.bypass = true;
    },
    "UNEXPECTED_KEY",
  ],
  [
    "branch whitespace",
    (s) => {
      s.branch.name = " main ";
    },
    "BRANCH_NAME",
  ],
  [
    "invalid SHA",
    (s) => {
      s.revision.gitSha = "short";
    },
    "INVALID_GIT_SHA",
  ],
  [
    "different SHA",
    (s) => {
      s.revision.gitSha = "b".repeat(40);
    },
    "GIT_SHA_MISMATCH",
  ],
  [
    "inventory path",
    (s) => {
      s.proofInventory.path = "other.json";
    },
    "INVALID_LITERAL",
  ],
  [
    "inventory version",
    (s) => {
      s.proofInventory.inventoryVersion = "99";
    },
    "INVALID_LITERAL",
  ],
  [
    "empty selection",
    (s) => {
      s.proofInventory.selectedStoryIds = [];
    },
    "INVALID_STRING_ARRAY",
  ],
  [
    "undefined item",
    (s) => {
      s.proofInventory.selectedStoryIds = [undefined];
    },
    "INVALID_STRING_ARRAY",
  ],
  [
    "duplicate selection",
    (s) => {
      s.proofInventory.selectedComponentIds.push("notice");
    },
    "INVALID_STRING_ARRAY",
  ],
  [
    "changed current scope",
    (s) => {
      s.proofInventory.selectedStoryIds = ["other--default"];
      s.review.scope.storyIds = ["other--default"];
    },
    "CURRENT_SCOPE",
  ],
  [
    "scope mismatch",
    (s) => {
      s.review.scope.componentIds = ["other"];
    },
    "SCOPE_MISMATCH",
  ],
  [
    "tier mismatch",
    (s) => {
      s.review.scope.componentTiers.notice = "another-tier";
    },
    "CURRENT_SCOPE",
  ],
  [
    "tier whitespace",
    (s) => {
      s.review.scope.componentTiers.notice = " atomic ";
    },
    "INVALID_STRING",
  ],
  [
    "missing tiers",
    (s) => {
      s.review.scope.componentTiers = {};
    },
    "INVALID_COMPONENT_TIERS",
  ],
  [
    "mode",
    (s) => {
      s.review.mode = "optional";
    },
    "INVALID_ENUM",
  ],
  [
    "boolean",
    (s) => {
      s.review.requiredForClaim = "false";
    },
    "INVALID_BOOLEAN",
  ],
  [
    "mode disagreement",
    (s) => {
      s.review.requiredForClaim = true;
    },
    "REQUIRED_FOR_CLAIM_MISMATCH",
  ],
  [
    "policy downgrade",
    (s) => {
      s.review.requiredForClaim = true;
      s.review.mode = "claim-required";
    },
    "POLICY_MODE",
  ],
  [
    "outcome",
    (s) => {
      s.review.diffOutcome = "unknown";
    },
    "INVALID_ENUM",
  ],
  [
    "conclusion",
    (s) => {
      s.check.conclusion = "failure";
    },
    "CHECK_CONCLUSION_MISMATCH",
  ],
  [
    "check owner",
    (s) => {
      s.check.name = "other";
    },
    "INVALID_LITERAL",
  ],
  [
    "unsafe URL",
    (s) => {
      s.build.url = "javascript:alert(1)";
    },
    "BUILD_URL",
  ],
  [
    "URL credentials",
    (s) => {
      s.build.url = "https://user:secret@example.com/";
    },
    "BUILD_URL",
  ],
  [
    "future",
    (s) => {
      s.generatedAt = "2027-01-01T00:00:00Z";
    },
    "FUTURE",
  ],
  [
    "stale",
    (s) => {
      s.generatedAt = "2026-01-01T00:00:00Z";
    },
    "STALE",
  ],
  [
    "calendar overflow",
    (s) => {
      s.generatedAt = "2026-02-30T00:00:00Z";
    },
    "INVALID_TIMESTAMP",
  ],
])("rejects %s", (_, mutate, code) => {
  const f = statusFixture();
  mutate(f.status);
  const r = evaluateChromaticStatus(f.status, f.options);
  expect(r.ok).toBe(false);
  expect(r.errors.join(" ")).toContain(code);
});
it.each([null, [], true, "invalid"])("rejects malformed root %j", (status) => {
  expect(evaluateChromaticStatus(status, statusFixture().options).ok).toBe(
    false,
  );
});
it("permits only the configured small future skew", () => {
  const f = statusFixture();
  f.status.generatedAt = "2026-09-09T12:00:30Z";
  expect(evaluateChromaticStatus(f.status, f.options).ok).toBe(true);
  f.options.maxFutureSkewSeconds = 0;
  expect(evaluateChromaticStatus(f.status, f.options).ok).toBe(false);
});
it.each([
  (o) => {
    o.now = "invalid";
  },
  (o) => {
    o.maxAgeMinutes = "60junk";
  },
  (o) => {
    o.expectedGitSha = null;
  },
  (o) => {
    o.maxFutureSkewSeconds = -1;
  },
])("refuses invalid caller policy %#", (mutate) => {
  const f = statusFixture();
  mutate(f.options);
  expect(() => evaluateChromaticStatus(f.status, f.options)).toThrow();
});

it.each([
  (o) => {
    o.scope.componentIds = [];
  },
  (o) => {
    o.scope.componentTiers = {};
  },
  (o) => {
    o.checkName = 42;
  },
  (o) => {
    o.inventoryPath = " ";
  },
])("refuses malformed expected scope/identity %#", (mutate) => {
  const f = statusFixture();
  mutate(f.options);
  expect(() => evaluateChromaticStatus(f.status, f.options)).toThrow();
});
