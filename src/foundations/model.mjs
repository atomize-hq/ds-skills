import crypto from "node:crypto";
import { validateFoundationConfig } from "./config.mjs";
import { foundationTokens } from "./artifact.mjs";
import {
  foundationError,
  dimension,
  contrast,
  shadow,
  shadowRoom,
} from "./values.mjs";
const expectedType = {
  color: "color",
  font: "string",
  size: "dimension",
  weight: "number",
  leading: "number",
  tracking: "dimension",
  dimension: "dimension",
  radius: "dimension",
  border: "dimension",
  opacity: "number",
  shadow: "string",
  duration: "duration",
};
export function buildFoundationModel(document, config) {
  validateFoundationConfig(config);
  const tokens = foundationTokens(document, config);
  const sections = config.sections.map((s) => {
    const selected = [...tokens.values()].filter(
      (t) =>
        t.id.startsWith(`${s.prefix}.`) &&
        (s.include === "descendants" ||
          !t.id.slice(s.prefix.length + 1).includes(".")),
    );
    if (!selected.length)
      throw foundationError(`Empty configured section: ${s.id}`);
    for (const id of [
      ...Object.keys(s.pairs ?? {}),
      ...Object.keys(s.metrics ?? {}),
    ])
      if (!selected.some((t) => t.id === id))
        throw foundationError(
          `Contrast pair does not select a section token: ${id}`,
        );
    const rows = selected.map((t) => {
      if (expectedType[s.kind] && t.type !== expectedType[s.kind])
        throw foundationError(`Incompatible ${s.kind} token: ${t.id}`);
      const samples = Object.fromEntries(
        config.modes.map(({ id: mode }) => {
          const value = t.values[mode],
            variableValue = t.figmaValues[mode];
          let rendered = value,
            binding = "none",
            note = "Text-only value",
            extra = {};
          if (s.kind === "color") {
            rendered = variableValue;
            binding = "direct";
            note = "Variable-bound color";
            const metric = s.metrics[t.id] ?? s.metric;
            if (metric !== "none") {
              const ground = tokens.get(s.pairs[t.id] ?? s.against);
              if (!ground || ground.type !== "color")
                throw foundationError(`Missing color ground for ${t.id}`);
              const ratio = contrast(value, ground.values[mode]);
              extra = {
                against: ground.variable,
                ratio,
                metric,
                verdict:
                  metric === "info"
                    ? "ratio-only"
                    : metric === "ui"
                      ? ratio >= 3
                        ? "pass"
                        : "below"
                      : ratio >= 4.5
                        ? "pass"
                        : ratio >= 3
                          ? "large-text-only"
                          : "below",
              };
            }
          } else if (
            ["size", "dimension", "radius", "border", "tracking"].includes(
              s.kind,
            )
          ) {
            rendered = dimension(value, config.units);
            if (s.kind !== "tracking" && rendered < 0)
              throw foundationError(`Negative geometry: ${t.id}`);
            binding = rendered === variableValue ? "direct" : "derived";
            note =
              binding === "direct"
                ? "Variable-bound numeric value"
                : "Resolved length differs from published numeric value";
            if (s.kind === "tracking") {
              binding = "derived";
              note =
                "Tracking resolved to pixels against explicit specimen reference";
            }
            if (rendered === 0 && ["dimension", "border"].includes(s.kind)) {
              binding = "derived";
              note =
                "Zero specimen geometry needs a visible floor; do not bind a nonzero floor to zero";
            }
          } else if (s.kind === "duration") {
            rendered = variableValue;
            if (rendered < 0)
              throw foundationError(`Negative duration: ${t.id}`);
            binding = "direct";
            note =
              "Milliseconds visualized at one pixel per millisecond, not animation proof";
            if (rendered === 0) {
              binding = "derived";
              note = "Zero-duration bar needs an explicit visible floor";
            }
          } else if (s.kind === "opacity") {
            if (value < 0 || value > 1)
              throw foundationError(`Opacity must be a unit interval: ${t.id}`);
            binding = "derived";
            note =
              "Unit interval applied directly, not a percentage variable binding";
          } else if (s.kind === "leading") {
            if (value <= 0)
              throw foundationError(`Leading must be positive: ${t.id}`);
            rendered = value * 100;
            binding = "derived";
            note = "Multiplier converted to percent, not bound as pixels";
          } else if (s.kind === "weight") {
            rendered = s.weightStyles[String(value)];
            if (!rendered)
              throw foundationError(
                `No configured Figma font style for weight ${value}`,
              );
            binding = "derived";
            note = "Numeric weight mapped to explicit font style";
          } else if (s.kind === "font") {
            binding = "direct";
            note =
              "Font-family variable; renderer must load and verify actual font style";
          } else if (s.kind === "shadow") {
            rendered = shadow(value);
            binding = "derived";
            note =
              "CSS shadow converted to effect; not a Figma effect-variable binding";
          }
          if (typeof rendered === "number" && !Number.isFinite(rendered))
            throw foundationError(`Nonfinite rendered value: ${t.id}`);
          return [mode, { value, rendered, binding, note, ...extra }];
        }),
      );
      return { id: t.id, variable: t.variable, type: t.type, samples };
    });
    const result = {
      id: s.id,
      label: s.label,
      description: s.description,
      kind: s.kind,
      rows,
    };
    if (s.kind === "shadow")
      result.shadowPadding = shadowRoom(
        rows.flatMap((r) => Object.values(r.samples).map((x) => x.rendered)),
      );
    return result;
  });
  return {
    modelVersion: "1",
    scope: "foundation-specimen-data",
    defaultTheme: config.defaultTheme,
    modes: config.modes.map((m) => ({ ...m })),
    inputDigest: crypto
      .createHash("sha256")
      .update(JSON.stringify({ document, config }))
      .digest("hex"),
    tokenCount: tokens.size,
    units: { ...config.units },
    variables: [...tokens.values()].map((t) => ({
      name: t.variable,
      resolvedType:
        t.type === "color"
          ? "COLOR"
          : ["dimension", "duration", "number"].includes(t.type)
            ? "FLOAT"
            : t.type === "boolean"
              ? "BOOLEAN"
              : "STRING",
      valuesByMode: { ...t.figmaValues },
    })),
    sections,
  };
}
