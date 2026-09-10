import { expect, it } from "vitest";
import { renderFixture } from "./render-fixture.mjs";
import { renderFoundations } from "./render-runtime.mjs";

it("models native dimensions as getter-only and changes them through resize", () => {
  const f = renderFixture(),
    node = new f.Node("RECTANGLE");
  for (const field of ["width", "height"])
    expect(() => (node[field] = 42)).toThrow(TypeError);
  node.resize(42, 24);
  expect([node.width, node.height]).toEqual([42, 24]);
});

it.each([1, 0.6])(
  "resizes specimens and preserves binding policy at scale %s",
  async (scale) => {
    const f = renderFixture();
    f.p.scales.dimension = scale;
    f.p.scales.duration = scale;
    const result = await renderFoundations(f.figma, f.model, f.p);
    expect(result.ok, result.error).toBe(true);
    for (const [name, value, direct] of [
      ["base/space/small", 4, true],
      ["base/motion/slow", 200, true],
      ["base/space/zero", 0, false],
    ]) {
      const specimens = [...f.nodes.values()].filter(
        (n) => n.name === `specimen/${name}` && !n.removed,
      );
      expect(specimens).toHaveLength(f.model.modes.length);
      for (const specimen of specimens) {
        const rectangle = specimen.children[0];
        expect(rectangle.width).toBeCloseTo(Math.max(0.01, value * scale));
        expect(rectangle.height).toBe(48);
        expect(rectangle.bindings.width).toBe(
          direct && scale === 1
            ? f.variables.find((v) => v.name === name).id
            : undefined,
        );
      }
    }
  },
);

it("preserves old bodies when resize fails during replacement preparation", async () => {
  const f = renderFixture(),
    first = await renderFoundations(f.figma, f.model, f.p);
  expect(first.ok).toBe(true);
  for (const frame of first.frames)
    f.p.frames.find((item) => item.id === frame.id).targetId = frame.nodeId;
  f.Node.prototype.resize = () => {
    throw new Error("Injected resize failure");
  };
  const result = await renderFoundations(f.figma, f.model, f.p);
  expect(result).toMatchObject({
    ok: false,
    phase: "prepare",
    committed: false,
    rollbackErrors: [],
    recoveryNodes: [],
  });
  for (const frame of first.frames)
    expect(f.nodes.get(frame.nodeId).children.map((n) => n.id)).toEqual([
      frame.bodyId,
    ]);
  expect(f.page.children).toHaveLength(first.frames.length + 1);
  expect(f.unrelated.removed).toBe(false);
});
