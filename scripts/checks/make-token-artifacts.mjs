import fs from "node:fs";
import path from "node:path";
import { loadProject, renderTokenArtifacts } from "../../dist/index.js";

/** Expected bytes authored by the development candidate, rechecked by the release. */
export async function configureBuildFixture(root, flavour) {
  const file = path.join(root, "project.json");
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  const outputDir = flavour === "alpha" ? "generated" : "packages/design/build";
  const artifactPath = JSON.parse(
    fs.readFileSync(path.join(root, "profile.json"), "utf8"),
  )["artifact-path"].const;
  config.tokens.build = {
    compiler: "tokens-studio-css-v1",
    banner: `Generated ${flavour} design data.`,
    formatting: {
      semi: flavour === "alpha",
      singleQuote: flavour === "alpha",
      tabWidth: flavour === "alpha" ? 2 : 4,
      trailingComma: "all",
      printWidth: flavour === "alpha" ? 80 : 100,
    },
    runtime: {
      themeAttribute: flavour === "alpha" ? "data-theme" : "data-scheme",
      identicalThemes: "error",
      compatibility: null,
    },
    outputs: {
      stagedCss: `${outputDir}/source.css`,
      runtimeCss: `${outputDir}/runtime.css`,
      typescript: `${outputDir}/tokens.ts`,
      figma: artifactPath,
    },
    lockPath: ".cache/design.lock",
  };
  config.tokens.runtimeChecks = {
    compatibilitySurface: "runtime-surface.json",
    imports: {
      format: "css-import-v1",
      entries: [
        { file: "global.css", specifier: `./${outputDir}/runtime.css` },
      ],
    },
  };
  config.tokens.manualEditGuard = {
    policy: "git-input-dirty-v1",
    generatorInputs: ["product-pin.json"],
  };
  fs.writeFileSync(
    path.join(root, "runtime-surface.json"),
    JSON.stringify({
      surfaceVersion: "1",
      runtimeCssPath: `${outputDir}/runtime.css`,
      requiredCustomProperties: ["--brand-base", "--space-gap"],
    }),
  );
  fs.writeFileSync(
    path.join(root, "global.css"),
    `@import './${outputDir}/runtime.css';\n`,
  );
  // Only data for testing the Git dirty-input policy, not installation evidence.
  fs.writeFileSync(
    path.join(root, "product-pin.json"),
    '{"release":"fixture"}\n',
  );
  config.tokens.governance = {
    publication: {
      config: "config.json",
      baseline: "governance-baseline.json",
      ledger: "sync-ledger.json",
      profile: "profile.json",
      proof: "publish-proof.json",
    },
  };
  const publication = JSON.parse(
    fs.readFileSync(path.join(root, "config.json"), "utf8"),
  );
  // Hand-authored expected observation from make-consumer, not a compiler output
  // or a freshly captured self-matching baseline.
  const observed = JSON.parse(
    fs.readFileSync(path.join(root, "observed.json"), "utf8"),
  );
  fs.writeFileSync(
    path.join(root, "governance-baseline.json"),
    JSON.stringify(
      {
        source: artifactPath,
        collectionName: publication.collectionName,
        extensionsNamespace: publication.extensionsNamespace,
        fallbackThemeId: publication.fallbackThemeId,
        summary: {
          leafCount: observed.variables.length,
          firstLeaf: observed.variables[0].name,
          lastLeaf: observed.variables.at(-1).name,
          defaultThemeId: observed.modeNames[0],
          themeIds: observed.modeNames,
        },
        variables: observed.variables.map((v) => ({
          name: v.name,
          resolvedType: v.resolvedType,
          valuesByTheme: v.valuesByMode,
        })),
      },
      null,
      2,
    ) + "\n",
  );
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  // A tempting consumer formatter/plugin must NOT be loaded by the runtime.
  fs.writeFileSync(
    path.join(root, ".prettierrc.json"),
    '{"plugins":["missing-ambient-formatter"]}\n',
  );
  const project = loadProject(file),
    { contents } = await renderTokenArtifacts({ project });
  for (const [id, content] of Object.entries(contents)) {
    const target = project.tokens.build.outputs[id];
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}
