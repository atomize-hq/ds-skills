import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CannotEvaluateError } from "./profile.mjs";
import { verifyMapping, type RailBaseline } from "./verify.js";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const configPath = path.join(packageRoot, "ds-skills.config.example.json");
const artifactPath = path.join(packageRoot, "src/__fixtures__/artifact.json");
const expectPath = path.join(
  packageRoot,
  "src/figma/__fixtures__/rail/token-rail.baseline.json",
);

let tmpDir: string;
let cwd: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-skills-verify-"));
  // The baseline records its artifact as a repo-relative path, so verification
  // has to run from the repo it describes — the same constraint a consumer has.
  cwd = process.cwd();
  process.chdir(packageRoot);
});
afterAll(() => {
  process.chdir(cwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

let counter = 0;
function write(name: string, data: unknown): string {
  const file = path.join(tmpDir, `${(counter += 1)}-${name}`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

function readBaseline(): RailBaseline {
  return JSON.parse(fs.readFileSync(expectPath, "utf8")) as RailBaseline;
}
function readArtifact(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(artifactPath, "utf8")) as Record<
    string,
    unknown
  >;
}

function codes(options: {
  configPath?: string;
  expectPath?: string;
  artifactPath?: string;
}): string[] {
  const result = verifyMapping({
    configPath: options.configPath ?? configPath,
    expectPath: options.expectPath ?? expectPath,
    artifactPath: options.artifactPath ?? artifactPath,
  });
  return result.errors.map((line) => /^\[([^\]]+)\]/.exec(line)?.[1] ?? line);
}

describe("figma verify compares against reviewed data, not against itself", () => {
  it("passes for the artifact and config the baseline was captured from", () => {
    const result = verifyMapping({ configPath, expectPath, artifactPath });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("notices a config that has drifted from the reviewed one", () => {
    // A namespace typo silently falls back to the wrong default theme, and
    // every downstream value still looks plausible.
    const drifted = write("config.json", {
      ...(JSON.parse(fs.readFileSync(configPath, "utf8")) as object),
      extensionsNamespace: "com.example.typo",
    });
    expect(codes({ configPath: drifted })).toContain(
      "RAIL_VERIFY_CONFIG_DRIFT",
    );
  });

  it("refuses to verify a different artifact than the reference describes", () => {
    // A green run against the wrong file proves nothing about the one anyone
    // ships, and reads exactly like a passing check.
    const elsewhere = write("artifact.json", readArtifact());
    expect(codes({ artifactPath: elsewhere })).toContain(
      "RAIL_VERIFY_ARTIFACT_MISMATCH",
    );
  });
});

describe("the full mapping, not the summary", () => {
  it("catches a changed value that leaves count, first and last intact", () => {
    // The exact case a summary cannot see: same leaf count, same first and last
    // name, different values in between.
    const artifact = readArtifact();
    const accent = artifact["accent"] as Record<string, { $value: string }>;
    accent["primary"] = { ...accent["primary"]!, $value: "#ff0000" };
    const changed = write("artifact.json", artifact);
    // Point the baseline at the mutated file so only the mapping differs.
    const baseline = {
      ...readBaseline(),
      source: path.relative(process.cwd(), changed),
    };

    const result = verifyMapping({
      configPath,
      expectPath: write("baseline.json", baseline),
      artifactPath: changed,
    });
    const found = result.errors.map((line) => /^\[([^\]]+)\]/.exec(line)?.[1]);
    expect(found).toContain("RAIL_VERIFY_MAPPING_DRIFT");
    expect(found).not.toContain("RAIL_VERIFY_SUMMARY_DRIFT");
    expect(result.errors.join(" ")).toContain("accent/primary");
  });

  it("names a bounded number of differing variables", () => {
    const baseline = readBaseline();
    const result = verifyMapping({
      configPath,
      expectPath: write("baseline.json", {
        ...baseline,
        variables: baseline.variables.slice(0, 2),
      }),
      artifactPath,
    });
    // Ten thousand names in a diagnostic is the same as none.
    expect(result.errors.join(" ")).toMatch(/and \d+ more/);
  });

  it("catches a variable missing a theme", () => {
    const artifact = readArtifact();
    const overrides = artifact["$themeOverrides"] as Record<string, unknown>;
    delete overrides["light"];
    const changed = write("artifact.json", artifact);
    const result = verifyMapping({
      configPath,
      expectPath: write("baseline.json", {
        ...readBaseline(),
        source: path.relative(process.cwd(), changed),
      }),
      artifactPath: changed,
    });
    const found = result.errors.map((line) => /^\[([^\]]+)\]/.exec(line)?.[1]);
    // Reported as a summary drift (the theme list shrank) rather than silently
    // comparing a one-theme mapping against a two-theme reference.
    expect(found).toContain("RAIL_VERIFY_SUMMARY_DRIFT");
  });
});

describe("the real-artifact constraint a package fixture cannot inherit", () => {
  it("fails when the artifact declares no namespace at all", () => {
    // Without this, a namespace typo falls through to fallbackThemeId and
    // everything else still passes — which is what the consumer's
    // $themeOverrides assertion was really protecting.
    const artifact = readArtifact();
    delete artifact["$extensions"];
    const changed = write("artifact.json", artifact);
    expect(
      codes({
        artifactPath: changed,
        expectPath: write("baseline.json", {
          ...readBaseline(),
          source: path.relative(process.cwd(), changed),
        }),
      }),
    ).toContain("RAIL_VERIFY_NAMESPACE_ABSENT");
  });

  it("fails when the artifact declares a different default theme", () => {
    const artifact = readArtifact();
    artifact["$extensions"] = { "com.example.tokens": { themeId: "light" } };
    const changed = write("artifact.json", artifact);
    expect(
      codes({
        artifactPath: changed,
        expectPath: write("baseline.json", {
          ...readBaseline(),
          source: path.relative(process.cwd(), changed),
        }),
      }),
    ).toContain("RAIL_VERIFY_DECLARED_THEME_DRIFT");
  });
});

describe("negative inputs are could-not-evaluate, not a failed check", () => {
  it.each(["configPath", "expectPath", "artifactPath"] as const)(
    "refuses a missing %s",
    (which) => {
      // Built inside the test: tmpDir does not exist when the cases are collected.
      expect(() =>
        codes({ [which]: path.join(tmpDir, "absent.json") }),
      ).toThrow(CannotEvaluateError);
    },
  );

  it("refuses malformed JSON", () => {
    const broken = path.join(tmpDir, "broken.json");
    fs.writeFileSync(broken, "{");
    expect(() => codes({ expectPath: broken })).toThrow(/not valid JSON/);
  });

  it("refuses a file that is JSON but is not a baseline", () => {
    expect(() => codes({ expectPath: write("nope.json", { a: 1 }) })).toThrow(
      /is not a rail baseline/,
    );
  });
});
