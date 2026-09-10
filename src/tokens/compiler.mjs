/** Bundled at product build time; installed consumers need no dependencies. */
import StyleDictionary from "style-dictionary";
import { expandTypesMap, register } from "@tokens-studio/sd-transforms";
import { format } from "prettier/standalone";
import typescript from "prettier/plugins/typescript";
import estree from "prettier/plugins/estree";
const hooksReady = register(StyleDictionary, { platform: "css" });

export async function compileCss(tokens) {
  await hooksReady;
  const dictionary = new StyleDictionary({
    usesDtcg: true,
    tokens,
    preprocessors: ["tokens-studio"],
    expand: { typesMap: expandTypesMap },
    log: {
      verbosity: "silent",
      warnings: "error",
      errors: { brokenReferences: "throw" },
    },
    platforms: {
      css: {
        transformGroup: "tokens-studio",
        transforms: ["name/kebab"],
        files: [
          {
            destination: "tokens.css",
            format: "css/variables",
            options: { selector: ":root", showFileHeader: false, sort: "name" },
          },
        ],
      },
    },
  });
  // Formatting only: the product's writer owns all filesystem effects.
  const files = await dictionary.formatPlatform("css");
  if (files.length !== 1 || typeof files[0]?.output !== "string")
    throw new Error("Token compiler did not produce one CSS artifact");
  return files[0].output
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replace(/\n?$/, "\n");
}
export function formatTypedModule(source, options) {
  return format(source, {
    ...options,
    parser: "typescript",
    plugins: [typescript, estree],
  });
}
