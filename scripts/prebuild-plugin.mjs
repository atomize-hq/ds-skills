#!/usr/bin/env node
/**
 * Bundle the invariant plugin code once, here, so a consumer never needs a
 * bundler.
 *
 * SPEC.md §7.3: `esbuild` as an optional peer meant a successful `ds-skills`
 * install did not establish that `figma plugin build` runs — npm does not
 * install optional peers, so the command worked only for consumers who already
 * had one. Nothing in `plugin/code.ts` depends on a consumer's config at bundle
 * time: the two values that do (`__html__` and `__RAIL_CONFIG__`) survive
 * bundling as free identifiers, and are substituted at command time.
 *
 * Run by `pnpm build`, after tsc, because it reads the output path from dist.
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const { prebuiltBundlePath, bakedIdentifiers } = await import(
  path.join(packageRoot, "dist/plugin/build.js")
);

await build({
  entryPoints: [path.join(packageRoot, "plugin/code.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2017",
  sourcemap: true,
  outfile: prebuiltBundlePath,
  loader: { ".html": "text" },
  logLevel: "warning",
});

// The two identifiers are the seam. If bundling ever resolved or renamed one,
// command-time assembly would silently produce a plugin with no config in it,
// so the prebuild refuses to publish a bundle it cannot substitute into.
const { readFileSync } = await import("node:fs");
const bundle = readFileSync(prebuiltBundlePath, "utf8");
for (const identifier of bakedIdentifiers) {
  const count = bundle.split(identifier).length - 1;
  if (count !== 1) {
    process.stderr.write(
      `${identifier} appears ${count} times in the prebuilt bundle; expected exactly one.\n` +
        "Command-time substitution assumes a single occurrence of each.\n",
    );
    process.exit(1);
  }
}

process.stdout.write(
  `prebuilt ${path.relative(packageRoot, prebuiltBundlePath)} (${bundle.length} bytes)\n`,
);
