/**
 * Shared by the two drift test files, which were split to stay under the LOC
 * guard. One definition of "a collection that matches" so a difference between
 * the files can only be a difference in what they assert.
 */
import artifact from "./__fixtures__/artifact.json" with { type: "json" };
import { buildExpectedVariables, type ObservedCollection } from "./drift.js";

export function loadArtifact(): unknown {
  // Structuredly identical to a real published artifact: a default theme in the
  // document body and one override theme under `$themeOverrides`.
  return structuredClone(artifact);
}

/** A collection that matches the expected set exactly — the no-drift baseline. */
export function observedFromExpected(
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

export const themeOptions = {
  extensionsNamespace: "com.example.tokens",
  fallbackThemeId: "dark",
} as const;
