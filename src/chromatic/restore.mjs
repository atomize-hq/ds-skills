import crypto from "node:crypto";
import { withDirectoryLock } from "../io/lock.mjs";
import { evaluateChromaticStatus, statusError } from "./status.mjs";
import {
  prepareChromaticContext,
  assertChromaticContext,
  readStatusBytes,
  parseStatusBytes,
} from "./context.mjs";
import { preflightStatusWrites, commitStatusBytes } from "./write.mjs";
import { githubClient } from "./http.mjs";
import { findStatusArtifact } from "./github-artifact.mjs";
import { readZipMember } from "./zip-member.mjs";
export async function restoreChromaticStatus(
  project,
  { gitSha, env = process.env } = {},
) {
  if (!project.storybook?.chromatic?.restore || !project.storybook.proof)
    throw statusError(
      "Chromatic restore and Storybook proof must be configured",
    );
  preflightStatusWrites(project);
  return withDirectoryLock(
    project.storybook.chromatic.lockPath,
    async () => {
      const context = prepareChromaticContext(project, gitSha);
      if (!context.ok)
        return {
          ok: false,
          errors: context.errors,
          artifactStatus: "not-written",
        };
      const previous = readStatusBytes(project.storybook.chromatic.status);
      const config = project.storybook.chromatic.restore;
      const client = githubClient(config, env);
      const artifact = await findStatusArtifact(
        client,
        config,
        context.options.expectedGitSha,
      );
      assertChromaticContext(project, context);
      if (!artifact)
        return {
          ok: false,
          errors: [
            "[CHROMATIC_ARTIFACT_MISSING] No current artifact from the configured completed workflow/revision",
          ],
          artifactStatus: "not-written",
        };
      const archive = await client.archive(artifact.id);
      if (
        typeof artifact.digest !== "string" ||
        !/^sha256:[a-f0-9]{64}$/.test(artifact.digest) ||
        `sha256:${crypto.createHash("sha256").update(archive).digest("hex")}` !==
          artifact.digest
      )
        throw statusError(
          "GitHub artifact archive digest is absent or mismatched",
        );
      const bytes = readZipMember(archive, config.entry);
      const parsed = parseStatusBytes(bytes);
      const evaluation = parsed.errors.length
        ? { ok: false, errors: parsed.errors }
        : evaluateChromaticStatus(parsed.data, context.options);
      assertChromaticContext(project, context);
      if (!evaluation.ok)
        return { ...evaluation, artifactStatus: "not-written" };
      const artifactStatus = commitStatusBytes(
        project,
        context,
        bytes,
        previous,
      );
      return {
        ok: true,
        errors: [],
        artifactStatus,
        artifactId: artifact.id,
        sourceRunId: artifact.workflow_run.id,
        revision: context.options.expectedGitSha,
        review: parsed.data.review,
      };
    },
    { label: "chromatic status restore" },
  );
}
