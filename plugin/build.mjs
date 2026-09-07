#!/usr/bin/env node
/**
 * Build the Figma plugin for one consuming repo.
 *
 *   node plugin/build.mjs [--config <path>] [--out <dir>]
 *
 * The config supplies everything repo-specific: collection name, artifact URL,
 * `$extensions` namespace, and the plugin's Figma name/id. Nothing repo-specific
 * is baked into this package.
 *
 * The implementation is src/plugin/build.ts — `ds-skills figma plugin build` and
 * this script are two entry points to one builder, so they cannot drift.
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const { buildPlugin, PluginBuildError } = await import(
  path.join(packageRoot, "dist/plugin/build.js")
);

const args = process.argv.slice(2);

try {
  const result = await buildPlugin({
    configPath: readFlag(args, "--config") ?? "ds-skills.config.json",
    outDir: readFlag(args, "--out") ?? path.join(packageRoot, "plugin/dist"),
  });
  process.stdout.write(
    `✓ Built "${result.config.plugin.name}" into ${path.relative(process.cwd(), result.outDir)}\n` +
      `  collection: ${result.config.collectionName}\n` +
      `  artifact:   ${result.config.artifactUrl}\n` +
      "  import manifest.json into Figma to load it\n",
  );
} catch (error) {
  process.stderr.write(
    `${error instanceof PluginBuildError || error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}

function readFlag(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}
