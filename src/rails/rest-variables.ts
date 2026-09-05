/**
 * The Figma Variables REST API rail.
 *
 * An alternative to the plugin for repos whose Figma plan exposes the Variables
 * write API. It is Enterprise/full-seat gated, which is why the plugin rail
 * exists alongside it.
 *
 * Two differences from the plugin rail are deliberate and worth knowing:
 *
 * 1. This rail DELETEs and recreates the whole collection on every sync, so
 *    VariableIDs do not survive. Paint bindings on existing components break.
 *    The plugin rail upserts and preserves them. Prefer the plugin unless you
 *    have a reason not to.
 * 2. This rail writes a single mode. Multi-theme artifacts publish only their
 *    default theme through it.
 *
 * Governance — ledgers, promotion levels, publish modes — is deliberately NOT
 * here. This module performs a sync and reports what happened; recording that
 * outcome is the consuming repo's business.
 */
import { flattenTokenDocument, type TokenLeaf } from "../token-mapping.js";
import { valuesEqual } from "../drift.js";

export type SyncPhase = "auth" | "write" | "verification";

export class FigmaVariablesSyncError extends Error {
  readonly phase: SyncPhase;
  readonly details: Record<string, unknown>;

  constructor(
    phase: SyncPhase,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "FigmaVariablesSyncError";
    this.phase = phase;
    this.details = details;
  }
}

export type SyncPlan = {
  collectionCount: number;
  variableCount: number;
  requestBody: unknown;
  targetCollectionName: string;
  targetModeName: string;
};

export type SyncVerification = {
  collectionCount: number;
  determinismVerified: true;
  variableCount: number;
};

export type RestSyncOptions = {
  /** The parsed DTCG artifact. */
  artifactDocument: unknown;
  /** `figma://file/<key>`. */
  figmaFile: string;
  /** Environment carrying `FIGMA_OAUTH_ACCESS_TOKEN`. */
  env: Record<string, string | undefined>;
  collectionName: string;
  /** Figma requires a mode; this rail writes exactly one. */
  modeName?: string;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
};

export type RestSyncResult = {
  fileKey: string;
  plan: SyncPlan;
  verification: SyncVerification;
  desiredVariables: TokenLeaf[];
};

const retryableStatusCodes = new Set([429, 500, 502, 503, 504]);
const maxAttempts = 3;

export async function syncVariablesViaRest(
  options: RestSyncOptions,
): Promise<RestSyncResult> {
  const modeName = options.modeName ?? "Base";
  const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
  const sleep = options.sleep ?? defaultSleep;

  if (typeof fetchImpl !== "function") {
    throw new FigmaVariablesSyncError(
      "auth",
      "global fetch is unavailable; Node 18+ is required",
    );
  }

  const accessToken = resolveAccessToken(options.env);
  const fileKey = parseFigmaFileKey(options.figmaFile);
  const desiredVariables = flattenTokenDocument(options.artifactDocument);

  const request = (
    method: string,
    endpoint: string,
    phase: SyncPhase,
    body?: unknown,
  ) =>
    requestFigmaJson({
      fetchImpl,
      sleep,
      accessToken,
      fileKey,
      method,
      endpoint,
      phase,
      body,
    });

  const beforeState = await request(
    "GET",
    `/v1/files/${fileKey}/variables/local`,
    "write",
  );
  const plan = createSyncPlan({
    currentState: beforeState,
    desiredVariables,
    collectionName: options.collectionName,
    modeName,
  });

  await request(
    "POST",
    `/v1/files/${fileKey}/variables`,
    "write",
    plan.requestBody,
  );

  const afterState = await request(
    "GET",
    `/v1/files/${fileKey}/variables/local`,
    "verification",
  );
  const verification = verifySyncOutcome({
    readBack: afterState,
    desiredVariables,
    collectionName: options.collectionName,
    modeName,
  });

  return { fileKey, plan, verification, desiredVariables };
}

export function resolveAccessToken(
  env: Record<string, string | undefined> | undefined,
): string {
  const configuredToken = env?.["FIGMA_OAUTH_ACCESS_TOKEN"];
  if (typeof configuredToken === "string" && configuredToken.length > 0) {
    return configuredToken;
  }

  const personalToken = env?.["FIGMA_TOKEN"];
  if (typeof personalToken === "string" && personalToken.length > 0) {
    throw new FigmaVariablesSyncError(
      "auth",
      "FIGMA_TOKEN is not accepted by the Variables REST rail; provide an OAuth app token via FIGMA_OAUTH_ACCESS_TOKEN",
    );
  }

  throw new FigmaVariablesSyncError(
    "auth",
    "missing OAuth access token in FIGMA_OAUTH_ACCESS_TOKEN (Variables REST API rail)",
  );
}

export function parseFigmaFileKey(figmaFile: unknown): string {
  if (typeof figmaFile !== "string" || figmaFile.length === 0) {
    throw new FigmaVariablesSyncError(
      "auth",
      "figmaFile must be a non-empty string",
    );
  }

  const match = /^figma:\/\/file\/([^/?#]+)(?:[/?#].*)?$/.exec(figmaFile);
  if (!match?.[1]) {
    throw new FigmaVariablesSyncError(
      "auth",
      `figmaFile must use the figma://file/<key> URI format (received ${figmaFile})`,
    );
  }

  return match[1];
}

export function createSyncPlan({
  currentState,
  desiredVariables,
  collectionName,
  modeName,
}: {
  currentState: unknown;
  desiredVariables: readonly TokenLeaf[];
  collectionName: string;
  modeName: string;
}): SyncPlan {
  const collections = readCollections(currentState);
  const targetCollection = findCollectionByName(collections, collectionName);

  const variableCollections: unknown[] = [];
  const variableModes: unknown[] = [];
  const variables: unknown[] = [];
  const variableModeValues: unknown[] = [];

  // Delete-then-create is why this rail loses VariableIDs. The API has no
  // upsert; the plugin rail is the one that preserves bindings.
  if (targetCollection?.id) {
    variableCollections.push({ action: "DELETE", id: targetCollection.id });
  }

  variableCollections.push({
    action: "CREATE",
    id: "temp_hardened_collection",
    name: collectionName,
    initialModeId: "temp_hardened_mode",
  });

  variableModes.push({
    action: "UPDATE",
    id: "temp_hardened_mode",
    name: modeName,
    variableCollectionId: "temp_hardened_collection",
  });

  desiredVariables.forEach((variable, index) => {
    const tempVariableId = `temp_hardened_variable_${index}`;
    variables.push({
      action: "CREATE",
      id: tempVariableId,
      name: variable.name,
      resolvedType: variable.resolvedType,
      variableCollectionId: "temp_hardened_collection",
    });
    variableModeValues.push({
      variableId: tempVariableId,
      modeId: "temp_hardened_mode",
      value: variable.value,
    });
  });

  return {
    collectionCount: 1,
    variableCount: desiredVariables.length,
    requestBody: {
      variableCollections,
      variableModes,
      variables,
      variableModeValues,
    },
    targetCollectionName: collectionName,
    targetModeName: modeName,
  };
}

export function verifySyncOutcome({
  readBack,
  desiredVariables,
  collectionName,
  modeName,
}: {
  readBack: unknown;
  desiredVariables: readonly TokenLeaf[];
  collectionName: string;
  modeName: string;
}): SyncVerification {
  const collections = readCollections(readBack);
  const variables = readVariables(readBack);
  const collection = findCollectionByName(collections, collectionName);

  const fail = (message: string): never => {
    throw new FigmaVariablesSyncError("verification", message);
  };

  if (!collection)
    fail(
      `collection ${collectionName} was not found in the Figma read-back payload`,
    );
  const found = collection as FigmaCollection;

  if (found.defaultModeId == null)
    fail(`collection ${collectionName} is missing a default mode id`);
  if (!Array.isArray(found.modes))
    fail(`collection ${collectionName} is missing the mode list`);

  const mode = found.modes?.find(
    (entry) => entry.modeId === found.defaultModeId,
  );
  if (!mode || mode.name !== modeName) {
    fail(
      `collection ${collectionName} does not expose the expected mode name ${modeName}`,
    );
  }

  if (!Array.isArray(found.variableIds)) {
    fail(`collection ${collectionName} does not expose variable ids`);
  }

  const variableIds = found.variableIds ?? [];
  if (variableIds.length !== desiredVariables.length) {
    fail(
      `collection ${collectionName} contains ${variableIds.length} variables, expected ${desiredVariables.length}`,
    );
  }

  const actualByName = new Map<string, FigmaVariable>();
  for (const variableId of variableIds) {
    const variable = variables[variableId];
    if (!variable)
      fail(
        `collection ${collectionName} references missing variable ${variableId}`,
      );
    actualByName.set(
      (variable as FigmaVariable).name,
      variable as FigmaVariable,
    );
  }

  for (const desired of desiredVariables) {
    const actual = actualByName.get(desired.name);
    if (!actual)
      fail(`variable ${desired.name} was not present after the write`);

    const present = actual as FigmaVariable;
    if (present.resolvedType !== desired.resolvedType) {
      fail(
        `variable ${desired.name} resolvedType=${present.resolvedType} but expected ${desired.resolvedType}`,
      );
    }

    const actualValue = present.valuesByMode?.[found.defaultModeId as string];
    if (!valuesEqual(desired.value, actualValue)) {
      fail(`variable ${desired.name} did not persist the expected value`);
    }
  }

  return {
    collectionCount: 1,
    determinismVerified: true,
    variableCount: desiredVariables.length,
  };
}

export function normalizeSyncError(error: unknown): FigmaVariablesSyncError {
  if (error instanceof FigmaVariablesSyncError) return error;
  return new FigmaVariablesSyncError("verification", messageForError(error));
}

export function formatSyncError(error: unknown): string {
  const syncError = normalizeSyncError(error);
  return `${syncError.phase}: ${syncError.message}`;
}

type FigmaCollection = {
  id?: string;
  name?: string;
  defaultModeId?: string;
  modes?: { modeId: string; name: string }[];
  variableIds?: string[];
};

type FigmaVariable = {
  name: string;
  resolvedType: string;
  valuesByMode?: Record<string, unknown>;
};

function readCollections(payload: unknown): Record<string, FigmaCollection> {
  const meta = (payload as { meta?: { variableCollections?: unknown } } | null)
    ?.meta;
  return (meta?.variableCollections as Record<string, FigmaCollection>) ?? {};
}

function readVariables(payload: unknown): Record<string, FigmaVariable> {
  const meta = (payload as { meta?: { variables?: unknown } } | null)?.meta;
  return (meta?.variables as Record<string, FigmaVariable>) ?? {};
}

function findCollectionByName(
  variableCollections: Record<string, FigmaCollection>,
  collectionName: string,
): FigmaCollection | null {
  for (const collection of Object.values(variableCollections)) {
    if (collection?.name === collectionName) return collection;
  }
  return null;
}

async function requestFigmaJson({
  fetchImpl,
  sleep,
  accessToken,
  fileKey,
  method,
  endpoint,
  phase,
  body,
}: {
  fetchImpl: typeof globalThis.fetch;
  sleep: (ms: number) => Promise<void>;
  accessToken: string;
  fileKey: string;
  method: string;
  endpoint: string;
  phase: SyncPhase;
  body?: unknown;
}): Promise<unknown> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(`https://api.figma.com${endpoint}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Figma-Token": accessToken,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      if (attempt < maxAttempts) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
      throw normalizeSyncError(error);
    }

    let payload: unknown;
    try {
      payload = await parseResponseBody(response);
    } catch (error) {
      if (attempt < maxAttempts) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
      throw normalizeSyncError(error);
    }

    if (response.ok) return payload;

    const message = extractFigmaErrorMessage(payload, response.status);
    if (retryableStatusCodes.has(response.status) && attempt < maxAttempts) {
      await sleep(retryDelayMs(attempt));
      continue;
    }

    throw new FigmaVariablesSyncError(
      phase,
      `Figma API request failed (${method} ${endpoint}) for ${fileKey}: ${message}`,
      { payload, status: response.status },
    );
  }

  throw new FigmaVariablesSyncError(phase, "Figma request failed unexpectedly");
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function extractFigmaErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const record = payload as { message?: unknown; error?: unknown };
    if (typeof record.message === "string" && record.message.length > 0)
      return record.message;
    if (typeof record.error === "string" && record.error.length > 0)
      return record.error;
  }
  return `HTTP ${status}`;
}

function retryDelayMs(attempt: number): number {
  return 150 * attempt;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageForError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
