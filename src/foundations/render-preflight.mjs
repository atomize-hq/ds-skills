import { valuesEqual as equal } from "../drift.js";
import {
  renderError,
  validatePresentation,
  colorRoles,
  numericRoles,
} from "./render-config.mjs";
export const markerKey = "ds-skills-foundations";
export async function preflightFoundations(figma, model, p) {
  validatePresentation(model, p);
  const page = await figma.getNodeByIdAsync(p.pageId);
  if (!page || page.type !== "PAGE")
    throw renderError("Configured page does not exist");
  await page.loadAsync();
  const collection = (
    await figma.variables.getLocalVariableCollectionsAsync()
  ).find((c) => c.id === p.collectionId);
  if (!collection)
    throw renderError("Configured local variable collection is unavailable");
  const modes = new Map();
  for (const m of model.modes) {
    const matches = collection.modes.filter((x) => x.name === m.id);
    if (matches.length !== 1)
      throw renderError(`Missing or ambiguous published mode: ${m.id}`);
    modes.set(m.id, matches[0].modeId);
  }
  const local = await figma.variables.getLocalVariablesAsync(),
    variables = new Map();
  for (const expected of model.variables) {
    const matches = local.filter(
      (v) =>
        v.variableCollectionId === collection.id && v.name === expected.name,
    );
    if (
      matches.length !== 1 ||
      matches[0].resolvedType !== expected.resolvedType
    )
      throw renderError(
        `Missing, ambiguous or mistyped variable: ${expected.name}`,
      );
    const v = matches[0];
    for (const m of model.modes)
      if (!equal(v.valuesByMode[modes.get(m.id)], expected.valuesByMode[m.id]))
        throw renderError(`Published value mismatch: ${expected.name}/${m.id}`);
    variables.set(v.name, v);
  }
  for (const role of [...colorRoles, ...numericRoles]) {
    const v = variables.get(p.roles[role]);
    if (
      !v ||
      v.resolvedType !== (colorRoles.includes(role) ? "COLOR" : "FLOAT")
    )
      throw renderError(`Invalid presentation variable role: ${role}`);
    if (numericRoles.includes(role))
      for (const m of modes.values()) {
        const n = v.valuesByMode[m];
        if (
          !Number.isFinite(n) ||
          n < 0 ||
          n > 10000 ||
          (["fontSize", "titleSize", "sectionSize"].includes(role) && n === 0)
        )
          throw renderError(`Invalid presentation numeric value: ${role}`);
      }
  }
  const targets = new Map();
  for (const f of p.frames) {
    const matches = page.children.filter((n) => n.name === f.name);
    if (f.targetId === null) {
      if (matches.length)
        throw renderError(
          `Refusing existing name without explicit owned target: ${f.name}`,
        );
      continue;
    }
    const target = await figma.getNodeByIdAsync(f.targetId);
    if (
      !target ||
      target.type !== "FRAME" ||
      target.parent?.id !== page.id ||
      target.name !== f.name
    )
      throw renderError(
        "Replacement target must be the exact named frame on configured page",
      );
    let mark;
    try {
      mark = JSON.parse(target.getPluginData(markerKey));
    } catch {
      throw renderError("Replacement target has no renderer ownership record");
    }
    if (
      mark.rendererVersion !== "1" ||
      mark.ownerId !== p.ownerId ||
      mark.frameId !== f.id
    )
      throw renderError("Replacement target belongs to another owner/frame");
    if (matches.length !== 1)
      throw renderError("Ambiguous existing frame name");
    targets.set(f.id, target);
  }
  const fonts = new Map();
  const add = (f) => fonts.set(JSON.stringify(f), f);
  add(p.fonts.body);
  add(p.fonts.code);
  if (p.fonts.heading) add(p.fonts.heading);
  for (const section of model.sections)
    for (const row of section.rows)
      for (const sample of Object.values(row.samples)) {
        if (section.kind === "font")
          add({ family: sample.rendered, style: p.fonts.body.style });
        if (section.kind === "weight")
          add({ family: p.fonts.body.family, style: sample.rendered });
        if (section.kind === "size" && sample.rendered <= 0)
          throw renderError("Font size specimens must be positive");
        if (
          ["dimension", "duration"].includes(section.kind) &&
          sample.rendered *
            (Object.prototype.hasOwnProperty.call(p.scales, section.id)
              ? p.scales[section.id]
              : 1) >
            100000
        )
          throw renderError("Scaled specimen exceeds geometry limits");
        if (
          typeof sample.rendered === "number" &&
          (!Number.isFinite(sample.rendered) ||
            Math.abs(sample.rendered) > 100000)
        )
          throw renderError("Specimen geometry exceeds renderer bounds");
      }
  for (const font of fonts.values()) await figma.loadFontAsync(font);
  const verify = () => {
    for (const m of model.modes)
      if (
        collection.modes.filter(
          (x) => x.name === m.id && x.modeId === modes.get(m.id),
        ).length !== 1
      )
        throw renderError("Published modes changed during preflight");
    for (const expected of model.variables) {
      const v = variables.get(expected.name);
      for (const m of model.modes)
        if (
          v.name !== expected.name ||
          v.variableCollectionId !== collection.id ||
          v.resolvedType !== expected.resolvedType ||
          !equal(v.valuesByMode[modes.get(m.id)], expected.valuesByMode[m.id])
        )
          throw renderError("Published variables changed during preflight");
    }
  };
  verify();
  return { page, collection, modes, variables, targets, verify };
}
