/**
 * The `--json` result: a versioned interface another program is written
 * against, not a formatting flag. Boundary contract §3.
 *
 * `resultVersion` is independent of `ledgerVersion` and of the release version.
 * A consumer seeing an unsupported value must fail rather than best-effort
 * parse, so it is emitted first and never omitted.
 */
export const RESULT_VERSION = "1";

export interface Diagnostic {
  readonly code: string;
  readonly field?: string;
  readonly message: string;
}

export interface RailProjection {
  readonly freshness: string;
  readonly outcome: string;
  readonly reasonCodes: readonly string[];
  readonly sourceVersionOrRevision: string;
}

export interface RailResult {
  readonly resultVersion: string;
  readonly command: string;
  readonly ok: boolean;
  readonly state: string | null;
  readonly promotable: boolean | null;
  readonly ledgerPath: string | null;
  readonly proofPath: string | null;
  readonly diagnostics: readonly Diagnostic[];
  readonly evidence: Readonly<Record<string, unknown>> | null;
  readonly rail: RailProjection | null;
}

/** Roots a diagnostic's field may start with. Anything else yields no field. */
const fieldRoots = [
  "artifact",
  "carrier",
  "destination",
  "exceptions",
  "ledger",
  "ledgerVersion",
  "materialization",
  "mode",
  "promotion",
  "proofVersion",
  "publication",
  "publish",
  "verification",
];

/**
 * Splits `[CODE] message` into its parts. The bare identifier is the interface;
 * the bracket punctuation is human formatting the CLI keeps for stderr.
 */
export function parseDiagnostic(line: string): Diagnostic {
  const match = /^\[([A-Za-z0-9_.-]+)\]\s*(.*)$/s.exec(line);
  if (match === null) {
    return { code: "UNCODED_DIAGNOSTIC", message: line };
  }

  const [, code, message] = match as unknown as [string, string, string];
  const field = detectField(message);
  return field === undefined ? { code, message } : { code, field, message };
}

function detectField(message: string): string | undefined {
  for (const token of message.split(/\s+/)) {
    const candidate = token.replace(/[.,;:]+$/, "");
    const root = candidate.split(/[.[]/)[0];
    if (root !== undefined && fieldRoots.includes(root)) return candidate;
  }
  return undefined;
}

/**
 * Serializes with a fixed key order. Determinism is part of the contract: a
 * consumer diffing two results must see only the changes that are real.
 */
export function serializeResult(result: RailResult): string {
  const ordered = {
    resultVersion: result.resultVersion,
    command: result.command,
    ok: result.ok,
    state: result.state,
    promotable: result.promotable,
    ledgerPath: result.ledgerPath,
    proofPath: result.proofPath,
    diagnostics: result.diagnostics,
    evidence: result.evidence,
    rail: result.rail,
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
