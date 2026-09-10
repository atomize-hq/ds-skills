import fs from "node:fs";
import { build } from "esbuild";
const result = await build({
  entryPoints: ["src/foundations/render-runtime.mjs"],
  bundle: true,
  platform: "neutral",
  format: "iife",
  globalName: "DSFoundations",
  target: "es2017",
  write: false,
  metafile: true,
});
if (Object.values(result.metafile.outputs).some((o) => o.imports.length))
  throw new Error("Foundations renderer must be self-contained");
fs.mkdirSync("dist/foundations", { recursive: true });
fs.writeFileSync(
  "dist/foundations/renderer.js",
  result.outputFiles[0].contents,
);
process.stdout.write("prebuilt self-contained Foundations specimen renderer\n");
