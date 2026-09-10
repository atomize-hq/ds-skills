import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { governanceFixture } from "../tokens/governance-fixture.mjs";
import { loadProject } from "../project/config.mjs";
import { componentPolicyFixture, commitFixture } from "./fixture.mjs";
import { runComponentOperation } from "./command.mjs";
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const f = governanceFixture();
  roots.push(f.root);
  f.config.components = componentPolicyFixture();
  f.write("project.json", f.config);
  commitFixture(f.root);
  return f;
}
const run = (f) =>
  runComponentOperation(loadProject(f.configPath), "promote", {
    profile: "publication",
    consumer: "release",
  });
it("preserves the real ledger/proof validator and separates it from component references", async () => {
  const f = fixture(),
    r = await run(f);
  expect(r.ok).toBe(true);
  expect(r.report.evidence["figma-publication"].scope).toBe(
    "publication-ledger-conformance",
  );
  expect(r.report.evidence["story-coverage"].state).toBe("not-configured");
  expect(r.report.policies.advancement.outcome).toBe("unsatisfied");
});
it.each([
  "stale",
  "deferred",
  "digest",
  "other proof",
  "profile",
  "missing proof",
])("does not promote %s publication evidence", async (mode) => {
  const f = fixture();
  if (mode === "stale")
    f.ledger.verification.lastVerifiedRevision = "b".repeat(40);
  if (mode === "deferred") {
    f.ledger.promotion.parityMode = "deferred";
    f.ledger.promotion.parityDeferredReason = "not observed";
  }
  if (mode === "digest") f.ledger.publication.sha256 = "0".repeat(64);
  if (mode === "other proof") f.ledger.publication.proof = "../../outside.json";
  if (mode === "profile") {
    f.profile["artifact-path"].const = "another.json";
    f.write("publication/profile.json", f.profile);
  }
  if (mode === "missing proof")
    fs.unlinkSync(path.join(f.root, "publication/proof.json"));
  f.write("publication/ledger.json", f.ledger);
  const result = await run(f);
  expect(result.ok).toBe(false);
  expect(result.decision.unmet).toEqual(["figma-publication"]);
});

it("refuses to overwrite token sources or generated token assets as a component report", async () => {
  const f = fixture();
  for (const target of [
    f.config.tokens.sourceDir + "/status.json",
    f.config.tokens.build.outputs.figma,
  ]) {
    f.config.components.report = target;
    f.write("project.json", f.config);
    await expect(run(f)).rejects.toThrow(/overlap/);
  }
});
