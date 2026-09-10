import { exact, fail, resolveProjectPath } from "./config.mjs";

/** Only data is accepted; format plugins and custom executable transforms are not. */
export function readBuild(value, root) {
  if (value == null) return null;
  exact(
    value,
    ["compiler", "banner", "formatting", "runtime", "outputs", "lockPath"],
    "tokens.build",
  );
  if (value.compiler !== "tokens-studio-css-v1")
    fail("Unsupported tokens.build.compiler");
  safeText(value.banner, "tokens.build.banner");
  const formatting = value.formatting;
  exact(
    formatting,
    ["semi", "singleQuote", "tabWidth", "trailingComma", "printWidth"],
    "tokens.build.formatting",
  );
  if (
    typeof formatting.semi !== "boolean" ||
    typeof formatting.singleQuote !== "boolean" ||
    !Number.isInteger(formatting.tabWidth) ||
    formatting.tabWidth < 1 ||
    formatting.tabWidth > 8 ||
    !Number.isInteger(formatting.printWidth) ||
    formatting.printWidth < 20 ||
    formatting.printWidth > 240 ||
    !["none", "es5", "all"].includes(formatting.trailingComma)
  )
    fail("Invalid token build formatting options");
  const runtime = value.runtime;
  exact(
    runtime,
    ["themeAttribute", "identicalThemes", "compatibility"],
    "tokens.build.runtime",
  );
  if (
    typeof runtime.themeAttribute !== "string" ||
    !/^data-[a-z][a-z0-9-]*$/.test(runtime.themeAttribute)
  )
    fail("runtime.themeAttribute must name a data attribute");
  if (!["error", "allow"].includes(runtime.identicalThemes))
    fail("runtime.identicalThemes must be error or allow");
  if (!Object.hasOwn(runtime, "compatibility"))
    fail("runtime.compatibility must be configured or null");
  const outputs = {};
  const keys = ["stagedCss", "runtimeCss", "typescript", "figma"];
  exact(value.outputs, keys, "tokens.build.outputs");
  for (const key of keys)
    outputs[key] = resolveProjectPath(
      root,
      value.outputs[key],
      `tokens.build.outputs.${key}`,
    );
  if (new Set(Object.values(outputs)).size !== keys.length)
    fail("Token output paths must be distinct");
  return {
    ...value,
    formatting: { ...formatting },
    runtime: {
      ...runtime,
      compatibility: readCompatibility(runtime.compatibility, root),
    },
    outputs,
    lockPath: resolveProjectPath(
      root,
      value.lockPath,
      "tokens.build.lockPath",
      {
        cooperativeLockDirectory: true,
      },
    ),
  };
}
function readCompatibility(value, root) {
  if (value === null) return null;
  exact(
    value,
    ["inventory", "aliases", "categoryLabels"],
    "runtime.compatibility",
  );
  if (
    !value.categoryLabels ||
    typeof value.categoryLabels !== "object" ||
    Array.isArray(value.categoryLabels)
  )
    fail("compatibility.categoryLabels must be an object");
  for (const [key, label] of Object.entries(value.categoryLabels)) {
    safeText(key, "category key");
    safeText(label, "category label");
  }
  return {
    ...value,
    inventory: resolveProjectPath(
      root,
      value.inventory,
      "compatibility.inventory",
    ),
    aliases: resolveProjectPath(root, value.aliases, "compatibility.aliases"),
  };
}
function safeText(value, label) {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.includes("\0") ||
    /[\r\n]|\*\//.test(value)
  )
    fail(`${label} must be nonempty single-line comment-safe text`);
}
