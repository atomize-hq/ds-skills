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

/**
 * The bundle produced once at package build time by `scripts/prebuild-plugin.mjs`
 * and shipped inside the release. Command-time assembly is two substitutions
 * into it, so a consumer needs no bundler — §7.3's optional-peer defect.
 *
 * Under dist/ with the other build output, and for the same reason: it is
 * generated, gitignored, shipped, and no more subject to the LOC guard than a
 * compiled module is.
 */
export const prebuiltBundlePath = path.resolve(
  pluginRoot,
  "../dist/plugin-bundle/code.js",
);

/**
 * The two values a consumer's config decides, as they survive bundling: free
 * identifiers, declared but never defined in `plugin/code.ts`. Substituting an
 * identifier with a JSON literal is always valid in expression position, which
 * is why the seam is an identifier rather than a string placeholder.
 */
export const bakedIdentifiers = ["__html__", "__RAIL_CONFIG__"] as const;

export interface BuildPluginOptions {
  readonly configPath: string;
  readonly outDir: string;
  /** Skip assembling code.js. The substitutions are what most tests care about. */
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

export function buildPlugin(options: BuildPluginOptions): BuildPluginResult {
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
    fs.writeFileSync(
      path.join(outDir, "code.js"),
      bakeBundle(readPrebuiltBundle(), config, uiHtml),
    );
    // The map describes the prebuilt bundle. Substitution replaces identifiers
    // with single-line JSON, so every line number still holds; only the two
    // columns carrying a baked value move.
    const map = `${prebuiltBundlePath}.map`;
    if (fs.existsSync(map)) {
      fs.copyFileSync(map, path.join(outDir, "code.js.map"));
    }
  }

  return { config, outDir, manifest, uiHtml };
}

/**
 * Read the shipped bundle, and say plainly when it is absent. A build that fell
 * back to running a bundler here would reintroduce the defect this replaced,
 * and would do it only on the machines that lack one.
 */
export function readPrebuiltBundle(file: string = prebuiltBundlePath): string {
  if (!fs.existsSync(file)) {
    throw new PluginBuildError(
      `No prebuilt plugin bundle at ${file}.\n` +
        "It is produced by the package build and shipped in the release, so an " +
        "install without one is incomplete rather than unbuilt.",
    );
  }
  return fs.readFileSync(file, "utf8");
}

/** Substitute the consumer's two values into the prebuilt bundle. */
export function bakeBundle(
  bundle: string,
  config: RailConfig,
  uiHtml: string,
): string {
  const values: Record<string, string> = {
    // A JS string literal for the one, a JS object literal for the other. JSON
    // text is already valid in expression position, so the config needs
    // escaping but not quoting — quoting it would hand the plugin a string
    // where it reads fields.
    __html__: jsString(uiHtml),
    __RAIL_CONFIG__: escapeJsLiterals(JSON.stringify(config)),
  };
  let out = bundle;
  for (const identifier of bakedIdentifiers) {
    // Exactly one, not at least one: a second occurrence would mean the bundler
    // inlined the identifier somewhere else, and replacing all of them would
    // corrupt code that merely mentions the name.
    const occurrences = out.split(identifier).length - 1;
    if (occurrences !== 1) {
      throw new PluginBuildError(
        `The prebuilt bundle contains ${identifier} ${occurrences} times; expected exactly one. ` +
          "Rebuild the package: this bundle and this builder disagree.",
      );
    }
    out = out.replace(identifier, values[identifier] as string);
  }
  return out;
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
  return escapeJsLiterals(JSON.stringify(value));
}

/**
 * Make JSON text safe to paste into JavaScript. `<` and `>` so a value can
 * never close a script element; U+2028 and U+2029 because JSON permits them
 * raw inside strings and they are line terminators to a pre-ES2019 parser,
 * which is what `target: es2017` says we compile for.
 */
export function escapeJsLiterals(json: string): string {
  return json
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );
}
