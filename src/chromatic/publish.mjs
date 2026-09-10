import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { withDirectoryLock } from "../io/lock.mjs";
import {
  prepareChromaticContext,
  assertChromaticContext,
  readStatusBytes,
} from "./context.mjs";
import { preflightStatusWrites, commitStatusBytes } from "./write.mjs";
import {
  capturePublicationBuild,
  assertPublicationBuild,
} from "./publish-build.mjs";
import { publicationStatus } from "./publish-status.mjs";
import { evaluateChromaticStatus, statusError } from "./status.mjs";
import { executeChromaticProvider } from "./provider-process.mjs";
export function publicationOptions(config, { branchName, token, scratch }) {
  return {
    branchName,
    projectToken: token,
    storybookBuildDir: config.buildDir,
    configFile: path.join(scratch, "config.json"),
    diagnosticsFile: path.join(scratch, "diagnostics.json"),
    logFile: path.join(scratch, "provider.log"),
    ci: true,
    interactive: false,
    logLevel: "silent",
    skipUpdateCheck: true,
    skip: config.mode === "deferred",
    exitZeroOnChanges: true,
    exitOnceUploaded: false,
    autoAcceptChanges: false,
    onlyChanged: false,
    uploadMetadata: false,
  };
}
function assertCommittedInputs(project, context) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
  );
  const entries = [...context.snapshot.files].map(([file, text]) => [
    path.relative(project.rootDir, file).split(path.sep).join("/"),
    Buffer.from(text),
  ]);
  try {
    const output = execFileSync(
      "git",
      [
        "--no-optional-locks",
        "ls-tree",
        "-rz",
        context.options.expectedGitSha,
        "--",
        ...entries.map(([name]) => name),
      ],
      {
        cwd: project.rootDir,
        env: { ...env, GIT_TERMINAL_PROMPT: "0" },
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const committed = new Map(
      output
        .split("\0")
        .filter(Boolean)
        .map((line) => {
          const match = /^(100644|100755) blob ([a-f0-9]{40})\t([\s\S]+)$/.exec(
            line,
          );
          if (!match) throw Error();
          return [match[3], match[2]];
        }),
    );
    for (const [name, bytes] of entries) {
      const hash = crypto
        .createHash("sha1")
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest("hex");
      if (committed.get(name) !== hash) throw Error();
    }
  } catch {
    throw statusError(
      "Publication proof/configuration inputs must be tracked and unchanged from the selected Git HEAD (exact committed bytes)",
    );
  }
}
export async function publishChromaticReview(
  project,
  {
    branchName,
    env = process.env,
    providerExecutor = executeChromaticProvider,
  } = {},
) {
  const config = project.storybook?.chromatic?.publish;
  if (!config || !project.storybook?.proof)
    throw statusError(
      "Chromatic publication and Storybook proof must be configured",
    );
  if (
    typeof branchName !== "string" ||
    !branchName.trim() ||
    branchName.trim() !== branchName ||
    /[\r\n\0]/.test(branchName)
  )
    throw statusError("Publication requires an explicit branch name");
  preflightStatusWrites(project);
  const status = project.storybook.chromatic;
  for (const target of [
    project.configPath,
    project.storybook.inventory,
    project.storybook.tierPolicy,
    project.storybook.versionPolicy,
    project.storybook.proof.componentSpecs,
    ...project.storybook.proof.storyRoots,
    path.join(project.rootDir, ".git"),
    path.join(project.rootDir, ".ds-skills"),
    path.join(project.rootDir, "ds-skills.release.json"),
    status.status,
    status.lockPath,
    `${status.lockPath}.guard`,
  ]) {
    const r = path.relative(config.buildDir, target),
      inverse = path.relative(target, config.buildDir);
    const within = (rel) =>
      rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
    if (within(r) || within(inverse))
      throw statusError(
        "Publication build overlaps protected source/configuration or writable status/lock paths",
      );
  }
  const token = env[config.tokenEnv];
  if (typeof token !== "string" || !token.trim())
    throw statusError(
      `Publication requires ${config.tokenEnv}; no remote review was performed`,
    );
  return withDirectoryLock(
    status.lockPath,
    async () => {
      const context = prepareChromaticContext(project);
      if (!context.ok) return { ...context, artifactStatus: "not-written" };
      assertCommittedInputs(project, context);
      const buildDigest = capturePublicationBuild(
        config.buildDir,
        context.options.scope.storyIds,
      );
      const previous = readStatusBytes(status.status);
      const scratch = fs.mkdtempSync(
        path.join(os.tmpdir(), "ds-skills-review-"),
      );
      try {
        fs.writeFileSync(path.join(scratch, "config.json"), "{}\n", {
          mode: 0o600,
        });
        const providerResult = await providerExecutor({
          rootDir: project.rootDir,
          env,
          gitSha: context.options.expectedGitSha,
          branchName,
          repository: config.repository,
          timeoutSeconds: config.timeoutSeconds,
          options: publicationOptions(config, {
            branchName,
            token: token.trim(),
            scratch,
          }),
        });
        assertChromaticContext(project, context);
        assertCommittedInputs(project, context);
        assertPublicationBuild(
          config.buildDir,
          context.options.scope.storyIds,
          buildDigest,
        );
        const record = publicationStatus(context, {
          branchName,
          mode: config.mode,
          providerResult,
        });
        const evaluated = evaluateChromaticStatus(record, context.options);
        if (!evaluated.ok)
          throw statusError(
            "Provider returned unusable review evidence; previous status was preserved",
          );
        const artifactStatus = commitStatusBytes(
          project,
          context,
          Buffer.from(JSON.stringify(record, null, 2) + "\n"),
          previous,
        );
        const ok = record.review.diffOutcome !== "failed";
        return {
          ok,
          errors: ok
            ? []
            : ["[CHROMATIC_REVIEW_FAILED] Provider reported a failed review"],
          artifactStatus,
          revision: context.options.expectedGitSha,
          buildDigest,
          provider: "chromatic@15.3.0",
          providerExitCode: providerResult.code,
          review: record.review,
          buildUrl: record.build.url,
        };
      } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
      }
    },
    { label: "chromatic review publish" },
  );
}
