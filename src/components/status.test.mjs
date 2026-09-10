import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { componentProjectFixture } from "./fixture.mjs";
import { runComponentOperation } from "./command.mjs";
import { evaluateComponentStatus } from "./evaluate.mjs";
import { publishComponentReport } from "./report-io.mjs";
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
async function fixture(options) {
  const f = await componentProjectFixture(options);
  roots.push(f.root);
  return f;
}
it("evaluates independent evidence axes and explicit profiles without a highest-claim ladder", async () => {
  const f = await fixture(),
    r = await runComponentOperation(f.project(), "evaluate");
  expect(r.ok).toBe(true);
  expect(r.report.statusVersion).toBe("3");
  expect(r.report.evidence["story-coverage"].state).toBe("satisfied");
  expect(r.report.evidence["visual-review"].state).toBe("satisfied");
  expect(r.report.evidence["figma-publication"].state).toBe("not-configured");
  expect(r.report.policies.advancement.outcome).toBe("satisfied");
  expect(r.report.policies.publication.unmet).toEqual(["figma-publication"]);
  expect(r.report).not.toHaveProperty("highestEarnedClaim");
});
it("supports a different library/tier and consumer configuration", async () => {
  const f = await fixture({
    component: "workspace-tree",
    tier: "composite",
    consumer: "desktop-review",
  });
  const r = await runComponentOperation(f.project(), "promote", {
    profile: "advancement",
    consumer: "ci",
  });
  expect(r.decision.outcome).toBe("pass");
  expect(r.report.evidence["visual-review"].facts.scope.componentTiers).toEqual(
    { "workspace-tree": "composite" },
  );
});
it.each(["changed", "failed", "deferred"])(
  "does not turn %s visual evidence into a satisfied policy",
  async (outcome) => {
    const f = await fixture();
    f.status.review.diffOutcome = outcome;
    f.status.check.conclusion = {
      changed: "neutral",
      failed: "failure",
      deferred: "skipped",
    }[outcome];
    f.write("review/status.json", f.status);
    const r = await runComponentOperation(f.project(), "promote", {
      profile: "advancement",
      consumer: "ci",
    });
    expect(r.ok).toBe(false);
    expect(r.decision.outcome).toBe("block");
    expect(r.report.evidence["visual-review"].state).toBe(outcome);
    const advisory = await runComponentOperation(f.project(), "promote", {
      profile: "advancement",
      consumer: "local",
    });
    expect(advisory.ok).toBe(true);
    expect(advisory.decision.requirementsSatisfied).toBe(false);
    expect(advisory.decision.outcome).toBe("advisory");
  },
);
it.each(["stale", "revision", "scope", "missing", "malformed"])(
  "reports %s review evidence without passing advancement",
  async (mode) => {
    const f = await fixture();
    if (mode === "stale") f.status.generatedAt = "2020-01-01T00:00:00Z";
    if (mode === "revision") f.status.revision.gitSha = "b".repeat(40);
    if (mode === "scope") f.status.review.scope.componentTiers.notice = "other";
    f.write(
      "review/status.json",
      mode === "malformed" ? "invalid-json" : f.status,
    );
    if (mode === "missing")
      fs.unlinkSync(path.join(f.root, "review/status.json"));
    const r = await runComponentOperation(f.project(), "promote", {
      profile: "advancement",
      consumer: "ci",
    });
    expect(r.ok).toBe(false);
    expect(r.decision.unmet).toContain("visual-review");
  },
);
it("rederives coverage and rejects a stored forged ready projection", async () => {
  const f = await fixture();
  f.spec.requiredStoryKinds = ["default", "interaction"];
  f.write("specs/notice.json", f.spec);
  const result = await runComponentOperation(f.project(), "evaluate");
  expect(result.report.evidence["story-coverage"].state).not.toBe("satisfied");
  expect(result.report.policies.reference.outcome).toBe("unsatisfied");
});
it("writes, checks, preserves unchanged mtime and rejects forged/stale reports", async () => {
  const f = await fixture(),
    file = path.join(f.root, f.config.components.report);
  expect((await runComponentOperation(f.project(), "check")).ok).toBe(false);
  expect(
    (await runComponentOperation(f.project(), "build")).artifactStatus,
  ).toBe("written");
  const before = fs.statSync(file).mtimeMs;
  expect(
    (await runComponentOperation(f.project(), "build")).artifactStatus,
  ).toBe("unchanged");
  expect(fs.statSync(file).mtimeMs).toBe(before);
  expect((await runComponentOperation(f.project(), "check")).ok).toBe(true);
  const record = JSON.parse(fs.readFileSync(file));
  record.evidence["figma-publication"].state = "satisfied";
  f.write(f.config.components.report, record);
  expect((await runComponentOperation(f.project(), "check")).ok).toBe(false);
  expect(
    (
      await runComponentOperation(f.project(), "promote", {
        profile: "publication",
        consumer: "release",
      })
    ).ok,
  ).toBe(false);
  await runComponentOperation(f.project(), "build");
  const stale = JSON.parse(fs.readFileSync(file));
  stale.generatedAt = "2020-01-01T00:00:00.000Z";
  f.write(f.config.components.report, stale);
  expect((await runComponentOperation(f.project(), "check")).ok).toBe(false);
});
it("status generation can truthfully record unavailable evidence without claiming readiness", async () => {
  const f = await fixture();
  fs.unlinkSync(path.join(f.root, "review/status.json"));
  const result = await runComponentOperation(f.project(), "build");
  expect(result.ok).toBe(true);
  expect(result.report.evidence["visual-review"].state).toBe("unavailable");
  expect(result.report.policies.advancement.outcome).toBe("unsatisfied");
});
it("requires explicit known profile/consumer selection", async () => {
  const f = await fixture();
  for (const selection of [
    { profile: "unknown", consumer: "ci" },
    { profile: "advancement", consumer: "release" },
    { profile: "constructor", consumer: "ci" },
  ])
    await expect(
      runComponentOperation(f.project(), "promote", selection),
    ).rejects.toThrow(/explicitly configured/);
});
it("preserves concurrent edits to the report and refuses source drift", async () => {
  const f = await fixture(),
    project = f.project();
  const { report, snapshot } = await evaluateComponentStatus(project);
  f.write(f.config.components.report, "user edit");
  expect(() => publishComponentReport(project, snapshot, report, null)).toThrow(
    /changed/,
  );
  expect(fs.readFileSync(project.components.report, "utf8")).toBe("user edit");
  fs.unlinkSync(project.components.report);
  f.write("library/demo.stories.tsx", "changed");
  expect(() => publishComponentReport(project, snapshot, report, null)).toThrow(
    /changed/,
  );
});
it.each([
  "project.json",
  "library/status.json",
  ".agents/status.json",
  "review/status.json",
  "locks/proof.lock",
])("refuses protected output %s", async (target) => {
  const f = await fixture();
  f.config.components.report = target;
  f.write("project.json", f.config);
  await expect(runComponentOperation(f.project(), "build")).rejects.toThrow(
    /overlap/,
  );
});
it("detects policy edits even if story inputs and current receipt do not change", async () => {
  const f = await fixture();
  await runComponentOperation(f.project(), "build");
  f.config.components.profiles.advancement.requirements.push(
    "figma-publication",
  );
  f.write("project.json", f.config);
  expect((await runComponentOperation(f.project(), "check")).ok).toBe(false);
  expect(
    (
      await runComponentOperation(f.project(), "promote", {
        profile: "advancement",
        consumer: "ci",
      })
    ).ok,
  ).toBe(false);
});

it("read-only evaluation and integrity checks do not require a writable report", async () => {
  const f = await fixture(),
    project = f.project();
  await runComponentOperation(project, "build");
  fs.chmodSync(project.components.report, 0o444);
  try {
    expect((await runComponentOperation(project, "evaluate")).ok).toBe(true);
    expect((await runComponentOperation(project, "check")).ok).toBe(true);
    expect(
      (
        await runComponentOperation(project, "promote", {
          profile: "advancement",
          consumer: "ci",
        })
      ).ok,
    ).toBe(true);
  } finally {
    fs.chmodSync(project.components.report, 0o644);
  }
});
it("fresh evaluation ignores a saved report with an unusable file type", async () => {
  const f = await fixture(),
    project = f.project();
  fs.mkdirSync(project.components.report, { recursive: true });
  expect((await runComponentOperation(project, "evaluate")).ok).toBe(true);
  await expect(runComponentOperation(project, "check")).rejects.toThrow(
    /regular file/,
  );
});
