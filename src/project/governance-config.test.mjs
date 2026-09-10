import fs from "node:fs";
import { afterEach, expect, it } from "vitest";
import { loadProject } from "./config.mjs";
import { governTokenProject } from "../tokens/governance.mjs";
import { governanceFixture } from "../tokens/governance-fixture.mjs";
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const f = governanceFixture();
  roots.push(f.root);
  return f;
}
it.each([
  ["missing publication selection", (t) => (t.governance = {})],
  ["missing manual guard selection", (t) => delete t.manualEditGuard],
  ["missing runtime selection", (t) => delete t.runtimeChecks],
  ["missing builder", (t) => (t.build = null)],
  ["arbitrary command", (t) => (t.governance.command = "pnpm local-validator")],
  [
    "outside baseline",
    (t) => (t.governance.publication.baseline = "../outside.json"),
  ],
  ["missing proof selection", (t) => delete t.governance.publication.proof],
  [
    "unknown publication field",
    (t) => (t.governance.publication.skipParity = true),
  ],
])("rejects invalid governance configuration: %s", (_name, mutate) => {
  const f = fixture();
  mutate(f.config.tokens);
  f.write("project.json", f.config);
  expect(() => loadProject(f.configPath)).toThrow();
});
it.each([null, undefined])(
  "does not enable omitted/null governance implicitly: %s",
  async (value) => {
    const f = fixture();
    f.config.tokens.governance = value;
    f.write("project.json", f.config);
    await expect(
      governTokenProject({ project: loadProject(f.configPath) }),
    ).rejects.toThrow("not configured");
  },
);
it("evaluates the mandatory core with all optional capabilities explicitly disabled", async () => {
  const f = fixture();
  f.config.tokens.manualEditGuard = null;
  f.config.tokens.runtimeChecks = null;
  f.config.tokens.governance.publication = null;
  f.write("project.json", f.config);
  const report = await governTokenProject({
    project: loadProject(f.configPath),
  });
  expect(report.ok).toBe(true);
  expect(report.steps.map((s) => s.id)).toEqual([
    "tokens validate",
    "tokens build",
    "tokens artifacts check",
  ]);
  expect(report.capabilities).toEqual({
    manualEditGuard: false,
    runtimeChecks: false,
    publication: false,
  });
});
