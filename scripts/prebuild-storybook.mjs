import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";
import { build } from "esbuild";
import { writeBundleNotices } from "./checks/bundle-notices.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const result = await build({
  absWorkingDir: root,
  entryPoints: ["src/storybook/csf-parser.mjs"],
  outfile: "dist/storybook/csf-parser.mjs",
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
      throw new Error(`Unbundled Storybook dependency: ${entry.path}`);
writeBundleNotices(
  result.metafile,
  root,
  path.join(root, "dist/storybook/THIRD-PARTY-NOTICES.txt"),
);
fs.writeFileSync(
  path.join(root, "dist/storybook/adapter.json"),
  JSON.stringify(
    {
      adapter: "csf-ts-v1",
      contractAdapter: "ts-named-imports-slots-v1",
      typescript: "5.9.3",
      csf: "@storybook/csf@0.1.13",
      formatter: "prettier@3.8.1",
      inputs: Object.keys(result.metafile.inputs).sort(),
    },
    null,
    2,
  ) + "\n",
);
process.stdout.write("prebuilt static CSF adapter and license notices\n");
