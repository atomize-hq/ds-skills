import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveConfig, type RailConfig } from "../config.js";
import { CannotEvaluateError } from "../figma/profile.mjs";

/**
 * The plugin builder, as a function rather than a script. `plugin/build.mjs`
 * still exists as the process entry point, so a consumer invoking it directly
 * keeps working; everything it used to do inline lives here where it can be
 * tested without spawning a build.
 */

/** Resolves to <packageRoot>/plugin from either src/plugin or dist/plugin. */
const pluginRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../plugin",
);

export interface BuildPluginOptions {
  readonly configPath: string;
  readonly outDir: string;
  /** Skip the esbuild bundle. The substitutions are what most tests care about. */
  readonly skipBundle?: boolean;
}

export interface BuildPluginResult {
  readonly config: RailConfig;
  readonly outDir: string;
  readonly manifest: string;
  readonly uiHtml: string;
}

export class PluginBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginBuildError";
  }
}

export async function buildPlugin(
  options: BuildPluginOptions,
): Promise<BuildPluginResult> {
  const configPath = path.resolve(options.configPath);
  if (!fs.existsSync(configPath)) {
    // A missing config is an inability to evaluate, not a failed build.
    throw new CannotEvaluateError(
      "CONFIG_MISSING",
      `No config at ${configPath}.\n` +
        "Pass --config <path>, or add ds-skills.config.json to the working directory.\n" +
        "See README.md for the shape.",
    );
  }

  const config = resolveConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
  const outDir = path.resolve(options.outDir);
  const { manifest, uiHtml } = renderPluginSources(config);

  fs.mkdirSync(outDir, { recursive: true });
  // Figma reads ui.html from disk as well as through the bundle, so write both.
  fs.writeFileSync(path.join(outDir, "ui.html"), uiHtml);
  fs.writeFileSync(path.join(outDir, "manifest.json"), manifest);

  if (options.skipBundle !== true) {
    // Imported here rather than at module load: esbuild is an optional peer, and
    // `figma verify` has no business requiring a bundler to read a JSON file.
    const { build } = await import("esbuild");
    await build({
      entryPoints: [path.join(pluginRoot, "code.ts")],
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "es2017",
      sourcemap: true,
      outfile: path.join(outDir, "code.js"),
      define: {
        __html__: JSON.stringify(uiHtml),
        __RAIL_CONFIG__: JSON.stringify(config),
      },
      loader: { ".html": "text" },
      logLevel: "info",
    });
  }

  return { config, outDir, manifest, uiHtml };
}

/** The substitution step alone — no filesystem writes, no bundler. */
export function renderPluginSources(config: RailConfig): {
  manifest: string;
  uiHtml: string;
} {
  const artifactOrigin = new URL(config.artifactUrl).origin;

  // Text substitutions land in HTML; the drift-report URL lands inside a
  // <script>, so it is JSON-encoded rather than HTML-escaped. Escaping one the
  // other way either breaks the value or, worse, lets a configured value close
  // the tag.
  const uiHtml = substitute(readTemplate("ui.html"), "ui.html", {
    __RAIL_PLUGIN_NAME__: escapeHtml(config.plugin.name),
    __RAIL_ARTIFACT_ORIGIN__: escapeHtml(artifactOrigin),
    __RAIL_TOKEN_SOURCE_PATH__: escapeHtml(config.tokenSourcePath),
    __RAIL_DRIFT_REPORT_URL__: jsString(`${artifactOrigin}/figma/drift-report`),
  });

  const manifest = substitute(
    readTemplate("manifest.template.json"),
    "manifest.template.json",
    {
      __RAIL_PLUGIN_NAME__: config.plugin.name,
      __RAIL_PLUGIN_ID__: config.plugin.id,
      __RAIL_ARTIFACT_ORIGIN__: artifactOrigin,
    },
  );

  return { manifest, uiHtml };
}

export function readTemplate(name: string): string {
  return fs.readFileSync(path.join(pluginRoot, name), "utf8");
}

/**
 * Replace every placeholder, and refuse to ship a template that has drifted
 * from the substitution map in either direction: a placeholder the map does not
 * know would survive into the output, and one the template no longer contains
 * means a configured value is silently not reaching the plugin. Both used to be
 * silent.
 */
export function substitute(
  template: string,
  label: string,
  values: Readonly<Record<string, string>>,
): string {
  let out = template;
  for (const [placeholder, value] of Object.entries(values)) {
    if (!out.includes(placeholder)) {
      throw new PluginBuildError(
        `${label} has no ${placeholder}. Either the template dropped it or the ` +
          "build is substituting a value nothing reads.",
      );
    }
    out = out.replaceAll(placeholder, value);
  }
  const leftover = /__RAIL_[A-Z0-9_]*__/.exec(out);
  if (leftover) {
    throw new PluginBuildError(
      `${label} still contains ${leftover[0]} after substitution.`,
    );
  }
  return out;
}

/** A JS string literal, safe inside a <script> block. */
export function jsString(value: string): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e");
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );
}
