import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadProject } from "../project/config.mjs";
import { governTokenProject } from "./governance.mjs";
import { runCli } from "../cli/run.js";
import { governanceFixture } from "./governance-fixture.mjs";
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture(options) {
  const f = governanceFixture(options);
  roots.push(f.root);
  return f;
}
async function run(f, extra = []) {
  let out = "",
    err = "";
  const code = await runCli({
    argv: [
      "tokens",
      "govern",
      "--root",
      f.root,
      "--config",
      "project.json",
      "--json",
      ...extra,
    ],
    version: "test",
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
  });
  return { code, out, err };
}
const ids = [
  "tokens validate",
  "tokens build",
  "tokens runtime check",
  "tokens artifacts check",
  "figma verify",
  "ledger validate",
  "ledger parity",
  "proof validate",
];
it("runs the real compiler and every selected check against hand-authored publication expectations", async () => {
  const f = fixture(),
    cwd = process.cwd();
  const inputs = [
    f.configPath,
    ...Object.values(loadProject(f.configPath).tokens.governance.publication),
  ];
  const before = inputs.map((file) => fs.readFileSync(file));
  const result = await run(f);
  expect(result.code, result.err || result.out).toBe(0);
  expect(result.err).toBe("");
  const report = JSON.parse(result.out);
  expect(report.steps.map((s) => s.id)).toEqual(ids);
  expect(report.capabilities).toEqual({
    manualEditGuard: false,
    runtimeChecks: true,
    publication: true,
  });
  expect(report.steps[5].result.ledger.promotable).toBe(true);
  expect(report.scope).toContain("not observed remote synchronization");
  expect(inputs.map((file) => fs.readFileSync(file))).toEqual(before);
  expect(process.cwd()).toBe(cwd);
});
it("supports explicit token-only governance without fake publication passes", async () => {
  const f = fixture({ publication: false });
  const result = await governTokenProject({
    project: loadProject(f.configPath),
  });
  expect(result.ok).toBe(true);
  expect(result.steps.map((s) => s.id)).toEqual(ids.slice(0, 4));
  expect(result.capabilities.publication).toBe(false);
});
it("stops on recipe validity before creating outputs even if a later proof is missing", async () => {
  const f = fixture();
  f.recipe.defaults.state = "absent";
  f.write("ui/recipes/notice.recipe.json", f.recipe);
  fs.unlinkSync(path.join(f.root, "publication/proof.json"));
  const result = await run(f);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.out).failedStep).toBe("tokens validate");
  expect(JSON.parse(result.out).steps).toHaveLength(1);
  expect(fs.existsSync(path.join(f.root, "build"))).toBe(false);
});
it("stops on runtime compatibility after build, before publication", async () => {
  const f = fixture();
  f.write("runtime-surface.json", {
    surfaceVersion: "1",
    runtimeCssPath: "ui/theme.css",
    requiredCustomProperties: ["--missing"],
  });
  const result = await run(f);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.out).steps.map((s) => s.id)).toEqual(
    ids.slice(0, 3),
  );
  expect(JSON.parse(result.out).failedStep).toBe("tokens runtime check");
  expect(fs.existsSync(path.join(f.root, "build/figma.json"))).toBe(true);
});
it("fails against a wrong reviewed baseline without rewriting it", async () => {
  const f = fixture();
  f.baseline.variables[0].valuesByTheme.daylight.r = 0;
  f.write("publication/baseline.json", f.baseline);
  const before = fs.readFileSync(
    path.join(f.root, "publication/baseline.json"),
  );
  const result = await run(f);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.out).failedStep).toBe("figma verify");
  expect(JSON.parse(result.out).steps.at(-1).result.errors.join(" ")).toContain(
    "RAIL_VERIFY_MAPPING_DRIFT",
  );
  expect(
    fs.readFileSync(path.join(f.root, "publication/baseline.json")),
  ).toEqual(before);
});
it("rejects a corrupted bound proof and never repairs its digest", async () => {
  const f = fixture();
  fs.appendFileSync(path.join(f.root, "publication/proof.json"), "\n");
  const before = fs.readFileSync(path.join(f.root, "publication/ledger.json"));
  const result = await run(f);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.out).failedStep).toBe("ledger validate");
  expect(
    JSON.parse(result.out).steps.at(-1).result.diagnostics[0].code,
  ).toContain("DIGEST_MISMATCH");
  expect(fs.readFileSync(path.join(f.root, "publication/ledger.json"))).toEqual(
    before,
  );
});
it("does not treat structurally valid blocked publication as failed recipe validity or a passing parity gate", async () => {
  const f = fixture();
  f.ledger.promotion.highestEarnedLevel = "C-consumption-valid";
  f.write("publication/ledger.json", f.ledger);
  const result = await run(f);
  expect(result.code).toBe(1);
  const report = JSON.parse(result.out);
  expect(report.failedStep).toBe("ledger parity");
  expect(report.steps.find((s) => s.id === "tokens validate").result.ok).toBe(
    true,
  );
  expect(report.steps.find((s) => s.id === "ledger validate").result.ok).toBe(
    true,
  );
});
it("binds publication expectations to this build's artifact", async () => {
  const f = fixture();
  f.profile["artifact-path"].const = "another/artifact.json";
  f.proof.artifact.path = "another/artifact.json";
  f.ledger.artifact.path = "another/artifact.json";
  f.saveProof();
  f.write("publication/profile.json", f.profile);
  const result = await run(f);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.out).failedStep).toBe("ledger validate");
  expect(
    JSON.parse(result.out).steps.at(-1).result.diagnostics.at(-1).code,
  ).toBe("GOVERNANCE_PUBLICATION_ARTIFACT_MISMATCH");
});
it("rejects a different bound proof even when its bytes are identical", async () => {
  const f = fixture();
  fs.copyFileSync(
    path.join(f.root, "publication/proof.json"),
    path.join(f.root, "publication/other-proof.json"),
  );
  f.ledger.publication.proof = "./other-proof.json";
  f.write("publication/ledger.json", f.ledger);
  const result = await run(f);
  expect(result.code).toBe(1);
  expect(
    JSON.parse(result.out).steps.at(-1).result.diagnostics.at(-1).code,
  ).toBe("GOVERNANCE_PUBLICATION_PROOF_MISMATCH");
});
it("cannot evaluate a selected absent baseline and emits no partial stdout result", async () => {
  const f = fixture();
  fs.unlinkSync(path.join(f.root, "publication/baseline.json"));
  const result = await run(f);
  expect(result).toMatchObject({ code: 2, out: "" });
  expect(result.err).toContain("figma verify:");
});
it("rejects writes over publication evidence before changing any artifact", async () => {
  const f = fixture();
  f.config.tokens.build.outputs.figma = "publication/proof.json";
  f.write("project.json", f.config);
  const before = fs.readFileSync(path.join(f.root, "publication/proof.json"));
  const result = await run(f);
  expect(result).toMatchObject({ code: 2, out: "" });
  expect(result.err).toContain("protected input");
  expect(fs.readFileSync(path.join(f.root, "publication/proof.json"))).toEqual(
    before,
  );
  expect(fs.existsSync(path.join(f.root, "build"))).toBe(false);
});
it.each(["--force", "extra"])(
  "rejects unsupported invocation %s",
  async (arg) => {
    const f = fixture();
    expect(await run(f, [arg])).toMatchObject({ code: 2, out: "" });
  },
);
