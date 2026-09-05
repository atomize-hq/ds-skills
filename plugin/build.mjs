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

const uiHtml = fs
  .readFileSync(path.join(pluginRoot, "ui.html"), "utf8")
  .replaceAll("__RAIL_PLUGIN_NAME__", escapeHtml(config.plugin.name));

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

const manifest = fs
  .readFileSync(path.join(pluginRoot, "manifest.template.json"), "utf8")
  .replaceAll("__RAIL_PLUGIN_NAME__", config.plugin.name)
  .replaceAll("__RAIL_PLUGIN_ID__", config.plugin.id)
  .replaceAll("__RAIL_ARTIFACT_ORIGIN__", new URL(config.artifactUrl).origin);
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
