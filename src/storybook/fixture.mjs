import { allowedStorybookValidatorKinds } from "./inventory.mjs";
export function storybookPolicyFixture({
  tier = "atomic",
  consumer = "ui-review",
  component = "notice",
} = {}) {
  return {
    inventory: {
      inventoryVersion: "1",
      components: [
        {
          componentId: component,
          validatorKinds: ["default"],
          implementedStoryRefs: [
            { kind: "default", storyId: `${component}--default` },
          ],
        },
      ],
    },
    tierPolicy: {
      policyVersion: "2",
      tierOrder: [tier],
      consumerIds: [consumer],
      tiers: {
        [tier]: {
          minimumRequiredKinds: [
            { kind: "default", purpose: "Baseline demonstration" },
          ],
          defaultOptionalKinds: allowedStorybookValidatorKinds.filter(
            (kind) => kind !== "default",
          ),
          consumerScope: [consumer],
        },
      },
    },
    versionPolicy: {
      policyVersion: "1",
      framework: "@storybook/react-vite",
      storybookVersion: "10.2.0",
      requiredAddons: ["@storybook/addon-a11y"],
      requiredImports: {
        test: "storybook/test",
        previewApi: "storybook/preview-api",
        actions: "storybook/actions",
      },
    },
  };
}
