import { readReleaseRecord, releaseError } from "./record.mjs";
import { resolveRelease, installPrefix } from "./resolve.mjs";
import { acquireRelease } from "./acquire.mjs";

export async function runReleaseCommand(name, options, rest, json, io) {
  const installing = name === "release install";
  const allowed = new Set([
    "record",
    "prefix",
    "json",
    ...(installing ? ["mirror", "force"] : []),
  ]);
  if (
    rest.length ||
    Object.keys(options).some((key) => !allowed.has(key)) ||
    !options.record ||
    ["record", "prefix", "mirror"].some(
      (key) => options[key] === "true" || options[key] === "",
    )
  )
    throw releaseError(
      "RELEASE_ARGUMENT",
      `Use ${name} --record <reviewed-pin.json> [--prefix <directory>]${installing ? " [--mirror <base-url>] [--force]" : ""}`,
    );
  const record = readReleaseRecord(options.record);
  const prefix = options.prefix ?? installPrefix();
  const resolve = () => resolveRelease({ record, prefix });
  let result,
    acquisition = null;
  try {
    result = resolve();
  } catch (error) {
    if (!installing || error.code !== "RELEASE_NOT_INSTALLED") throw error;
  }
  if (installing && (!result?.ok || options.force === "true")) {
    acquisition = await acquireRelease({
      record,
      prefix,
      baseUrl: options.mirror ?? process.env.DS_SKILLS_BASE_URL,
    });
    result = resolve();
  }
  const report = {
    resultVersion: "1",
    command: name,
    ...result,
    ...(installing ? { acquired: acquisition !== null } : {}),
  };
  if (json) io.stdout.write(`${JSON.stringify(report)}\n`);
  else {
    io.stdout.write(
      `${report.ok ? "✓" : "✗"} ${name}: ${record.release} at ${result.home}\n`,
    );
    for (const diagnostic of report.diagnostics)
      io.stderr.write(
        `[${diagnostic.code}] ${diagnostic.path}: ${diagnostic.message}\n`,
      );
  }
  return report.ok ? 0 : 1;
}
