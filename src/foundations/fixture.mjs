export const leaf = ($type, $value) => ({ $type, $value });
export function fixture(root = "base", modes = ["night", "day", "contrast"]) {
  const tokens = {
    colors: { ink: leaf("color", "#ffffff"), ground: leaf("color", "#000000") },
    fonts: { sans: leaf("string", "Inter") },
    sizes: { body: leaf("dimension", "1rem") },
    weights: { body: leaf("number", 400) },
    leading: { body: leaf("number", 1.5) },
    tracking: { body: leaf("dimension", "0.1em") },
    space: { small: leaf("dimension", "4px"), zero: leaf("dimension", "0px") },
    radii: { small: leaf("dimension", "2px") },
    border: { thin: leaf("dimension", "1px") },
    opacity: { muted: leaf("number", 0.5) },
    shadow: {
      base: leaf("string", "0 2px 6px rgba(0, 0, 0, 0.5)"),
      flat: leaf("string", "none"),
    },
    motion: { slow: leaf("duration", "0.2s") },
    labels: { description: leaf("string", "Token specimen") },
  };
  const sections = Object.entries({
    color: "colors",
    font: "fonts",
    size: "sizes",
    weight: "weights",
    leading: "leading",
    tracking: "tracking",
    dimension: "space",
    radius: "radii",
    border: "border",
    opacity: "opacity",
    shadow: "shadow",
    duration: "motion",
    value: "labels",
  }).map(([kind, group]) => ({
    id: kind,
    label: kind,
    description: "Actual selected source",
    kind,
    prefix: `${root}.${group}`,
    include: "direct",
    ...(kind === "color"
      ? {
          metric: "text",
          against: `${root}.colors.ground`,
          pairs: {},
          metrics: {},
        }
      : {}),
    ...(kind === "weight" ? { weightStyles: { 400: "Regular" } } : {}),
  }));
  return {
    document: {
      [root]: tokens,
      $extensions: { "org.example": { themeId: modes[0] } },
      $themeOverrides: Object.fromEntries(
        modes.slice(1).map((id) => [
          id,
          {
            [root]: {
              colors: {
                ink: leaf("color", "#000000"),
                ground: leaf("color", "#ffffff"),
              },
            },
          },
        ]),
      ),
    },
    config: {
      modelVersion: "1",
      extensionsNamespace: "org.example",
      defaultTheme: modes[0],
      modes: modes.map((id) => ({ id, label: id })),
      units: { rootFontPx: 16, emReferencePx: 12 },
      sections,
    },
    tokens,
  };
}
