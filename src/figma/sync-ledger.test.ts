import { describe, expect, it } from "vitest";

import {
  createWritableBuffer,
  fixtureProfile,
  ledgerFixturePath as fixturePath,
  readLedgerFixture as readFixture,
} from "./__fixtures__/support.js";
import {
  evaluateFigmaParity,
  runValidateFigmaParityCli,
  validateFigmaParity,
} from "./figma-parity.mjs";
import {
  evaluateSyncLedgerConformance,
  loadAndValidateSyncLedger,
  runValidateSyncLedgerCli,
  validateSyncLedger,
} from "./sync-ledger.mjs";

const profile = fixtureProfile();

describe("loadAndValidateSyncLedger", () => {
  it("accepts the happy-path deferred fixture", () => {
    const result = loadAndValidateSyncLedger(
      fixturePath("valid.sync-ledger.json"),
      profile,
    );

    expect(result.errors).toEqual([]);
    expect(result.data.publish.mode).toBe("plugin-import-manual");
    expect(result.data.promotion.parityMode).toBe("deferred");
    expect(result.data.promotion.highestEarnedLevel).toBe("D-publish-valid");
  });

  it("accepts the blocked example fixture", () => {
    const result = loadAndValidateSyncLedger(
      fixturePath("blocked.sync-ledger.json"),
      profile,
    );

    expect(result.errors).toEqual([]);
    expect(result.data.exceptions).toHaveLength(1);
    expect(result.data.exceptions[0]?.blocking).toBe(true);
  });

  it("reports missing required contract fields", () => {
    const result = loadAndValidateSyncLedger(
      fixturePath("invalid-missing-required-field.sync-ledger.json"),
      profile,
    );

    expect(result.errors).toContain(
      "[CT-8B_MISSING_REQUIRED_KEY] artifact.revision is required",
    );
  });

  it("reports contradictory parity metadata", () => {
    const result = loadAndValidateSyncLedger(
      fixturePath("invalid-contradictory-mode.sync-ledger.json"),
      profile,
    );

    expect(result.errors).toContain(
      "[CT-8B_FORBIDDEN_PARITY_DEFERRED_REASON] promotion.parityDeferredReason must be omitted when promotion.parityMode is required",
    );
  });

  it("reports invalid Tokens Studio carrier metadata", () => {
    const result = loadAndValidateSyncLedger(
      fixturePath("invalid-tokens-studio-carrier.sync-ledger.json"),
      profile,
    );

    expect(result.errors).toContain(
      "[CT-8B_INVALID_TOKENS_STUDIO_CARRIER_COMBINATION] publish.tokensStudioCarrier must be true only when publish.mode is tokens-studio-carried",
    );
  });

  it("forbids promotion-complete while parity is deferred", () => {
    const result = loadAndValidateSyncLedger(
      fixturePath("invalid-deferred-complete.sync-ledger.json"),
      profile,
    );

    expect(result.errors).toContain(
      "[CT-8B_EARNED_LEVEL_REQUIRES_REQUIRED_PARITY] promotion.highestEarnedLevel cannot be E-promotion-complete when promotion.parityMode is deferred",
    );
  });

  it("accepts the required ledger contract when using the Enterprise rail", () => {
    const result = validateSyncLedger(
      readFixture("valid-required.sync-ledger.json"),
      profile,
    );

    expect(result).toEqual([]);
  });
});

describe("evaluateSyncLedgerConformance", () => {
  it.each([
    ["declared.sync-ledger.json", "declared", false],
    ["valid.sync-ledger.json", "verified-current", true],
    ["stale.sync-ledger.json", "verified-stale", false],
    ["blocked.sync-ledger.json", "blocked-exception", false],
    ["incomplete.sync-ledger.json", "incomplete", false],
  ])(
    "classifies %s as %s",
    (fixtureName, expectedState, expectedPromotable) => {
      const ledger = readFixture(fixtureName);
      const result = evaluateSyncLedgerConformance(ledger);

      expect(result.state).toBe(expectedState);
      expect(result.promotable).toBe(expectedPromotable);
      expect(result.evidence["artifact.revision"]).toBe(
        ledger.artifact.revision,
      );
      expect(result.evidence["publish.mode"]).toBe(ledger.publish.mode);
    },
  );

  it("records carrier-only usage without changing the verified-current state", () => {
    const result = evaluateSyncLedgerConformance(
      readFixture("valid-carried.sync-ledger.json"),
    );

    expect(result.state).toBe("verified-current");
    expect(result.evidence["publish.tokensStudioCarrier"]).toBe(true);
  });
});

describe("validateFigmaParity", () => {
  it("accepts a required ledger with the hardened rail and no blocking exceptions", () => {
    const result = validateFigmaParity({
      target: fixturePath("valid-required.sync-ledger.json"),
      profile,
    });

    expect(result).toEqual({
      ok: true,
      parityMode: "required",
      state: "verified-current",
      message:
        "✓ Figma parity requirements are satisfied for the current sync ledger (state=verified-current).",
    });
  });

  it("fails required parity when a blocking exception remains open", () => {
    const requiredLedger = readFixture("valid-required.sync-ledger.json");
    const result = evaluateFigmaParity({
      ...requiredLedger,
      exceptions: [
        {
          code: "oauth-ownership-pending",
          message: "The hardened rail still has unresolved ownership work.",
          blocking: true,
          status: "open",
          field: "exceptions[0]",
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "[FIGMA_PARITY_OPEN_BLOCKING_EXCEPTION] exceptions[0].status for oauth-ownership-pending must not remain open when promotion.parityMode is required",
    );
  });

  it("accepts required parity with the canonical plugin-import-manual rail", () => {
    const requiredLedger = readFixture("valid-required.sync-ledger.json");
    const result = evaluateFigmaParity({
      ...requiredLedger,
      publish: {
        ...requiredLedger.publish,
        mode: "plugin-import-manual",
      },
    });

    expect(result.ok).toBe(true);
  });

  it("fails required parity when the current verification is stale", () => {
    const staleLedger = readFixture("valid-required.sync-ledger.json");
    const result = evaluateFigmaParity({
      ...staleLedger,
      verification: {
        ...staleLedger.verification,
        lastVerifiedRevision: "ffffffffffffffffffffffffffffffffffffffff",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.state).toBe("verified-stale");
    expect(result.errors).toContain(
      "[FIGMA_PARITY_REQUIRES_VERIFIED_CURRENT_STATE] evaluated sync ledger state must be verified-current when promotion.parityMode is required (received verified-stale)",
    );
  });

  it("fails required parity when Tokens Studio remains active as the carrier", () => {
    const carrierLedger = readFixture("valid-required.sync-ledger.json");
    const result = evaluateFigmaParity({
      ...carrierLedger,
      publish: {
        ...carrierLedger.publish,
        mode: "tokens-studio-carried",
        tokensStudioCarrier: true,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "[FIGMA_PARITY_FORBIDS_TOKENS_STUDIO_CARRIER] publish.tokensStudioCarrier must be false when promotion.parityMode is required",
    );
  });
});

describe("runValidateSyncLedgerCli", () => {
  it("prints the evaluated conformance state and evidence without failing deferred states", () => {
    const stdout = createWritableBuffer();
    const stderr = createWritableBuffer();
    const exitCode = runValidateSyncLedgerCli({
      args: [fixturePath("stale.sync-ledger.json")],
      profile,
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(stdout.read()).toContain(
      "[FIGMA_SYNC_LEDGER_STATE] state=verified-stale",
    );
    expect(stdout.read()).toContain(
      "verification.lastVerifiedRevision=1212121212121212121212121212121212121212",
    );
    expect(stderr.read()).toBe("");
  });
});

describe("runValidateFigmaParityCli", () => {
  it("prints the explicit deferred branch instead of silently skipping parity", () => {
    const stdout = createWritableBuffer();
    const stderr = createWritableBuffer();
    const exitCode = runValidateFigmaParityCli({
      args: [fixturePath("valid.sync-ledger.json")],
      profile,
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(stdout.read()).toContain("[FIGMA_PARITY_DEFERRED]");
    expect(stdout.read()).toContain("state=verified-current");
    expect(stdout.read()).toContain(
      "Parity remains deferred because the release-governed promotion gate is not yet in place for this consumer.",
    );
    expect(stderr.read()).toBe("");
  });
});

describe("the publication binding's absence rules", () => {
  const withPublication = readFixture("valid.sync-ledger.json");
  const withoutPublication = readFixture("declared.sync-ledger.json");

  it("forbids a proof for a materialization that has not run", () => {
    // A pre-publication repository is legitimately proofless. A binding here
    // would claim an attestation for something nobody attempted.
    expect(
      validateSyncLedger(
        { ...withoutPublication, publication: withPublication.publication },
        profile,
      ),
    ).toContain(
      "[CT-8B_NOT_RUN_FORBIDS_PUBLICATION] publication must be absent when verification.materializationStatus is not-run",
    );
  });

  it.each(["passed", "failed"])(
    "requires a proof when materialization is %s",
    (status) => {
      // A failed attempt is still an attestation, so omitting one is not the
      // way to record a failure.
      const { publication: _dropped, ...bare } = withPublication;
      const errors = validateSyncLedger(
        {
          ...bare,
          verification: { ...bare.verification, materializationStatus: status },
        },
        profile,
      );
      expect(errors).toContain(
        "[CT-8B_MATERIALIZATION_REQUIRES_PUBLICATION] publication is required when verification.materializationStatus is passed or failed",
      );
    },
  );

  it("rejects a binding that is not an exact digest", () => {
    expect(
      validateSyncLedger(
        {
          ...withPublication,
          publication: {
            proof: "./publish-proof.json",
            sha256: "not-a-digest",
          },
        },
        profile,
      ),
    ).toContain(
      "[CT-8B_INVALID_PUBLICATION_DIGEST] publication.sha256 must be a 64-character lowercase sha256 digest",
    );
  });

  it("no longer accepts a v2 ledger", () => {
    // The version moves with the required key, so a v2 record cannot pass by
    // simply omitting the binding it never had.
    expect(
      validateSyncLedger({ ...withPublication, ledgerVersion: "2" }, profile),
    ).toContain("[CT-8B_INVALID_LITERAL] ledgerVersion must be 3");
  });
});
