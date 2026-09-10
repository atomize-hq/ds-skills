import { hostError, checkProjectInstallation } from "./state.mjs";
import { setupProjectInstallation } from "./setup.mjs";

export async function runProjectCommand(name, options, rest, json, io) {
  if (
    rest.length ||
    Object.keys(options).some(
      (key) => !["root", "prefix", "json"].includes(key),
    ) ||
    !options.root ||
    ["root", "prefix"].some(
      (key) => options[key] === "true" || options[key] === "",
    )
  )
    throw hostError(`Use ${name} --root <project> [--prefix <directory>]`);
  const args = { root: options.root, prefix: options.prefix };
  const result =
    name === "project setup"
      ? await setupProjectInstallation(args)
      : checkProjectInstallation(args);
  const report = { resultVersion: "1", command: name, ...result };
  if (json) io.stdout.write(`${JSON.stringify(report)}\n`);
  else {
    io.stdout.write(`${report.ok ? "✓" : "✗"} ${name}: ${report.root}\n`);
    for (const d of report.diagnostics)
      io.stderr.write(`[${d.code}] ${d.path}: ${d.message}\n`);
  }
  return report.ok ? 0 : 1;
}
