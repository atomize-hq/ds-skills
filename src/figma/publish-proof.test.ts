import { describe, expect, it } from "vitest";

import {
  fixtureProfile,
  proofFixturePath as fixturePath,
} from "./__fixtures__/support.js";
import {
  loadAndValidatePublishProof,
  publishProofUsage,
} from "./publish-proof.mjs";

const profile = fixtureProfile();

describe("loadAndValidatePublishProof", () => {
  it("accepts the happy-path plugin-import-manual fixture", () => {
    const result = loadAndValidatePublishProof(
      fixturePath("valid-plugin-import-manual.publish-proof.json"),
      profile,
    );

    expect(result.errors).toEqual([]);
    expect(result.data.mode).toBe("plugin-import-manual");
  });

  it("reports a missing artifact git sha", () => {
    const result = loadAndValidatePublishProof(
      fixturePath("invalid-missing-artifact-git-sha.publish-proof.json"),
      profile,
    );

    expect(result.errors).toContain(
      "[CT-7B_PUBLISH_PROOF_MISSING_REQUIRED_KEY] artifact.gitSha is required",
    );
  });

  it("reports a missing destination figma file", () => {
    const result = loadAndValidatePublishProof(
      fixturePath("invalid-missing-destination.publish-proof.json"),
      profile,
    );

    expect(result.errors).toContain(
      "[CT-7B_PUBLISH_PROOF_MISSING_REQUIRED_KEY] destination.figmaFile is required",
    );
  });

  it("reports invalid carrier metadata", () => {
    const result = loadAndValidatePublishProof(
      fixturePath("invalid-carrier-metadata.publish-proof.json"),
      profile,
    );

    expect(result.errors).toContain(
      "[CT-7B_PUBLISH_PROOF_FORBIDDEN_CARRIER_REASON] carrier.reason must be null when carrier.used is false",
    );
  });
});

describe("publish proof package contract", () => {
  // This assertion previously pinned "node scripts/validate-publish-proof.mjs",
  // a consumer script path T17 deletes. It was kept deliberately so T12 would
  // trip over it rather than quietly leave the constant behind; it now pins the
  // generalized form instead.
  it("names its own command, not a consumer's script", () => {
    expect(publishProofUsage).toBe(
      "Usage: ds-skills proof validate --proof <path> --profile <path>",
    );
    expect(publishProofUsage).not.toMatch(/scripts\//);
  });
});
