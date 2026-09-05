import { describe, expect, it } from "vitest";
import artifact from "./__fixtures__/artifact.json" with { type: "json" };
import {
  buildExpectedVariables,
  compareFigmaVariables,
  formatDriftReport,
  isVariableAlias,
  readDefaultThemeId,
  valuesEqual,
  type ObservedCollection,
} from "./drift.js";

function loadArtifact(): unknown {
  // Structuredly identical to a real published artifact: a default theme in the
  // document body and one override theme under `$themeOverrides`.
  return structuredClone(artifact);
}

/** A collection that matches the expected set exactly — the no-drift baseline. */
function observedFromExpected(
  expected: ReturnType<typeof buildExpectedVariables>,
  name = "Design Tokens",
): ObservedCollection {
  return {
    name,
    modeNames: [...expected.themeIds],
    variables: expected.variables.map((variable) => ({
      name: variable.name,
      resolvedType: variable.resolvedType,
      valuesByMode: { ...variable.valuesByTheme },
    })),
  };
}

const themeOptions = {
  extensionsNamespace: "com.example.tokens",
  fallbackThemeId: "dark",
} as const;

describe("readDefaultThemeId", () => {
  it("reads the theme id the artifact declares", () => {
    expect(
      readDefaultThemeId(
        { $extensions: { "com.example.tokens": { themeId: "light" } } },
        themeOptions,
      ),
    ).toBe("light");
  });

  it("falls back to dark when the extension is absent or malformed", () => {
    expect(readDefaultThemeId({}, themeOptions)).toBe("dark");
    expect(readDefaultThemeId(null, themeOptions)).toBe("dark");
    expect(
      readDefaultThemeId(
        { $extensions: { "com.example.tokens": { themeId: 7 } } },
        themeOptions,
      ),
    ).toBe("dark");
  });
});

describe("buildExpectedVariables", () => {
  it("carries every theme in the real artifact", () => {
    const expected = buildExpectedVariables(loadArtifact(), themeOptions);
    expect(expected.defaultThemeId).toBe("dark");
    expect(expected.themeIds).toEqual(["dark", "light"]);
    expect(expected.variables).toHaveLength(12);
    for (const variable of expected.variables) {
      expect(Object.keys(variable.valuesByTheme).sort()).toEqual([
        "dark",
        "light",
      ]);
    }
  });

  it("applies $themeOverrides per theme and inherits the base value otherwise", () => {
    const expected = buildExpectedVariables(
      {
        $extensions: { "com.example.tokens": { themeId: "dark" } },
        $themeOverrides: {
          light: { bg: { base: { $type: "color", $value: "#ffffff" } } },
        },
        bg: { base: { $type: "color", $value: "#000000" } },
        radius: { sm: { $type: "dimension", $value: "4px" } },
      },
      themeOptions,
    );

    const byName = new Map(
      expected.variables.map((entry) => [entry.name, entry]),
    );
    expect(byName.get("bg/base")?.valuesByTheme.dark).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 1,
    });
    expect(byName.get("bg/base")?.valuesByTheme.light).toEqual({
      r: 1,
      g: 1,
      b: 1,
      a: 1,
    });
    // Not overridden — the base value carries into every theme.
    expect(byName.get("radius/sm")?.valuesByTheme.light).toBe(4);
  });

  it("does not duplicate the default theme when $themeOverrides also names it", () => {
    const expected = buildExpectedVariables(
      {
        $extensions: { "com.example.tokens": { themeId: "dark" } },
        $themeOverrides: {
          dark: { bg: { $type: "color", $value: "#111111" } },
        },
        bg: { $type: "color", $value: "#000000" },
      },
      themeOptions,
    );
    expect(expected.themeIds).toEqual(["dark"]);
  });
});

describe("compareFigmaVariables", () => {
  it("reports no drift when the collection matches the artifact", () => {
    const expected = buildExpectedVariables(loadArtifact(), themeOptions);
    const report = compareFigmaVariables(
      expected,
      observedFromExpected(expected),
    );

    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.expectedVariableCount).toBe(12);
    expect(report.observedVariableCount).toBe(12);
  });

  it("tolerates the float32 precision Figma reads values back at", () => {
    const expected = buildExpectedVariables(
      {
        $extensions: { "com.example.tokens": { themeId: "dark" } },
        opacity: { muted: { $type: "number", $value: 0.7 } },
      },
      themeOptions,
    );
    const observed = observedFromExpected(expected);
    // What Figma actually returns for 0.7 stored in single precision.
    observed.variables[0]!.valuesByMode.dark = 0.699999988079071;

    expect(compareFigmaVariables(expected, observed).ok).toBe(true);
  });

  it("flags a variable the artifact publishes but the file lacks", () => {
    const expected = buildExpectedVariables(loadArtifact(), themeOptions);
    const observed = observedFromExpected(expected);
    const removed = observed.variables.pop()!;

    const report = compareFigmaVariables(expected, observed);
    expect(report.ok).toBe(false);
    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: "MISSING_VARIABLE", name: removed.name }),
    );
  });

  it("flags a variable someone added in Figma", () => {
    const expected = buildExpectedVariables(loadArtifact(), themeOptions);
    const observed = observedFromExpected(expected);
    observed.variables.push({
      name: "brand/experimental",
      resolvedType: "COLOR",
      valuesByMode: {
        dark: { r: 1, g: 0, b: 0, a: 1 },
        light: { r: 1, g: 0, b: 0, a: 1 },
      },
    });

    const report = compareFigmaVariables(expected, observed);
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: "UNEXPECTED_VARIABLE",
        name: "brand/experimental",
      }),
    );
  });

  it("flags a value edited in Figma and names both sides in hex", () => {
    const expected = buildExpectedVariables(loadArtifact(), themeOptions);
    const observed = observedFromExpected(expected);
    const target = observed.variables.find(
      (entry) => entry.resolvedType === "COLOR",
    )!;
    target.valuesByMode.dark = { r: 1, g: 0, b: 0, a: 1 };

    const report = compareFigmaVariables(expected, observed);
    const finding = report.findings.find(
      (entry) => entry.code === "VALUE_MISMATCH",
    );
    expect(finding?.name).toBe(target.name);
    expect(finding?.mode).toBe("dark");
    expect(finding?.detail).toContain("found #ff0000");
  });

  it("reports an alias binding separately from a plain value mismatch", () => {
    const expected = buildExpectedVariables(loadArtifact(), themeOptions);
    const observed = observedFromExpected(expected);
    observed.variables[0]!.valuesByMode.dark = {
      type: "VARIABLE_ALIAS",
      id: "VariableID:1:2",
    };

    const report = compareFigmaVariables(expected, observed);
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: "ALIAS_BINDING",
        name: observed.variables[0]!.name,
      }),
    );
    expect(
      report.findings.some((entry) => entry.code === "VALUE_MISMATCH"),
    ).toBe(false);
  });

  it("flags a resolvedType change and stops checking that variable", () => {
    const expected = buildExpectedVariables(loadArtifact(), themeOptions);
    const observed = observedFromExpected(expected);
    const target = observed.variables.find(
      (entry) => entry.resolvedType === "COLOR",
    )!;
    target.resolvedType = "STRING";
    target.valuesByMode.dark = "not a color";

    const report = compareFigmaVariables(expected, observed);
    const forTarget = report.findings.filter(
      (entry) => entry.name === target.name,
    );
    expect(forTarget).toHaveLength(1);
    expect(forTarget[0]?.code).toBe("TYPE_MISMATCH");
  });

  it("flags a missing mode once rather than once per variable", () => {
    const expected = buildExpectedVariables(loadArtifact(), themeOptions);
    const observed = observedFromExpected(expected);
    observed.modeNames = ["dark"];

    const report = compareFigmaVariables(expected, observed);
    expect(
      report.findings.filter((entry) => entry.code === "MISSING_MODE"),
    ).toEqual([expect.objectContaining({ mode: "light" })]);
    expect(
      report.findings.some((entry) => entry.mode === "light" && entry.name),
    ).toBe(false);
  });

  it("flags a mode added in Figma", () => {
    const expected = buildExpectedVariables(loadArtifact(), themeOptions);
    const observed = observedFromExpected(expected);
    observed.modeNames.push("high-contrast");

    const report = compareFigmaVariables(expected, observed);
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        code: "UNEXPECTED_MODE",
        mode: "high-contrast",
      }),
    );
  });

  it("flags a variable left unset in one mode", () => {
    const expected = buildExpectedVariables(loadArtifact(), themeOptions);
    const observed = observedFromExpected(expected);
    delete observed.variables[0]!.valuesByMode.light;

    const report = compareFigmaVariables(expected, observed);
    expect(report.findings).toContainEqual(
      expect.objectContaining({ code: "MISSING_MODE_VALUE", mode: "light" }),
    );
  });

  it("orders findings deterministically", () => {
    const expected = buildExpectedVariables(loadArtifact(), themeOptions);
    const observed = observedFromExpected(expected);
    observed.variables.push({
      name: "zz/extra",
      resolvedType: "STRING",
      valuesByMode: {},
    });
    observed.variables.push({
      name: "aa/extra",
      resolvedType: "STRING",
      valuesByMode: {},
    });
    observed.modeNames.push("extra-mode");

    const codes = compareFigmaVariables(expected, observed).findings.map(
      (entry) => entry.code,
    );
    expect(codes).toEqual([...codes].sort());
  });
});

describe("valuesEqual", () => {
  it("rejects mismatched primitive types instead of coercing", () => {
    expect(valuesEqual(1, "1")).toBe(false);
    expect(valuesEqual(true, 1)).toBe(false);
    expect(valuesEqual("#fff", { r: 1, g: 1, b: 1, a: 1 })).toBe(false);
  });

  it("treats a missing alpha channel as opaque", () => {
    expect(valuesEqual({ r: 0, g: 0, b: 0, a: 1 }, { r: 0, g: 0, b: 0 })).toBe(
      true,
    );
  });
});

describe("isVariableAlias", () => {
  it("recognises the Figma alias shape only", () => {
    expect(isVariableAlias({ type: "VARIABLE_ALIAS", id: "x" })).toBe(true);
    expect(isVariableAlias({ type: "SOLID" })).toBe(false);
    expect(isVariableAlias(null)).toBe(false);
    expect(isVariableAlias("VARIABLE_ALIAS")).toBe(false);
  });
});

describe("formatDriftReport", () => {
  it("states plainly when nothing drifted", () => {
    const expected = buildExpectedVariables(loadArtifact(), themeOptions);
    const text = formatDriftReport(
      compareFigmaVariables(expected, observedFromExpected(expected)),
    );
    expect(text).toContain("Figma drift: NONE");
    expect(text).toContain("modes=dark, light");
  });

  it("lists each finding with its code", () => {
    const expected = buildExpectedVariables(loadArtifact(), themeOptions);
    const observed = observedFromExpected(expected);
    observed.variables.push({
      name: "zz/extra",
      resolvedType: "STRING",
      valuesByMode: {},
    });

    const text = formatDriftReport(compareFigmaVariables(expected, observed));
    expect(text).toContain("Figma drift: 1 finding(s)");
    expect(text).toContain("[UNEXPECTED_VARIABLE] zz/extra");
  });
});
