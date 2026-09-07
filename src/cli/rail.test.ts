import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  EXIT_CANNOT_EVALUATE,
  EXIT_NONCONFORMANT,
  EXIT_OK,
  emitsMachineResult,
} from "./exit-codes.js";
import { runCli } from "./run.js";

const fixtures = fileURLToPath(
  new URL("../figma/__fixtures__/", import.meta.url),
);
const profileA = path.join(fixtures, "profiles/consumer-a.json");
const ledgers = path.join(fixtures, "sync-ledger");

function capture(argv: readonly string[]) {
  let out = "";
  let err = "";
  const code = runCli({
    argv,
    version: "0.0.0-test",
    stdout: { write: (chunk: string) => (out += chunk) },
    stderr: { write: (chunk: string) => (err += chunk) },
  });
  return { code, out, err };
}

function validateJson(ledger: string, profile = profileA) {
  const { code, out, err } = capture([
    "ledger",
    "validate",
    "--ledger",
    ledger,
    "--profile",
    profile,
    "--json",
  ]);
  return { code, err, result: out === "" ? null : JSON.parse(out) };
}

let tmpDir: string;
let brokenBinding: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-skills-cli-"));
  // A ledger whose bound proof has been edited since it was attested: the one
  // way an otherwise-valid record becomes nonconformant, so exit 1 is reachable.
  const proof = JSON.parse(
    fs.readFileSync(path.join(ledgers, "valid.publish-proof.json"), "utf8"),
  );
  const ledger = JSON.parse(
    fs.readFileSync(path.join(ledgers, "valid.sync-ledger.json"), "utf8"),
  );
  // Named exactly as the ledger's binding names it: the point of this case is
  // an edited proof, not an unresolvable one, and those are different findings.
  const proofPath = path.join(tmpDir, path.basename(ledger.publication.proof));
  fs.writeFileSync(
    proofPath,
    `${JSON.stringify({ ...proof, materialization: { ...proof.materialization, attemptedAt: "2026-05-01T00:00:00Z" } }, null, 2)}\n`,
  );
  brokenBinding = path.join(tmpDir, "sync-ledger.json");
  fs.writeFileSync(brokenBinding, `${JSON.stringify(ledger, null, 2)}\n`);
  // The ledger keeps the original digest, so the binding no longer resolves to
  // the record it names.
  expect(
    crypto
      .createHash("sha256")
      .update(fs.readFileSync(proofPath))
      .digest("hex"),
  ).not.toBe(ledger.publication.sha256);
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("the --json result is a versioned interface", () => {
  it("declares its own version, independent of the ledger's", () => {
    const { result } = validateJson(
      path.join(ledgers, "valid.sync-ledger.json"),
    );
    expect(result.resultVersion).toBe("1");
    // Independent on purpose: the ledger moved 2 -> 3 in this very task and the
    // result contract did not.
    expect(result.rail.sourceVersionOrRevision).toContain("ledgerVersion:3");
  });

  it("carries the nine evidence keys in a fixed order", () => {
    const { result } = validateJson(
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

  it("emits byte-identical output for the same input", () => {
    const first = capture([
      "ledger",
      "validate",
      "--ledger",
      path.join(ledgers, "stale.sync-ledger.json"),
      "--profile",
      profileA,
      "--json",
    ]);
    const second = capture([
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

  it("uses bare diagnostic codes, without the human bracket punctuation", () => {
    const { result } = validateJson(
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

  it("puts nothing but the result on stdout", () => {
    const { out } = capture([
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
  it("0 — evaluated and conformant", () => {
    const { code, result } = validateJson(
      path.join(ledgers, "valid.sync-ledger.json"),
    );
    expect(code).toBe(EXIT_OK);
    expect(result.ok).toBe(true);
  });

  it("1 — evaluated and NOT conformant, with the result still on stdout", () => {
    // The payload on a failing run is the reason --json exists: a caller that
    // discards stdout on non-zero exit throws away the diagnosis.
    const { code, result } = validateJson(brokenBinding);
    expect(code).toBe(EXIT_NONCONFORMANT);
    expect(emitsMachineResult(code)).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d: { code: string }) => d.code)).toContain(
      "CT-8B_PUBLICATION_DIGEST_MISMATCH",
    );
  });

  it("2 — could not evaluate, and emits nothing at all", () => {
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
      const { code, out, err } = capture(argv);
      expect(code, argv.join(" ")).toBe(EXIT_CANNOT_EVALUATE);
      // The asymmetry is deliberate: a caller parsing stdout cannot mistake a
      // non-answer for an empty result.
      expect(out, argv.join(" ")).toBe("");
      expect(err.length).toBeGreaterThan(0);
      expect(emitsMachineResult(code)).toBe(false);
    }
  });
});

describe("the status projection replaces reading the records", () => {
  it("answers every field the status caller reads today", () => {
    // The hold point on this task: a caller gets its complete rail answer from
    // here without opening the ledger or the proof.
    const { result } = validateJson(
      path.join(ledgers, "stale.sync-ledger.json"),
    );
    expect(result.rail).toEqual({
      freshness: "stale",
      outcome: "deferred",
      reasonCodes: ["ct8b-parity-stale"],
      sourceVersionOrRevision:
        "ledgerVersion:3|artifactRevision:9898989898989898989898989898989898989898",
    });
    expect(result.evidence["promotion.parityMode"]).toBe("deferred");
    expect(result.evidence["promotion.highestEarnedLevel"]).toBe(
      "C-consumption-valid",
    );
  });

  it("reports a conformance blocker without failing a legitimate state", () => {
    // `verified-stale` is a real state, not a broken record. The pre-CLI
    // validator exited 0 here and so must this, or the migration tightens a
    // gate while claiming to move one.
    const { code, result } = validateJson(
      path.join(ledgers, "stale.sync-ledger.json"),
    );
    expect(code).toBe(EXIT_OK);
    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((d: { code: string }) => d.code)).toEqual([
      "verification-stale-revision",
    ]);
  });

  it("never reports a rail for a record it could not read", () => {
    const { result } = validateJson(
      path.join(ledgers, "invalid-contradictory-mode.sync-ledger.json"),
    );
    // The consumer's defect this replaces is exactly the opposite: an
    // unreadable ledger reported as a clean, not-applicable rail.
    expect(result.rail).toBeNull();
    expect(result.evidence).toBeNull();
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

describe("proof validate and ledger parity stay independently invocable", () => {
  it("validates a proof with no ledger in sight", () => {
    const { code, out } = capture([
      "proof",
      "validate",
      "--proof",
      path.join(
        fixtures,
        "publish-proof/valid-plugin-import-manual.publish-proof.json",
      ),
      "--profile",
      profileA,
      "--json",
    ]);
    expect(code).toBe(EXIT_OK);
    const result = JSON.parse(out);
    expect(result.command).toBe("proof validate");
    expect(result.ledgerPath).toBeNull();
  });

  it("keeps parity a command of its own, not a side effect of validation", () => {
    const { code, out } = capture([
      "ledger",
      "parity",
      "--ledger",
      path.join(ledgers, "valid-required.sync-ledger.json"),
      "--profile",
      profileA,
      "--json",
    ]);
    expect(code).toBe(EXIT_OK);
    expect(JSON.parse(out).command).toBe("ledger parity");
  });

  it("fails parity for a deferred-but-required contradiction", () => {
    const { code, out } = capture([
      "ledger",
      "parity",
      "--ledger",
      path.join(ledgers, "stale.sync-ledger.json"),
      "--profile",
      profileA,
      "--json",
    ]);
    // stale is parityMode deferred, so parity passes and says so; the state is
    // carried rather than hidden.
    expect(code).toBe(EXIT_OK);
    expect(JSON.parse(out).state).toBe("verified-stale");
  });
});
