import { commands, type CommandSpec } from "./commands.js";
import { EXIT_CANNOT_EVALUATE, EXIT_OK } from "./exit-codes.js";
import { parseArgv } from "./parse.js";

export interface CliIo {
  readonly argv: readonly string[];
  /** The package's own version, supplied by the executable that knows where it lives. */
  readonly version: string;
  readonly stdout?: { write(chunk: string): unknown };
  readonly stderr?: { write(chunk: string): unknown };
}

export function runCli(io: CliIo): number {
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
      // Dispatching is not implementing. An unimplemented command must never
      // look like a clean run, and must not print a result on stdout — a caller
      // parsing stdout would read the silence as an empty rail.
      stderr.write(
        `[CLI_COMMAND_NOT_IMPLEMENTED] \`${invocation.command.path.join(" ")}\` is not implemented in this build.\n` +
          `Usage once available: ${invocation.command.usage}\n`,
      );
      return EXIT_CANNOT_EVALUATE;
  }
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
