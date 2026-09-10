import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../cli/run.js";
import { runValidateArtifactCli } from "../validate/artifact.mjs";

const workdirs: string[] = [];
afterEach(() => {
  for (const dir of workdirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});
function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recipes-cli-"));
  workdirs.push(root);
  const recipes = path.join(root, "custom sources");
  fs.mkdirSync(recipes);
  fs.copyFileSync(
    new URL("./__fixtures__/notice.recipe.json", import.meta.url),
    path.join(recipes, "notice.recipe.json"),
  );
  const tokens = path.join(root, "design.json");
  fs.copyFileSync(
    new URL("./__fixtures__/tokens.json", import.meta.url),
    tokens,
  );
  return { root, recipes, tokens };
}
async function capture(args: string[]) {
  let out = "",
    err = "";
  const code = await runCli({
    argv: ["recipes", "validate", ...args],
    version: "test",
    stdout: {
      write: (s) => {
        out += s;
      },
    },
    stderr: {
      write: (s) => {
        err += s;
      },
    },
  });
  return { code, out, err };
}
function args(w: ReturnType<typeof workspace>) {
  return ["--recipes", w.recipes, "--tokens", w.tokens, "--json"];
}

describe("recipe CLI filesystem and result boundary", () => {
  it("evaluates explicit source roots independently of the working directory", async () => {
    const w = workspace();
    const before = fs.readFileSync(
      path.join(w.recipes, "notice.recipe.json"),
      "utf8",
    );
    const result = await capture(args(w));
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(JSON.parse(result.out)).toMatchObject({
      resultVersion: "1",
      command: "recipes validate",
      ok: true,
      components: [{ componentId: "notice", valid: true }],
      diagnostics: [],
    });
    expect(
      fs.readFileSync(path.join(w.recipes, "notice.recipe.json"), "utf8"),
    ).toBe(before);
  });
  it("discovers source files in stable order without an enrollment index", async () => {
    const w = workspace();
    const data = JSON.parse(
      fs.readFileSync(path.join(w.recipes, "notice.recipe.json"), "utf8"),
    );
    fs.writeFileSync(
      path.join(w.recipes, "alert.recipe.json"),
      JSON.stringify({ ...data, componentId: "alert" }),
    );
    fs.writeFileSync(
      path.join(w.recipes, "index.json"),
      JSON.stringify({ components: [] }),
    );
    const result = await capture(args(w));
    expect(result.code).toBe(0);
    expect(
      JSON.parse(result.out).components.map(
        (record: { componentId: string }) => record.componentId,
      ),
    ).toEqual(["alert", "notice"]);
  });
  it("rejects unknown options even with otherwise valid inputs", async () => {
    const result = await capture([...args(workspace()), "--bypass", "true"]);
    expect(result.code).toBe(2);
    expect(result.out).toBe("");
    expect(result.err).toContain("RECIPE_ARGUMENT");
  });
  it("reports a nonconformant recipe as an evaluated result", async () => {
    const w = workspace();
    fs.renameSync(
      path.join(w.recipes, "notice.recipe.json"),
      path.join(w.recipes, "wrong.recipe.json"),
    );
    const result = await capture(args(w));
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out).diagnostics).toEqual([
      expect.objectContaining({ rule: "filename-alignment" }),
    ]);
  });
  it("reports malformed recipe JSON without crashing or claiming success", async () => {
    const w = workspace();
    fs.writeFileSync(path.join(w.recipes, "notice.recipe.json"), "{");
    const result = await capture(args(w));
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out).diagnostics).toEqual([
      expect.objectContaining({ rule: "json-parse" }),
    ]);
  });
  it("accepts an existing empty recipe directory but not a missing one", async () => {
    const w = workspace();
    fs.unlinkSync(path.join(w.recipes, "notice.recipe.json"));
    const result = await capture(args(w));
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out).components).toEqual([]);
    fs.rmdirSync(w.recipes);
    const missing = await capture(args(w));
    expect(missing.code).toBe(2);
    expect(missing.out).toBe("");
  });
  it.each([
    { input: [] },
    { input: ["--recipes", "absent"] },
    { input: ["--recipes", "absent", "--tokens", "absent"] },
    { input: ["--wat", "ignored"] },
  ])(
    "refuses missing inputs and unsupported options $input",
    async ({ input }) => {
      const result = await capture(input);
      expect(result.code).toBe(2);
      expect(result.out).toBe("");
      expect(result.err).toMatch(/RECIPE_/);
    },
  );
  it("cannot evaluate an invalid token input", async () => {
    const w = workspace();
    fs.writeFileSync(w.tokens, "{}");
    const result = await capture(args(w));
    expect(result.code).toBe(2);
    expect(result.out).toBe("");
    expect(result.err).toContain("RECIPE_TOKEN_INPUT");
  });
  it("rejects symlink recipes instead of reading outside the selected source", async () => {
    const w = workspace();
    fs.symlinkSync(w.tokens, path.join(w.recipes, "external.recipe.json"));
    const result = await capture(args(w));
    expect(result.code).toBe(2);
    expect(result.out).toBe("");
    expect(result.err).toContain("RECIPE_SOURCE_ENTRY");
  });
});

describe("shipped recipe schema", () => {
  it("validates arbitrary namespaces and enforces reference-tree property names", () => {
    const w = workspace();
    const file = path.join(w.recipes, "notice.recipe.json");
    let err = "";
    const io = {
      stdout: { write: () => {} },
      stderr: {
        write: (s: string) => {
          err += s;
        },
      },
    };
    expect(runValidateArtifactCli(["component-recipe", file], io)).toBe(0);
    const recipe = JSON.parse(fs.readFileSync(file, "utf8"));
    recipe.slots["Bad Slot"] = recipe.slots.body;
    fs.writeFileSync(file, JSON.stringify(recipe));
    expect(runValidateArtifactCli(["component-recipe", file], io)).toBe(1);
    expect(err).toContain("property name");
  });
});
