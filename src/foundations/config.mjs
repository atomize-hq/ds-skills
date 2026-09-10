import { foundationError } from "./values.mjs";
export const kinds = [
  "color",
  "font",
  "size",
  "weight",
  "leading",
  "tracking",
  "dimension",
  "radius",
  "border",
  "opacity",
  "shadow",
  "duration",
  "value",
];
export function exact(value, fields, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !fields.includes(k))
  )
    throw foundationError(`Invalid ${label} object`);
}
const text = (v) => typeof v === "string" && v.trim() === v && v.length > 0;
export function validateFoundationConfig(c) {
  exact(
    c,
    [
      "modelVersion",
      "defaultTheme",
      "extensionsNamespace",
      "modes",
      "units",
      "sections",
    ],
    "configuration",
  );
  if (
    c.modelVersion !== "1" ||
    !text(c.defaultTheme) ||
    !(c.extensionsNamespace === null || text(c.extensionsNamespace))
  )
    throw foundationError(
      "Invalid model version, default theme or extension namespace",
    );
  if (!Array.isArray(c.modes) || !c.modes.length || c.modes.length > 20)
    throw foundationError("Configure 1 to 20 modes");
  const modes = new Set();
  for (const m of c.modes) {
    exact(m, ["id", "label"], "mode");
    if (!text(m.id) || !text(m.label) || modes.has(m.id))
      throw foundationError("Modes require unique IDs and labels");
    modes.add(m.id);
  }
  if (!modes.has(c.defaultTheme))
    throw foundationError("Default theme must be selected");
  exact(c.units, ["rootFontPx", "emReferencePx"], "units");
  if (
    Object.values(c.units).length !== 2 ||
    Object.values(c.units).some(
      (n) => !Number.isFinite(n) || n <= 0 || n > 10000,
    )
  )
    throw foundationError("Unit references must be positive finite pixels");
  if (
    !Array.isArray(c.sections) ||
    !c.sections.length ||
    c.sections.length > 100
  )
    throw foundationError("Configure 1 to 100 specimen sections");
  const ids = new Set();
  for (const s of c.sections) {
    exact(
      s,
      [
        "id",
        "label",
        "description",
        "kind",
        "prefix",
        "include",
        "metric",
        "against",
        "pairs",
        "metrics",
        "weightStyles",
      ],
      "section",
    );
    if (
      !text(s.id) ||
      ids.has(s.id) ||
      !text(s.label) ||
      typeof s.description !== "string" ||
      !kinds.includes(s.kind) ||
      !text(s.prefix) ||
      s.prefix.endsWith(".") ||
      !["direct", "descendants"].includes(s.include)
    )
      throw foundationError("Invalid or duplicate specimen section");
    ids.add(s.id);
    if (s.kind === "color") {
      if (!["text", "ui", "info", "none"].includes(s.metric))
        throw foundationError("Color metric must be explicit");
      if (s.metric !== "none" && !text(s.against))
        throw foundationError("Color metrics need an actual ground token");
      if (s.metric === "none" && s.against !== null)
        throw foundationError(
          "No-metric section must explicitly use null ground",
        );
      exact(s.metrics, Object.keys(s.metrics ?? {}), "color metrics");
      if (
        Object.values(s.metrics).some(
          (v) => !["text", "ui", "info", "none"].includes(v),
        )
      )
        throw foundationError("Invalid token-specific metric");
      exact(s.pairs, Object.keys(s.pairs ?? {}), "color pairs");
      if (Object.values(s.pairs).some((v) => !text(v)))
        throw foundationError("Pairs must name actual ground tokens");
    } else if (
      ["metric", "against", "pairs", "metrics"].some((k) => Object.hasOwn(s, k))
    )
      throw foundationError("Only color sections define contrast policy");
    if (s.kind === "weight") {
      exact(s.weightStyles, Object.keys(s.weightStyles ?? {}), "weight styles");
      if (
        !Object.keys(s.weightStyles).length ||
        Object.values(s.weightStyles).some((v) => !text(v))
      )
        throw foundationError("Weight specimens need explicit Figma styles");
    } else if (Object.hasOwn(s, "weightStyles"))
      throw foundationError("Only weight sections define styles");
  }
}
