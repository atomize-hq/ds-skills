import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { fixtureProfile } from "./__fixtures__/support.js";
import { loadAndValidateSyncLedger } from "./sync-ledger.mjs";
import { evaluateStatusRail } from "./status-rail.mjs";

const profile = fixtureProfile();

/**
 * The captured baseline reads `ledgerVersion:2`. T12 moved the ledger schema to
 * v3, which changes this one string and nothing else the rail reports. It is
 * substituted here rather than rewritten into the baseline file, so the pre-move
 * capture stays a pre-move capture — a rebaseline would make the reconciliation
 * unfalsifiable.
 */
const V2_TO_V3 = ["ledgerVersion:2|", "ledgerVersion:3|"] as const;

function reconciled(sourceVersionOrRevision: string): string {
  return sourceVersionOrRevision.replace(V2_TO_V3[0], V2_TO_V3[1]);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const ledgerFixtures = path.join(here, "__fixtures__/sync-ledger");

/**
 * Expected values captured from the CONSUMER's pre-move summarizeCt8b(), driven
 * once per fixture through createReusableComponentStatus. Independent origin: if
 * the moved evaluator disagrees, the relocation changed behaviour.
 */
const baseline = JSON.parse(
  fs.readFileSync(
    path.join(here, "__fixtures__/status-rail.baseline.json"),
    "utf8",
  ),
) as Record<
  string,
  {
    freshness: string;
    outcome: string;
    statusReasonCodes: string[];
    sourceVersionOrRevision: string;
  }
>;

const fixtureNames = fs
  .readdirSync(ledgerFixtures)
  .filter((f) => f.endsWith(".sync-ledger.json"))
  .map((f) => f.replace(".sync-ledger.json", ""))
  .sort();

describe("evaluateStatusRail reproduces the pre-move rail", () => {
  it("covers every ledger fixture, so none can be quietly dropped", () => {
    expect(fixtureNames).toHaveLength(11);
    expect(Object.keys(baseline).sort()).toEqual(fixtureNames);
  });

  // The second reconciliation, as an assertion rather than a claim in a table:
  // the version segment is the ONLY thing T12 was allowed to change here. A
  // moved revision would mean a fixture changed identity under cover of the
  // schema bump.
  it("differs from the pre-move capture in the version segment alone", () => {
    for (const [name, expected] of Object.entries(baseline)) {
      const [version, revision] = expected.sourceVersionOrRevision.split("|");
      if (expected.freshness === "missing") {
        expect(expected.sourceVersionOrRevision, name).toBe("unavailable");
        continue;
      }
      expect(version, name).toBe("ledgerVersion:2");
      expect(reconciled(expected.sourceVersionOrRevision), name).toBe(
        `ledgerVersion:3|${revision}`,
      );
    }
  });

  for (const name of fixtureNames) {
    const expected = baseline[name]!;

    // The four invalid fixtures never reach the evaluator: the consumer's
    // loader rejects them first and its rail reports `missing`. That collapse —
    // an invalid ledger being indistinguishable from an absent one — is a
    // consumer defect recorded in the boundary contract, not this evaluator's.
    const evaluable = expected.freshness !== "missing";

    it(`${name} — ${evaluable ? "evaluates identically" : "is rejected before evaluation"}`, () => {
      const loaded = loadAndValidateSyncLedger(
        path.join(ledgerFixtures, `${name}.sync-ledger.json`),
        profile,
      );

      if (!evaluable) {
        expect(loaded.errors.length).toBeGreaterThan(0);
        return;
      }

      expect(loaded.errors).toEqual([]);
      const rail = evaluateStatusRail(loaded.data);

      expect(rail.freshness).toBe(expected.freshness);
      expect(rail.outcome).toBe(expected.outcome);
      expect(rail.sourceVersionOrRevision).toBe(
        reconciled(expected.sourceVersionOrRevision),
      );
      expect(rail.reasonCodes).toEqual(expected.statusReasonCodes);
    });
  }
});

describe("the reason-code ordering the consumer depends on", () => {
  it("reports a stale ledger as stale even when its parity is deferred", () => {
    // `stale` has parityMode deferred AND a mismatched verified revision. If the
    // branches were reordered it would report `ct8b-parity-deferred` while every
    // outcome stayed identical — a silent change to what a reviewer is told.
    const loaded = loadAndValidateSyncLedger(
      path.join(ledgerFixtures, "stale.sync-ledger.json"),
      profile,
    );
    const rail = evaluateStatusRail(loaded.data);

    expect(rail.outcome).toBe("deferred");
    expect(rail.reasonCodes).toEqual(["ct8b-parity-stale"]);
  });
});

describe("the projection carries what the consumer reads off the ledger directly", () => {
  it("exposes parityMode and highestEarnedLevel as evidence", () => {
    const loaded = loadAndValidateSyncLedger(
      path.join(ledgerFixtures, "valid-required.sync-ledger.json"),
      profile,
    );
    const rail = evaluateStatusRail(loaded.data);

    // These two are read straight off the ledger by summarizeCt8b() today. If
    // they are not in the projection, the consumer keeps opening the ledger and
    // the boundary has not moved.
    expect(rail.evidence["promotion.parityMode"]).toBe("required");
    expect(rail.evidence["promotion.highestEarnedLevel"]).toBe(
      "E-promotion-complete",
    );
    expect(rail.state).toBe("verified-current");
    expect(rail.promotable).toBe(true);
  });
});
