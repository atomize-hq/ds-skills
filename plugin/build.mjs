#!/usr/bin/env node
/**
 * Build the Figma plugin for one consuming repo.
 *
 *   node plugin/build.mjs [--config <path>] [--out <dir>]
 *
 * The config supplies everything repo-specific: collection name, artifact URL,
 * `$extensions` namespace, and the plugin's Figma name/id. Nothing repo-specific
 * is baked into this package.
 */
import path from "node:path";
import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const pluginRoot = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(pluginRoot, "..");

const args = process.argv.slice(2);
const configPath = path.resolve(
  readFlag(args, "--config") ?? "figma-token-rail.config.json",
);
const outDir = path.resolve(
  readFlag(args, "--out") ?? path.join(packageRoot, "plugin/dist"),
);

if (!fs.existsSync(configPath)) {
  fail(
    `No config at ${configPath}.\n` +
      "Pass --config <path>, or add figma-token-rail.config.json to the working directory.\n" +
      "See README.md for the shape.",
  );
}

const { resolveConfig } = await import("../src/config.ts").catch(
  () => import(path.join(packageRoot, "dist/config.js")),
);
const config = resolveConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));

fs.mkdirSync(outDir, { recursive: true });

const artifactOrigin = new URL(config.artifactUrl).origin;

// Text substitutions land in HTML; the drift-report URL lands inside a <script>,
// so it is JSON-encoded rather than HTML-escaped. Escaping one the other way
// either breaks the value or, worse, lets a configured value close the tag.
const uiHtml = substitute(
  fs.readFileSync(path.join(pluginRoot, "ui.html"), "utf8"),
  "ui.html",
  {
    __RAIL_PLUGIN_NAME__: escapeHtml(config.plugin.name),
    __RAIL_ARTIFACT_ORIGIN__: escapeHtml(artifactOrigin),
    __RAIL_TOKEN_SOURCE_PATH__: escapeHtml(config.tokenSourcePath),
    __RAIL_DRIFT_REPORT_URL__: jsString(`${artifactOrigin}/figma/drift-report`),
  },
);

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

// Figma reads ui.html from disk as well as through the bundle, so write both.
fs.writeFileSync(path.join(outDir, "ui.html"), uiHtml);

const manifest = substitute(
  fs.readFileSync(path.join(pluginRoot, "manifest.template.json"), "utf8"),
  "manifest.template.json",
  {
    __RAIL_PLUGIN_NAME__: config.plugin.name,
    __RAIL_PLUGIN_ID__: config.plugin.id,
    __RAIL_ARTIFACT_ORIGIN__: artifactOrigin,
  },
);
fs.writeFileSync(path.join(outDir, "manifest.json"), manifest);

process.stdout.write(
  `✓ Built "${config.plugin.name}" into ${path.relative(process.cwd(), outDir)}\n` +
    `  collection: ${config.collectionName}\n` +
    `  artifact:   ${config.artifactUrl}\n` +
    "  import manifest.json into Figma to load it\n",
);

function readFlag(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

/**
 * Replace every placeholder, and refuse to ship a template that has drifted from
 * the substitution map in either direction: a placeholder the map does not know
 * would survive into the output, and one the template no longer contains means a
 * configured value is silently not reaching the plugin. Both used to be silent.
 */
function substitute(template, label, values) {
  let out = template;
  for (const [placeholder, value] of Object.entries(values)) {
    if (!out.includes(placeholder)) {
      fail(
        `${label} has no ${placeholder}. Either the template dropped it or the ` +
          "build is substituting a value nothing reads.",
      );
    }
    out = out.replaceAll(placeholder, value);
  }
  const leftover = out.match(/__RAIL_[A-Z0-9_]*__/);
  if (leftover) {
    fail(`${label} still contains ${leftover[0]} after substitution.`);
  }
  return out;
}

/** A JS string literal, safe inside a <script> block. */
function jsString(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e");
}

function escapeHtml(value) {
  return value.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
