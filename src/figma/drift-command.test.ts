import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildExpectedVariables, type ObservedCollection } from "../drift.js";
import { checkDrift, observedStateGuidance } from "./drift-command.js";
import { CannotEvaluateError } from "./profile.mjs";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const configPath = path.join(packageRoot, "ds-skills.config.example.json");
const artifactPath = path.join(packageRoot, "src/__fixtures__/artifact.json");

let tmpDir: string;
beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-skills-drift-"));
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

let counter = 0;
function write(data: unknown): string {
  const file = path.join(tmpDir, `observed-${(counter += 1)}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

/** An observation that matches the artifact, as a plugin session would report. */
function matchingObservation(): ObservedCollection {
  const expected = buildExpectedVariables(
    JSON.parse(fs.readFileSync(artifactPath, "utf8")),
    { extensionsNamespace: "com.example.tokens", fallbackThemeId: "light" },
  );
  return {
    name: "Design Tokens",
    modeNames: [...expected.themeIds],
    variables: expected.variables.map((variable) => ({
      name: variable.name,
      resolvedType: variable.resolvedType,
      valuesByMode: { ...variable.valuesByTheme },
    })),
  };
}

describe("observed state comes from a file, and the command says so", () => {
  it("states where an observation comes from rather than implying it can read Figma", () => {
    // Figma variables are readable only inside a plugin session. A command that
    // produced its own observation would need a live editor, which would make it
    // useless as a gate — so recording and checking are two steps on purpose.
    expect(observedStateGuidance).toContain("--observed <path> is required");
    expect(observedStateGuidance).toContain("plugin session");
  });

  it("reports no drift when the observation matches the artifact", () => {
    const result = checkDrift({
      configPath,
      artifactPath,
      observedPath: write(matchingObservation()),
    });
    expect(result.ok).toBe(true);
    expect(result.report.findings).toEqual([]);
  });

  it("reports a changed value", () => {
    const observed = matchingObservation();
    observed.variables[0]!.valuesByMode = {
      ...observed.variables[0]!.valuesByMode,
      dark: { r: 1, g: 0, b: 0, a: 1 },
    };
    const result = checkDrift({
      configPath,
      artifactPath,
      observedPath: write(observed),
    });
    expect(result.ok).toBe(false);
    expect(result.rendered).toContain(observed.variables[0]!.name);
  });

  it("reports a variable the file is missing", () => {
    const observed = matchingObservation();
    const dropped = observed.variables.pop()!;
    const result = checkDrift({
      configPath,
      artifactPath,
      observedPath: write(observed),
    });
    expect(result.ok).toBe(false);
    expect(result.report.findings.map((f) => f.code)).toContain(
      "MISSING_VARIABLE",
    );
    expect(result.rendered).toContain(dropped.name);
  });

  it("accepts the envelope the serve endpoint writes, as well as a bare collection", () => {
    // Both are things a consumer genuinely has on disk; guessing between them
    // is worse than accepting both.
    const enveloped = {
      checkedAt: "2026-04-01T00:00:00.000Z",
      ok: true,
      findings: [],
      collection: matchingObservation(),
    };
    expect(
      checkDrift({ configPath, artifactPath, observedPath: write(enveloped) })
        .ok,
    ).toBe(true);
  });
});

describe("an observation of the wrong thing is not a drift result", () => {
  it("refuses an observation of a different collection", () => {
    // Otherwise every variable reads as missing and the report looks like
    // catastrophic drift rather than the wrong input.
    const observed = {
      ...matchingObservation(),
      name: "Somebody Else's Tokens",
    };
    expect(() =>
      checkDrift({ configPath, artifactPath, observedPath: write(observed) }),
    ).toThrow(/is of collection/);
  });

  it("refuses a file that is not an observation", () => {
    expect(() =>
      checkDrift({ configPath, artifactPath, observedPath: write({ a: 1 }) }),
    ).toThrow(CannotEvaluateError);
  });

  it("refuses a missing observation", () => {
    expect(() =>
      checkDrift({
        configPath,
        artifactPath,
        observedPath: path.join(tmpDir, "absent.json"),
      }),
    ).toThrow(CannotEvaluateError);
  });
});
