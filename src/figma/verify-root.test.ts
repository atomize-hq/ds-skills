import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { runCli } from "../cli/run.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function consumer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "figma-root-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "data"));
  fs.copyFileSync(
    new URL("../../ds-skills.config.example.json", import.meta.url),
    path.join(root, "config.json"),
  );
  fs.copyFileSync(
    new URL("../__fixtures__/artifact.json", import.meta.url),
    path.join(root, "data/tokens.json"),
  );
  const baseline = JSON.parse(
    fs.readFileSync(
      new URL("./__fixtures__/rail/token-rail.baseline.json", import.meta.url),
      "utf8",
    ),
  );
  fs.writeFileSync(
    path.join(root, "baseline.json"),
    JSON.stringify({ ...baseline, source: "data/tokens.json" }),
  );
  return root;
}
async function verify(root: string, artifact: string) {
  let out = "",
    err = "";
  const code = await runCli({
    argv: [
      "figma",
      "verify",
      "--root",
      root,
      "--config",
      "config.json",
      "--expect",
      "baseline.json",
      "--artifact",
      artifact,
    ],
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
it("resolves all verification inputs and baseline identity from an explicit consumer root", async () => {
  const root = consumer();
  const cwd = process.cwd();
  expect(root).not.toBe(cwd);
  expect(await verify(root, "data/tokens.json")).toMatchObject({
    code: 0,
    err: "",
  });
  expect(await verify(root, path.join(root, "data/tokens.json"))).toMatchObject(
    { code: 0, err: "" },
  );
  expect(process.cwd()).toBe(cwd);
});
it("does not accept equal bytes at a different artifact path", async () => {
  const root = consumer();
  fs.copyFileSync(
    path.join(root, "data/tokens.json"),
    path.join(root, "other.json"),
  );
  const result = await verify(root, "other.json");
  expect(result.code).toBe(1);
  expect(result.err).toContain("RAIL_VERIFY_ARTIFACT_MISMATCH");
});
