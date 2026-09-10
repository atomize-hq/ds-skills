import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { projectFixture } from "./fixture.mjs";
import { setupProjectInstallation } from "./setup.mjs";
import { readPinnedResultAt, runPinnedAt } from "./invoke.mjs";
const fixtures = [];
async function fixture() {
  const f = projectFixture();
  fixtures.push(f);
  await setupProjectInstallation(f.options);
  return f;
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0))
    fs.rmSync(f.root, { recursive: true, force: true });
});
it("invokes by absolute installed path, binds cwd to the project and preserves argv", async () => {
  const f = await fixture();
  const cwd = process.cwd();
  const args = ["tokens", "validate", "--config", "a file.json"];
  const result = readPinnedResultAt(f.project, args, "tokens validate", {
    prefix: f.prefix,
  });
  expect(result).toMatchObject({
    evaluated: true,
    status: 0,
    result: {
      ok: true,
      cwd: fs.realpathSync(f.project),
      args: [...args, "--json"],
    },
  });
  expect(process.cwd()).toBe(cwd);
});
it("represents a completed nonconformant evaluation without declaring it successful", async () => {
  const f = await fixture();
  vi.stubEnv("HOST_TEST_MODE", "fail");
  expect(
    readPinnedResultAt(f.project, ["tokens", "validate"], "tokens validate", {
      prefix: f.prefix,
    }),
  ).toMatchObject({ evaluated: true, status: 1, result: { ok: false } });
});
it.each([
  "exit2",
  "exit3",
  "not-json",
  "array",
  "version",
  "identity",
  "contradiction",
])("rejects invalid machine outcome %s", async (mode) => {
  const f = await fixture();
  vi.stubEnv("HOST_TEST_MODE", mode);
  expect(() =>
    readPinnedResultAt(f.project, ["tokens", "validate"], "tokens validate", {
      prefix: f.prefix,
    }),
  ).toThrow(/could not evaluate|single JSON|disagrees/);
});
it.each([undefined, "proof validate", "tokens  validate"])(
  "requires explicit matching machine identity %s before execution",
  async (command) => {
    const f = await fixture();
    expect(() =>
      readPinnedResultAt(f.project, ["tokens", "validate"], command, {
        prefix: f.prefix,
      }),
    ).toThrow("exact requested command");
    expect(fs.existsSync(path.join(f.project, "executed.txt"))).toBe(false);
  },
);
it("never executes a corrupt release even when its labels still match", async () => {
  const f = await fixture();
  fs.appendFileSync(path.join(f.home, "lib/bin/ds-skills.mjs"), "// corrupt");
  expect(() =>
    runPinnedAt(f.project, ["--version"], { prefix: f.prefix, capture: true }),
  ).toThrow("failed verification");
  expect(fs.existsSync(path.join(f.project, "executed.txt"))).toBe(false);
});
it("refuses project skew before execution", async () => {
  const f = await fixture();
  fs.unlinkSync(f.receipt);
  expect(() =>
    runPinnedAt(f.project, ["--version"], { prefix: f.prefix, capture: true }),
  ).toThrow("Missing or changed");
  expect(fs.existsSync(path.join(f.project, "executed.txt"))).toBe(false);
});
it("runs the dependency-free copied launcher from outside the consumer with no PATH fallback", async () => {
  const f = await fixture();
  const result = spawnSync(
    process.execPath,
    [f.launcher, "tokens", "validate"],
    {
      cwd: f.root,
      encoding: "utf8",
      env: { ...process.env, DS_SKILLS_PREFIX: f.prefix, PATH: "" },
    },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).cwd).toBe(fs.realpathSync(f.project));
  const missing = spawnSync(process.execPath, [f.launcher, "--version"], {
    cwd: f.root,
    encoding: "utf8",
    env: { ...process.env, DS_SKILLS_PREFIX: path.join(f.root, "missing") },
  });
  expect(missing.status).toBe(2);
  expect(missing.stdout).toBe("");
});
it("exports bound machine helpers without running on import", async () => {
  const f = await fixture();
  const script = `const m = await import(${JSON.stringify(pathToFileURL(f.launcher).href)}); if (process.argv.length !== 1) throw Error('bad fixture'); process.stdout.write(JSON.stringify(m.readPinnedResult(['tokens','validate'], 'tokens validate', {prefix:${JSON.stringify(f.prefix)}})));`;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    { cwd: f.root, encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    evaluated: true,
    result: { cwd: fs.realpathSync(f.project) },
  });
});
it.each([["--unknown"], ["--install", "--typo"], ["--check", "--force"]])(
  "rejects invalid launcher options %j",
  async (...args) => {
    const f = await fixture();
    const result = spawnSync(process.execPath, [f.launcher, ...args], {
      cwd: f.root,
      encoding: "utf8",
      env: { ...process.env, DS_SKILLS_PREFIX: f.prefix },
    });
    expect(result.status, result.stderr).toBe(2);
    expect(result.stdout).toBe("");
    expect(fs.existsSync(path.join(f.project, "executed.txt"))).toBe(false);
  },
);

it("can be imported from a Node stdin module without treating dash as a real executable", async () => {
  const f = await fixture();
  const result = spawnSync(process.execPath, ["--input-type=module", "-"], {
    cwd: f.root,
    encoding: "utf8",
    input: `await import(${JSON.stringify(pathToFileURL(f.launcher).href)}); process.stdout.write('imported');`,
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe("imported");
  expect(fs.existsSync(path.join(f.project, "executed.txt"))).toBe(false);
});

it("does not execute an earlier selection if the reviewed pin changes while checking outputs", async () => {
  const f = await fixture();
  const read = fs.readFileSync;
  const receipt = fs.realpathSync(f.receipt);
  vi.spyOn(fs, "readFileSync").mockImplementation((file, ...args) => {
    const bytes = read(file, ...args);
    if (String(file) === receipt) fs.appendFileSync(f.pin, "\n");
    return bytes;
  });
  expect(() =>
    runPinnedAt(f.project, ["--version"], { prefix: f.prefix, capture: true }),
  ).toThrow("pin changed");
  expect(fs.existsSync(path.join(f.project, "executed.txt"))).toBe(false);
});
