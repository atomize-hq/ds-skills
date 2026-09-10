export function foundationNodes(figma, context, p, mode, track) {
  const { variables, collection, modes } = context;
  const variable = (name) => variables.get(name);
  const value = (name) => variable(name).valuesByMode[modes.get(mode)];
  const bind = (node, field, name) =>
    node.setBoundVariable(field, variable(name));
  const num = (node, field, name) => {
    node[field] = value(name);
    bind(node, field, name);
  };
  const fill = (node, name, field = "fills") => {
    node[field] = [
      figma.variables.setBoundVariableForPaint(
        { type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 1 },
        "color",
        variable(name),
      ),
    ];
  };
  const frame = (name, dir = "VERTICAL") => {
    const f = track(figma.createFrame());
    f.name = name;
    f.layoutMode = dir;
    f.primaryAxisSizingMode = "AUTO";
    f.counterAxisSizingMode = "AUTO";
    f.fills = [];
    f.clipsContent = false;
    f.setExplicitVariableModeForCollection(collection, modes.get(mode));
    return f;
  };
  const text = (
    chars,
    {
      font = p.fonts.body,
      size = p.roles.fontSize,
      rawSize = null,
      color = p.roles.text,
      width = null,
    } = {},
  ) => {
    const t = track(figma.createText());
    t.fontName = font;
    t.characters = String(chars);
    if (rawSize !== null) t.fontSize = rawSize;
    else num(t, "fontSize", size);
    fill(t, color);
    t.textAutoResize = "WIDTH_AND_HEIGHT";
    if (width !== null) {
      t.resize(width, t.height);
      t.textAutoResize = "HEIGHT";
    }
    return t;
  };
  const rectangle = (width, height) => {
    const r = track(figma.createRectangle());
    r.resize(Math.max(0.01, width), Math.max(0.01, height));
    fill(r, p.roles.accent);
    return r;
  };
  const radius = (node, name) => {
    for (const f of [
      "topLeftRadius",
      "topRightRadius",
      "bottomLeftRadius",
      "bottomRightRadius",
    ])
      num(node, f, name);
  };
  const shell = (f) => {
    const root = frame(f.name);
    root.visible = false;
    num(root, "itemSpacing", p.roles.sectionGap);
    for (const side of ["Top", "Bottom", "Left", "Right"])
      num(root, `padding${side}`, p.roles.padding);
    fill(root, p.roles.background);
    root.appendChild(
      text(f.name, {
        size: p.roles.titleSize,
        font: p.fonts.heading ?? p.fonts.body,
      }),
    );
    root.appendChild(
      text(f.description, { color: p.roles.muted, width: p.width }),
    );
    return root;
  };
  return {
    variable,
    value,
    bind,
    num,
    fill,
    frame,
    text,
    rectangle,
    radius,
    shell,
  };
}
