import fs from "node:fs";
import { afterEach, expect, it } from "vitest";
import { loadProject } from "../project/config.mjs";
import { renderTokenArtifacts } from "./render.mjs";
import { buildPublishedRuntimeCss } from "./runtime-css.mjs";
import { tokenBuildFixture } from "./project-fixture.mjs";
const roots = [];
afterEach(() => {
  for (const r of roots.splice(0))
    fs.rmSync(r, { recursive: true, force: true });
});
function fixture() {
  const f = tokenBuildFixture();
  roots.push(f.root);
  const inventory = {
    inventoryVersion: "1",
    entries: [{ legacyVar: "--old-ink", normalizedCategory: "text" }],
  };
  const aliases = {
    aliasMapVersion: "1",
    defaultThemeId: "midnight",
    entries: [
      {
        legacyVar: "--old-ink",
        canonicalTokenId: "brand.ink",
        themeId: "midnight",
        action: "preserve",
      },
    ],
  };
  f.config.tokens.build.runtime.compatibility = {
    inventory: "migration/inventory.json",
    aliases: "migration/aliases.json",
    categoryLabels: { text: "Text" },
  };
  function save() {
    f.write("project.json", f.config);
    f.write("migration/inventory.json", inventory);
    f.write("migration/aliases.json", aliases);
  }
  save();
  return { ...f, inventory, aliases, save };
}
it.each(["preserve", "alias", "rename-with-migration"])(
  "publishes %s aliases in both themed subtrees and the root",
  async (action) => {
    const f = fixture();
    f.aliases.entries[0].action = action;
    f.save();
    const { contents } = await renderTokenArtifacts({
      project: loadProject(f.configPath),
    });
    expect(
      contents.runtimeCss.match(/--old-ink: var\(--brand-ink\);/g),
    ).toHaveLength(3);
    expect(contents.runtimeCss).toContain("/* Text */");
    expect(contents.runtimeCss).toMatch(
      /\[data-mode='midnight'\] \{\n {2}--brand-ink: #102030;/,
    );
  },
);
it.each([
  [
    "inventory version",
    (f) => (f.inventory.inventoryVersion = "2"),
    /version 1/,
  ],
  ["aliases version", (f) => (f.aliases.aliasMapVersion = "2"), /version 1/],
  [
    "default theme",
    (f) => (f.aliases.defaultThemeId = "wrong"),
    /default theme/,
  ],
  [
    "entry theme",
    (f) => (f.aliases.entries[0].themeId = "wrong"),
    /another theme/,
  ],
  [
    "action",
    (f) => (f.aliases.entries[0].action = "ignore"),
    /unsupported alias action/,
  ],
  [
    "missing canonical",
    (f) => (f.aliases.entries[0].canonicalTokenId = "unknown.value"),
    /canonical variable/,
  ],
  [
    "duplicate aliases",
    (f) => f.aliases.entries.push(f.aliases.entries[0]),
    /unique and aligned/,
  ],
  [
    "duplicate inventory",
    (f) => f.inventory.entries.push(f.inventory.entries[0]),
    /unique and aligned/,
  ],
  [
    "missing entry",
    (f) => (f.aliases.entries[0].legacyVar = "--other"),
    /missing alias-map/,
  ],
  [
    "canonical shadow",
    (f) => {
      f.aliases.entries[0].legacyVar = "--brand-ink";
      f.inventory.entries[0].legacyVar = "--brand-ink";
    },
    /shadows canonical/,
  ],
  [
    "unsafe name",
    (f) => (f.inventory.entries[0].legacyVar = "--x; color:red"),
    /invalid runtime legacy/,
  ],
  [
    "unsafe category",
    (f) => (f.inventory.entries[0].normalizedCategory = "*/ .bad {}"),
    /invalid compatibility category/,
  ],
])(
  "refuses invalid %s without publishing a partial result",
  async (_name, mutate, message) => {
    const f = fixture();
    mutate(f);
    f.save();
    await expect(
      renderTokenArtifacts({ project: loadProject(f.configPath) }),
    ).rejects.toThrow(message);
  },
);
const runtime = {
  themeAttribute: "data-mode",
  identicalThemes: "error",
  compatibility: null,
};
it("refuses theme variable-set changes rather than writing undefined default resets", () => {
  expect(() =>
    buildPublishedRuntimeCss({
      stagedCss: ":root {\n  --one: 1;\n}\n",
      themeId: "first",
      themeOverrides: [
        {
          themeId: "second",
          stagedCss: ":root {\n  --one: 2;\n  --two: 2;\n}\n",
        },
      ],
      banner: "Generated",
      runtime,
    }),
  ).toThrow(/same variable names/);
});
it("refuses unparsed multiline declarations instead of silently losing theme values", () => {
  expect(() =>
    buildPublishedRuntimeCss({
      stagedCss: ":root {\n  --one:\n    2;\n}\n",
      themeId: "first",
      banner: "Generated",
      runtime,
    }),
  ).toThrow(/Unsupported/);
});
