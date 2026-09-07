import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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

const here = path.dirname(fileURLToPath(import.meta.url));
const syncLedgerFixtureDir = path.join(here, "__fixtures__/sync-ledger");

describe("loadAndValidateSyncLedger", () => {
  it("accepts the happy-path deferred fixture", () => {
    const result = loadAndValidateSyncLedger(
      fixturePath("valid.sync-ledger.json"),
    );

    expect(result.errors).toEqual([]);
    expect(result.data.publish.mode).toBe("plugin-import-manual");
    expect(result.data.promotion.parityMode).toBe("deferred");
    expect(result.data.promotion.highestEarnedLevel).toBe("D-publish-valid");
  });

  it("accepts the blocked example fixture", () => {
    const result = loadAndValidateSyncLedger(
      fixturePath("blocked.sync-ledger.json"),
    );

    expect(result.errors).toEqual([]);
    expect(result.data.exceptions).toHaveLength(1);
    expect(result.data.exceptions[0]?.blocking).toBe(true);
  });

  it("reports missing required contract fields", () => {
    const result = loadAndValidateSyncLedger(
      fixturePath("invalid-missing-required-field.sync-ledger.json"),
    );

    expect(result.errors).toContain(
      "[CT-8B_MISSING_REQUIRED_KEY] artifact.revision is required",
    );
  });

  it("reports contradictory parity metadata", () => {
    const result = loadAndValidateSyncLedger(
      fixturePath("invalid-contradictory-mode.sync-ledger.json"),
    );

    expect(result.errors).toContain(
      "[CT-8B_FORBIDDEN_PARITY_DEFERRED_REASON] promotion.parityDeferredReason must be omitted when promotion.parityMode is required",
    );
  });

  it("reports invalid Tokens Studio carrier metadata", () => {
    const result = loadAndValidateSyncLedger(
      fixturePath("invalid-tokens-studio-carrier.sync-ledger.json"),
    );

    expect(result.errors).toContain(
      "[CT-8B_INVALID_TOKENS_STUDIO_CARRIER_COMBINATION] publish.tokensStudioCarrier must be true only when publish.mode is tokens-studio-carried",
    );
  });

  it("forbids promotion-complete while parity is deferred", () => {
    const result = loadAndValidateSyncLedger(
      fixturePath("invalid-deferred-complete.sync-ledger.json"),
    );

    expect(result.errors).toContain(
      "[CT-8B_EARNED_LEVEL_REQUIRES_REQUIRED_PARITY] promotion.highestEarnedLevel cannot be E-promotion-complete when promotion.parityMode is deferred",
    );
  });

  it("accepts the required ledger contract when using the Enterprise rail", () => {
    const result = validateSyncLedger(
      readFixture("valid-required.sync-ledger.json"),
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
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    expect(stdout.read()).toContain("[FIGMA_PARITY_DEFERRED]");
    expect(stdout.read()).toContain("state=verified-current");
    expect(stdout.read()).toContain(
      "Parity remains deferred because the release-governed promotion gate is not yet in place for Collider.",
    );
    expect(stderr.read()).toBe("");
  });
});

function fixturePath(name: string) {
  return path.join(syncLedgerFixtureDir, name);
}

function readFixture(name: string) {
  return JSON.parse(fs.readFileSync(fixturePath(name), "utf8")) as {
    artifact: { revision: string };
    exceptions: Array<{
      blocking: boolean;
      code: string;
      field?: string;
      message: string;
      status: string;
    }>;
    promotion: { parityMode: string };
    publish: {
      figmaFile: string;
      mode: string;
      tokensStudioCarrier: boolean;
    };
    verification: {
      lastVerifiedRevision: string | null;
      materializationStatus: string;
    };
  };
}

function createWritableBuffer() {
  let buffer = "";

  return {
    write(chunk: string | Uint8Array) {
      buffer +=
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    },
    read() {
      return buffer;
    },
  };
}
