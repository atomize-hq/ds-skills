import { expect, it } from "vitest";
import { validateStoryInventory } from "./inventory.mjs";
import { validateComponentTierPolicy } from "./tier-policy.mjs";
import { validateStorybookVersionPolicy } from "./version-policy.mjs";
import { storybookPolicyFixture } from "./fixture.mjs";

it("accepts different consumers, tiers and library-independent component names", () => {
  for (const options of [
    {},
    {
      tier: "composite",
      consumer: "desktop-review",
      component: "workspace-tree",
    },
  ]) {
    const f = storybookPolicyFixture(options);
    expect(validateStoryInventory(f.inventory)).toEqual([]);
    expect(validateComponentTierPolicy(f.tierPolicy)).toEqual([]);
    expect(validateStorybookVersionPolicy(f.versionPolicy)).toEqual([]);
  }
});
it.each([
  [
    "version",
    (p) => {
      p.policyVersion = "1";
    },
    "INVALID_LITERAL",
  ],
  [
    "unknown field",
    (p) => {
      p.bypass = true;
    },
    "UNEXPECTED_KEY",
  ],
  [
    "missing tier order",
    (p) => {
      delete p.tierOrder;
    },
    "MISSING_REQUIRED_KEY",
  ],
  [
    "empty tiers",
    (p) => {
      p.tierOrder = [];
    },
    "POLICY_NAMES",
  ],
  [
    "duplicate tier",
    (p) => {
      p.tierOrder.push("atomic");
    },
    "DUPLICATE_NAME",
  ],
  [
    "missing tier definition",
    (p) => {
      p.tierOrder.push("composite");
    },
    "MISSING_REQUIRED_TIER",
  ],
  [
    "unlisted tier",
    (p) => {
      p.tiers.extra = p.tiers.atomic;
    },
    "UNKNOWN_TIER",
  ],
  [
    "missing consumer names",
    (p) => {
      delete p.consumerIds;
    },
    "POLICY_NAMES",
  ],
  [
    "duplicate consumer names",
    (p) => {
      p.consumerIds.push("ui-review");
    },
    "DUPLICATE_NAME",
  ],
  [
    "unconfigured consumer",
    (p) => {
      p.tiers.atomic.consumerScope = ["other-review"];
    },
    "UNKNOWN_CONSUMER_THREAD",
  ],
  [
    "duplicate consumer",
    (p) => {
      p.tiers.atomic.consumerScope.push("ui-review");
    },
    "DUPLICATE_CONSUMER_THREAD",
  ],
  [
    "empty scope",
    (p) => {
      p.tiers.atomic.consumerScope = [];
    },
    "EMPTY_CONSUMER_SCOPE",
  ],
  [
    "no required proof",
    (p) => {
      p.tiers.atomic.minimumRequiredKinds = [];
    },
    "EMPTY_REQUIRED_KIND_LIST",
  ],
  [
    "empty purpose",
    (p) => {
      p.tiers.atomic.minimumRequiredKinds[0].purpose = " ";
    },
    "INVALID_REQUIRED_KIND_PURPOSE",
  ],
  [
    "duplicate required",
    (p) => {
      p.tiers.atomic.minimumRequiredKinds.push(
        p.tiers.atomic.minimumRequiredKinds[0],
      );
    },
    "DUPLICATE_REQUIRED_KIND",
  ],
  [
    "duplicate optional",
    (p) => {
      p.tiers.atomic.defaultOptionalKinds.push("docs");
    },
    "DUPLICATE_OPTIONAL_KIND",
  ],
  [
    "overlap",
    (p) => {
      p.tiers.atomic.defaultOptionalKinds.push("default");
    },
    "OVERLAPPING_KIND",
  ],
  [
    "incomplete classification",
    (p) => {
      p.tiers.atomic.defaultOptionalKinds.pop();
    },
    "UNCATEGORIZED_KIND",
  ],
  [
    "unknown proof kind",
    (p) => {
      p.tiers.atomic.defaultOptionalKinds.push("imaginary");
    },
    "UNKNOWN_KIND",
  ],
])("preserves tier policy rule: %s", (_, mutate, code) => {
  const { tierPolicy } = storybookPolicyFixture();
  mutate(tierPolicy);
  expect(validateComponentTierPolicy(tierPolicy).join("\n")).toContain(code);
});
it.each([
  [
    "duplicate components",
    (p) => {
      p.components.push(p.components[0]);
    },
    "DUPLICATE_COMPONENT_ID",
  ],
  [
    "unknown kind",
    (p) => {
      p.components[0].validatorKinds = ["imaginary"];
    },
    "UNKNOWN_KIND",
  ],
  [
    "duplicate kind",
    (p) => {
      p.components[0].validatorKinds.push("default");
    },
    "DUPLICATE_KIND",
  ],
  [
    "wrong order",
    (p) => {
      p.components[0].validatorKinds = ["docs", "default"];
    },
    "INVALID_KIND_ORDER",
  ],
  [
    "empty story id",
    (p) => {
      p.components[0].implementedStoryRefs[0].storyId = "";
    },
    "INVALID_STORY_ID",
  ],
  [
    "duplicate story ref",
    (p) => {
      p.components[0].implementedStoryRefs.push(
        p.components[0].implementedStoryRefs[0],
      );
    },
    "DUPLICATE_STORY_REF",
  ],
  [
    "kind mismatch",
    (p) => {
      p.components[0].implementedStoryRefs = [];
    },
    "KIND_SET_MISMATCH",
  ],
  [
    "unknown property",
    (p) => {
      p.components[0].promoted = true;
    },
    "UNEXPECTED_KEY",
  ],
])("preserves inventory rule: %s", (_, mutate, code) => {
  const { inventory } = storybookPolicyFixture();
  mutate(inventory);
  expect(validateStoryInventory(inventory).join("\n")).toContain(code);
});
it.each([
  (p) => {
    p.storybookVersion = "^10.2.0";
  },
  (p) => {
    p.framework = " ";
  },
  (p) => {
    p.requiredAddons = [];
  },
  (p) => {
    p.requiredAddons = ["a", "a"];
  },
  (p) => {
    p.requiredImports.test = "";
  },
  (p) => {
    p.requiredImports = [];
  },
])("rejects malformed version policy %#", (mutate) => {
  const { versionPolicy } = storybookPolicyFixture();
  mutate(versionPolicy);
  expect(validateStorybookVersionPolicy(versionPolicy).length).toBeGreaterThan(
    0,
  );
});
it.each([null, [], "invalid", 12])(
  "invalid roots produce diagnostics, not exceptions: %j",
  (data) => {
    for (const validate of [
      validateComponentTierPolicy,
      validateStoryInventory,
      validateStorybookVersionPolicy,
    ])
      expect(validate(data).length).toBeGreaterThan(0);
  },
);
it("empty inventory is structurally valid, not component readiness proof", () => {
  expect(
    validateStoryInventory({ inventoryVersion: "1", components: [] }),
  ).toEqual([]);
});

it("ships a tier template conforming to both schema and cross-field checks", async () => {
  const fs = await import("node:fs");
  const { validate } = await import("../validate/schema.mjs");
  const read = (file) =>
    JSON.parse(fs.readFileSync(new URL(file, import.meta.url), "utf8"));
  const template = read("../../templates/storybook-tier-policy.template.json");
  const schema = read("../../schemas/storybook-tier-policy.schema.json");
  expect(
    validate(template, schema, { root: schema, profile: {}, path: "" }),
  ).toEqual([]);
  expect(validateComponentTierPolicy(template)).toEqual([]);
});
it("version policy applies the shipped schema to metadata and unknown fields", () => {
  const { versionPolicy } = storybookPolicyFixture();
  expect(
    validateStorybookVersionPolicy({ ...versionPolicy, unknownField: true })
      .length,
  ).toBeGreaterThan(0);
  expect(
    validateStorybookVersionPolicy({
      ...versionPolicy,
      baselineDate: "not-a-date",
    }).length,
  ).toBeGreaterThan(0);
  expect(
    validateStorybookVersionPolicy({
      ...versionPolicy,
      baselineDate: "2026-09-09",
      notes: ["Reviewed"],
    }),
  ).toEqual([]);
});
