import process from "node:process";
import {
  evaluateSyncLedgerConformance,
  loadAndValidateSyncLedger,
} from "./sync-ledger.mjs";

export const figmaParityUsage =
  "Usage: ds-skills ledger parity --ledger <path> --profile <path>";

export function evaluateFigmaParity(ledger) {
  const parityMode = ledger.promotion.parityMode;
  const conformance = evaluateSyncLedgerConformance(ledger);

  if (parityMode === "deferred") {
    return {
      ok: true,
      parityMode,
      state: conformance.state,
      message: `[FIGMA_PARITY_DEFERRED] state=${conformance.state} ${ledger.promotion.parityDeferredReason}`,
    };
  }

  const errors = [];
  if (conformance.state !== "verified-current") {
    errors.push(
      `[FIGMA_PARITY_REQUIRES_VERIFIED_CURRENT_STATE] evaluated sync ledger state must be verified-current when promotion.parityMode is required (received ${conformance.state})`,
    );
  }

  if (ledger.publish.tokensStudioCarrier) {
    errors.push(
      "[FIGMA_PARITY_FORBIDS_TOKENS_STUDIO_CARRIER] publish.tokensStudioCarrier must be false when promotion.parityMode is required",
    );
  }

  if (ledger.promotion.highestEarnedLevel !== "E-promotion-complete") {
    errors.push(
      "[FIGMA_PARITY_REQUIRES_COMPLETE_PROMOTION] promotion.highestEarnedLevel must be E-promotion-complete when promotion.parityMode is required",
    );
  }

  for (const [index, entry] of ledger.exceptions.entries()) {
    if (entry.blocking === true && entry.status === "open") {
      errors.push(
        `[FIGMA_PARITY_OPEN_BLOCKING_EXCEPTION] exceptions[${index}].status for ${entry.code} must not remain open when promotion.parityMode is required`,
      );
    }
  }

  for (const blocker of conformance.blockers) {
    errors.push(
      `[FIGMA_PARITY_CONFORMANCE_BLOCKER] ${blocker.field} (${blocker.code}) prevents required parity: ${blocker.message}`,
    );
  }

  if (errors.length > 0) {
    return {
      ok: false,
      parityMode,
      state: conformance.state,
      errors,
      exitCode: 1,
    };
  }

  return {
    ok: true,
    parityMode,
    state: conformance.state,
    message: `✓ Figma parity requirements are satisfied for the current sync ledger (state=${conformance.state}).`,
  };
}

export function validateFigmaParity(options = {}) {
  const target = options.target;
  const loadLedger =
    options.loadAndValidateSyncLedger ?? loadAndValidateSyncLedger;
  const { data, errors } = loadLedger(target, options.profile);

  if (errors.length > 0) {
    return { ok: false, parityMode: null, errors, exitCode: 1 };
  }

  return evaluateFigmaParity(data);
}

export function runValidateFigmaParityCli(options = {}) {
  const args = options.args ?? process.argv.slice(2);
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const runValidation = options.runValidation ?? validateFigmaParity;

  if (args.length !== 1) {
    writeLine(stderr, figmaParityUsage);
    return 1;
  }

  try {
    const result = runValidation({
      target: args[0],
      profile: options.profile,
    });

    if (!result.ok) {
      for (const error of result.errors) {
        writeLine(stderr, error);
      }
      return result.exitCode ?? 1;
    }

    writeLine(stdout, result.message);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeLine(stderr, `[UNEXPECTED_RUNTIME_FAILURE] ${message}`);
    return 3;
  }
}

function writeLine(stream, message) {
  stream.write(`${message}\n`);
}
