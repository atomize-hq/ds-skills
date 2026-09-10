import { expect, it } from "vitest";
import { renderFixture } from "./render-fixture.mjs";
import { renderFoundations } from "./render-runtime.mjs";
import { markerKey } from "./render-preflight.mjs";
async function initial(f) {
  const result = await renderFoundations(f.figma, f.model, f.p);
  expect(result.ok).toBe(true);
  for (const item of result.frames)
    f.p.frames.find((x) => x.id === item.id).targetId = item.nodeId;
  return result;
}
it.each([{}, { root: "workspace", modes: ["paper", "terminal"] }])(
  "renders every selected mode/specimen with explicit bindings %j",
  async (options) => {
    const f = renderFixture(options),
      result = await initial(f);
    expect(result.counts.specimens).toBe(16 * f.model.modes.length);
    expect(result.counts.shadows).toBe(f.model.modes.length);
    expect(f.page.children).toHaveLength(f.p.frames.length + 1);
    expect(f.unrelated.removed).toBe(false);
    expect(f.figma.currentPage.id).toBe("other");
    const shapes = [...f.nodes.values()].filter(
      (n) => n.type === "RECTANGLE" && !n.removed,
    );
    expect(shapes.some((n) => Object.hasOwn(n.bindings, "width"))).toBe(true);
    expect(
      shapes.some(
        (n) => n.opacity === 0.5 && !Object.hasOwn(n.bindings, "opacity"),
      ),
    ).toBe(true);
    expect([...f.nodes.values()].some((n) => n.lineHeight?.value === 150)).toBe(
      true,
    );
    expect(
      [...f.nodes.values()].some(
        (n) => n.letterSpacing?.value > 1.19 && n.letterSpacing?.value < 1.21,
      ),
    ).toBe(true);
  },
);
it("preserves stable root IDs on reviewed replacement and deletes only old generated bodies", async () => {
  const f = renderFixture(),
    first = await initial(f),
    second = await renderFoundations(f.figma, f.model, f.p);
  expect(second.ok).toBe(true);
  expect(second.frames.map((x) => x.nodeId)).toEqual(
    first.frames.map((x) => x.nodeId),
  );
  for (const item of first.frames)
    expect(f.nodes.get(item.bodyId).removed).toBe(true);
  expect(f.unrelated.removed).toBe(false);
  expect(f.page.children).toHaveLength(4);
});
it.each([
  "variable missing",
  "ambiguous variable",
  "wrong collection",
  "wrong value",
  "alias value",
  "wrong mode",
  "missing font",
  "unowned frame",
  "unexpected child",
  "mode omission",
  "unknown role",
])("refuses %s before creating or removing nodes", async (mode) => {
  const f = renderFixture();
  if (mode === "variable missing") f.variables.pop();
  if (mode === "ambiguous variable")
    f.variables.push({ ...f.variables[0], id: "duplicate" });
  if (mode === "wrong collection") f.p.collectionId = "different";
  if (mode === "wrong value") f.variables[0].valuesByMode["mode-0"] = "wrong";
  if (mode === "alias value")
    f.variables[0].valuesByMode["mode-0"] = {
      type: "VARIABLE_ALIAS",
      id: "unknown",
    };
  if (mode === "wrong mode") f.collection.modes[0].name = "unknown";
  if (mode === "missing font")
    f.hooks.font = () => {
      throw new Error("Font unavailable");
    };
  if (mode === "unowned frame") {
    f.p.frames[0].targetId = "unrelated";
    f.p.frames[0].name = f.unrelated.name;
  }
  if (mode === "unexpected child") {
    await initial(f);
    f.nodes.get(f.p.frames[0].targetId).appendChild(new f.Node("RECTANGLE"));
  }
  if (mode === "mode omission") f.p.frames.pop();
  if (mode === "unknown role") f.p.roles.background = "absent";
  const before = f.calls.created,
    removed = f.calls.removed.length;
  const r = await renderFoundations(f.figma, f.model, f.p);
  expect(r.ok).toBe(false);
  expect(r.phase).toBe("preflight");
  expect(f.calls.created).toBe(before);
  expect(f.calls.removed).toHaveLength(removed);
});
it("does not replace an owned frame without explicit target ID", async () => {
  const f = renderFixture();
  await initial(f);
  f.p.frames[0].targetId = null;
  const r = await renderFoundations(f.figma, f.model, f.p);
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/existing name/);
});
it("keeps old frames intact when specimen construction fails", async () => {
  const f = renderFixture(),
    first = await initial(f);
  let seen = 0;
  f.hooks.create = (type) => {
    if (type === "TEXT" && ++seen === 30)
      throw new Error("Injected preparation failure");
  };
  const r = await renderFoundations(f.figma, f.model, f.p);
  expect(r).toMatchObject({
    ok: false,
    phase: "prepare",
    committed: false,
    rollbackErrors: [],
  });
  for (const item of first.frames)
    expect(f.nodes.get(item.nodeId).children.map((n) => n.id)).toEqual([
      item.bodyId,
    ]);
  expect(f.page.children).toHaveLength(4);
});
it("rolls back earlier swaps when a later commit fails", async () => {
  const f = renderFixture(),
    first = await initial(f);
  let once = true;
  f.hooks.marker = (node) => {
    if (node.id === first.frames[1].nodeId && once) {
      once = false;
      throw new Error("Injected marker failure");
    }
  };
  const r = await renderFoundations(f.figma, f.model, f.p);
  expect(r).toMatchObject({
    ok: false,
    phase: "commit",
    committed: false,
    rollbackErrors: [],
  });
  for (const item of first.frames) {
    expect(f.nodes.get(item.nodeId).children.map((n) => n.id)).toEqual([
      item.bodyId,
    ]);
    expect(
      JSON.parse(f.nodes.get(item.nodeId).getPluginData(markerKey)).bodyId,
    ).toBe(item.bodyId);
  }
  expect(f.page.children).toHaveLength(4);
});
it("retains original content for recovery if restoration itself fails", async () => {
  const f = renderFixture(),
    first = await initial(f);
  let failed = false;
  f.hooks.marker = (node) => {
    if (node.id === first.frames[1].nodeId && !failed) {
      failed = true;
      throw new Error("Commit failure");
    }
  };
  f.hooks.append = (parent, child) => {
    if (
      failed &&
      child.id === first.frames[0].bodyId &&
      parent.id === first.frames[0].nodeId
    )
      throw new Error("Restoration failure");
  };
  const r = await renderFoundations(f.figma, f.model, f.p);
  expect(r.ok).toBe(false);
  expect(r.rollbackErrors.length).toBeGreaterThan(0);
  expect(r.recoveryNodes.length).toBeGreaterThan(0);
  expect(f.nodes.get(first.frames[0].bodyId).removed).toBe(false);
  expect(f.unrelated.removed).toBe(false);
});
it("rejects variable drift during font/page awaits before creating nodes", async () => {
  const f = renderFixture();
  f.hooks.page = () => {
    f.variables[0].valuesByMode["mode-0"] = "changed";
  };
  const r = await renderFoundations(f.figma, f.model, f.p);
  expect(r.ok).toBe(false);
  expect(f.calls.created).toBe(0);
});

it("reports committed output plus recovery IDs when old-content cleanup fails", async () => {
  const f = renderFixture(),
    first = await initial(f);
  f.hooks.remove = (n) => {
    if (n.id === first.frames[0].bodyId) throw new Error("Cleanup failure");
  };
  const r = await renderFoundations(f.figma, f.model, f.p);
  expect(r.ok).toBe(false);
  expect(r.committed).toBe(true);
  expect(r.cleanupErrors.length).toBeGreaterThan(0);
  expect(r.cleanupNodes.length).toBeGreaterThan(0);
  expect(f.nodes.get(first.frames[0].bodyId).removed).toBe(false);
  expect(f.nodes.get(first.frames[0].nodeId).children[0].id).not.toBe(
    first.frames[0].bodyId,
  );
});
it("rejects a scale on a non-geometric specimen rather than ignoring it", async () => {
  const f = renderFixture();
  f.p.scales.color = 2;
  expect((await renderFoundations(f.figma, f.model, f.p)).ok).toBe(false);
  expect(f.calls.created).toBe(0);
});

it("uses the publication checker float32 comparison instead of rejecting stored precision", async () => {
  const f = renderFixture();
  for (const v of f.variables)
    for (const [mode, value] of Object.entries(v.valuesByMode))
      if (typeof value === "number") v.valuesByMode[mode] = Math.fround(value);
  const r = await renderFoundations(f.figma, f.model, f.p);
  expect(r.ok).toBe(true);
});
it("loads explicitly configured heading fonts before mutation", async () => {
  const f = renderFixture();
  f.p.fonts.heading = { family: "Inter", style: "SemiBold" };
  const r = await renderFoundations(f.figma, f.model, f.p);
  expect(r.ok).toBe(true);
  expect(f.calls.fonts).toContainEqual(f.p.fonts.heading);
  expect(
    [...f.nodes.values()].some((n) => n.fontName?.style === "SemiBold"),
  ).toBe(true);
});
