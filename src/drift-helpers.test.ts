import { describe, expect, it } from "vitest";

import {
  buildExpectedVariables,
  compareFigmaVariables,
  formatDriftReport,
  isVariableAlias,
  valuesEqual,
} from "./drift.js";
import {
  loadArtifact,
  observedFromExpected,
  themeOptions,
} from "./drift-support.js";

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
