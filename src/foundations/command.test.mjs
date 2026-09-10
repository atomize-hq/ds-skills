import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { foundationProjectFixture } from "./project-fixture.mjs";
import { runFoundationOperation } from "./command.mjs";
import {
  captureFoundationInputs,
  readFoundationOutput,
  writeFoundationOutput,
} from "./io.mjs";
const renderer = fs.readFileSync(
  new URL("../../dist/foundations/renderer.js", import.meta.url),
  "utf8",
);
const roots = [];
const fixture = () => {
  const f = foundationProjectFixture();
  roots.push(f.root);
  return f;
};
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
const run = async (f, mode) =>
  await runFoundationOperation(f.project(), mode, { renderer });
it("builds executable self-contained specimen code and checks exact freshness", async () => {
  const f = fixture();
  expect((await run(f, "check")).ok).toBe(false);
  expect((await run(f, "build")).artifactStatus).toBe("written");
  expect((await run(f, "check")).ok).toBe(true);
  const output = path.join(f.root, f.projectConfig.foundations.output),
    mtime = fs.statSync(output).mtimeMs;
  expect((await run(f, "build")).artifactStatus).toBe("unchanged");
  expect(fs.statSync(output).mtimeMs).toBe(mtime);
  const script = fs.readFileSync(output, "utf8");
  const result = await new Function("figma", script)(f.figma);
  expect(result.ok).toBe(true);
  expect(result.counts.specimens).toBe(48);
  fs.chmodSync(output, 0o444);
  try {
    expect((await run(f, "check")).ok).toBe(true);
  } finally {
    fs.chmodSync(output, 0o644);
  }
});
it("serializes hostile-looking descriptions as data, never source commands", async () => {
  const f = fixture();
  f.p.frames[0].description = '"}; throw new Error("injected"); // ${oops}';
  f.write("presentation.json", f.p);
  expect((await run(f, "build")).ok).toBe(true);
  expect(
    (await new Function("figma", readFoundationOutput(f.project()))(f.figma))
      .ok,
  ).toBe(true);
});
it("detects configuration and output edits without changing inputs", async () => {
  const f = fixture();
  await run(f, "build");
  f.modelConfig.sections[0].description = "Changed copy";
  f.write("model.json", f.modelConfig);
  expect((await run(f, "check")).ok).toBe(false);
  await run(f, "build");
  f.write(f.projectConfig.foundations.output, "tampered");
  expect((await run(f, "check")).ok).toBe(false);
});
it.each(["invalid JSON", "missing mode", "unknown role"])(
  "refuses %s without overwriting the previous script",
  async (mode) => {
    const f = fixture();
    await run(f, "build");
    const before = readFoundationOutput(f.project());
    if (mode === "invalid JSON") f.write("model.json", "{");
    if (mode === "missing mode") {
      f.modelConfig.modes.pop();
      f.write("model.json", f.modelConfig);
    }
    if (mode === "unknown role") {
      f.p.roles.extra = "value";
      f.write("presentation.json", f.p);
    }
    const result = await run(f, "build");
    expect(result.ok).toBe(false);
    expect(result.artifactStatus).toBe("not-written");
    expect(readFoundationOutput(f.project())).toBe(before);
  },
);
it.each(["input", "install", "lock", "symlink"])(
  "rejects %s output collisions before writes",
  async (kind) => {
    const f = fixture();
    if (kind === "input") f.projectConfig.foundations.output = "tokens.json";
    if (kind === "install")
      f.projectConfig.foundations.output = ".agents/skills/tool.js";
    if (kind === "lock")
      f.projectConfig.foundations.output = ".locks/foundations/owner.json";
    if (kind === "symlink")
      fs.symlinkSync("/tmp", path.join(f.root, "generated"));
    f.write("project.json", f.projectConfig);
    await expect(run(f, "build")).rejects.toThrow();
    expect(fs.existsSync(path.join(f.root, ".locks"))).toBe(false);
  },
);
it.each(["input", "output"])(
  "rejects concurrent %s drift before replacement",
  async (kind) => {
    const f = fixture();
    await run(f, "build");
    const p = f.project(),
      snapshot = captureFoundationInputs(p),
      before = readFoundationOutput(p);
    f.write(
      kind === "input" ? "tokens.json" : f.projectConfig.foundations.output,
      "changed",
    );
    expect(() => writeFoundationOutput(p, snapshot, before, "new")).toThrow(
      /changed/,
    );
  },
);
