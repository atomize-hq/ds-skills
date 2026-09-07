import path from "node:path";
import process from "node:process";

import {
  captureBaselines,
  checkBaselines,
  type BaselineResult,
} from "../figma/baseline.js";
import { checkDrift, observedStateGuidance } from "../figma/drift-command.js";
import { startTokenServer } from "../figma/serve.js";
import { verifyMapping } from "../figma/verify.js";
import { buildPlugin, PluginBuildError } from "../plugin/build.js";
import { EXIT_NONCONFORMANT, EXIT_OK } from "./exit-codes.js";
import { CliArgumentError } from "./rail.js";

/**
 * The five figma commands. Each reads a **local** path for everything it needs;
 * none of them reaches the network, and none of them requires a Figma session.
 * That is what lets `verify` and `drift` be gate commands at all.
 */

export interface Streams {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
}

type Options = Readonly<Record<string, string>>;

export async function runFigmaCommand(
  name: string,
  options: Options,
  io: Streams,
): Promise<number> {
  switch (name) {
    case "figma plugin build":
      return pluginBuild(options, io);
    case "figma verify":
      return verify(options, io);
    case "figma drift":
      return drift(options, io);
    case "figma baseline":
      return baseline(options, io);
    default:
      return serve(options, io);
  }
}

async function pluginBuild(options: Options, io: Streams): Promise<number> {
  try {
    const result = await buildPlugin({
      configPath: required(options, "config"),
      outDir: required(options, "out"),
    });
    io.stdout.write(
      `✓ Built "${result.config.plugin.name}" into ${path.relative(process.cwd(), result.outDir)}\n` +
        `  collection: ${result.config.collectionName}\n` +
        `  artifact:   ${result.config.artifactUrl}\n` +
        "  import manifest.json into Figma to load it\n",
    );
    return EXIT_OK;
  } catch (error) {
    if (error instanceof PluginBuildError) {
      io.stderr.write(`[RAIL_PLUGIN_BUILD_FAILED] ${error.message}\n`);
      return EXIT_NONCONFORMANT;
    }
    throw error;
  }
}

function verify(options: Options, io: Streams): number {
  const result = verifyMapping({
    configPath: required(options, "config"),
    expectPath: required(options, "expect"),
    artifactPath: required(options, "artifact"),
  });

  io.stdout.write(
    `${result.ok ? "✓" : "✗"} figma verify: ${result.summary.join(" ")}\n`,
  );
  for (const error of result.errors) io.stderr.write(`${error}\n`);
  return result.ok ? EXIT_OK : EXIT_NONCONFORMANT;
}

function drift(options: Options, io: Streams): number {
  if (options["observed"] === undefined) {
    throw new CliArgumentError(observedStateGuidance);
  }

  const result = checkDrift({
    configPath: required(options, "config"),
    artifactPath: required(options, "artifact"),
    observedPath: options["observed"],
  });

  io.stdout.write(`${result.rendered}\n`);
  io.stdout.write(`  observed from ${result.observedFrom}\n`);
  return result.ok ? EXIT_OK : EXIT_NONCONFORMANT;
}

async function baseline(options: Options, io: Streams): Promise<number> {
  const request = {
    configPath: required(options, "config"),
    artifactPath: required(options, "artifact"),
    outDir: required(options, "out"),
    pluginOutDir: options["plugin-out"],
    force: options["force"] === "true",
  };

  // Checking and capturing are different commands wearing one name, so which
  // one ran is stated rather than inferred from whether anything changed.
  const checking = options["check"] === "true";
  if (checking && request.force) {
    throw new CliArgumentError(
      "--check never writes, so --force is meaningless with it",
    );
  }

  const result: BaselineResult = checking
    ? await checkBaselines(request)
    : await captureBaselines(request);

  io.stdout.write(
    `${checking ? "checked" : "captured"} ${result.outcomes.length} baseline(s)\n`,
  );
  for (const outcome of result.outcomes) {
    io.stdout.write(`  ${outcome.status.padEnd(9)} ${outcome.file}\n`);
  }
  for (const error of result.errors) io.stderr.write(`${error}\n`);
  return result.ok ? EXIT_OK : EXIT_NONCONFORMANT;
}

async function serve(options: Options, io: Streams): Promise<number> {
  const server = await startTokenServer({
    configPath: required(options, "config"),
    artifactPath: required(options, "artifact"),
    driftReportPath: options["drift-out"],
    port: options["port"] === undefined ? undefined : Number(options["port"]),
  });

  // Readiness goes to stderr: stdout belongs to whatever a caller might parse,
  // and a long-running command's progress is not a result.
  io.stderr.write(
    `[RAIL_SERVE_READY] http://localhost:${server.port}${server.artifactUrlPath}\n` +
      `[RAIL_SERVE_READY] POST http://localhost:${server.port}${server.driftReportUrlPath}` +
      `${options["drift-out"] === undefined ? " (refused: no --drift-out)" : ""}\n`,
  );

  await new Promise<void>((resolve) => {
    const stop = () => {
      void server.close().then(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return EXIT_OK;
}

function required(options: Options, flag: string): string {
  const value = options[flag];
  if (value === undefined || value === "true" || value.length === 0) {
    throw new CliArgumentError(`--${flag} is required and takes a path`);
  }
  return value;
}
