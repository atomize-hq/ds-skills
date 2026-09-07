import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  loadAndValidatePublishProof,
  publishProofUsage,
} from "./publish-proof.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const publishProofFixtureDir = path.join(here, "__fixtures__/publish-proof");

describe("loadAndValidatePublishProof", () => {
  it("accepts the happy-path plugin-import-manual fixture", () => {
    const result = loadAndValidatePublishProof(
      fixturePath("valid-plugin-import-manual.publish-proof.json"),
    );

    expect(result.errors).toEqual([]);
    expect(result.data.mode).toBe("plugin-import-manual");
  });

  it("reports a missing artifact git sha", () => {
    const result = loadAndValidatePublishProof(
      fixturePath("invalid-missing-artifact-git-sha.publish-proof.json"),
    );

    expect(result.errors).toContain(
      "[CT-7B_PUBLISH_PROOF_MISSING_REQUIRED_KEY] artifact.gitSha is required",
    );
  });

  it("reports a missing destination figma file", () => {
    const result = loadAndValidatePublishProof(
      fixturePath("invalid-missing-destination.publish-proof.json"),
    );

    expect(result.errors).toContain(
      "[CT-7B_PUBLISH_PROOF_MISSING_REQUIRED_KEY] destination.figmaFile is required",
    );
  });

  it("reports invalid carrier metadata", () => {
    const result = loadAndValidatePublishProof(
      fixturePath("invalid-carrier-metadata.publish-proof.json"),
    );

    expect(result.errors).toContain(
      "[CT-7B_PUBLISH_PROOF_FORBIDDEN_CARRIER_REASON] carrier.reason must be null when carrier.used is false",
    );
  });
});

describe("publish proof package contract", () => {
  // Kept, and expected to fail at T12. This string names a consumer script
  // path that T17 deletes, so it is one of the hardcoded constants §4.5
  // requires generalizing — the failure is the gate working.
  it("keeps the CLI usage stable", () => {
    expect(publishProofUsage).toBe(
      "Usage: node scripts/validate-publish-proof.mjs [path-to-publish-proof.json]",
    );
  });
});

function fixturePath(name: string) {
  return path.join(publishProofFixtureDir, name);
}
