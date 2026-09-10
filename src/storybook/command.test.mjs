import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { runCli } from "../cli/run.js";
import { storybookPolicyFixture } from "./fixture.mjs";
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "storybook-policy-"));
  roots.push(root);
  const write = (file, data) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      typeof data === "string" ? data : JSON.stringify(data),
    );
  };
  const config = {
    projectVersion: "1",
    tokens: null,
    storybook: {
      format: "csf-policy-v1",
      inventory: "proof/inventory.json",
      tierPolicy: "policy/tiers.json",
      versionPolicy: "toolchain/version.json",
    },
  };
  const data = storybookPolicyFixture();
  for (const [key, value] of Object.entries(data))
    write(config.storybook[key], value);
  write("config/project.json", config);
  return { root, write, config, data };
}
async function capture(args) {
  let out = "",
    err = "";
  const code = await runCli({
    argv: ["storybook", "policy", "validate", ...args],
    version: "test",
    stdout: {
      write: (v) => {
        out += v;
      },
    },
    stderr: {
      write: (v) => {
        err += v;
      },
    },
  });
  return { out, err, code };
}
function args(f) {
  return ["--root", f.root, "--config", "config/project.json", "--json"];
}
it("binds all policy inputs to explicit root and leaves files unchanged", async () => {
  const f = fixture();
  const before = fs.readFileSync(
    path.join(f.root, f.config.storybook.inventory),
  );
  const r = await capture(args(f));
  expect(r.code).toBe(0);
  expect(r.err).toBe("");
  const report = JSON.parse(r.out);
  expect(report).toMatchObject({
    resultVersion: "1",
    command: "storybook policy validate",
    scope: "structural-policy-only",
    ok: true,
    projectRoot: f.root,
  });
  expect(report.inputs).toHaveLength(3);
  expect(
    fs.readFileSync(path.join(f.root, f.config.storybook.inventory)),
  ).toEqual(before);
});
it("isolates two different policy roots in one process", async () => {
  const a = fixture(),
    b = fixture();
  b.write(
    b.config.storybook.tierPolicy,
    storybookPolicyFixture({ tier: "composite", consumer: "desktop-review" })
      .tierPolicy,
  );
  a.write(a.config.storybook.inventory, { inventoryVersion: "invalid" });
  expect((await capture(args(a))).code).toBe(1);
  expect((await capture(args(b))).code).toBe(0);
});
it("returns evaluated diagnostics for malformed JSON and continues other inputs", async () => {
  const f = fixture();
  f.write(f.config.storybook.inventory, "{");
  f.data.versionPolicy.storybookVersion = "latest";
  f.write(f.config.storybook.versionPolicy, f.data.versionPolicy);
  const r = await capture(args(f));
  expect(r.code).toBe(1);
  expect(JSON.parse(r.out).diagnostics.map((d) => d.kind)).toEqual([
    "inventory",
    "versionPolicy",
  ]);
});
it.each([
  [
    "missing file",
    (f) => {
      fs.unlinkSync(path.join(f.root, f.config.storybook.inventory));
    },
  ],
  [
    "directory",
    (f) => {
      fs.unlinkSync(path.join(f.root, f.config.storybook.inventory));
      fs.mkdirSync(path.join(f.root, f.config.storybook.inventory));
    },
  ],
  [
    "unknown config",
    (f) => {
      f.config.storybook.ignore = true;
    },
  ],
  [
    "missing input",
    (f) => {
      delete f.config.storybook.inventory;
    },
  ],
  [
    "outside path",
    (f) => {
      f.config.storybook.inventory = "../outside.json";
    },
  ],
  [
    "absolute path",
    (f) => {
      f.config.storybook.inventory = path.join(
        f.root,
        f.config.storybook.inventory,
      );
    },
  ],
  [
    "capability null",
    (f) => {
      f.config.storybook = null;
    },
  ],
  [
    "capability omitted",
    (f) => {
      delete f.config.storybook;
    },
  ],
  [
    "input symlink",
    (f) => {
      fs.symlinkSync(
        path.join(f.root, f.config.storybook.inventory),
        path.join(f.root, "link.json"),
      );
      f.config.storybook.inventory = "link.json";
    },
  ],
])("cannot evaluate %s and emits no machine result", async (_, mutate) => {
  const f = fixture();
  mutate(f);
  f.write("config/project.json", f.config);
  const r = await capture(args(f));
  expect(r.code).toBe(2);
  expect(r.out).toBe("");
  expect(r.err).not.toBe("");
});
it.each(
  [
    [],
    ["--config"],
    ["--config", "missing.json"],
    ["--config", "a", "--ignore"],
    ["unexpected"],
  ].map((argv) => ({ argv })),
)("refuses invalid arguments $argv", async ({ argv }) => {
  const r = await capture(argv);
  expect(r.code).toBe(2);
  expect(r.out).toBe("");
});
