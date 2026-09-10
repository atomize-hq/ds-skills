import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { chromaticProjectFixture } from "./fixture.mjs";
import { publishChromaticReview } from "./publish.mjs";
const roots = [];
afterEach(() => {
  for (const r of roots.splice(0))
    fs.rmSync(r, { recursive: true, force: true });
});
function fixture({ mode = "review", ...options } = {}) {
  const f = chromaticProjectFixture(options);
  roots.push(f.root);
  f.config.storybook.chromatic.publish = {
    provider: "chromatic-node-v15",
    buildDir: "built",
    tokenEnv: "TEST_REVIEW_TOKEN",
    repository: "example/design",
    timeoutSeconds: 20,
    mode,
  };
  f.write("project.json", f.config);
  f.write("built/index.html", "built");
  f.write("built/iframe.html", "iframe");
  const id = `${f.component}--default`;
  f.write("built/index.json", {
    v: 5,
    entries: { [id]: { id, type: "story" } },
  });
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: f.root,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    });
  git("init", "-q");
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "fixture",
  );
  return f;
}
const published = {
  code: 0,
  changeCount: 0,
  errorCount: 0,
  interactionTestFailuresCount: 0,
  buildUrl: "https://www.chromatic.com/build?id=1",
};
const run = (f, providerExecutor = async () => published, extra = {}) =>
  publishChromaticReview(f.project(), {
    branchName: "feature/example",
    env: { TEST_REVIEW_TOKEN: "secret" },
    providerExecutor,
    ...extra,
  });
it.each([
  ["passed", "review", { ...published }, true],
  ["changed", "review", { ...published, changeCount: 1 }, true],
  ["failed", "review", { ...published, code: 2 }, false],
  ["failed", "review", { ...published, errorCount: 1 }, false],
  [
    "failed",
    "review",
    { ...published, interactionTestFailuresCount: 1 },
    false,
  ],
  ["deferred", "deferred", { code: 0, buildUrl: published.buildUrl }, true],
  ["failed", "deferred", { code: 2, buildUrl: published.buildUrl }, false],
])(
  "records %s in %s mode without turning failure into deferral",
  async (outcome, mode, result, ok) => {
    const f = fixture({ mode });
    const r = await run(f, async () => result);
    expect(r.ok).toBe(ok);
    expect(r.review.diffOutcome).toBe(outcome);
    expect(r.buildDigest).toMatch(/^[a-f0-9]{64}$/);
    const record = JSON.parse(
      fs.readFileSync(path.join(f.root, "review/status.json")),
    );
    expect(record.review.diffOutcome).toBe(outcome);
    expect(record.revision.gitSha).toBe(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: f.root,
        encoding: "utf8",
      }).trim(),
    );
  },
);
it("supports a materially different component/tier scope", async () => {
  const f = fixture({
    component: "workspace-tree",
    tier: "composite",
    consumer: "desktop-review",
  });
  expect((await run(f)).review.scope.componentTiers).toEqual({
    "workspace-tree": "composite",
  });
});
it("pins provider options and cleans isolated logs/config after success", async () => {
  const f = fixture();
  let scratch;
  await run(f, async (input) => {
    scratch = path.dirname(input.options.configFile);
    expect(input.rootDir).toBe(f.root);
    expect(input.options.storybookBuildDir).toBe(path.join(f.root, "built"));
    expect(input.options).toMatchObject({
      skip: false,
      exitOnceUploaded: false,
      autoAcceptChanges: false,
      onlyChanged: false,
      exitZeroOnChanges: true,
    });
    expect(JSON.parse(fs.readFileSync(input.options.configFile))).toEqual({});
    fs.writeFileSync(input.options.logFile, "private log");
    return published;
  });
  expect(fs.existsSync(scratch)).toBe(false);
});
it("missing token is unavailable and never reports a local success", async () => {
  const f = fixture();
  let called = false;
  await expect(
    run(
      f,
      async () => {
        called = true;
        return published;
      },
      { env: {} },
    ),
  ).rejects.toMatchObject({ code: "CHROMATIC_INPUT" });
  expect(called).toBe(false);
});
it.each([
  ["missing count", { code: 0, buildUrl: published.buildUrl }],
  ["invalid count", { ...published, changeCount: -1 }],
  ["invalid URL", { ...published, buildUrl: "file:///tmp/x" }],
  ["missing URL", { code: 2 }],
  ["missing code", { changeCount: 0, buildUrl: published.buildUrl }],
])("preserves previous bytes on %s", async (_, result) => {
  const f = fixture(),
    file = path.join(f.root, "review/status.json"),
    before = fs.readFileSync(file);
  await expect(run(f, async () => result)).rejects.toMatchObject({
    code: "CHROMATIC_INPUT",
  });
  expect(fs.readFileSync(file)).toEqual(before);
});
it.each(["built/index.html", "library/demo.stories.tsx", "review/status.json"])(
  "detects concurrent changes to %s",
  async (file) => {
    const f = fixture(),
      target = path.join(f.root, "review/status.json"),
      before = fs.readFileSync(target);
    await expect(
      run(f, async () => {
        f.write(file, "changed");
        return published;
      }),
    ).rejects.toThrow(/changed/i);
    expect(fs.readFileSync(target)).toEqual(
      file === "review/status.json" ? Buffer.from("changed") : before,
    );
  },
);
it("refuses uncommitted proof inputs before invoking the provider", async () => {
  const f = fixture();
  f.write(
    "library/demo.stories.tsx",
    "export default {title:'notice'}; export const Default={args:{}};",
  );
  let called = false;
  await expect(
    run(f, async () => {
      called = true;
      return published;
    }),
  ).rejects.toThrow(/tracked and unchanged/);
  expect(called).toBe(false);
});
it.each(["absent", "wrong index", "symlink"])(
  "refuses an %s build without invoking the provider",
  async (mode) => {
    const f = fixture();
    if (mode === "absent")
      fs.unlinkSync(path.join(f.root, "built/iframe.html"));
    if (mode === "wrong index")
      f.write("built/index.json", { v: 5, entries: {} });
    if (mode === "symlink")
      fs.symlinkSync("/etc/hosts", path.join(f.root, "built/link"));
    let called = false;
    await expect(
      run(f, async () => {
        called = true;
        return published;
      }),
    ).rejects.toMatchObject({ code: "CHROMATIC_INPUT" });
    expect(called).toBe(false);
  },
);

it.each([".", "library", "review", "policy", ".ds-skills"])(
  "rejects protected build overlap %s before executing",
  async (buildDir) => {
    const f = fixture();
    f.config.storybook.chromatic.publish.buildDir = buildDir;
    f.write("project.json", f.config);
    let called = false;
    await expect(
      run(f, async () => {
        called = true;
        return published;
      }),
    ).rejects.toThrow();
    expect(called).toBe(false);
  },
);

it("does not trust assume-unchanged index flags for source identity", async () => {
  const f = fixture();
  execFileSync(
    "git",
    ["update-index", "--assume-unchanged", "library/demo.stories.tsx"],
    { cwd: f.root },
  );
  f.write(
    "library/demo.stories.tsx",
    "export default {title:'notice'}; export const Default={args:{}};",
  );
  await expect(run(f)).rejects.toThrow(/exact committed bytes/);
});
