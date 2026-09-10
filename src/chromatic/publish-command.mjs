import { loadProject } from "../project/config.mjs";
import { statusError } from "./status.mjs";
import { publishChromaticReview } from "./publish.mjs";
export async function runChromaticPublishCommand(options, rest, json, io) {
  if (
    rest.length ||
    Object.keys(options).some(
      (k) => !["config", "root", "branch", "json"].includes(k),
    ) ||
    !options.config ||
    options.config === "true" ||
    options.root === "true" ||
    !options.branch ||
    options.branch === "true"
  )
    throw statusError(
      "Use chromatic review publish --config <project.json> --branch <review-branch> [--root <dir>]",
    );
  const project = loadProject(options.config, { rootDir: options.root });
  const result = {
    resultVersion: "1",
    command: "chromatic review publish",
    scope: "remote-visual-review",
    projectRoot: project.rootDir,
    ...(await publishChromaticReview(project, { branchName: options.branch })),
  };
  if (json) io.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    io.stdout.write(
      `${result.ok ? "✓" : "✗"} chromatic review publish: ${result.review?.diffOutcome ?? "not performed"}\n`,
    );
    for (const error of result.errors) io.stderr.write(`${error}\n`);
  }
  return result.ok ? 0 : 1;
}
