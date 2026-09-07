/**
 * The CT-8B status rail's *evaluation*, lifted out of the consumer's status
 * generator. Only the evaluation: the generator's other 611 lines are Storybook
 * proof coverage, Chromatic status, story inventory and claim profiles, and none
 * of that is rail.
 *
 * The consumer keeps the mapping to its report — including `claimRelevant`,
 * which is a product policy about whether CT-8B applies to a given change class,
 * not a rail question. So this answers "if the rail applies, what does it say?"
 * and the consumer decides whether it applies.
 *
 * Behaviour is pinned against outputs captured from the pre-move implementation
 * in __fixtures__/status-rail.baseline.json — expected values whose origin is
 * the old code, not this file describing itself.
 */
import { evaluateSyncLedgerConformance } from "./sync-ledger.mjs";

/**
 * @param {any} ledger a ledger that has already passed validation
 * @returns {{
 *   freshness: 'current' | 'stale',
 *   outcome: 'satisfied' | 'unsatisfied' | 'deferred',
 *   reasonCodes: string[],
 *   sourceVersionOrRevision: string,
 *   state: string,
 *   promotable: boolean,
 *   evidence: Record<string, unknown>,
 * }}
 */
export function evaluateStatusRail(ledger) {
  const conformance = evaluateSyncLedgerConformance(ledger);
  const freshness =
    conformance.state === "verified-stale" ? "stale" : "current";

  const outcome =
    ledger.promotion.parityMode === "deferred"
      ? "deferred"
      : conformance.state === "verified-current" &&
          ledger.promotion.highestEarnedLevel === "E-promotion-complete"
        ? "satisfied"
        : "unsatisfied";

  // Order matters and is load-bearing: a stale ledger whose parity is deferred
  // reports `stale`, not `deferred`. Reordering these branches changes what a
  // reviewer is told without changing any outcome, so it looks harmless.
  const reasonCodes =
    freshness === "stale"
      ? ["ct8b-parity-stale"]
      : outcome === "deferred"
        ? ["ct8b-parity-deferred"]
        : outcome === "unsatisfied"
          ? ["ct8b-parity-unsatisfied"]
          : [];

  return {
    freshness,
    outcome,
    reasonCodes,
    sourceVersionOrRevision: `ledgerVersion:${ledger.ledgerVersion}|artifactRevision:${ledger.artifact.revision}`,
    state: conformance.state,
    promotable: conformance.promotable,
    evidence: conformance.evidence,
  };
}
