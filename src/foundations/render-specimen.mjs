export function specimen(nodes, row, section, p, model, mode, counts) {
  const sample = row.samples[mode],
    kind = section.kind,
    scale = Object.prototype.hasOwnProperty.call(p.scales, section.id)
      ? p.scales[section.id]
      : 1;
  const { frame, text, rectangle, fill, bind, radius, num } = nodes;
  const numeric = (node, field, value) => {
    node[field] = value;
    if (sample.binding === "direct" && scale === 1)
      bind(node, field, row.variable);
  };
  let node;
  if (["font", "size", "weight", "leading", "tracking"].includes(kind)) {
    const font =
      kind === "font"
        ? { family: sample.rendered, style: p.fonts.body.style }
        : kind === "weight"
          ? { family: p.fonts.body.family, style: sample.rendered }
          : p.fonts.body;
    node = text("Aa Bb Cc 0123 · The quick brown fox jumps", {
      font,
      rawSize:
        kind === "size"
          ? sample.rendered
          : kind === "tracking"
            ? model.units.emReferencePx
            : p.sampleFontSize,
      width: kind === "leading" ? p.width / 2 : null,
    });
    if (kind === "font") bind(node, "fontFamily", row.variable);
    if (kind === "size" && sample.binding === "direct")
      bind(node, "fontSize", row.variable);
    if (kind === "leading")
      node.lineHeight = { unit: "PERCENT", value: sample.rendered };
    if (kind === "tracking")
      node.letterSpacing = { unit: "PIXELS", value: sample.rendered };
  } else if (kind === "value")
    node = text(String(sample.rendered), {
      font: p.fonts.code,
      color: p.roles.muted,
    });
  else if (kind === "shadow") {
    const room = section.shadowPadding;
    node = frame("shadow-stage");
    node.paddingLeft = node.paddingRight = room.x;
    node.paddingTop = room.top;
    node.paddingBottom = room.bottom;
    const card = rectangle(160, 56);
    fill(card, p.roles.background);
    radius(card, p.roles.cornerRadius);
    if (sample.rendered !== null) {
      card.effects = [sample.rendered];
      counts.shadows++;
    }
    node.appendChild(card);
  } else {
    node = rectangle(
      ["dimension", "duration"].includes(kind) ? sample.rendered * scale : 96,
      48,
    );
    if (kind === "color") fill(node, row.variable);
    else if (["dimension", "duration"].includes(kind)) {
      // rectangle() already resized it; native width has no property setter.
      if (sample.rendered > 0 && sample.binding === "direct" && scale === 1)
        bind(node, "width", row.variable);
    } else if (kind === "radius")
      for (const side of [
        "topLeftRadius",
        "topRightRadius",
        "bottomLeftRadius",
        "bottomRightRadius",
      ])
        numeric(node, side, sample.rendered);
    else if (kind === "border") {
      node.fills = [];
      fill(node, p.roles.border, "strokes");
      numeric(node, "strokeWeight", sample.rendered);
    } else if (kind === "opacity") node.opacity = sample.rendered;
    if (kind !== "radius") radius(node, p.roles.cornerRadius);
  }
  const result = frame(`specimen/${row.variable}`);
  result.appendChild(node);
  if (scale !== 1 && ["dimension", "duration"].includes(kind))
    result.appendChild(
      text(`Display scale × ${scale}; static geometry`, {
        color: p.roles.muted,
      }),
    );
  if (sample.ratio !== undefined)
    result.appendChild(
      text(
        `${sample.ratio.toFixed(2)} · ${sample.verdict} · vs ${sample.against}`,
        { color: p.roles.muted },
      ),
    );
  if (sample.binding === "derived")
    result.appendChild(
      text(sample.note, { color: p.roles.muted, width: p.width / 2 }),
    );
  num(result, "itemSpacing", p.roles.rowGap);
  counts.specimens++;
  return result;
}
