import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { provisionProject } from "../../../src/project-host/provision.mjs";
import { hostError } from "../../../src/project-host/paths.mjs";

try {
  const env = process.env;
  if (
    !env.GITHUB_WORKSPACE ||
    !env.GITHUB_OUTPUT ||
    (!env.RUNNER_TEMP && !env.DS_SKILLS_ACTION_PREFIX)
  )
    throw hostError(
      "CI setup requires GITHUB_WORKSPACE, GITHUB_OUTPUT and RUNNER_TEMP (or explicit install-prefix)",
    );
  const root = path.resolve(
    env.GITHUB_WORKSPACE,
    env.DS_SKILLS_ACTION_PROJECT || ".",
  );
  const prefix = path.resolve(
    env.GITHUB_WORKSPACE,
    env.DS_SKILLS_ACTION_PREFIX || path.join(env.RUNNER_TEMP, "ds-skills"),
  );
  const result = await provisionProject({
    root,
    prefix,
    baseUrl: env.DS_SKILLS_ACTION_MIRROR || undefined,
  });
  process.exitCode = result.status;
  if (result.status === 0)
    for (const name of ["release", "prefix", "launcher"]) {
      const delimiter = `ds_skills_${crypto.randomUUID()}`;
      fs.appendFileSync(
        env.GITHUB_OUTPUT,
        `${name}<<${delimiter}\n${result[name]}\n${delimiter}\n`,
      );
    }
} catch (error) {
  process.stderr.write(
    `[${error.code ?? "PROJECT_CI_SETUP"}] ${error.message}\n`,
  );
  process.exitCode = error.name === "CannotEvaluateError" ? 2 : 3;
}
