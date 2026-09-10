import { kinds } from "./config.mjs";
export const renderError = (message) =>
  new Error(`FOUNDATIONS_RENDER: ${message}`);
const text = (v) => typeof v === "string" && v.length > 0 && v.trim() === v;
const object = (v, keys, label) => {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    throw renderError(`Invalid ${label}`);
};
export const colorRoles = ["background", "text", "muted", "accent", "border"];
export const numericRoles = [
  "fontSize",
  "titleSize",
  "sectionSize",
  "cornerRadius",
  "rowGap",
  "sectionGap",
  "padding",
];
export function validatePresentation(model, p) {
  object(
    p,
    [
      "rendererVersion",
      "pageId",
      "collectionId",
      "ownerId",
      "fonts",
      "roles",
      "width",
      "sampleFontSize",
      "frames",
      "scales",
    ],
    "presentation",
  );
  if (
    p.rendererVersion !== "1" ||
    !text(p.pageId) ||
    !text(p.collectionId) ||
    !text(p.ownerId)
  )
    throw renderError("Explicit target and owner identities required");
  if (
    !model ||
    model.modelVersion !== "1" ||
    model.scope !== "foundation-specimen-data" ||
    !Array.isArray(model.variables) ||
    !model.units
  )
    throw renderError("Expected a generated Foundation model");
  if (model.sections.some((s) => !kinds.includes(s.kind)))
    throw renderError("Unsupported specimen kind");
  object(p.fonts, ["body", "code", "heading"], "fonts");
  for (const f of ["body", "code", ...(p.fonts.heading ? ["heading"] : [])]) {
    object(p.fonts[f], ["family", "style"], "font");
    if (!text(p.fonts[f].family) || !text(p.fonts[f].style))
      throw renderError("Explicit font family/style required");
  }
  object(p.roles, [...colorRoles, ...numericRoles], "roles");
  for (const role of [...colorRoles, ...numericRoles]) {
    const variable = model.variables.find((v) => v.name === p.roles[role]);
    if (
      !variable ||
      variable.resolvedType !== (colorRoles.includes(role) ? "COLOR" : "FLOAT")
    )
      throw renderError(`Unknown or mistyped presentation role: ${role}`);
  }
  if ([...colorRoles, ...numericRoles].some((k) => !text(p.roles[k])))
    throw renderError("Every presentation role must name a variable");
  for (const n of [p.width, p.sampleFontSize])
    if (!Number.isFinite(n) || n <= 0 || n > 10000)
      throw renderError("Invalid presentation size");
  if (!Array.isArray(p.frames) || !p.frames.length || p.frames.length > 100)
    throw renderError("Configure 1 to 100 frame groups");
  const ids = new Set(),
    targets = new Set(),
    coverage = new Set();
  const sectionIds = new Set(model.sections.map((s) => s.id)),
    modes = new Set(model.modes.map((m) => m.id));
  for (const f of p.frames) {
    object(
      f,
      ["id", "name", "description", "mode", "sections", "x", "y", "targetId"],
      "frame",
    );
    if (
      !text(f.id) ||
      ids.has(f.id) ||
      !text(f.name) ||
      typeof f.description !== "string" ||
      !modes.has(f.mode) ||
      !(f.targetId === null || text(f.targetId))
    )
      throw renderError("Invalid or duplicate frame");
    ids.add(f.id);
    if (f.targetId !== null) {
      if (targets.has(f.targetId)) throw renderError("Duplicate target frame");
      targets.add(f.targetId);
    }
    if (![f.x, f.y].every((n) => Number.isFinite(n) && Math.abs(n) <= 1000000))
      throw renderError("Invalid frame placement");
    if (!Array.isArray(f.sections) || !f.sections.length)
      throw renderError("Frame requires sections");
    for (const id of f.sections) {
      const key = JSON.stringify([f.mode, id]);
      if (!sectionIds.has(id) || coverage.has(key))
        throw renderError("Unknown or duplicate mode/section assignment");
      coverage.add(key);
    }
  }
  if (coverage.size !== model.sections.length * model.modes.length)
    throw renderError("Every section must be presented exactly once per mode");
  if (new Set(p.frames.map((f) => f.name)).size !== p.frames.length)
    throw renderError("Frame names must be unique");
  object(p.scales, Object.keys(p.scales ?? {}), "scales");
  for (const [id, n] of Object.entries(p.scales))
    if (
      !sectionIds.has(id) ||
      !["dimension", "duration"].includes(
        model.sections.find((s) => s.id === id)?.kind,
      ) ||
      !Number.isFinite(n) ||
      n <= 0 ||
      n > 100
    )
      throw renderError("Invalid explicit section scale");
}
