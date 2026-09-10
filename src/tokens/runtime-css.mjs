import { TokenInputError } from "./source.mjs";
import { renderCompatibilityAliases } from "./runtime-aliases.mjs";

export function buildPublishedRuntimeCss(options) {
  const { stagedCss, themeId, themeOverrides = [], banner, runtime } = options;

  const stagedVariables = extractCssCustomProperties(stagedCss);
  const compatibilityLines = renderCompatibilityAliases(
    runtime.compatibility,
    themeId,
    stagedVariables,
  );
  const rootBody = extractCssRootBody(stagedCss);
  parseDeclarations(rootBody);

  return [
    `/* ${banner} */`,
    "",
    ":root {",
    rootBody,
    ...compatibilityBlock(compatibilityLines),
    "}",
    ...renderThemeOverrideBlocks(
      stagedCss,
      themeOverrides,
      compatibilityLines,
      themeId,
      runtime,
    ),
    "",
  ].join("\n");
}

/**
 * Non-default themes are emitted as `[data-theme="<id>"]` blocks holding only the
 * declarations whose values differ from the default theme.
 *
 * The legacy compatibility aliases are repeated in each block. They are declared
 * as `--color-x: var(--semantic-x)`, and a `var()` in a custom property resolves
 * on the element that declares it — so the `:root` copies compute against the
 * default theme and then merely inherit. Without restating them here, theming a
 * subtree (which is what Storybook's decorator does) would switch the semantic
 * variables while the legacy aliases stayed on the default theme's values.
 */
function renderThemeOverrideBlocks(
  defaultStagedCss,
  themeOverrides,
  compatibilityLines,
  defaultThemeId,
  runtime,
) {
  if (themeOverrides.length === 0) {
    return [];
  }

  const defaults = parseDeclarations(extractCssRootBody(defaultStagedCss));
  const lines = [];
  const themedNames = new Set();

  for (const { themeId, stagedCss } of themeOverrides) {
    const candidate = parseDeclarations(extractCssRootBody(stagedCss));
    if (
      candidate.size !== defaults.size ||
      [...candidate.keys()].some((name) => !defaults.has(name))
    )
      throw new TokenInputError(
        "TOKEN_RUNTIME",
        `Theme ${themeId} changes the compiled variable set; this adapter requires the same variable names in every theme`,
      );
    const changed = [...candidate].filter(
      ([name, value]) => defaults.get(name) !== value,
    );

    if (changed.length === 0 && runtime.identicalThemes === "error") {
      throw new TokenInputError(
        "TOKEN_RUNTIME",
        `token build setup: theme "${themeId}" resolves identically to the default theme, so it would publish an empty override block`,
      );
    }

    for (const [name] of changed) themedNames.add(name);
    lines.push("");
    lines.push(`[${runtime.themeAttribute}='${themeId}'] {`);
    for (const [name, value] of changed) {
      lines.push(`  ${name}: ${value};`);
    }
    lines.push(...compatibilityBlock(compatibilityLines));
    lines.push("}");
  }

  // The default theme also gets an explicit block so it can be re-declared
  // inside another theme's subtree. Without it, `data-theme="dark"` would be
  // inert (dark lives unqualified in `:root`) and a surface that must stay dark
  // regardless of app theme — a terminal, whose ANSI palette is defined against
  // a dark ground — would have no way to opt out of an enclosing light theme.
  lines.push("");
  lines.push(`[${runtime.themeAttribute}='${defaultThemeId}'] {`);
  for (const name of [...themedNames].sort()) {
    lines.push(`  ${name}: ${defaults.get(name)};`);
  }
  lines.push(...compatibilityBlock(compatibilityLines));
  lines.push("}");

  return lines;
}

function parseDeclarations(cssBody) {
  const declarations = new Map();

  for (const line of cssBody.replace(/\/\*[\s\S]*?\*\//g, "").split("\n")) {
    if (!line.trim()) continue;
    const match = line.match(/^\s*(--[a-z0-9-]+):\s*(.+);\s*$/);
    if (!match || declarations.has(match[1]))
      throw new TokenInputError(
        "TOKEN_RUNTIME",
        "Unsupported or duplicate compiled CSS declaration",
      );
    declarations.set(match[1], match[2]);
  }

  return declarations;
}

export function extractCssCustomProperties(cssSource) {
  const variables = new Set();

  for (const match of cssSource.matchAll(/^\s*(--[a-z0-9-]+):\s*.+;$/gm)) {
    variables.add(match[1]);
  }

  return variables;
}

function extractCssRootBody(cssSource) {
  const match = cssSource.match(/^:root\s*\{\n([\s\S]*?)\n\}\n?$/);
  if (!match) {
    throw new TokenInputError(
      "TOKEN_RUNTIME",
      "token build setup: staged runtime css must be a single :root block",
    );
  }

  return match[1];
}

function compatibilityBlock(lines) {
  return lines.length
    ? ["", "  /* Legacy runtime compatibility surface */", ...lines]
    : [];
}
