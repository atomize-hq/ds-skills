import fs from "node:fs";
import { afterEach, expect, it } from "vitest";
import { chromaticProjectFixture, exampleSha } from "./fixture.mjs";
import { statusHttpFixture } from "../../scripts/checks/chromatic-http-fixture.mjs";
import { restoreChromaticStatus } from "./restore.mjs";
import { findStatusArtifact } from "./github-artifact.mjs";
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
it("does not select from an incomplete pagination window", async () => {
  const { f, state } = await fixture();
  state.listing = {
    total_count: 400,
    artifacts: Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      name: "other",
    })),
  };
  await expect(restore(f)).rejects.toThrow();
  expect(state.requests.some((r) => r.path === "/download")).toBe(false);
});
it("selects newest qualified artifact by creation time rather than list order", async () => {
  const { f, state } = await fixture();
  const meta = {
    name: `review-${exampleSha}`,
    expired: false,
    workflow_run: {
      id: 123,
      repository_id: 9,
      head_repository_id: 9,
      head_sha: exampleSha,
    },
  };
  const artifacts = [
    { ...meta, id: 2, created_at: "2026-09-09T12:01:00Z" },
    { ...meta, id: 3, created_at: "2026-09-09T12:00:00Z" },
  ];
  const client = {
    json: async (endpoint) =>
      endpoint.includes("/runs/") ? state.run : { total_count: 2, artifacts },
  };
  expect(
    (
      await findStatusArtifact(
        client,
        f.project().storybook.chromatic.restore,
        exampleSha,
      )
    ).id,
  ).toBe(2);
});

it("finds a matching artifact beyond the first page without trusting partial listings", async () => {
  const { f, state } = await fixture();
  const name = `review-${exampleSha}`;
  const old = Array.from({ length: 100 }, (_, i) => ({
    id: 1000 + i,
    name,
    expired: true,
  }));
  const selected = {
    id: 77,
    name,
    expired: false,
    created_at: "2026-09-09T12:00:00Z",
    workflow_run: {
      id: 123,
      head_sha: exampleSha,
      repository_id: 9,
      head_repository_id: 9,
    },
  };
  const calls = [];
  const client = {
    json: async (endpoint) => {
      calls.push(endpoint);
      if (endpoint.includes("/runs/")) return state.run;
      return {
        total_count: 101,
        artifacts: endpoint.includes("page=2&") ? [selected] : old,
      };
    },
  };
  expect(
    (
      await findStatusArtifact(
        client,
        f.project().storybook.chromatic.restore,
        exampleSha,
      )
    ).id,
  ).toBe(77);
  expect(calls).toHaveLength(3);
});

it("classifies malformed workflow metadata as unavailable, not a runtime crash", async () => {
  const { f, state } = await fixture();
  state.run.repository.full_name = 42;
  await expect(restore(f)).rejects.toMatchObject({ code: "CHROMATIC_INPUT" });
});
it("classifies a null API listing as unavailable", async () => {
  const { f } = await fixture();
  await expect(
    findStatusArtifact(
      { json: async () => null },
      f.project().storybook.chromatic.restore,
      exampleSha,
    ),
  ).rejects.toMatchObject({ code: "CHROMATIC_INPUT" });
});

it("refuses a short page even when its advertised total fits on that page", async () => {
  const { f, state } = await fixture();
  state.listing = { total_count: 2, artifacts: [{ id: 1, name: "other" }] };
  await expect(restore(f)).rejects.toMatchObject({ code: "CHROMATIC_INPUT" });
  expect(state.requests.some((r) => r.path === "/download")).toBe(false);
});

it("requires same-repository numeric identity, not just matching names", async () => {
  const { f, state } = await fixture();
  state.run.head_repository.id = 10;
  state.artifact = {
    workflow_run: {
      id: 123,
      repository_id: 9,
      head_repository_id: 10,
      head_sha: exampleSha,
    },
  };
  await expect(restore(f)).rejects.toMatchObject({ code: "CHROMATIC_INPUT" });
});
