import { preflightFoundations, markerKey } from "./render-preflight.mjs";
import { foundationNodes } from "./render-nodes.mjs";
import { specimen } from "./render-specimen.mjs";
import { renderError } from "./render-config.mjs";
export async function renderFoundations(figma, model, p) {
  let phase = "preflight";
  const originalBodies = [];
  const recoveryNodes = [];
  const created = [],
    staged = [],
    changed = [],
    rollbackErrors = [];
  const track = (node) => {
    created.push(node);
    return node;
  };
  const safe = (fn) => {
    try {
      fn();
    } catch (e) {
      rollbackErrors.push(String(e.message ?? e));
    }
  };
  let oldPage,
    committed = false;
  try {
    const context = await preflightFoundations(figma, model, p);
    const originals = new Map();
    for (const [id, target] of context.targets) {
      const marker = JSON.parse(target.getPluginData(markerKey));
      if (
        target.children.length !== 1 ||
        target.children[0].id !== marker.bodyId
      )
        throw renderError(
          "Owned frame contains unexpected content; refusing replacement",
        );
      originalBodies.push(target.children[0]);
      originals.set(id, {
        target,
        body: target.children[0],
        marker: target.getPluginData(markerKey),
        x: target.x,
        y: target.y,
      });
    }
    oldPage = figma.currentPage;
    await figma.setCurrentPageAsync(context.page);
    // Page/font loading was the last await. Prepare and swap synchronously so no
    // asynchronous local continuation silently changes our own target snapshot.
    context.verify();
    for (const o of originals.values())
      if (
        o.target.children.length !== 1 ||
        o.target.children[0].id !== o.body.id ||
        o.target.getPluginData(markerKey) !== o.marker
      )
        throw renderError("Target changed during preflight");
    phase = "prepare";
    const counts = { specimens: 0, shadows: 0 };
    for (const f of p.frames) {
      const nodes = foundationNodes(figma, context, p, f.mode, track),
        body = nodes.shell(f);
      for (const id of f.sections) {
        const section = model.sections.find((s) => s.id === id),
          group = nodes.frame(`section/${id}`);
        nodes.num(group, "itemSpacing", p.roles.rowGap);
        group.appendChild(
          nodes.text(section.label, {
            size: p.roles.sectionSize,
            font: p.fonts.heading ?? p.fonts.body,
          }),
        );
        group.appendChild(
          nodes.text(section.description, {
            color: p.roles.muted,
            width: p.width,
          }),
        );
        for (const row of section.rows) {
          const line = nodes.frame(row.variable, "HORIZONTAL");
          nodes.num(line, "itemSpacing", p.roles.rowGap);
          const meta = nodes.frame("metadata");
          meta.appendChild(nodes.text(row.variable));
          meta.appendChild(
            nodes.text(String(row.samples[f.mode].value), {
              font: p.fonts.code,
              color: p.roles.muted,
              width: p.width / 3,
            }),
          );
          line.appendChild(meta);
          line.appendChild(
            specimen(nodes, row, section, p, model, f.mode, counts),
          );
          group.appendChild(line);
        }
        body.appendChild(group);
      }
      let target = context.targets.get(f.id);
      if (!target) {
        target = nodes.frame(f.name);
        target.visible = false;
      }
      staged.push({ f, body, target, original: originals.get(f.id) });
    }
    const expected = model.sections.reduce(
      (n, s) => n + s.rows.length * model.modes.length,
      0,
    );
    const shadows = model.sections
      .filter((s) => s.kind === "shadow")
      .reduce(
        (n, s) =>
          n +
          s.rows.reduce(
            (v, r) =>
              v +
              Object.values(r.samples).filter((x) => x.rendered !== null)
                .length,
            0,
          ),
        0,
      );
    if (counts.specimens !== expected || counts.shadows !== shadows)
      throw renderError("Incomplete specimen/effect preparation");
    phase = "commit";
    for (const item of staged) {
      changed.push(item);
      const { f, body, target, original } = item;
      if (original) {
        const parking = track(figma.createFrame());
        parking.visible = false;
        parking.name = "ds-skills temporary rollback";
        parking.appendChild(original.body);
      }
      target.appendChild(body);
      body.visible = true;
      target.x = f.x;
      target.y = f.y;
      target.setPluginData(
        markerKey,
        JSON.stringify({
          rendererVersion: "1",
          ownerId: p.ownerId,
          frameId: f.id,
          bodyId: body.id,
          inputDigest: model.inputDigest,
        }),
      );
      if (!original) target.visible = true;
    }
    committed = true;
    phase = "cleanup";
    // Irreversible deletion happens only after all replacements are attached.
    // A cleanup failure is reported separately; do not claim rollback then.
    const retained = new Set(
      staged.reduce((ids, i) => ids.concat([i.target.id, i.body.id]), []),
    );
    for (const n of [...created].reverse())
      if (!n.removed && !retained.has(n.id) && n.parent?.type === "PAGE")
        safe(() => n.remove());
    const frames = staged.map((i) => ({
      id: i.f.id,
      nodeId: i.target.id,
      bodyId: i.body.id,
      mode: i.f.mode,
    }));
    return {
      ok: rollbackErrors.length === 0,
      scope: "foundation-specimen-render",
      inputDigest: model.inputDigest,
      frames,
      counts,
      cleanupErrors: rollbackErrors,
      cleanupNodes: created
        .filter(
          (n) => !n.removed && !retained.has(n.id) && n.parent?.type === "PAGE",
        )
        .map((n) => n.id),
      committed: true,
    };
  } catch (error) {
    if (!committed) {
      for (const { target, body, original } of [...changed].reverse()) {
        if (original) {
          safe(() => target.appendChild(original.body));
          safe(() => (target.x = original.x));
          safe(() => (target.y = original.y));
          safe(() => target.setPluginData(markerKey, original.marker));
        }
        if (!body.removed) safe(() => body.remove());
      }
      for (const n of [...created].reverse()) {
        if (n.removed) continue;
        const containsOriginal = originalBodies.some((body) => {
          let parent = body.parent;
          while (parent) {
            if (parent.id === n.id) return true;
            parent = parent.parent;
          }
          return false;
        });
        if (containsOriginal) {
          recoveryNodes.push(n.id);
          safe(() => (n.visible = true));
          continue;
        }
        safe(() => n.remove());
      }
    }
    return {
      ok: false,
      scope: "foundation-specimen-render",
      phase,
      committed,
      error: String(error.message ?? error),
      rollbackErrors,
      recoveryNodes,
    };
  } finally {
    if (oldPage && figma.currentPage.id !== oldPage.id) {
      try {
        await figma.setCurrentPageAsync(oldPage);
      } catch {
        /* Successful content remains; page focus restoration is best effort. */
      }
    }
  }
}
