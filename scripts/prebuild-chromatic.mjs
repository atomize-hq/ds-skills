import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";
import { build } from "esbuild";
import { writeBundleNotices } from "./checks/bundle-notices.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const result = await build({
  absWorkingDir: root,
  entryPoints: ["src/chromatic/provider-api.mjs"],
  outfile: "dist/chromatic/provider-api.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  metafile: true,
  legalComments: "linked",
  banner: {
    js: 'import { createRequire as __dsCreateRequire } from "node:module"; const require = __dsCreateRequire(import.meta.url); import { fileURLToPath as __dsFileURL } from "node:url"; import { dirname as __dsDirname } from "node:path"; const __filename = __dsFileURL(import.meta.url); const __dirname = __dsDirname(__filename);',
  },
  logLevel: "warning",
});
for (const output of Object.values(result.metafile.outputs))
  for (const entry of output.imports)
    if (
      entry.external &&
      !builtinModules.includes(entry.path.replace(/^node:/, ""))
    )
      throw new Error(`Unbundled Chromatic dependency: ${entry.path}`);
writeBundleNotices(
  result.metafile,
  root,
  path.join(root, "dist/chromatic/THIRD-PARTY-NOTICES.txt"),
);
fs.writeFileSync(
  path.join(root, "dist/chromatic/provider.json"),
  JSON.stringify({
    adapter: "chromatic-node-v15",
    package: "chromatic@15.3.0",
  }) + "\n",
);
process.stdout.write(
  "prebuilt Chromatic provider and retained license notices\n",
);
