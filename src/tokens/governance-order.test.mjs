import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CannotEvaluateError } from "../figma/profile.mjs";
import { loadProject } from "../project/config.mjs";
import { runCli } from "../cli/run.js";
import { governTokenProject } from "./governance.mjs";
import * as execution from "./governance-steps.mjs";
import { governanceFixture } from "./governance-fixture.mjs";
const roots = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const f = governanceFixture();
  roots.push(f.root);
  return f;
}
async function run(f) {
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
    ],
    version: "test",
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
  });
  return { code, out, err };
}
const plan = [
  "tokens validate",
  "tokens guard",
  "tokens build",
  "tokens runtime check",
  "tokens artifacts check",
  "figma verify",
  "ledger validate",
  "ledger parity",
  "proof validate",
];
it.each(plan)(
  "stops exactly at an evaluated failure of %s",
  async (failure) => {
    const f = fixture();
    f.config.tokens.manualEditGuard = {
      policy: "git-input-dirty-v1",
      generatorInputs: ["pin.json"],
    };
    f.write("project.json", f.config);
    const called = [];
    vi.spyOn(execution, "executeGovernanceStep").mockImplementation(
      async (id) => {
        called.push(id);
        return {
          ok: id !== failure,
          diagnostics:
            id === failure
              ? [
                  {
                    code: "DELIBERATE_REJECTION",
                    message: "negative execution fixture",
                  },
                ]
              : [],
        };
      },
    );
    const result = await governTokenProject({
      project: loadProject(f.configPath),
    });
    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe(failure);
    expect(called).toEqual(plan.slice(0, plan.indexOf(failure) + 1));
    expect(result.steps.map((s) => s.id)).toEqual(called);
  },
);
it.each([2, 3])(
  "preserves exit %s with no aggregate stdout or later steps",
  async (code) => {
    const f = fixture(),
      called = [];
    vi.spyOn(execution, "executeGovernanceStep").mockImplementation(
      async (id) => {
        called.push(id);
        if (id === "tokens build")
          throw code === 2
            ? new CannotEvaluateError("FIXTURE_INPUT_UNAVAILABLE", "missing")
            : new Error("fixture unexpected failure");
        return { ok: true };
      },
    );
    const result = await run(f);
    expect(result).toMatchObject({ code, out: "" });
    expect(result.err).toContain("tokens build:");
    expect(called).toEqual(["tokens validate", "tokens build"]);
  },
);
it.each([
  "design/source/brand.tokens.json",
  "publication/profile.json",
  "publication/proof.json",
  "runtime-surface.json",
  "global.css",
  "project.json",
])(
  "rejects concurrent input drift in %s instead of certifying mixed state",
  async (file) => {
    const f = fixture(),
      actual = execution.executeGovernanceStep;
    vi.spyOn(execution, "executeGovernanceStep").mockImplementation(
      async (id, project) => {
        const result = await actual(id, project);
        if (id === "tokens build")
          fs.appendFileSync(path.join(f.root, file), "\n");
        return result;
      },
    );
    const result = await run(f);
    expect(result).toMatchObject({ code: 2, out: "" });
    expect(result.err).toContain("TOKEN_GOVERNANCE_INPUT_CHANGED");
    expect(result.err).toContain(
      "earlier build writes may already have occurred",
    );
  },
);
it("rejects artifact drift after freshness checking", async () => {
  const f = fixture(),
    actual = execution.executeGovernanceStep;
  vi.spyOn(execution, "executeGovernanceStep").mockImplementation(
    async (id, project) => {
      const result = await actual(id, project);
      if (id === "figma verify")
        fs.appendFileSync(
          project.tokens.build.outputs.runtimeCss,
          "\n/* concurrent edit */\n",
        );
      return result;
    },
  );
  const result = await run(f);
  expect(result).toMatchObject({ code: 2, out: "" });
  expect(result.err).toContain("TOKEN_GOVERNANCE_INPUT_CHANGED");
});
