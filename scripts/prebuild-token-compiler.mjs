#!/usr/bin/env node
/** Ship the invariant compiler, not a consumer dependency tree or bundler. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { writeBundleNotices } from "./checks/bundle-notices.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = await build({
  absWorkingDir: root,
  entryPoints: ["src/tokens/compiler.mjs"],
  outfile: "dist/tokens/compiler.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  metafile: true,
  legalComments: "linked",
  banner: {
    js: 'import { createRequire as __dsCreateRequire } from "node:module"; const require = __dsCreateRequire(import.meta.url);',
  },
  logLevel: "warning",
});
for (const output of Object.values(result.metafile.outputs))
  for (const dependency of output.imports)
    if (
      dependency.external &&
      !dependency.path.startsWith("node:") &&
      !/^(assert|buffer|constants|crypto|events|fs|module|os|path|process|stream|tty|url|util|worker_threads|zlib)(\/|$)/.test(
        dependency.path,
      )
    )
      throw new Error(`Unbundled compiler dependency: ${dependency.path}`);
writeBundleNotices(
  result.metafile,
  root,
  path.join(root, "dist/tokens/THIRD-PARTY-NOTICES.txt"),
);
fs.rmSync(path.join(root, "dist/tokens/compiler.mjs.map"), { force: true });
fs.writeFileSync(
  path.join(root, "dist/tokens/compiler-build.json"),
  JSON.stringify(
    {
      adapter: "tokens-studio-css-v1",
      compiler: "style-dictionary@5.3.3",
      transforms: "@tokens-studio/sd-transforms@2.0.3",
      formatter: "prettier@3.8.1",
      inputs: Object.keys(result.metafile.inputs).sort(),
    },
    null,
    2,
  ) + "\n",
);
process.stdout.write(
  "prebuilt dependency-free token compiler and license notices\n",
);
