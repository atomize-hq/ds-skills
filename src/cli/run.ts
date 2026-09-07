import { CannotEvaluateError } from "../figma/profile.mjs";
import { runValidateArtifactCli } from "../validate/artifact.mjs";
import { commands, type CommandSpec } from "./commands.js";
import { runFigmaCommand } from "./figma.js";
import { PluginBuildError } from "../plugin/build.js";
import {
  EXIT_CANNOT_EVALUATE,
  EXIT_NONCONFORMANT,
  EXIT_OK,
  EXIT_UNEXPECTED,
} from "./exit-codes.js";
import { parseArgv } from "./parse.js";
import {
  CliArgumentError,
  ledgerParity,
  ledgerValidate,
  proofValidate,
  type RailOptions,
} from "./rail.js";
import { serializeResult, type RailResult } from "./result.js";

export interface CliIo {
  readonly argv: readonly string[];
  /** The package's own version, supplied by the executable that knows where it lives. */
  readonly version: string;
  readonly stdout?: { write(chunk: string): unknown };
  readonly stderr?: { write(chunk: string): unknown };
}

export async function runCli(io: CliIo): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const invocation = parseArgv(io.argv);

  switch (invocation.kind) {
    case "version":
      stdout.write(`${io.version}\n`);
      return EXIT_OK;

    case "help":
      stdout.write(formatHelp(invocation.command));
      return EXIT_OK;

    case "unknown":
      stderr.write(
        `[CLI_UNKNOWN_COMMAND] no such command: ${invocation.tokens.join(" ")}\n` +
          `Run \`ds-skills --help\` for the command list.\n`,
      );
      return EXIT_CANNOT_EVALUATE;

    case "json-unsupported":
      stderr.write(
        `[CLI_JSON_UNSUPPORTED] --json is not available for \`${invocation.command.path.join(" ")}\`.\n` +
          `Machine-readable commands: ${machineReadableNames().join(", ")}\n`,
      );
      return EXIT_CANNOT_EVALUATE;

    case "command":
      if (!invocation.command.implemented) {
        // Dispatching is not implementing. An unimplemented command must never
        // look like a clean run, and must not print a result on stdout — a
        // caller parsing stdout would read the silence as an empty rail.
        stderr.write(
          `[CLI_COMMAND_NOT_IMPLEMENTED] \`${invocation.command.path.join(" ")}\` is not implemented in this build.\n` +
            `Usage once available: ${invocation.command.usage}\n`,
        );
        return EXIT_CANNOT_EVALUATE;
      }
      return runCommand(
        invocation.command,
        invocation.options,
        invocation.rest,
        invocation.json,
        { stdout, stderr },
      );
  }
}

type Streams = {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
};

async function runCommand(
  command: CommandSpec,
  options: Readonly<Record<string, string>>,
  rest: readonly string[],
  json: boolean,
  io: Streams,
): Promise<number> {
  const name = command.path.join(" ");

  try {
    if (name === "validate") {
      return runValidateArtifactCli([...rest, ...profileArgs(options)], io);
    }
    if (name.startsWith("figma ")) {
      return await runFigmaCommand(name, options, io);
    }

    const railOptions: RailOptions = {
      ledger: options["ledger"],
      proof: options["proof"],
      profile: options["profile"],
    };
    const result =
      name === "ledger validate"
        ? ledgerValidate(railOptions)
        : name === "ledger parity"
          ? ledgerParity(railOptions)
          : proofValidate(railOptions);

    return emit(result, json, io);
  } catch (error) {
    // The 1/2 line is the whole point: 1 is an answer, 2 is the absence of one.
    // Both of these are the absence of one, so neither writes to stdout.
    if (error instanceof CannotEvaluateError) {
      io.stderr.write(`[${error.code}] ${error.message}\n`);
      return EXIT_CANNOT_EVALUATE;
    }
    if (error instanceof PluginBuildError) {
      // An evaluated failure of the build, not an inability to run it.
      io.stderr.write(`[RAIL_PLUGIN_BUILD_FAILED] ${error.message}\n`);
      return EXIT_NONCONFORMANT;
    }
    if (error instanceof CliArgumentError) {
      io.stderr.write(
        `[${error.code}] ${error.message}\nUsage: ${command.usage}\n`,
      );
      return EXIT_CANNOT_EVALUATE;
    }
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`[UNEXPECTED_RUNTIME_FAILURE] ${message}\n`);
    return EXIT_UNEXPECTED;
  }
}

function profileArgs(options: Readonly<Record<string, string>>): string[] {
  const profile = options["profile"];
  return profile === undefined ? [] : ["--profile", profile];
}

/** A completed evaluation always emits a result, conformant or not. */
function emit(result: RailResult, json: boolean, io: Streams): number {
  if (json) {
    // stdout carries the result and nothing else, so a caller parsing it never
    // has to strip human formatting.
    io.stdout.write(serializeResult(result));
    return result.ok ? EXIT_OK : EXIT_NONCONFORMANT;
  }

  io.stdout.write(renderHuman(result));
  // A reported blocker on an otherwise-conformant record is part of the report,
  // not an error — `verified-stale` is a legitimate state, and the pre-CLI
  // validators printed it on stdout with exit 0. Only a failing run writes to
  // stderr, so a governance step that captures stderr still sees what it saw.
  const stream = result.ok ? io.stdout : io.stderr;
  for (const diagnostic of result.diagnostics) {
    stream.write(
      `[${diagnostic.phase}] [${diagnostic.code}]${diagnostic.field === undefined ? "" : ` ${diagnostic.field}:`} ${diagnostic.message}\n`,
    );
  }
  return result.ok ? EXIT_OK : EXIT_NONCONFORMANT;
}

function renderHuman(result: RailResult): string {
  const lines = [
    `${result.ok ? "✓" : "✗"} ${result.command}: ${result.ledgerPath ?? result.proofPath ?? "-"}`,
  ];
  if (result.state !== null) {
    // `promotable` is only meaningful where conformance was evaluated; parity
    // reports a state without one, and printing a default there would assert
    // something the command never computed.
    lines.push(
      `[RAIL_STATE] state=${result.state}` +
        (result.promotable === null ? "" : ` promotable=${result.promotable}`),
    );
  }
  if (result.proofPath !== null && result.ledgerPath !== null) {
    lines.push(`[RAIL_PUBLICATION] proof=${result.proofPath}`);
  }
  if (result.evidence !== null) {
    const evidence = Object.entries(result.evidence)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    lines.push(`[RAIL_EVIDENCE] ${evidence}`);
  }
  if (result.rail !== null) {
    lines.push(
      `[RAIL_STATUS] freshness=${result.rail.freshness} outcome=${result.rail.outcome} reasonCodes=${result.rail.reasonCodes.join(",") || "-"}`,
    );
  }
  // What the gate proves, said where a reader will see it — and only where an
  // attestation was actually consulted, so it never overstates a command that
  // read no proof at all.
  if (result.proofPath !== null) {
    lines.push(
      "[RAIL_SCOPE] validated attestation and consistency; not observed remote synchronization",
    );
  }
  return `${lines.join("\n")}\n`;
}

function machineReadableNames(): string[] {
  return commands.filter((c) => c.machineReadable).map((c) => c.path.join(" "));
}

function formatHelp(command: CommandSpec | undefined): string {
  if (command !== undefined) {
    const flags = [
      command.machineReadable ? "supports --json" : "human output only",
      command.effect,
    ].join(", ");
    return `${command.usage}\n\n  ${command.summary}\n  (${flags})\n`;
  }

  const width = Math.max(...commands.map((c) => c.path.join(" ").length));
  const lines = commands.map(
    (c) => `  ${c.path.join(" ").padEnd(width)}  ${c.summary}`,
  );
  return (
    `ds-skills — design-system tooling for token rails\n\n` +
    `Usage: ds-skills <command> [options]\n\n` +
    `Commands:\n${lines.join("\n")}\n\n` +
    `  --json     machine-readable result (${machineReadableNames().join(", ")})\n` +
    `  --help     this help, or a command's usage\n` +
    `  --version  the installed release identity\n`
  );
}
