import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { chromaticProjectFixture, exampleSha } from "./fixture.mjs";
import { statusHttpFixture } from "../../scripts/checks/chromatic-http-fixture.mjs";
import { restoreChromaticStatus } from "./restore.mjs";
const fixtures = [];
afterEach(async () => {
  for (const { f, service } of fixtures.splice(0)) {
    await service.close();
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
async function fixture() {
  const f = chromaticProjectFixture();
  const service = await statusHttpFixture(f);
  fixtures.push({ f, service });
  return { f, ...service };
}
const restore = (f) =>
  restoreChromaticStatus(f.project(), {
    gitSha: exampleSha,
    env: { DS_TEST_GH_TOKEN: "test-secret" },
  });
it("validates before atomic replacement and drops credentials on signed redirect", async () => {
  const { f, state } = await fixture();
  f.write("review/status.json", "previous user bytes");
  const result = await restore(f);
  expect(result.ok).toBe(true);
  expect(result.artifactStatus).toBe("written");
  expect(result.artifactId).toBe(77);
  expect(
    JSON.parse(fs.readFileSync(path.join(f.root, "review/status.json"))),
  ).toEqual(state.status);
  expect(
    state.requests
      .filter((r) => r.path.includes("/repos/"))
      .every((r) => r.authorization === "Bearer test-secret"),
  ).toBe(true);
  expect(
    state.requests.find((r) => r.path === "/download").authorization,
  ).toBeUndefined();
  const before = fs.statSync(path.join(f.root, "review/status.json")).mtimeMs;
  expect((await restore(f)).artifactStatus).toBe("unchanged");
  expect(fs.statSync(path.join(f.root, "review/status.json")).mtimeMs).toBe(
    before,
  );
});
it.each([
  [
    "stale",
    (state) => {
      state.status.generatedAt = "2020-01-01T00:00:00Z";
    },
  ],
  [
    "wrong revision",
    (state) => {
      state.status.revision.gitSha = "b".repeat(40);
    },
  ],
  [
    "policy downgrade",
    (state) => {
      state.status.review.requiredForClaim = true;
      state.status.review.mode = "claim-required";
    },
  ],
  [
    "scope swap",
    (state) => {
      state.status.review.scope.componentTiers.notice = "other";
    },
  ],
])(
  "preserves the prior artifact on downloaded %s evidence",
  async (_, mutate) => {
    const { f, state } = await fixture();
    mutate(state);
    const before = fs.readFileSync(path.join(f.root, "review/status.json"));
    const result = await restore(f);
    expect(result.ok).toBe(false);
    expect(result.artifactStatus).toBe("not-written");
    expect(fs.readFileSync(path.join(f.root, "review/status.json"))).toEqual(
      before,
    );
  },
);
it.each([
  [
    "wrong workflow",
    (state) => {
      state.run.path = ".github/workflows/untrusted.yml";
    },
  ],
  [
    "fork run",
    (state) => {
      state.run.head_repository.full_name = "fork/ui";
    },
  ],
  [
    "unfinished run",
    (state) => {
      state.run.status = "in_progress";
    },
  ],
  [
    "wrong run revision",
    (state) => {
      state.run.head_sha = "b".repeat(40);
    },
  ],
  [
    "expired",
    (state) => {
      state.artifact = { expired: true };
    },
  ],
])("does not select %s", async (_, mutate) => {
  const { f, state } = await fixture();
  mutate(state);
  const r = await restore(f);
  expect(r.ok).toBe(false);
  expect(r.errors.join(" ")).toContain("ARTIFACT_MISSING");
  expect(state.requests.some((r) => r.path === "/download")).toBe(false);
});
it.each([
  [
    "digest mismatch",
    (s) => {
      s.artifact = { digest: `sha256:${"0".repeat(64)}` };
    },
  ],
  [
    "digest missing",
    (s) => {
      s.artifact = { digest: null };
    },
  ],
  [
    "broken ZIP",
    (s) => {
      s.archive = Buffer.from("not a ZIP");
    },
  ],
  [
    "repository mismatch",
    (s) => {
      s.run.repository.full_name = "other/repo";
    },
  ],
  [
    "artifact binding mismatch",
    (s) => {
      s.artifact = {
        workflow_run: {
          id: 123,
          repository_id: 8,
          head_repository_id: 9,
          head_sha: exampleSha,
        },
      };
    },
  ],
  [
    "unsafe redirect",
    (s) => {
      s.redirect = "file:///etc/passwd";
    },
  ],
  [
    "HTTP failure",
    (s) => {
      s.httpError = 403;
    },
  ],
])("refuses %s without replacement", async (_, mutate) => {
  const { f, state } = await fixture();
  mutate(state);
  const before = fs.readFileSync(path.join(f.root, "review/status.json"));
  await expect(restore(f)).rejects.toThrow();
  expect(fs.readFileSync(path.join(f.root, "review/status.json"))).toEqual(
    before,
  );
});
it("detects source drift during download and preserves previous report", async () => {
  const { f, state } = await fixture();
  const before = fs.readFileSync(path.join(f.root, "review/status.json"));
  state.duringDownload = () =>
    f.write(
      "library/demo.stories.tsx",
      "export default {title:'changed'}; export const Default={};",
    );
  await expect(restore(f)).rejects.toThrow("changed");
  expect(fs.readFileSync(path.join(f.root, "review/status.json"))).toEqual(
    before,
  );
});
it("preserves a concurrently edited output", async () => {
  const { f, state } = await fixture();
  state.duringDownload = () =>
    f.write("review/status.json", "concurrent user edit");
  await expect(restore(f)).rejects.toThrow("changed");
  expect(fs.readFileSync(path.join(f.root, "review/status.json"), "utf8")).toBe(
    "concurrent user edit",
  );
});
it("checks unsafe targets before any request", async () => {
  const { f, state } = await fixture();
  f.config.storybook.chromatic.status = "policy/inventory.json";
  f.write("project.json", f.config);
  await expect(restore(f)).rejects.toThrow("overlap");
  expect(state.requests).toEqual([]);
});
