import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { tokenBuildFixture } from "./project-fixture.mjs";

export function governanceFixture({ publication = true } = {}) {
  const f = tokenBuildFixture();
  const artifact = f.config.tokens.build.outputs.figma;
  const revision = "a".repeat(40);
  f.config.tokens.manualEditGuard = null;
  f.config.tokens.runtimeChecks = {
    compatibilitySurface: "runtime-surface.json",
    imports: {
      format: "css-import-v1",
      entries: [{ file: "global.css", specifier: "./ui/theme.css" }],
    },
  };
  f.config.tokens.governance = {
    publication: publication
      ? {
          config: "publication/config.json",
          baseline: "publication/baseline.json",
          ledger: "publication/ledger.json",
          profile: "publication/profile.json",
          proof: "publication/proof.json",
        }
      : null,
  };
  f.write("project.json", f.config);
  f.write("runtime-surface.json", {
    surfaceVersion: "1",
    runtimeCssPath: "ui/theme.css",
    requiredCustomProperties: ["--brand-ink"],
  });
  fs.writeFileSync(
    path.join(f.root, "global.css"),
    '@import "./ui/theme.css";\n',
  );
  f.profile = {
    "artifact-path": { const: artifact },
    "destination-name": { const: "Fixture" },
    "destination-figma-file": { const: "figma://file/fixture" },
    "publish-modes": { enum: ["plugin-import-manual"] },
  };
  f.proof = {
    proofVersion: "1",
    mode: "plugin-import-manual",
    artifact: { path: artifact, gitSha: revision },
    destination: { name: "Fixture", figmaFile: "figma://file/fixture" },
    materialization: { status: "passed", attemptedAt: "2026-09-01T00:00:00Z" },
    carrier: { used: false, reason: null, exitExpectation: null },
  };
  f.ledger = {
    ledgerVersion: "3",
    artifact: { path: artifact, revision },
    publish: {
      mode: "plugin-import-manual",
      tokensStudioCarrier: false,
      figmaFile: "figma://file/fixture",
    },
    verification: {
      materializationStatus: "passed",
      lastVerifiedRevision: revision,
    },
    promotion: {
      parityMode: "required",
      highestEarnedLevel: "E-promotion-complete",
    },
    exceptions: [],
    publication: { proof: "./proof.json", sha256: "" },
  };
  f.saveProof = () => {
    f.write("publication/proof.json", f.proof);
    f.ledger.publication.sha256 = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(f.root, "publication/proof.json")))
      .digest("hex");
    f.write("publication/ledger.json", f.ledger);
  };
  f.saveProof();
  f.write("publication/profile.json", f.profile);
  const config = {
    collectionName: "Fixture Tokens",
    extensionsNamespace: "dev.example.design",
    fallbackThemeId: "midnight",
    artifactUrl: "http://localhost:8123/build/figma.json",
    plugin: { id: "fixture", name: "Fixture" },
  };
  f.write("publication/config.json", config);
  // Independent expected values for the fixture's authored #102030/#405060
  // source colors; not regenerated from the compiler or the verifier under test.
  const rgba = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255, a: 1 });
  f.baseline = {
    source: artifact,
    collectionName: config.collectionName,
    extensionsNamespace: config.extensionsNamespace,
    fallbackThemeId: config.fallbackThemeId,
    summary: {
      leafCount: 2,
      firstLeaf: "brand/ink",
      lastLeaf: "brand/text",
      defaultThemeId: "midnight",
      themeIds: ["midnight", "daylight"],
    },
    variables: ["ink", "text"].map((name) => ({
      name: `brand/${name}`,
      resolvedType: "COLOR",
      valuesByTheme: { midnight: rgba(16, 32, 48), daylight: rgba(64, 80, 96) },
    })),
  };
  f.write("publication/baseline.json", f.baseline);
  return f;
}
