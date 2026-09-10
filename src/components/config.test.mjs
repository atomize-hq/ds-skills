import { expect, it } from "vitest";
import { readComponents } from "../project/components-config.mjs";
import { componentPolicyFixture } from "./fixture.mjs";
import { evaluateComponentPromotion } from "./policy.mjs";
it("requires explicit consumer policies and permits a truly out-of-scope profile", () => {
  const c = readComponents(componentPolicyFixture(), "/tmp");
  expect(c.profiles.other.requirements).toEqual([]);
  expect(readComponents(null, "/tmp")).toBe(null);
  expect(c.report).toBe("/tmp/component-reports/status.json");
});
it.each([
  (v) => {
    v.maxAgeMinutes = 0;
  },
  (v) => {
    v.maxAgeMinutes = 1.2;
  },
  (v) => {
    v.maxAgeMinutes = Infinity;
  },
  (v) => {
    v.profiles = {};
  },
  (v) => {
    v.profiles.advancement.requirements = ["unknown"];
  },
  (v) => {
    v.profiles.advancement.requirements = ["visual-review", "visual-review"];
  },
  (v) => {
    v.profiles.advancement.consumers = {};
  },
  (v) => {
    v.profiles.advancement.consumers.ci = "disabled";
  },
  (v) => {
    v.profiles.advancement.automaticallyApprove = true;
  },
  (v) => {
    v.profiles["Invalid Name"] = v.profiles.advancement;
  },
  (v) => {
    v.report = "../outside";
  },
  (v) => {
    v.lockPath = "/absolute";
  },
  (v) => {
    v.unsupported = true;
  },
])("rejects invalid component policy", (mutate) => {
  const value = componentPolicyFixture();
  mutate(value);
  expect(() => readComponents(value, "/tmp")).toThrow();
});
it("does not accept a forged precomputed policy outcome or caller enforcement override", () => {
  const c = readComponents(componentPolicyFixture(), "/tmp");
  const report = {
    evidence: {
      "story-coverage": { state: "satisfied" },
      "visual-review": { state: "failed" },
    },
    policies: { advancement: { outcome: "satisfied" } },
  };
  const decision = evaluateComponentPromotion(report, c, {
    profile: "advancement",
    consumer: "ci",
    enforcement: "advisory",
  });
  expect(decision.ok).toBe(false);
  expect(decision.enforcement).toBe("blocking");
});
