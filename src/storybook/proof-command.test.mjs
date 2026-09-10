import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { runCli } from "../cli/run.js";
import { evaluateStorybookProof } from "./proof-command.mjs";
import { captureProofInputs } from "./proof-inputs.mjs";
import { publishProofCoverage } from "./proof-write.mjs";
import { proofFixture } from "./proof-fixture.mjs";
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const f = proofFixture();
  roots.push(f.root);
  return f;
}
async function capture(f, mode, extra = []) {
  let out = "",
    err = "";
  const code = await runCli({
    argv: [
      "storybook",
      "proof",
      mode,
      "--config",
      "project.json",
      "--root",
      f.root,
      "--json",
      ...extra,
    ],
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
  return { code, out, err, result: out ? JSON.parse(out) : null };
}
it("separates structure evaluation from stored coverage gate", async () => {
  const f = fixture();
  const valid = await capture(f, "validate");
  expect(valid.code).toBe(0);
  expect(valid.result.scope).toBe("static-story-reference-coverage");
  expect((await capture(f, "check")).code).toBe(1);
  expect(fs.existsSync(path.join(f.root, "reports"))).toBe(false);
  expect(fs.existsSync(path.join(f.root, "locks"))).toBe(false);
});
it("builds, rechecks and preserves healthy artifact bytes/mtime", async () => {
  const f = fixture(),
    file = path.join(f.root, "reports/coverage.json");
  const built = await capture(f, "build");
  expect(built.code).toBe(0);
  expect(built.result.artifactStatus).toBe("written");
  const before = fs.statSync(file).mtimeMs,
    bytes = fs.readFileSync(file);
  expect((await capture(f, "check")).code).toBe(0);
  expect((await capture(f, "build")).result.artifactStatus).toBe("unchanged");
  expect(fs.statSync(file).mtimeMs).toBe(before);
  expect(fs.readFileSync(file)).toEqual(bytes);
  expect(JSON.parse(bytes).proofCoverageVersion).toBe("2");
});
it("writes evaluated missing-kind coverage but returns a failing gate", async () => {
  const f = fixture();
  f.spec.requiredStoryKinds.push("docs");
  f.write(`specs/${f.component}.json`, f.spec);
  expect((await capture(f, "validate")).code).toBe(0);
  const built = await capture(f, "build");
  expect(built.code).toBe(1);
  expect(built.result.coverage.components[0].missingKinds).toEqual(["docs"]);
  expect(built.result.artifactStatus).toBe("written");
  expect((await capture(f, "check")).code).toBe(1);
});
it("does not trust edited status/counts or an obsolete report version", async () => {
  const f = fixture();
  await capture(f, "build");
  f.write("reports/coverage.json", {
    proofCoverageVersion: "1",
    summary: { componentCount: 0, readyCount: 0, failingCount: 0 },
    components: [],
  });
  const result = await capture(f, "check");
  expect(result.code).toBe(1);
  expect(result.result.diagnostics.join(" ")).toContain("COVERAGE_STALE");
});
it("leaves previous report untouched on invalid source metadata", async () => {
  const f = fixture();
  await capture(f, "build");
  const before = fs.readFileSync(path.join(f.root, "reports/coverage.json"));
  f.write("specs/notice.json", "{");
  const result = await capture(f, "build");
  expect(result.code).toBe(1);
  expect(result.result.coverage).toBeNull();
  expect(fs.readFileSync(path.join(f.root, "reports/coverage.json"))).toEqual(
    before,
  );
});
it("serializes concurrent writers using the shared product lock", async () => {
  const f = fixture(),
    p = f.project();
  const results = await Promise.all([
    evaluateStorybookProof(p, "build"),
    evaluateStorybookProof(p, "build"),
  ]);
  expect(results.map((r) => r.artifactStatus).sort()).toEqual([
    "unchanged",
    "written",
  ]);
  expect((await capture(f, "check")).code).toBe(0);
});
it("refuses publishing when source bytes changed after evaluation", () => {
  const f = fixture(),
    p = f.project(),
    snapshot = captureProofInputs(p);
  f.write(
    "library/demo.stories.tsx",
    "export default {title:'Changed'}; export const Default={};",
  );
  expect(() => publishProofCoverage(p, snapshot, Buffer.from("{}"))).toThrow(
    "changed",
  );
  expect(fs.existsSync(path.join(f.root, "reports/coverage.json"))).toBe(false);
  expect(fs.readdirSync(path.join(f.root, "reports"))).toEqual([]);
});
it.each([
  [
    "input overlap",
    (f) => {
      f.config.storybook.proof.coverage = "policy/inventory.json";
    },
  ],
  [
    "source dir overlap",
    (f) => {
      f.config.storybook.proof.coverage = "library/result.json";
    },
  ],
  [
    "lock overlap",
    (f) => {
      f.config.storybook.proof.lockPath = "reports/coverage.json";
    },
  ],
  [
    "escaping path",
    (f) => {
      f.config.storybook.proof.coverage = "../outside.json";
    },
  ],
  [
    "unknown adapter",
    (f) => {
      f.config.storybook.proof.adapter = "anything";
    },
  ],
  [
    "empty roots",
    (f) => {
      f.config.storybook.proof.storyRoots = [];
    },
  ],
  [
    "missing keys",
    (f) => {
      delete f.config.storybook.proof.generatedArtifactKeys;
    },
  ],
  [
    "invalid formatting",
    (f) => {
      f.config.storybook.proof.formatting = { printWidth: 0 };
    },
  ],
  [
    "unknown option",
    (f) => {
      f.config.storybook.proof.skipMissing = true;
    },
  ],
])("rejects unsafe/unsupported proof config: %s", async (_, mutate) => {
  const f = fixture();
  mutate(f);
  f.write("project.json", f.config);
  const r = await capture(f, "build");
  expect(r.code).toBe(2);
  expect(r.out).toBe("");
  expect(fs.existsSync(path.join(f.root, "locks"))).toBe(false);
});
it("refuses a coverage symlink without altering its target", async () => {
  const f = fixture();
  f.write("safe.txt", "user bytes");
  fs.mkdirSync(path.join(f.root, "reports"));
  fs.symlinkSync("../safe.txt", path.join(f.root, "reports/coverage.json"));
  expect((await capture(f, "build")).code).toBe(2);
  expect(fs.readFileSync(path.join(f.root, "safe.txt"), "utf8")).toBe(
    "user bytes",
  );
});
it("unavailable input has no machine result", async () => {
  const f = fixture();
  fs.unlinkSync(path.join(f.root, "policy/inventory.json"));
  const r = await capture(f, "check");
  expect(r.code).toBe(2);
  expect(r.out).toBe("");
});
it("unknown command options are not silently ignored", async () => {
  const f = fixture();
  const r = await capture(f, "validate", ["--skip-checks"]);
  expect(r.code).toBe(2);
  expect(r.out).toBe("");
});
