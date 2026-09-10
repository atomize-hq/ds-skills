import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadProject } from "../project/config.mjs";
import { renderTokenArtifacts } from "./render.mjs";
import { compileCss } from "./compiler.mjs";
import { tokenBuildFixture } from "./project-fixture.mjs";
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const f = tokenBuildFixture();
  roots.push(f.root);
  return f;
}
it("renders every artifact with configured namespace, theme selector, and formatting without writing", async () => {
  const f = fixture();
  const artifacts = await renderTokenArtifacts({
    project: loadProject(f.configPath),
  });
  expect(Object.keys(artifacts.contents).sort()).toEqual([
    "figma",
    "runtimeCss",
    "stagedCss",
    "typescript",
  ]);
  expect(artifacts.contents.stagedCss).toContain("--brand-ink: #102030;");
  expect(artifacts.contents.runtimeCss).toContain("[data-mode='daylight']");
  expect(artifacts.contents.runtimeCss).toContain("[data-mode='midnight']");
  expect(artifacts.contents.runtimeCss).not.toContain("Legacy runtime");
  expect(artifacts.contents.typescript).toContain("export const recipeMap =");
  expect(artifacts.contents.typescript).toContain("notice:");
  expect(JSON.parse(artifacts.contents.figma).$extensions).toHaveProperty(
    "dev.example.design",
  );
  expect(fs.existsSync(path.join(f.root, "build"))).toBe(false);
  expect(fs.existsSync(path.join(f.root, ".cache"))).toBe(false);
});
it("uses the real transforms for composite typography and unit math", async () => {
  const css = await compileCss({
    size: { $type: "dimension", $value: "4 * 2" },
    type: {
      $type: "typography",
      $value: {
        fontFamily: "Inter",
        fontSize: "16px",
        fontWeight: "Regular",
        lineHeight: "150%",
        letterSpacing: "0px",
      },
    },
  });
  expect(css).toContain("--size: 8px;");
  expect(css).toContain("--type-font-size: 16px;");
  expect(css).toContain("--type-font-weight: 400;");
});
it("does not load a consumer formatter config or plugin", async () => {
  const f = fixture();
  fs.writeFileSync(
    path.join(f.root, ".prettierrc.json"),
    '{"plugins":["does-not-exist"]}',
  );
  const a = await renderTokenArtifacts({ project: loadProject(f.configPath) });
  expect(a.contents.typescript).toContain("export const tokenMap");
});
it("fails rendering before writes on a broken non-default source", async () => {
  const f = fixture();
  f.write("design/modes/day.json", {
    $extensions: { "dev.example.design": { themeId: "daylight" } },
    brand: { ink: { $type: "color", $value: "{missing.color}" } },
  });
  await expect(
    renderTokenArtifacts({ project: loadProject(f.configPath) }),
  ).rejects.toThrow(/missing/);
  expect(fs.existsSync(path.join(f.root, "build"))).toBe(false);
});
it("makes identical-theme policy explicit", async () => {
  const f = fixture();
  f.write("design/modes/day.json", {
    $extensions: { "dev.example.design": { themeId: "daylight" } },
  });
  await expect(
    renderTokenArtifacts({ project: loadProject(f.configPath) }),
  ).rejects.toThrow(/identically/);
  f.config.tokens.build.runtime.identicalThemes = "allow";
  f.write("project.json", f.config);
  expect(
    (await renderTokenArtifacts({ project: loadProject(f.configPath) }))
      .contents.runtimeCss,
  ).toContain("[data-mode='daylight']");
});
it("does not imply an unconfigured build is available", async () => {
  const f = fixture();
  delete f.config.tokens.build;
  f.write("project.json", f.config);
  await expect(
    renderTokenArtifacts({ project: loadProject(f.configPath) }),
  ).rejects.toThrow(/not configured/);
});
