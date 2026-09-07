/// <reference types="@figma/plugin-typings" />

import {
  buildExpectedVariables,
  compareFigmaVariables,
  formatDriftReport,
  type ExpectedVariableSet,
  type ObservedCollection,
  type ObservedVariable,
} from "../src/drift.js";
import type { RailConfig } from "../src/config.js";

declare const __html__: string;
/** Injected by plugin/build.mjs from the consuming repo's config file. */
declare const __RAIL_CONFIG__: RailConfig;

type UiToPluginMessage =
  | { type: "UI_READY" }
  | { type: "FETCH_URL"; url: string }
  | { type: "SYNC"; jsonText: string }
  | { type: "CHECK"; jsonText: string };

const config = __RAIL_CONFIG__;
const defaultArtifactUrl = config.artifactUrl;
const collectionName = config.collectionName;
const themeOptions = {
  extensionsNamespace: config.extensionsNamespace,
  fallbackThemeId: config.fallbackThemeId,
};

figma.showUI(__html__, { width: 420, height: 560 });

/**
 * Figma's `onmessage` slot expects a void return, so an async handler's
 * rejection is unhandled — and in the plugin runtime an unhandled rejection is
 * silent, which shows up as the plugin simply doing nothing. Every branch below
 * catches its own errors; this wrapper is for the ones that do not exist yet.
 */
figma.ui.onmessage = (msg: UiToPluginMessage) => {
  void handleMessage(msg).catch((error: unknown) => {
    figma.notify(`Plugin error: ${messageForError(error)}`, { error: true });
  });
};

async function handleMessage(msg: UiToPluginMessage): Promise<void> {
  if (!msg || typeof msg.type !== "string") return;

  if (msg.type === "UI_READY") {
    figma.ui.postMessage({ type: "DEFAULT_URL", url: defaultArtifactUrl });
    return;
  }

  if (msg.type === "FETCH_URL") {
    const url =
      typeof msg.url === "string" && msg.url.length > 0
        ? msg.url
        : defaultArtifactUrl;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} while fetching ${url}`);
      }
      const jsonText = await response.text();
      figma.ui.postMessage({
        type: "FETCH_OK",
        jsonText,
        byteCount: jsonText.length,
      });
    } catch (error) {
      figma.ui.postMessage({
        type: "FETCH_ERROR",
        message: `Failed to fetch artifact: ${messageForError(error)}`,
      });
    }
    return;
  }

  // Read-only. Reports where this file disagrees with the published artifact
  // without writing anything, in either direction. An intentional Figma-side
  // edit shows up here as a finding to be reviewed and then made in the
  // consuming repo's token sources, which stay the only authoring surface.
  if (msg.type === "CHECK") {
    try {
      const expected = buildExpectedVariables(
        JSON.parse(msg.jsonText),
        themeOptions,
      );
      const observed = await readObservedCollection();
      if (!observed) {
        throw new Error(
          `Collection "${collectionName}" does not exist in this file. Run Sync Variables first.`,
        );
      }
      const report = compareFigmaVariables(expected, observed);
      figma.ui.postMessage({
        type: "CHECK_REPORT",
        ok: report.ok,
        report: formatDriftReport(report),
        json: JSON.stringify(report),
      });
    } catch (error) {
      figma.ui.postMessage({
        type: "CHECK_REPORT",
        ok: false,
        report: `Drift check failed: ${messageForError(error)}`,
      });
    }
    return;
  }

  if (msg.type === "SYNC") {
    const startedAt = new Date().toISOString();
    try {
      const expected = buildExpectedVariables(
        JSON.parse(msg.jsonText),
        themeOptions,
      );
      const modeIdByTheme = await applyExpectedVariables(expected);

      // Verify by re-reading the file and running the same comparison the
      // CHECK path uses, so a write that silently failed cannot pass.
      const observed = await readObservedCollection();
      if (!observed) {
        throw new Error(
          `Verification failed: collection "${collectionName}" not found after sync`,
        );
      }
      const report = compareFigmaVariables(expected, observed);
      if (!report.ok) {
        throw new Error(`Verification failed:\n${formatDriftReport(report)}`);
      }

      figma.ui.postMessage({
        type: "SYNC_REPORT",
        ok: true,
        report: [
          `${config.plugin.name}: SUCCESS`,
          `startedAt=${startedAt}`,
          `finishedAt=${new Date().toISOString()}`,
          `collection=${collectionName}`,
          `modes=${[...modeIdByTheme.keys()].join(", ")}`,
          `variables=${expected.variables.length}`,
        ].join("\n"),
      });
    } catch (error) {
      figma.ui.postMessage({
        type: "SYNC_REPORT",
        ok: false,
        report: [
          `${config.plugin.name}: FAILED`,
          `startedAt=${startedAt}`,
          `finishedAt=${new Date().toISOString()}`,
          `error=${messageForError(error)}`,
        ].join("\n"),
      });
    }
    return;
  }
}

/**
 * Upsert semantics: preserve the collection and existing VariableIDs so that
 * paint bindings on components in this file survive re-syncs. The repo remains
 * canonical for token *values*; Figma's variable *identity* is durable.
 */
async function applyExpectedVariables(expected: ExpectedVariableSet) {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  let collection = collections.find((entry) => entry.name === collectionName);
  if (!collection) {
    collection = figma.variables.createVariableCollection(collectionName);
  }

  // The collection's default mode carries the default theme; renaming keeps
  // its modeId, so existing paint bindings survive the rename.
  const defaultMode = collection.modes.find(
    (entry) => entry.modeId === collection!.defaultModeId,
  );
  if (defaultMode && defaultMode.name !== expected.defaultThemeId) {
    collection.renameMode(defaultMode.modeId, expected.defaultThemeId);
  }

  const modeIdByTheme = new Map<string, string>([
    [expected.defaultThemeId, collection.defaultModeId],
  ]);
  for (const themeId of expected.themeIds) {
    if (modeIdByTheme.has(themeId)) continue;
    const existing = collection.modes.find((entry) => entry.name === themeId);
    if (existing) {
      modeIdByTheme.set(themeId, existing.modeId);
      continue;
    }
    try {
      modeIdByTheme.set(themeId, collection.addMode(themeId));
    } catch (error) {
      // Mode count is plan-gated in Figma, so this is a likely and very
      // confusing failure to hit without an explicit explanation.
      throw new Error(
        `Could not add a mode for theme "${themeId}": ${messageForError(error)}. Figma limits modes per collection by plan tier.`,
        { cause: error },
      );
    }
  }

  const existingByName = new Map<string, Variable>();
  for (const variable of await resolveVariables(collection.variableIds)) {
    existingByName.set(variable.name, variable);
  }

  const desiredByName = new Map(
    expected.variables.map((entry) => [entry.name, entry]),
  );
  const toRemove: Variable[] = [];
  for (const [name, variable] of existingByName) {
    if (!desiredByName.has(name)) toRemove.push(variable);
  }
  // Figma variables cannot change resolvedType in place — queue mismatches
  // for removal so the upsert pass below recreates them cleanly.
  for (const entry of expected.variables) {
    const existing = existingByName.get(entry.name);
    if (existing && existing.resolvedType !== entry.resolvedType) {
      toRemove.push(existing);
      existingByName.delete(entry.name);
    }
  }
  for (const variable of toRemove) {
    variable.remove();
  }

  for (const entry of expected.variables) {
    let variable = existingByName.get(entry.name);
    if (!variable) {
      variable = figma.variables.createVariable(
        entry.name,
        collection,
        entry.resolvedType,
      );
    }
    for (const [themeId, modeId] of modeIdByTheme) {
      variable.setValueForMode(
        modeId,
        entry.valuesByTheme[themeId] as VariableValue,
      );
    }
  }

  return modeIdByTheme;
}

/** Snapshot the collection with values keyed by mode *name*, for comparison. */
async function readObservedCollection(): Promise<ObservedCollection | null> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const collection = collections.find((entry) => entry.name === collectionName);
  if (!collection) return null;

  const modeNameById = new Map(
    collection.modes.map((mode) => [mode.modeId, mode.name]),
  );
  const variables: ObservedVariable[] = [];
  for (const variable of await resolveVariables(collection.variableIds)) {
    const valuesByMode: Record<string, unknown> = {};
    for (const [modeId, value] of Object.entries(variable.valuesByMode)) {
      const modeName = modeNameById.get(modeId);
      if (modeName !== undefined) valuesByMode[modeName] = value;
    }
    variables.push({
      name: variable.name,
      resolvedType: variable.resolvedType,
      valuesByMode,
    });
  }

  return {
    name: collection.name,
    modeNames: collection.modes.map((mode) => mode.name),
    variables,
  };
}

// Resolved in parallel — a long sequential await chain is both slow and, over
// the remote-debug bridge, prone to dropping the socket.
async function resolveVariables(ids: readonly string[]): Promise<Variable[]> {
  const resolved = await Promise.all(
    ids.map((id) => figma.variables.getVariableByIdAsync(id)),
  );
  return resolved.filter((variable): variable is Variable => variable !== null);
}

function messageForError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}
