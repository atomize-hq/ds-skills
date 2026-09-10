import { flattenTokenDocument } from "../token-mapping.js";
export const foundationError = (message) =>
  new Error(`FOUNDATIONS_INPUT: ${message}`);
export function color(value) {
  try {
    return flattenTokenDocument({ value: { $type: "color", $value: value } })[0]
      .value;
  } catch (error) {
    throw foundationError(error.message);
  }
}
export function contrast(foreground, background) {
  const fg = color(foreground),
    bg = color(background);
  if (bg.a !== 1)
    throw foundationError(
      "Contrast background must be opaque; configure its actual composited ground",
    );
  const luminance = (c) =>
    [c.r, c.g, c.b]
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
      .reduce((n, x, i) => n + x * [0.2126, 0.7152, 0.0722][i], 0);
  const blended = {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
  };
  const a = luminance(blended),
    b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
export function dimension(value, { rootFontPx, emReferencePx }) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const m =
    typeof value === "string" && /^(-?\d+(?:\.\d+)?)(px|rem|em)?$/.exec(value);
  if (!m)
    throw foundationError(
      "Specimen dimensions require finite numbers or px/rem/em lengths",
    );
  const n =
    Number(m[1]) *
    (m[2] === "rem" ? rootFontPx : m[2] === "em" ? emReferencePx : 1);
  if (!Number.isFinite(n))
    throw foundationError("Dimension cannot be resolved");
  return n;
}
export function shadow(value) {
  if (value === "none") return null;
  const number = "(-?\\d+(?:\\.\\d+)?)";
  const m =
    typeof value === "string" &&
    new RegExp(
      `^${number}(?:px)?\\s+${number}(?:px)?\\s+${number}(?:px)?(?:\\s+${number}(?:px)?)?\\s+(rgba?\\([^)]*\\)|#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?)$`,
    ).exec(value.trim());
  if (
    !m ||
    [m[1], m[2], m[3], m[4] ?? 0].some((v) => !Number.isFinite(Number(v))) ||
    Number(m[3]) < 0
  )
    throw foundationError("Unsupported single CSS drop-shadow specimen");
  if (
    value
      .trim()
      .slice(0, value.trim().indexOf(m[5]))
      .trim()
      .split(/\s+/)
      .some((x) => !x.endsWith("px") && Number(x) !== 0)
  )
    throw foundationError("Only zero CSS shadow lengths may be unitless");
  return {
    type: "DROP_SHADOW",
    offset: { x: Number(m[1]), y: Number(m[2]) },
    radius: Number(m[3]),
    spread: m[4] === undefined ? 0 : Number(m[4]),
    color: color(m[5]),
    visible: true,
    blendMode: "NORMAL",
  };
}
export function shadowRoom(effects) {
  const m = (f) => Math.ceil(Math.max(0, ...effects.filter(Boolean).map(f)));
  const y = Math.max(
    m((e) => e.radius + e.spread - e.offset.y),
    m((e) => e.radius + e.spread + e.offset.y),
  );
  return {
    x: m((e) => e.radius + e.spread + Math.abs(e.offset.x)),
    top: y,
    bottom: y,
  };
}
