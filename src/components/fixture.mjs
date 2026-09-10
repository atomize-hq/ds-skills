import { execFileSync } from "node:child_process";
import { chromaticProjectFixture } from "../chromatic/fixture.mjs";
import { evaluateStorybookProof } from "../storybook/proof-command.mjs";
export function componentPolicyFixture() {
  return {
    report: "component-reports/status.json",
    lockPath: "locks/components.lock",
    maxAgeMinutes: 60,
    profiles: {
      advancement: {
        requirements: ["story-coverage", "visual-review"],
        consumers: { local: "advisory", ci: "blocking" },
      },
      publication: {
        requirements: ["figma-publication"],
        consumers: { release: "blocking" },
      },
      reference: {
        requirements: ["story-coverage"],
        consumers: { docs: "blocking" },
      },
      other: { requirements: [], consumers: { local: "advisory" } },
    },
  };
}
export function commitFixture(root) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
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
  return git("rev-parse", "HEAD").trim();
}
export async function componentProjectFixture(options = {}) {
  const f = chromaticProjectFixture(options);
  f.config.components = componentPolicyFixture();
  f.write("project.json", f.config);
  const revision = commitFixture(f.root);
  f.status.revision.gitSha = revision;
  f.write("review/status.json", f.status);
  await evaluateStorybookProof(f.project(), "build");
  return { ...f, revision };
}
