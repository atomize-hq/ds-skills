import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tokenProjectFixture } from "./project-fixture.mjs";
import { loadProject } from "../project/config.mjs";
import {
  loadBuildGraph,
  createFigmaTokenDocument,
  createThemeOverrideMaps,
} from "./graph.mjs";
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const f = tokenProjectFixture();
  roots.push(f.root);
  return f;
}
function graph(f, themeId) {
  return loadBuildGraph({ project: loadProject(f.configPath), themeId });
}

describe("configured token graph", () => {
  it("resolves different source roots, theme names, references and recipes", () => {
    const f = fixture();
    const g = graph(f);
    expect(g.themeId).toBe("midnight");
    expect(g.tokenMap["brand.text"]).toEqual({
      type: "color",
      value: "#102030",
      themeId: "midnight",
    });
    expect(g.recipeMap.notice).toEqual(f.recipe);
    const day = graph(f, "daylight");
    expect(day.tokenMap["brand.text"].value).toBe("#405060");
    const variants = [{ themeId: day.themeId, tokens: day.materializedTokens }];
    expect(
      createThemeOverrideMaps(g, variants)["daylight"]["brand.text"].value,
    ).toBe("#405060");
    const publish = createFigmaTokenDocument(g, variants);
    expect(publish.$extensions).toEqual({
      "dev.example.design": { source: "repo", themeId: "midnight" },
    });
    expect(publish.private).toBeUndefined();
    expect(g.tokenMap["private.gap"]).toBeDefined();
    expect(publish.$themeOverrides.daylight.brand.text.$value).toBe("#405060");
  });
  it("discovers new recipes without an index or component allowlist", () => {
    const f = fixture();
    f.write("ui/recipes/editor.recipe.json", {
      ...f.recipe,
      componentId: "editor",
    });
    f.write("ui/recipes/index.json", { recipes: [] });
    expect(Object.keys(graph(f).recipeMap)).toEqual(["editor", "notice"]);
  });
  it("accepts group-inherited types", () => {
    const f = fixture();
    f.write("design/source/space.tokens.json", {
      $type: "dimension",
      gap: { $value: "4px" },
    });
    expect(graph(f).tokenMap["space.gap"].type).toBe("dimension");
  });
  it.each([
    [
      "duplicate theme",
      (f) => {
        f.registry.themes.push({ ...f.registry.themes[0] });
        f.write("design/modes/list.json", f.registry);
      },
      /duplicate theme/,
    ],
    [
      "cycle",
      (f) => {
        f.registry.themes[0].extends = "daylight";
        f.write("design/modes/list.json", f.registry);
      },
      /cycle/,
    ],
    [
      "unknown parent",
      (f) => {
        f.registry.themes[1].extends = "missing";
        f.write("design/modes/list.json", f.registry);
      },
      /unknown.*theme/i,
    ],
    [
      "unknown default",
      (f) => {
        f.registry.defaultThemeId = "missing";
        f.write("design/modes/list.json", f.registry);
      },
      /defaultThemeId/,
    ],
    [
      "unknown fallback",
      (f) => {
        f.registry.terminalFallbackThemeId = "missing";
        f.write("design/modes/list.json", f.registry);
      },
      /terminalFallbackThemeId/,
    ],
    [
      "wrong metadata",
      (f) =>
        f.write("design/modes/base.json", {
          $extensions: { "dev.example.design": { themeId: "wrong" } },
        }),
      /themeId/,
    ],
    [
      "bad source",
      (f) => f.write("design/source/brand.tokens.json", { ink: 1 }),
      /token/,
    ],
    [
      "missing token",
      (f) =>
        f.write("design/source/brand.tokens.json", {
          ink: { $type: "color", $value: "{missing.ink}" },
        }),
      /not defined/,
    ],
    [
      "reference cycle",
      (f) =>
        f.write("design/source/brand.tokens.json", {
          ink: { $type: "color", $value: "{brand.ink}" },
        }),
      /circular token/,
    ],
    [
      "duplicate family",
      (f) => f.write("design/source/nested/brand.tokens.json", {}),
      /duplicate.*family/,
    ],
    [
      "invalid recipe",
      (f) => {
        f.recipe.defaults.state = "absent";
        f.write("ui/recipes/notice.recipe.json", f.recipe);
      },
      /unknown default state/,
    ],
    [
      "unknown recipe token",
      (f) => {
        f.recipe.slots.body.color = "{brand.absent}";
        f.write("ui/recipes/notice.recipe.json", f.recipe);
      },
      /unknown token reference/,
    ],
  ])("rejects %s", (_name, mutate, error) => {
    const f = fixture();
    mutate(f);
    expect(() => graph(f)).toThrow(error);
  });
  it("rejects an invalid canonical reference even when a theme overwrites it", () => {
    const f = fixture();
    f.write("design/source/brand.tokens.json", {
      ink: { $type: "color", $value: "{brand.absent}" },
      text: { $type: "color", $value: "{brand.ink}" },
    });
    f.write("design/modes/base.json", {
      $extensions: { "dev.example.design": { themeId: "midnight" } },
      brand: { ink: { $type: "color", $value: "#000000" } },
    });
    expect(() => graph(f)).toThrow(/not defined/);
  });
  it("rejects invalid theme references even when a child theme overwrites them", () => {
    const f = fixture();
    f.write("design/modes/base.json", {
      $extensions: { "dev.example.design": { themeId: "midnight" } },
      brand: { ink: { $type: "color", $value: "{brand.absent}" } },
    });
    expect(() => graph(f, "daylight")).toThrow(/not defined/);
  });
  it("requires the default and terminal fallback themes to be mandatory", () => {
    const f = fixture();
    f.registry.themes[0].required = false;
    f.write("design/modes/list.json", f.registry);
    expect(() => graph(f)).toThrow(/must name a required theme/);
  });
  it("excludes the configured theme directory rather than a literal folder name", () => {
    const f = fixture();
    f.config.tokens.themes.directory = "design/source/modes";
    f.write("project.json", f.config);
    fs.mkdirSync(path.join(f.root, "design/source/modes"));
    fs.copyFileSync(
      path.join(f.root, "design/modes/base.json"),
      path.join(f.root, "design/source/modes/base.json"),
    );
    fs.copyFileSync(
      path.join(f.root, "design/modes/day.json"),
      path.join(f.root, "design/source/modes/day.json"),
    );
    f.write("design/source/modes/ignored.tokens.json", { unexpected: 1 });
    expect(Object.keys(graph(f).tokenMap)).toEqual([
      "brand.ink",
      "brand.text",
      "private.gap",
    ]);
  });
});
