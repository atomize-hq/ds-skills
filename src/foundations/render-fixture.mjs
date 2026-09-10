import { fixture } from "./fixture.mjs";
import { buildFoundationModel } from "./model.mjs";
export function renderFixture(options = {}) {
  const f = fixture(options.root, options.modes),
    model = buildFoundationModel(f.document, f.config);
  const p = {
    rendererVersion: "1",
    pageId: "page",
    collectionId: "collection",
    ownerId: "test-owner",
    fonts: {
      body: { family: "Inter", style: "Regular" },
      code: { family: "Mono", style: "Regular" },
    },
    roles: {},
    width: 1000,
    sampleFontSize: 14,
    scales: {},
    frames: model.modes.map((m, i) => ({
      id: `group-${m.id}`,
      name: `Reference ${m.label}`,
      description: "Configured project specimens",
      mode: m.id,
      sections: model.sections.map((s) => s.id),
      x: i * 1500,
      y: 0,
      targetId: null,
    })),
  };
  const root = options.root ?? "base";
  for (const role of ["background", "text", "muted", "accent", "border"])
    p.roles[role] =
      `${root}/colors/${role === "background" ? "ground" : "ink"}`;
  for (const role of ["fontSize", "titleSize", "sectionSize"])
    p.roles[role] = `${root}/sizes/body`;
  for (const role of ["rowGap", "sectionGap", "padding"])
    p.roles[role] = `${root}/space/small`;
  p.roles.cornerRadius = `${root}/radii/small`;
  let serial = 0;
  const nodes = new Map(),
    calls = { created: 0, fonts: [], removed: [] },
    hooks = {};
  class Node {
    constructor(type, id) {
      this.id = id ?? `node-${++serial}`;
      this.type = type;
      this.name = "";
      this.children = [];
      this.parent = null;
      this.visible = true;
      this.removed = false;
      this.x = 0;
      this.y = 0;
      this._width = 100;
      this._height = 100;
      this.data = {};
      this.bindings = {};
      this.explicitVariableModes = {};
      nodes.set(this.id, this);
    }
    get width() {
      return this._width;
    }
    get height() {
      return this._height;
    }
    appendChild(child) {
      hooks.append?.(this, child);
      if (child.parent)
        child.parent.children = child.parent.children.filter(
          (c) => c !== child,
        );
      child.parent = this;
      this.children.push(child);
    }
    remove() {
      hooks.remove?.(this);
      for (const c of [...this.children]) c.remove();
      if (this.parent)
        this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = null;
      this.removed = true;
      calls.removed.push(this.id);
    }
    resize(w, h) {
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0)
        throw new Error("Invalid geometry");
      this._width = w;
      this._height = h;
    }
    setBoundVariable(field, v) {
      if (!v) throw new Error("Missing variable");
      this.bindings[field] = v.id;
    }
    setExplicitVariableModeForCollection(c, m) {
      if (!c.modes.some((x) => x.modeId === m)) throw new Error("Unknown mode");
      this.explicitVariableModes[c.id] = m;
    }
    setPluginData(k, v) {
      hooks.marker?.(this, k, v);
      this.data[k] = v;
    }
    getPluginData(k) {
      return this.data[k] ?? "";
    }
    async loadAsync() {}
  }
  const page = new Node("PAGE", "page"),
    other = new Node("PAGE", "other"),
    unrelated = new Node("FRAME", "unrelated");
  page.appendChild(unrelated);
  unrelated.name = "User content";
  const collection = {
    id: "collection",
    modes: model.modes.map((m, i) => ({ name: m.id, modeId: `mode-${i}` })),
  };
  const variables = model.variables.map((v, i) => ({
    id: `variable-${i}`,
    name: v.name,
    resolvedType: v.resolvedType,
    variableCollectionId: collection.id,
    valuesByMode: Object.fromEntries(
      model.modes.map((m, i) => [
        `mode-${i}`,
        JSON.parse(JSON.stringify(v.valuesByMode[m.id])),
      ]),
    ),
  }));
  const figma = {
    currentPage: other,
    getNodeByIdAsync: async (id) => nodes.get(id),
    setCurrentPageAsync: async (p) => {
      figma.currentPage = p;
      await hooks.page?.();
    },
    loadFontAsync: async (f) => {
      calls.fonts.push(f);
      await hooks.font?.(f);
    },
    variables: {
      getLocalVariablesAsync: async () => variables,
      getLocalVariableCollectionsAsync: async () => [collection],
      setBoundVariableForPaint: (paint, _field, v) => ({
        ...paint,
        boundVariables: { color: { type: "VARIABLE_ALIAS", id: v.id } },
      }),
    },
  };
  for (const [method, type] of [
    ["createFrame", "FRAME"],
    ["createText", "TEXT"],
    ["createRectangle", "RECTANGLE"],
  ])
    figma[method] = () => {
      hooks.create?.(type);
      calls.created++;
      const n = new Node(type);
      figma.currentPage.appendChild(n);
      return n;
    };
  return {
    model,
    artifact: f.document,
    modelConfig: f.config,
    p,
    figma,
    nodes,
    page,
    other,
    unrelated,
    variables,
    collection,
    calls,
    hooks,
    Node,
  };
}
