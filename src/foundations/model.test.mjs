import { expect, it } from "vitest";
import { buildFoundationModel } from "./model.mjs";
import { contrast, shadow } from "./values.mjs";
import { fixture, leaf } from "./fixture.mjs";
it.each([
  ["base", ["night", "day", "contrast"]],
  ["workspace", ["paper", "terminal"]],
])(
  "derives all specimen kinds for %s without a fixed token namespace or theme pair",
  (root, modes) => {
    const f = fixture(root, modes),
      result = buildFoundationModel(f.document, f.config);
    expect(result.sections).toHaveLength(13);
    expect(result.modes.map((m) => m.id)).toEqual(modes);
    const sample = (kind) =>
      result.sections.find((s) => s.kind === kind).rows[0].samples[modes[0]];
    expect(sample("size")).toMatchObject({ rendered: 16, binding: "derived" });
    expect(sample("tracking")).toMatchObject({
      binding: "derived",
    });
    expect(sample("tracking").rendered).toBeCloseTo(1.2);
    expect(sample("leading")).toMatchObject({
      rendered: 150,
      binding: "derived",
    });
    expect(sample("opacity")).toMatchObject({
      rendered: 0.5,
      binding: "derived",
    });
    expect(sample("duration")).toMatchObject({
      rendered: 200,
      binding: "direct",
    });
    expect(sample("weight")).toMatchObject({
      rendered: "Regular",
      binding: "derived",
    });
    expect(
      result.sections.find((s) => s.kind === "shadow").shadowPadding,
    ).toEqual({ x: 6, top: 8, bottom: 8 });
    expect(
      result.sections
        .find((s) => s.kind === "color")
        .rows.find((r) => r.id.endsWith(".ink")).samples[modes[1]],
    ).toMatchObject({ ratio: 21, verdict: "pass" });
    expect(result.scope).toBe("foundation-specimen-data");
  },
);
it("does not mutate input and records changed values/configuration in identity", () => {
  const f = fixture(),
    before = JSON.stringify(f),
    a = buildFoundationModel(f.document, f.config);
  expect(JSON.stringify(f)).toBe(before);
  f.config.sections[0].description = "Reviewed copy";
  expect(buildFoundationModel(f.document, f.config).inputDigest).not.toBe(
    a.inputDigest,
  );
});
it.each([
  "default mismatch",
  "missing mode",
  "extra mode",
  "unknown override",
  "changed type",
  "duplicate normalized name",
  "missing type",
  "nonfinite",
  "bad segment",
  "empty section",
  "wrong kind",
  "missing pair target",
  "unused pair",
  "missing style",
  "negative size",
  "negative duration",
  "bad opacity",
  "bad leading",
  "unknown field",
])("refuses %s instead of producing plausible specimen data", (mode) => {
  const f = fixture();
  if (mode === "default mismatch")
    f.document.$extensions["org.example"].themeId = "other";
  if (mode === "missing mode") f.config.modes.pop();
  if (mode === "extra mode")
    f.config.modes.push({ id: "other", label: "other" });
  if (mode === "unknown override")
    f.document.$themeOverrides.day.base.new = leaf("number", 1);
  if (mode === "changed type")
    f.document.$themeOverrides.day.base.colors.ink = leaf("number", 1);
  if (mode === "duplicate normalized name") {
    f.tokens["foo{bar"] = leaf("number", 1);
    f.tokens["foo-bar"] = leaf("number", 2);
  }
  if (mode === "missing type") delete f.tokens.sizes.body.$type;
  if (mode === "nonfinite") f.tokens.opacity.muted.$value = Infinity;
  if (mode === "bad segment") f.tokens["a.b"] = leaf("number", 1);
  if (mode === "empty section") f.config.sections[0].prefix = "unknown";
  if (mode === "wrong kind") f.config.sections[1].prefix = "base.colors";
  if (mode === "missing pair target") f.config.sections[0].against = "unknown";
  if (mode === "unused pair")
    f.config.sections[0].pairs.unknown = "base.colors.ink";
  if (mode === "missing style")
    f.config.sections.find((s) => s.kind === "weight").weightStyles = {
      700: "Bold",
    };
  if (mode === "negative size") f.tokens.sizes.body.$value = "-1px";
  if (mode === "negative duration") f.tokens.motion.slow.$value = "-1ms";
  if (mode === "bad opacity") f.tokens.opacity.muted.$value = 2;
  if (mode === "bad leading") f.tokens.leading.body.$value = 0;
  if (mode === "unknown field") f.config.skipValidation = true;
  expect(() => buildFoundationModel(f.document, f.config)).toThrow();
});
it("keeps no-metric sections informational and uses explicit pair grounds", () => {
  const f = fixture();
  const s = f.config.sections[0];
  s.metric = "none";
  s.against = null;
  expect(
    buildFoundationModel(f.document, f.config).sections[0].rows[0].samples
      .night,
  ).not.toHaveProperty("ratio");
  s.metric = "info";
  s.against = "base.colors.ink";
  s.pairs = { "base.colors.ink": "base.colors.ground" };
  const row = buildFoundationModel(f.document, f.config).sections[0].rows.find(
    (r) => r.id === "base.colors.ink",
  );
  expect(row.samples.night).toMatchObject({
    ratio: 21,
    verdict: "ratio-only",
    against: "base/colors/ground",
  });
});
it("composites foreground alpha but refuses ambiguous transparent grounds", () => {
  expect(contrast("#ffffff80", "#000000")).toBeLessThan(6);
  expect(contrast("#ffffff80", "#000000")).toBeGreaterThan(5);
  expect(() => contrast("#ffffff", "#00000080")).toThrow(/opaque/);
  expect(() => contrast("#fffff", "#000000")).toThrow();
});
it.each([
  "not a shadow",
  "1 2 3 #000000",
  "0 0 -1px #000000",
  "1px 1px 2px #000000, 0 0 0 #ffffff",
  "inset 0 0 0 #000000",
  "0 0 1px rgb(999, 0, 0)",
])("does not silently skip unsupported shadow %s", (value) =>
  expect(() => shadow(value)).toThrow(),
);
it("does not confuse direct members with descendants", () => {
  const f = fixture();
  f.tokens.space.nested = { large: leaf("dimension", "20px") };
  let r = buildFoundationModel(f.document, f.config);
  expect(r.sections.find((s) => s.kind === "dimension").rows).toHaveLength(2);
  f.config.sections.find((s) => s.kind === "dimension").include = "descendants";
  r = buildFoundationModel(f.document, f.config);
  expect(r.sections.find((s) => s.kind === "dimension").rows).toHaveLength(3);
});

it("preserves token-specific foreground contrast policy", () => {
  const f = fixture();
  const s = f.config.sections[0];
  s.metric = "info";
  s.metrics = { "base.colors.ink": "text" };
  const rows = buildFoundationModel(f.document, f.config).sections[0].rows;
  expect(
    rows.find((r) => r.id === "base.colors.ink").samples.night.verdict,
  ).toBe("pass");
  expect(
    rows.find((r) => r.id === "base.colors.ground").samples.night.verdict,
  ).toBe("ratio-only");
});

it("keeps arbitrary theme IDs as own data properties", () => {
  const f = fixture("base", ["__proto__", "constructor"]),
    m = buildFoundationModel(f.document, f.config);
  const v = m.variables.find((v) => v.name === "base/colors/ink");
  expect(Object.hasOwn(v.valuesByMode, "__proto__")).toBe(true);
  expect(v.valuesByMode["__proto__"].r).toBe(1);
});
it("refuses overflow in derived values and CSS shadow numbers", () => {
  const f = fixture();
  f.tokens.leading.body.$value = 1e308;
  expect(() => buildFoundationModel(f.document, f.config)).toThrow(/Nonfinite/);
  expect(() => shadow(`0 0 ${"9".repeat(400)}px #000000`)).toThrow();
});
