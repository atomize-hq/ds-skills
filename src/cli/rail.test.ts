import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  EXIT_CANNOT_EVALUATE,
  EXIT_NONCONFORMANT,
  EXIT_OK,
  emitsMachineResult,
} from "./exit-codes.js";
import {
  brokenBinding,
  capture,
  ledgers,
  profileA,
  tmpDir,
  validateJson,
} from "./harness.js";

describe("the --json result is a versioned interface", () => {
  it("declares its own version, independent of the ledger's", async () => {
    const { result } = await validateJson(
      path.join(ledgers, "valid.sync-ledger.json"),
    );
    expect(result.resultVersion).toBe("1");
    // Independent on purpose: the ledger moved 2 -> 3 in this very task and the
    // result contract did not.
    expect(result.rail.sourceVersionOrRevision).toContain("ledgerVersion:3");
  });

  it("carries the nine evidence keys in a fixed order", async () => {
    const { result } = await validateJson(
      path.join(ledgers, "valid.sync-ledger.json"),
    );
    expect(Object.keys(result.evidence)).toEqual([
      "artifact.path",
      "artifact.revision",
      "publish.mode",
      "publish.tokensStudioCarrier",
      "verification.materializationStatus",
      "verification.lastVerifiedRevision",
      "promotion.parityMode",
      "promotion.highestEarnedLevel",
      "exceptions.openBlockingCount",
    ]);
  });

  it("emits byte-identical output for the same input", async () => {
    const first = await capture([
      "ledger",
      "validate",
      "--ledger",
      path.join(ledgers, "stale.sync-ledger.json"),
      "--profile",
      profileA,
      "--json",
    ]);
    const second = await capture([
      "ledger",
      "validate",
      "--ledger",
      path.join(ledgers, "stale.sync-ledger.json"),
      "--profile",
      profileA,
      "--json",
    ]);
    expect(first.out).toBe(second.out);
  });

  it("uses bare diagnostic codes, without the human bracket punctuation", async () => {
    const { result } = await validateJson(
      path.join(ledgers, "invalid-deferred-complete.sync-ledger.json"),
    );
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.code).not.toContain("[");
      expect(diagnostic.code).toMatch(/^[A-Za-z0-9_.-]+$/);
    }
    expect(result.diagnostics[0].code).toBe(
      "CT-8B_EARNED_LEVEL_REQUIRES_REQUIRED_PARITY",
    );
  });

  it("puts nothing but the result on stdout", async () => {
    const { out } = await capture([
      "ledger",
      "validate",
      "--ledger",
      path.join(ledgers, "stale.sync-ledger.json"),
      "--profile",
      profileA,
      "--json",
    ]);
    expect(() => JSON.parse(out)).not.toThrow();
  });
});

describe("exit codes separate an answer from the absence of one", () => {
  it("0 — evaluated and conformant", async () => {
    const { code, result } = await validateJson(
      path.join(ledgers, "valid.sync-ledger.json"),
    );
    expect(code).toBe(EXIT_OK);
    expect(result.ok).toBe(true);
  });

  it("1 — evaluated and NOT conformant, with the result still on stdout", async () => {
    // The payload on a failing run is the reason --json exists: a caller that
    // discards stdout on non-zero exit throws away the diagnosis.
    const { code, result } = await validateJson(brokenBinding);
    expect(code).toBe(EXIT_NONCONFORMANT);
    expect(emitsMachineResult(code)).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d: { code: string }) => d.code)).toContain(
      "CT-8B_PUBLICATION_DIGEST_MISMATCH",
    );
  });

  it("2 — could not evaluate, and emits nothing at all", async () => {
    for (const argv of [
      [
        "ledger",
        "validate",
        "--ledger",
        path.join(ledgers, "absent.json"),
        "--profile",
        profileA,
        "--json",
      ],
      ["ledger", "validate", "--profile", profileA, "--json"],
      [
        "ledger",
        "validate",
        "--ledger",
        path.join(ledgers, "valid.sync-ledger.json"),
        "--profile",
        path.join(tmpDir, "no-profile.json"),
        "--json",
      ],
    ]) {
      const { code, out, err } = await capture(argv);
      expect(code, argv.join(" ")).toBe(EXIT_CANNOT_EVALUATE);
      // The asymmetry is deliberate: a caller parsing stdout cannot mistake a
      // non-answer for an empty result.
      expect(out, argv.join(" ")).toBe("");
      expect(err.length).toBeGreaterThan(0);
      expect(emitsMachineResult(code)).toBe(false);
    }
  });
});
