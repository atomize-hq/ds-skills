import { loadProject } from "../project/config.mjs";
import { evaluateChromaticStatus, statusError } from "./status.mjs";
import {
  prepareChromaticContext,
  assertChromaticContext,
  readStatusBytes,
  parseStatusBytes,
} from "./context.mjs";
import { restoreChromaticStatus } from "./restore.mjs";
export function validateChromaticStatusProject(project, { gitSha } = {}) {
  const context = prepareChromaticContext(project, gitSha);
  if (!context.ok) return { ok: false, errors: context.errors };
  const parsed = parseStatusBytes(
    readStatusBytes(project.storybook.chromatic.status),
  );
  const evaluation = parsed.errors.length
    ? { ok: false, errors: parsed.errors }
    : evaluateChromaticStatus(parsed.data, context.options);
  assertChromaticContext(project, context);
  return {
    ...evaluation,
    revision: context.options.expectedGitSha,
    review: evaluation.ok ? parsed.data.review : null,
  };
}
export async function runChromaticStatusCommand(name, options, rest, json, io) {
  if (
    rest.length ||
    Object.keys(options).some(
      (key) => !["root", "config", "sha", "json"].includes(key),
    ) ||
    !options.config ||
    options.config === "true" ||
    options.root === "true" ||
    (options.sha !== undefined && !/^[a-f0-9]{40}$/.test(options.sha))
  )
    throw statusError(
      `Use ${name} --config <project.json> [--root <dir>] [--sha <full-sha>]`,
    );
  const project = loadProject(options.config, { rootDir: options.root });
  const evaluation = name.endsWith("restore")
    ? await restoreChromaticStatus(project, { gitSha: options.sha })
    : validateChromaticStatusProject(project, { gitSha: options.sha });
  const result = {
    resultVersion: "1",
    command: name,
    scope: "review-artifact-conformance",
    projectRoot: project.rootDir,
    ...evaluation,
  };
  if (json) io.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    io.stdout.write(`${result.ok ? "✓" : "✗"} ${name}\n`);
    for (const error of result.errors) io.stderr.write(`${error}\n`);
    io.stdout.write(
      "Scope: artifact identity, freshness, scope and policy consistency; not a new remote review or a release-claim approval.\n",
    );
  }
  return result.ok ? 0 : 1;
}
