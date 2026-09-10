import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { prepareReleaseOutput } from "../../scripts/release/output.mjs";
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-output-"));
  roots.push(root);
  const product = path.join(root, "product");
  fs.mkdirSync(product);
  return { root, product };
}
it("creates a fresh external staging directory", () => {
  const f = fixture(),
    out = path.join(f.root, "stage");
  prepareReleaseOutput(out, f.product);
  expect(fs.statSync(out).isDirectory()).toBe(true);
});
it("allows replacing only recognized generated asset files", () => {
  const f = fixture(),
    out = path.join(f.product, "release");
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, "install.sh"), "old");
  prepareReleaseOutput(out, f.product);
  expect(fs.readdirSync(out)).toEqual([]);
});
it.each(["notes.md", "subdirectory", "symlink"])(
  "preserves every file when staging contains %s",
  (name) => {
    const f = fixture(),
      out = path.join(f.root, "stage");
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, "install.sh"), "preserve");
    if (name === "subdirectory") fs.mkdirSync(path.join(out, name));
    else if (name === "symlink")
      fs.symlinkSync("install.sh", path.join(out, "SHA256SUMS"));
    else fs.writeFileSync(path.join(out, name), "notes");
    expect(() => prepareReleaseOutput(out, f.product)).toThrow(
      /nothing was removed/,
    );
    expect(fs.readFileSync(path.join(out, "install.sh"), "utf8")).toBe(
      "preserve",
    );
  },
);
it.each(["root", "source", "parent"])(
  "refuses %s overlap with product source",
  (which) => {
    const f = fixture(),
      out =
        which === "root"
          ? f.product
          : which === "source"
            ? path.join(f.product, "src")
            : f.root;
    expect(() => prepareReleaseOutput(out, f.product)).toThrow(
      /product source/,
    );
    expect(fs.existsSync(f.product)).toBe(true);
  },
);
it("refuses a symlinked output directory", () => {
  const f = fixture(),
    out = path.join(f.root, "stage");
  const external = path.join(f.root, "external");
  fs.mkdirSync(external);
  fs.symlinkSync(external, out);
  expect(() => prepareReleaseOutput(out, f.product)).toThrow(/real directory/);
});

it("rejects source overlap through an aliased parent", () => {
  const f = fixture(),
    alias = path.join(f.root, "alias");
  fs.symlinkSync(f.product, alias);
  expect(() =>
    prepareReleaseOutput(path.join(alias, "src/new"), f.product),
  ).toThrow(/product source/);
  expect(fs.existsSync(path.join(f.product, "src"))).toBe(false);
});
