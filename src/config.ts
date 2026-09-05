/**
 * Every value a consuming repo needs to supply. Nothing else in this package
 * knows the name of the repo using it.
 */
export type RailConfig = {
  /** The Figma variable collection this rail owns. Created on first sync. */
  collectionName: string;
  /** Where the plugin fetches the published DTCG artifact from. */
  artifactUrl: string;
  /**
   * `$extensions` key carrying `{ themeId }` for the artifact's default theme.
   * `null` means the artifact does not declare one and `fallbackThemeId` is used.
   */
  extensionsNamespace: string | null;
  /** Theme id assumed when the artifact declares none. */
  fallbackThemeId: string;
  plugin: {
    /** Shown in Figma's plugin list. */
    name: string;
    /** Figma plugin manifest id. Must be unique within a Figma account. */
    id: string;
  };
};

export const defaultConfig: RailConfig = {
  collectionName: "Design Tokens",
  artifactUrl: "http://localhost:4173/tokens.json",
  extensionsNamespace: null,
  fallbackThemeId: "light",
  plugin: {
    name: "Design Token Sync",
    id: "design-token-sync-dev",
  },
};

export type PartialRailConfig = Partial<Omit<RailConfig, "plugin">> & {
  plugin?: Partial<RailConfig["plugin"]>;
};

export function resolveConfig(partial: PartialRailConfig = {}): RailConfig {
  const resolved: RailConfig = {
    ...defaultConfig,
    ...partial,
    plugin: { ...defaultConfig.plugin, ...(partial.plugin ?? {}) },
  };

  for (const [key, value] of [
    ["collectionName", resolved.collectionName],
    ["artifactUrl", resolved.artifactUrl],
    ["fallbackThemeId", resolved.fallbackThemeId],
    ["plugin.name", resolved.plugin.name],
    ["plugin.id", resolved.plugin.id],
  ] as const) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`RailConfig.${key} must be a non-empty string`);
    }
  }

  if (
    resolved.extensionsNamespace !== null &&
    typeof resolved.extensionsNamespace !== "string"
  ) {
    throw new Error("RailConfig.extensionsNamespace must be a string or null");
  }

  return resolved;
}
