import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fixtureProfile, readLedgerFixture } from "./__fixtures__/support.js";
import { checkPublicationBinding } from "./publication-binding.mjs";
import { validatePublishProof } from "./publish-proof.mjs";
import { validateSyncLedger } from "./sync-ledger.mjs";

const profile = fixtureProfile();
let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-skills-binding-"));
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

let counter = 0;

/**
 * Writes a ledger and its bound proof, with the digest computed from the bytes
 * actually written. Overrides are deep-merged one level, which is enough for
 * every fact in §4's table.
 */
function buildPair(
  ledgerOverrides: Record<string, unknown> = {},
  proofOverrides: Record<string, unknown> = {},
  options: { skipDigest?: boolean; proofName?: string } = {},
) {
  const dir = path.join(tmpDir, `case-${(counter += 1)}`);
  fs.mkdirSync(dir, { recursive: true });

  const baseLedger = readLedgerFixture("valid.sync-ledger.json");
  const baseProof = JSON.parse(
    fs.readFileSync(
      path.join(
        path.dirname(new URL(import.meta.url).pathname),
        "__fixtures__/sync-ledger/valid.publish-proof.json",
      ),
      "utf8",
    ),
  );

  const proof = merge(baseProof, proofOverrides);
  const proofName = options.proofName ?? "publish-proof.json";
  const proofPath = path.join(dir, proofName);
  fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);

  const ledger = merge(baseLedger, ledgerOverrides);
  ledger["publication"] = {
    proof: `./${proofName}`,
    sha256: options.skipDigest
      ? "0".repeat(64)
      : crypto
          .createHash("sha256")
          .update(fs.readFileSync(proofPath))
          .digest("hex"),
    ...(ledgerOverrides["publication"] as object | undefined),
  };
  const ledgerPath = path.join(dir, "sync-ledger.json");
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

  return { ledger, ledgerPath, proof, proofPath };
}

function merge(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    out[key] =
      isPlainObject(value) && isPlainObject(base[key])
        ? { ...(base[key] as object), ...value }
        : value;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codes(ledger: unknown, ledgerPath: string): string[] {
  const { errors } = checkPublicationBinding({
    ledger,
    ledgerPath,
    profile,
  });
  return errors.map((line: string) => /^\[([^\]]+)\]/.exec(line)?.[1] ?? line);
}

const SHA_A = "1111111111111111111111111111111111111111";
const SHA_B = "4444444444444444444444444444444444444444";

describe("the binding resolves one exact record", () => {
  it("accepts a proof whose bytes match the declared digest", () => {
    const { ledger, ledgerPath } = buildPair();
    expect(codes(ledger, ledgerPath)).toEqual([]);
  });

  it("rejects a named proof that resolves to nothing", () => {
    const { ledger, ledgerPath, proofPath } = buildPair();
    fs.rmSync(proofPath);
    expect(codes(ledger, ledgerPath)).toEqual([
      "CT-8B_PUBLICATION_PROOF_UNRESOLVED",
    ]);
  });

  it("rejects a present but malformed proof rather than ignoring it", () => {
    const { ledger, ledgerPath, proofPath } = buildPair();
    fs.writeFileSync(proofPath, "{ not json");
    expect(codes(ledger, ledgerPath)).toEqual([
      "CT-8B_PUBLICATION_PROOF_UNRESOLVED",
    ]);
  });

  it("rejects an edited proof, and is never resolved by recomputing", () => {
    const { ledger, ledgerPath, proof, proofPath } = buildPair();
    fs.writeFileSync(
      proofPath,
      `${JSON.stringify({ ...proof, mode: "tokens-studio-carried" }, null, 2)}\n`,
    );

    expect(codes(ledger, ledgerPath)).toEqual([
      "CT-8B_PUBLICATION_DIGEST_MISMATCH",
    ]);
    // Recomputing the digest is what a "fix" would look like. It makes the
    // record self-consistent and the edit invisible, which is the point of
    // binding to bytes rather than to a path.
    const recomputed = crypto
      .createHash("sha256")
      .update(fs.readFileSync(proofPath))
      .digest("hex");
    expect(recomputed).not.toBe(
      (ledger["publication"] as { sha256: string }).sha256,
    );
  });

  it("rejects a bound proof that is itself invalid", () => {
    const { ledger, ledgerPath } = buildPair(
      {},
      { carrier: { used: false, reason: "carried", exitExpectation: null } },
    );
    expect(codes(ledger, ledgerPath)).toEqual([
      "CT-8B_PUBLICATION_PROOF_INVALID",
    ]);
  });
});

describe("agreement — each record individually valid, shared claims disagreeing", () => {
  // The precondition that makes these cases meaningful: neither record is
  // rejected on its own, so only the cross-record check can catch them.
  function assertBothIndividuallyValid(ledger: unknown, proof: unknown) {
    expect(validateSyncLedger(ledger, profile)).toEqual([]);
    expect(validatePublishProof(proof, profile)).toEqual([]);
  }

  it("fact 2 — the attested revision is not the ledger's verified revision", () => {
    const { ledger, ledgerPath, proof } = buildPair(
      {
        artifact: { path: profile.artifactPath, revision: SHA_B },
        verification: {
          materializationStatus: "passed",
          lastVerifiedRevision: SHA_B,
        },
        promotion: {
          parityMode: "deferred",
          parityDeferredReason: "Fixture case.",
          highestEarnedLevel: "C-consumption-valid",
        },
      },
      { artifact: { path: profile.artifactPath, gitSha: SHA_A } },
    );
    assertBothIndividuallyValid(ledger, proof);
    expect(codes(ledger, ledgerPath)).toEqual([
      "CT-8B_PUBLICATION_ARTIFACT_REVISION_MISMATCH",
    ]);
  });

  it("fact 2, the other direction — the ledger moved, the proof did not", () => {
    const { ledger, ledgerPath, proof } = buildPair(
      {},
      { artifact: { path: profile.artifactPath, gitSha: SHA_B } },
    );
    assertBothIndividuallyValid(ledger, proof);
    expect(codes(ledger, ledgerPath)).toEqual([
      "CT-8B_PUBLICATION_ARTIFACT_REVISION_MISMATCH",
    ]);
  });

  it("facts 3 and 6 — modes disagree, and the carriers disagree with them", () => {
    const { ledger, ledgerPath, proof } = buildPair(
      {},
      {
        mode: "tokens-studio-carried",
        carrier: {
          used: true,
          reason: "Tokens Studio carried it.",
          exitExpectation: "Retire the carrier.",
        },
      },
    );
    assertBothIndividuallyValid(ledger, proof);
    // Carrier is pinned to mode inside each record, so an unequal carrier pair
    // is only reachable through an unequal mode pair — they always report
    // together, which is exactly why fact 6 costs one comparison to close.
    expect(codes(ledger, ledgerPath)).toEqual([
      "CT-8B_PUBLICATION_MODE_MISMATCH",
      "CT-8B_PUBLICATION_CARRIER_MISMATCH",
    ]);
  });

  it("fact 4 — the ledger names a destination the attestation does not", () => {
    const { ledger, ledgerPath, proof } = buildPair({
      publish: {
        mode: "plugin-import-manual",
        tokensStudioCarrier: false,
        figmaFile: "figma://file/some-other-file",
      },
    });
    assertBothIndividuallyValid(ledger, proof);
    expect(codes(ledger, ledgerPath)).toEqual([
      "CT-8B_PUBLICATION_DESTINATION_MISMATCH",
    ]);
  });

  it("fact 5 — the ledger claims a pass the attestation does not support", () => {
    const { ledger, ledgerPath, proof } = buildPair(
      {},
      {
        materialization: {
          status: "failed",
          attemptedAt: "2026-03-19T20:46:09Z",
          notes: "The import did not complete.",
        },
      },
    );
    assertBothIndividuallyValid(ledger, proof);
    expect(codes(ledger, ledgerPath)).toEqual([
      "CT-8B_PUBLICATION_MATERIALIZATION_MISMATCH",
    ]);
  });

  it("fact 1 is unreachable from valid records, and the check is still there", () => {
    // Both validators pin artifact.path to the same profile key, so two valid
    // records cannot disagree on it. Driven directly with a ledger the CLI
    // would already have rejected, so the comparison is exercised rather than
    // assumed — defence in depth if that pinning is ever relaxed.
    const { ledger, ledgerPath } = buildPair({
      artifact: { path: "somewhere/else.json", revision: SHA_A },
    });
    expect(validateSyncLedger(ledger, profile).length).toBeGreaterThan(0);
    expect(codes(ledger, ledgerPath)).toContain(
      "CT-8B_PUBLICATION_ARTIFACT_PATH_MISMATCH",
    );
  });
});

describe("sufficiency is checked separately from agreement", () => {
  it("a valid historical proof does not support a publish-valid claim", () => {
    // Agreement holds — the proof attests exactly what the ledger says it
    // verified. What fails is that the verified publication is not the current
    // artifact, at a promotion level that requires it to be.
    const { ledger, ledgerPath, proof } = buildPair(
      {
        artifact: { path: profile.artifactPath, revision: SHA_B },
        verification: {
          materializationStatus: "passed",
          lastVerifiedRevision: SHA_A,
        },
      },
      { artifact: { path: profile.artifactPath, gitSha: SHA_A } },
    );
    expect(validatePublishProof(proof, profile)).toEqual([]);
    expect(codes(ledger, ledgerPath)).toEqual([
      "CT-8B_PUBLICATION_DOES_NOT_SUPPORT_CLAIM",
    ]);
    // Never reported as an invalid proof: the attestation is fine, the claim
    // built on it is not, and re-attesting to SHA_B would be a forgery.
    expect(codes(ledger, ledgerPath)).not.toContain(
      "CT-8B_PUBLICATION_PROOF_INVALID",
    );
  });

  it("a legitimately stale ledger with a matching proof is not a failure", () => {
    // Same shape, below the promotion level that requires currentness. History
    // is not currentness, and a stale rail is a real state, not a defect.
    const { ledger, ledgerPath } = buildPair(
      {
        artifact: { path: profile.artifactPath, revision: SHA_B },
        verification: {
          materializationStatus: "passed",
          lastVerifiedRevision: SHA_A,
        },
        promotion: {
          parityMode: "deferred",
          parityDeferredReason: "Fixture case.",
          highestEarnedLevel: "C-consumption-valid",
        },
      },
      { artifact: { path: profile.artifactPath, gitSha: SHA_A } },
    );
    expect(codes(ledger, ledgerPath)).toEqual([]);
  });

  it("sufficiency never runs while agreement is broken", () => {
    // Otherwise a mismatched proof could be reported as an unsupported claim,
    // and the reader would go looking for a publication instead of a mismatch.
    const { ledger, ledgerPath } = buildPair(
      { artifact: { path: profile.artifactPath, revision: SHA_B } },
      { artifact: { path: profile.artifactPath, gitSha: SHA_B } },
    );
    const reported = codes(ledger, ledgerPath);
    expect(reported).toContain("CT-8B_PUBLICATION_ARTIFACT_REVISION_MISMATCH");
    expect(reported).not.toContain("CT-8B_PUBLICATION_DOES_NOT_SUPPORT_CLAIM");
  });
});
