import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ledgerFixturePath,
  profilePath,
  readLedgerFixture,
} from "./__fixtures__/support.js";
import {
  CannotEvaluateError,
  portableInvariantKeys,
  readProfile,
  resolveProfile,
} from "./profile.mjs";
import { checkPublicationBinding } from "./publication-binding.mjs";
import {
  loadAndValidatePublishProof,
  validatePublishProof,
} from "./publish-proof.mjs";
import {
  loadAndValidateSyncLedger,
  validateSyncLedger,
} from "./sync-ledger.mjs";

let tmpDir: string;
beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-skills-profile-"));
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const validProfile = {
  "artifact-path": { const: "x/tokens.json" },
  "destination-name": { const: "Somewhere" },
  "destination-figma-file": { const: "figma://file/somewhere" },
};

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof CannotEvaluateError) return error.code;
    throw error;
  }
  throw new Error("expected the profile to be rejected");
}

describe("a profile declares expectations, it does not relax invariants", () => {
  it("resolves the literals both validators compare against", () => {
    const resolved = resolveProfile(validProfile) as {
      artifactPath: string;
      publishModes: string[];
    };
    expect(resolved.artifactPath).toBe("x/tokens.json");
    // Unstated means the full portable set, never "anything goes".
    expect(resolved.publishModes).toEqual([
      "plugin-import-manual",
      "tokens-studio-carried",
    ]);
  });

  it("may narrow the publish modes", () => {
    const resolved = resolveProfile({
      ...validProfile,
      "publish-modes": { enum: ["plugin-import-manual"] },
    }) as { publishModes: string[] };
    expect(resolved.publishModes).toEqual(["plugin-import-manual"]);
  });

  it("may not re-enable the retired REST mode", () => {
    // The retirement touched a schema, two validators, fixtures and error
    // messages. A profile that could widen this enum would undo all of it from
    // outside the package, without changing a line of it.
    expect(
      reason(() =>
        resolveProfile({
          ...validProfile,
          "publish-modes": {
            enum: ["plugin-import-manual", "rest-variables-oauth"],
          },
        }),
      ),
    ).toBe("PROFILE_WIDENS_PUBLISH_MODES");
  });

  it.each(portableInvariantKeys as string[])(
    "refuses to silently ignore an attempt to override %s",
    (key) => {
      expect(
        reason(() =>
          resolveProfile({ ...validProfile, [key]: { const: "x" } }),
        ),
      ).toBe("PROFILE_OVERRIDES_INVARIANT");
    },
  );

  it("names the key it is missing", () => {
    const { "destination-name": _omitted, ...rest } = validProfile;
    expect(reason(() => resolveProfile(rest))).toBe("PROFILE_MISSING_KEY");
  });

  it("rejects a fragment that is not a literal expectation", () => {
    expect(
      reason(() =>
        resolveProfile({
          ...validProfile,
          "artifact-path": { type: "string" },
        }),
      ),
    ).toBe("PROFILE_INVALID_KEY");
  });

  it("cannot be evaluated from a file that is missing or malformed", () => {
    expect(reason(() => readProfile(path.join(tmpDir, "nope.json")))).toBe(
      "PROFILE_UNREADABLE",
    );
    const broken = path.join(tmpDir, "broken.json");
    fs.writeFileSync(broken, "{");
    expect(reason(() => readProfile(broken))).toBe("PROFILE_MALFORMED");
  });

  it("is required — a validator with no profile fails loudly, never vacuously", () => {
    // Comparing against `undefined` would make every literal check pass.
    const ledger = readLedgerFixture("valid.sync-ledger.json");
    expect(reason(() => validateSyncLedger(ledger, undefined))).toBe(
      "PROFILE_REQUIRED",
    );
    expect(reason(() => validatePublishProof({}, undefined))).toBe(
      "PROFILE_REQUIRED",
    );
  });
});

describe("a second consumer, unlike the first in every profiled dimension", () => {
  const profileB = readProfile(profilePath("consumer-b")).profile;
  const ledgerB = new URL(
    "./__fixtures__/consumer-b/sync-ledger.json",
    import.meta.url,
  );
  const proofB = new URL(
    "./__fixtures__/consumer-b/publish-proof.json",
    import.meta.url,
  );

  it("accepts consumer B's records under consumer B's profile", () => {
    const ledgerPath = ledgerB.pathname;
    const loaded = loadAndValidateSyncLedger(ledgerPath, profileB);
    expect(loaded.errors).toEqual([]);
    expect(
      loadAndValidatePublishProof(proofB.pathname, profileB).errors,
    ).toEqual([]);
    expect(
      checkPublicationBinding({
        ledger: loaded.data,
        ledgerPath,
        profile: profileB,
      }).errors,
    ).toEqual([]);
  });

  it("rejects consumer A's records under consumer B's profile, and the reverse", () => {
    // Both record sets are internally consistent; what differs is whose repo
    // they belong to. If either passed, the validators would still be carrying
    // a consumer's vocabulary rather than reading it.
    const aUnderB = loadAndValidateSyncLedger(
      ledgerFixturePath("valid.sync-ledger.json"),
      profileB,
    );
    expect(aUnderB.errors).toContain(
      "[CT-8B_INVALID_LITERAL] artifact.path must be build/design-tokens.json",
    );

    const profileA = readProfile(profilePath("consumer-a")).profile;
    const bUnderA = loadAndValidateSyncLedger(ledgerB.pathname, profileA);
    expect(bUnderA.errors).toContain(
      "[CT-8B_INVALID_LITERAL] artifact.path must be design-tokens/dist/figma/tokens.json",
    );
  });

  it("enforces B's narrowed mode set, which A's profile permits", () => {
    const carried = readLedgerFixture("valid-carried.sync-ledger.json");
    const underB = validateSyncLedger(
      {
        ...carried,
        artifact: { ...carried.artifact, path: "build/design-tokens.json" },
      },
      profileB,
    );
    expect(underB).toContain(
      "[CT-8B_INVALID_PUBLISH_MODE] publish.mode must be one of: plugin-import-manual",
    );
  });
});
