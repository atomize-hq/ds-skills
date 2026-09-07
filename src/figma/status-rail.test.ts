import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadAndValidateSyncLedger } from "./sync-ledger.mjs";
import { evaluateStatusRail } from "./status-rail.mjs";

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
        expected.sourceVersionOrRevision,
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
