import { fileURLToPath } from "node:url";
import { loadProject } from "../project/config.mjs";
import { libraryError } from "../libraries/definition.mjs";
import {
  desiredCuratedInstallation,
  assertCuratedExecutingRelease,
  checkCuratedDesired,
} from "./install-state.mjs";
import { installCuratedSkills } from "./install.mjs";
export async function runCuratedInstallCommand(name, options, rest, json, io) {
  if (
    rest.length ||
    Object.keys(options).some(
      (k) => !["config", "root", "prefix", "json"].includes(k),
    ) ||
    !options.config ||
    ["config", "root", "prefix"].some(
      (k) => options[k] === "true" || options[k] === "",
    )
  )
    throw libraryError(
      `Use ${name} --config <project.json> [--root <dir>] [--prefix <dir>]`,
    );
  const project = loadProject(options.config, { rootDir: options.root });
  let result;
  try {
    const desired = desiredCuratedInstallation(project, options.prefix);
    assertCuratedExecutingRelease(
      desired,
      fileURLToPath(new URL("install-state.mjs", import.meta.url)),
    );
    result =
      name === "curation install"
        ? await installCuratedSkills(project, options.prefix)
        : checkCuratedDesired(desired);
  } catch (error) {
    if (error.code !== "CURATION_CONTENT_INVALID") throw error;
    result = {
      ok: false,
      artifactStatus: "not-written",
      diagnostics: [{ code: error.code, message: error.message }],
    };
  }
  const report = {
    resultVersion: "1",
    command: name,
    scope: "installed-curated-library-skills",
    projectRoot: project.rootDir,
    ...result,
  };
  if (json) io.stdout.write(JSON.stringify(report) + "\n");
  else {
    io.stdout.write(
      `${report.ok ? "✓" : "✗"} ${name}: ${report.artifactStatus}\n`,
    );
    for (const d of report.diagnostics)
      io.stderr.write(`[${d.code}] ${d.path ?? ""}: ${d.message}\n`);
  }
  return report.ok ? 0 : 1;
}
