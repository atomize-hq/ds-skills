import path from "node:path";

import { evaluateFigmaParity } from "../figma/figma-parity.mjs";
import { readProfile } from "../figma/profile.mjs";
import { checkPublicationBinding } from "../figma/publication-binding.mjs";
import { loadAndValidatePublishProof } from "../figma/publish-proof.mjs";
import { evaluateStatusRail } from "../figma/status-rail.mjs";
import {
  evaluateSyncLedgerConformance,
  loadAndValidateSyncLedger,
} from "../figma/sync-ledger.mjs";
import {
  parseDiagnostic,
  RESULT_VERSION,
  type Diagnostic,
  type RailResult,
} from "./result.js";

/** The shape profile.mjs resolves to; the .mjs module is the authority on it. */
export interface ResolvedProfile {
  readonly artifactPath: string;
  readonly destinationName: string;
  readonly destinationFigmaFile: string;
  readonly publishModes: readonly string[];
}

export interface RailOptions {
  readonly ledger?: string;
  readonly proof?: string;
  readonly profile?: string;
}

const emptyResult = {
  resultVersion: RESULT_VERSION,
  state: null,
  promotable: null,
  ledgerPath: null,
  proofPath: null,
  evidence: null,
  rail: null,
} as const;

/**
 * `ledger validate` — structural validation, the publication binding, and the
 * status projection, in one evaluation. The hold point on T12 is that a status
 * caller gets its complete rail answer from here without opening either record.
 */
export function ledgerValidate(options: RailOptions): RailResult {
  const profile = requireProfile(options.profile);
  const ledgerPath = requirePath(options.ledger, "--ledger");
  const { absPath, data, errors } = loadAndValidateSyncLedger(
    ledgerPath,
    profile,
  );

  if (errors.length > 0) {
    return {
      ...emptyResult,
      command: "ledger validate",
      ok: false,
      ledgerPath: absPath,
      diagnostics: errors.map(parseDiagnostic),
    };
  }

  const binding = checkPublicationBinding({
    ledger: data,
    ledgerPath: absPath,
    profile,
  });
  const conformance = evaluateSyncLedgerConformance(data);
  const status = evaluateStatusRail(data);
  const diagnostics: Diagnostic[] = [
    ...binding.errors.map(parseDiagnostic),
    ...conformance.blockers.map(
      (blocker: { code: string; field: string; message: string }) => ({
        code: blocker.code,
        field: blocker.field,
        message: blocker.message,
      }),
    ),
  ];

  return {
    resultVersion: RESULT_VERSION,
    command: "ledger validate",
    // A conformance blocker is a reported state, not a failed validation:
    // `verified-stale` is a legitimate ledger. Only the binding can make an
    // otherwise-valid ledger nonconformant here.
    ok: binding.errors.length === 0,
    state: conformance.state,
    promotable: conformance.promotable,
    ledgerPath: absPath,
    proofPath: binding.proofPath,
    diagnostics,
    evidence: conformance.evidence,
    rail: {
      freshness: status.freshness,
      outcome: status.outcome,
      reasonCodes: status.reasonCodes,
      sourceVersionOrRevision: status.sourceVersionOrRevision,
    },
  };
}

/** `ledger parity` — kept independently invocable, per its governance-step identity. */
export function ledgerParity(options: RailOptions): RailResult {
  const profile = requireProfile(options.profile);
  const ledgerPath = requirePath(options.ledger, "--ledger");
  const result = evaluateFigmaParity_(ledgerPath, profile);

  return {
    ...emptyResult,
    command: "ledger parity",
    ok: result.ok,
    state: result.state ?? null,
    ledgerPath: path.resolve(ledgerPath),
    diagnostics: (result.errors ?? []).map(parseDiagnostic),
  };
}

/** `proof validate` — the proof in isolation, with no ledger in sight. */
export function proofValidate(options: RailOptions): RailResult {
  const profile = requireProfile(options.profile);
  const proofPath = requirePath(options.proof, "--proof");
  const { absPath, errors } = loadAndValidatePublishProof(proofPath, profile);

  return {
    ...emptyResult,
    command: "proof validate",
    ok: errors.length === 0,
    proofPath: absPath,
    diagnostics: errors.map(parseDiagnostic),
  };
}

function evaluateFigmaParity_(
  ledgerPath: string,
  profile: ResolvedProfile,
): {
  ok: boolean;
  state?: string;
  errors?: string[];
} {
  const { data, errors } = loadAndValidateSyncLedger(ledgerPath, profile);
  if (errors.length > 0) return { ok: false, errors };
  return evaluateFigmaParity(data);
}

function requireProfile(target: string | undefined): ResolvedProfile {
  return readProfile(requirePath(target, "--profile"))
    .profile as ResolvedProfile;
}

function requirePath(value: string | undefined, flag: string): string {
  if (value === undefined || value.length === 0) {
    throw new CliArgumentError(`${flag} is required and takes a path`);
  }
  return value;
}

/** Bad arguments are "could not evaluate" (exit 2), never a validation result. */
export class CliArgumentError extends Error {
  readonly code = "CLI_INVALID_ARGUMENTS";
  constructor(message: string) {
    super(message);
    this.name = "CliArgumentError";
  }
}
