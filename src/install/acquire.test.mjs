import fs from "node:fs";
import { afterEach, expect, it } from "vitest";
import { acquireRelease } from "./acquire.mjs";
import { installedFixture } from "./fixture.mjs";
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const f = installedFixture();
  roots.push(f.root);
  return f;
}
it("downloads the selected pinned bootstrap and verifies before execution", async () => {
  const f = fixture(),
    urls = [];
  let executed;
  const result = await acquireRelease({
    record: f.record,
    prefix: f.prefix,
    platform: "linux",
    arch: "x64",
    fetchBytes: async (url) => {
      urls.push(url);
      return f.bootstrap;
    },
    run: async (request) => {
      executed = request;
      expect(fs.readFileSync(request.file)).toEqual(f.bootstrap);
    },
  });
  expect(urls).toEqual([
    `https://github.com/${f.record.repository}/releases/download/${f.record.release}/install.sh`,
  ]);
  expect(result.digest).toBe(f.record.bootstrap.sha256);
  expect(fs.existsSync(executed.file)).toBe(false);
});
it("propagates an explicit mirror to the verified bootstrap without changing digest authority", async () => {
  const f = fixture();
  let executed;
  await acquireRelease({
    record: f.record,
    prefix: f.prefix,
    platform: "win32",
    arch: "x64",
    baseUrl: "http://127.0.0.1:9000/releases",
    fetchBytes: async (url) => {
      expect(url).toBe("http://127.0.0.1:9000/releases/install.ps1");
      return f.bootstrap;
    },
    run: async (request) => {
      executed = request;
    },
  });
  expect(executed).toMatchObject({
    platform: "win32",
    baseUrl: "http://127.0.0.1:9000/releases",
    prefix: f.prefix,
  });
});
it("never reaches execution on a digest mismatch", async () => {
  const f = fixture();
  let reached = false;
  await expect(
    acquireRelease({
      record: f.record,
      prefix: f.prefix,
      fetchBytes: async () => Buffer.from("changed"),
      run: () => {
        reached = true;
      },
    }),
  ).rejects.toThrow("Nothing was executed");
  expect(reached).toBe(false);
});
it("waits for execution and cleans only its private temporary directory on failure", async () => {
  const f = fixture();
  let file;
  await expect(
    acquireRelease({
      record: f.record,
      prefix: f.prefix,
      fetchBytes: async () => f.bootstrap,
      run: async (request) => {
        file = request.file;
        await Promise.resolve();
        throw new Error("execution failed");
      },
    }),
  ).rejects.toThrow("execution failed");
  expect(fs.existsSync(file)).toBe(false);
  expect(fs.existsSync(f.home)).toBe(true);
});
it.each([
  "file:///tmp/release",
  "https://user:password@example.test/release",
  "https://example.test/release?token=secret",
])(
  "rejects invalid/authenticated mirror %s without fetching",
  async (baseUrl) => {
    const f = fixture();
    let fetched = false;
    await expect(
      acquireRelease({
        record: f.record,
        prefix: f.prefix,
        baseUrl,
        fetchBytes: async () => {
          fetched = true;
          return f.bootstrap;
        },
      }),
    ).rejects.toThrow("mirror");
    expect(fetched).toBe(false);
  },
);
it("checks unsupported platforms before acquiring any bytes", async () => {
  const f = fixture();
  let fetched = false;
  await expect(
    acquireRelease({
      record: f.record,
      prefix: f.prefix,
      platform: "win32",
      arch: "arm64",
      fetchBytes: async () => {
        fetched = true;
        return f.bootstrap;
      },
    }),
  ).rejects.toThrow("No tested release");
  expect(fetched).toBe(false);
});
