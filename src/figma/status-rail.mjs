/**
 * Publication-record evaluation shared by the ledger CLI and the product's
 * component-evidence aggregation. Applicability belongs to reviewed project policy,
 * not to this ledger evaluator. A conformant attestation is not a new live Figma scan.
 * Baseline fixtures retain evidence of the pre-extraction evaluation behavior.
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
