import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { CannotEvaluateError } from "./profile.mjs";
import {
  assertPlainObject,
  getOpenBlockingExceptions,
  requireProfile,
  validateSyncLedgerShape,
} from "./sync-ledger-shape.mjs";

export * from "./sync-ledger-shape.mjs";

export const syncLedgerUsage =
  "Usage: ds-skills ledger validate --ledger <path> --profile <path>";

export function readSyncLedger(target) {
  const absPath = path.resolve(target);
  let text;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch {
    throw new CannotEvaluateError(
      "LEDGER_UNREADABLE",
      `sync ledger could not be read: ${absPath}`,
    );
  }

  try {
    return { absPath, data: JSON.parse(text) };
  } catch (error) {
    throw new CannotEvaluateError(
      "LEDGER_MALFORMED",
      `sync ledger is not valid JSON: ${absPath} (${error.message})`,
    );
  }
}

export function loadAndValidateSyncLedger(target, profile) {
  const { absPath, data } = readSyncLedger(target);
  return {
    absPath,
    data,
    errors: validateSyncLedger(data, profile),
  };
}

export function validateSyncLedgerWithState(target, profile) {
  const { absPath, data, errors } = loadAndValidateSyncLedger(target, profile);
  return {
    absPath,
    data,
    errors,
    evaluation:
      errors.length === 0 ? evaluateSyncLedgerConformance(data) : null,
  };
}

export function validateSyncLedger(data, profile) {
  requireProfile(profile, "validateSyncLedger");
  const errors = [];

  assertPlainObject(errors, data, "Ledger must be a JSON object");
  if (errors.length > 0) {
    return errors;
  }

  validateSyncLedgerShape(errors, data, profile);

  return errors;
}

export function evaluateSyncLedgerConformance(ledger) {
  const openBlockingExceptions = getOpenBlockingExceptions(ledger.exceptions);
  const evidence = {
    "artifact.path": ledger.artifact.path,
    "artifact.revision": ledger.artifact.revision,
    "publish.mode": ledger.publish.mode,
    "publish.tokensStudioCarrier": ledger.publish.tokensStudioCarrier,
    "verification.materializationStatus":
      ledger.verification.materializationStatus,
    "verification.lastVerifiedRevision":
      ledger.verification.lastVerifiedRevision,
    "promotion.parityMode": ledger.promotion.parityMode,
    "promotion.highestEarnedLevel": ledger.promotion.highestEarnedLevel,
    "exceptions.openBlockingCount": openBlockingExceptions.length,
  };

  if (openBlockingExceptions.length > 0) {
    return {
      state: "blocked-exception",
      promotable: false,
      blockers: openBlockingExceptions.map((entry, index) => ({
        code: entry.code,
        field: entry.field ?? `exceptions[${index}]`,
        message: entry.message,
      })),
      evidence,
    };
  }

  if (ledger.verification.materializationStatus === "not-run") {
    return {
      state: "declared",
      promotable: false,
      blockers: [],
      evidence,
    };
  }

  if (ledger.verification.materializationStatus === "failed") {
    return {
      state: "incomplete",
      promotable: false,
      blockers: [
        {
          code: "verification-materialization-failed",
          field: "verification.materializationStatus",
          message:
            "verification.materializationStatus is failed, so the current artifact revision is not verified.",
        },
      ],
      evidence,
    };
  }

  if (ledger.verification.lastVerifiedRevision !== ledger.artifact.revision) {
    return {
      state: "verified-stale",
      promotable: false,
      blockers: [
        {
          code: "verification-stale-revision",
          field: "verification.lastVerifiedRevision",
          message:
            "verification.lastVerifiedRevision does not match artifact.revision for the active ledger.",
        },
      ],
      evidence,
    };
  }

  return {
    state: "verified-current",
    promotable: true,
    blockers: [],
    evidence,
  };
}

export function runValidateSyncLedgerCli(options = {}) {
  const args = options.args ?? process.argv.slice(2);
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const runValidation = options.runValidation ?? validateSyncLedgerWithState;

  if (args.length !== 1) {
    writeLine(stderr, syncLedgerUsage);
    return 1;
  }

  try {
    const { absPath, errors, evaluation } = runValidation(
      args[0],
      options.profile,
    );

    if (errors.length > 0) {
      for (const error of errors) {
        writeLine(stderr, error);
      }
      return 1;
    }

    writeLine(stdout, `✓ Sync ledger is structurally valid: ${absPath}`);
    writeLine(
      stdout,
      `[FIGMA_SYNC_LEDGER_STATE] state=${evaluation.state} promotable=${evaluation.promotable}`,
    );
    writeLine(
      stdout,
      `[FIGMA_SYNC_LEDGER_EVIDENCE] ${formatEvidenceLine(evaluation.evidence)}`,
    );

    for (const blocker of evaluation.blockers) {
      writeLine(
        stdout,
        `[FIGMA_SYNC_LEDGER_BLOCKER] code=${blocker.code} field=${blocker.field} message=${blocker.message}`,
      );
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeLine(stderr, `[UNEXPECTED_RUNTIME_FAILURE] ${message}`);
    return 3;
  }
}

function formatEvidenceLine(evidence) {
  return Object.entries(evidence)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}

function writeLine(stream, message) {
  stream.write(`${message}\n`);
}
